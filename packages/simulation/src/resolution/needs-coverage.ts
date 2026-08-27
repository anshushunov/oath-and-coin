import { SortedMap } from '../collections/sorted-map.ts';
import type { HeroCapability } from '../domain/capability.ts';
import type { NeedId } from '../domain/need-id.ts';
import { CoverageVerdict, type NeedCoverage } from '../domain/outcome.ts';
import { compareHeroIds, type HeroId } from '../ids/hero-id.ts';
import { divideTowardZero, multiplyInt32 } from '../integer-division.ts';

/**
 * What a crew brought against what a contract asked (`RESOLUTION_SPEC` §4.1–§4.3).
 *
 * The first module of the resolution layer, and deliberately the one that knows least:
 * it reads a capability and a weight and answers a number. It does not know what a
 * `ContractState` is, what a commitment costs, or what grade any of this adds up to —
 * those live above it, and keeping them out is what lets this be exercised on a
 * synthetic crew and batch-run over the whole shipped roster (`ADR-014` §3).
 *
 * All arithmetic is integer and truncates toward zero at every division (`TDD` §7.4).
 * The order of operations is fixed by the spec rather than chosen here, because under
 * integer division it changes the answer.
 */

/**
 * Most a supply may count for, as a percentage of the requirement.
 *
 * The ceiling is what stops "close one need twice over and forget the other" from being
 * a winning answer to a two-need contract. Without it the strongest available hero is
 * again the right answer to everything, which is the kill-criterion `MVP_PLAN` §3.2
 * names and the reason a contract has more than one need at all.
 */
export const SURPLUS_CAP_PERCENT = 120;

/**
 * Least a supply may be, as a percentage of the requirement, to count as `weak` rather
 * than as `uncovered`.
 *
 * A percentage and not an absolute: a need asked for at weight 10 and a need asked for
 * at weight 100 are the same kind of shortfall at the same *proportion*, and a floor
 * stated in points would make the small need trivially weak and the large one
 * impossible.
 */
export const COVERAGE_FLOOR_PERCENT = 60;

/**
 * One member of the crew, as coverage reads them: an identity and what they can do.
 *
 * Not a `HeroState`, although every real caller has one. What this function needs is the
 * capability and the id to break ties by, and taking only those is what makes a coverage
 * table something a balancing run can build by hand — a test naming a whole `HeroState`
 * to ask "what do three heroes of forty supply" would be stating nine irrelevant fields.
 */
export interface CoverageParticipant {
  readonly hero: HeroId;
  readonly capability: HeroCapability;
}

/** Everything outside the crew and the needs that the arithmetic reads. */
export interface CoverageContext {
  /** The contract's own risk, `0..100` — what raises every requirement (§4.2). */
  readonly risk: number;
}

/**
 * One row per need, in the vocabulary's own order — which is the order that reaches the
 * canonical artifact, so it is a property of `compareNeedIds` and not of how the caller
 * built the map.
 */
export function coverNeeds(
  needs: SortedMap<NeedId, number>,
  crew: readonly CoverageParticipant[],
  context: CoverageContext
): readonly NeedCoverage[] {
  return needs.entries().map(([need, weight]) => coverOneNeed(need, weight, crew, context));
}

function coverOneNeed(
  need: NeedId,
  weight: number,
  crew: readonly CoverageParticipant[],
  context: CoverageContext
): NeedCoverage {
  // §4.2. Risk raises the bar; it is never subtracted from the margin afterwards. The
  // difference is not cosmetic: subtracted in the same units, a fully-staffed crew would
  // lose every dangerous contract, because the surplus a good crew can earn is bounded
  // by `SURPLUS_CAP_PERCENT` and could never catch a subtrahend that is not.
  const required = divideTowardZero(multiplyInt32(weight, 100 + context.risk), 100);

  // Everyone *answerable* for this need, whatever they are worth at it — including at
  // zero (`RESOLUTION_SPEC` §2.2). A hero the need is no business of does not appear,
  // and that absence is the fact `faltered_early` and the wound choice read later.
  const contributors = crew
    .filter((member) => member.capability.expertise.has(need))
    .map((member) => ({ hero: member.hero, amount: contributionOf(member, need) }))
    // Descending by what they bring, ties by hero id — the order the halving below
    // applies to, and the order the debrief screen shows. Sorted here rather than
    // assumed of the caller: the crew arrives in whatever order a command assembled it,
    // and the answer must not depend on that (§10.1's independence property).
    .sort((left, right) =>
      left.amount === right.amount
        ? compareHeroIds(left.hero, right.hero)
        : right.amount - left.amount
    );

  // §4.3. Diminishing returns: the k-th best is halved k times. This is the answer to
  // "take four of the same hero" — the fourth copy of a specialist is worth an eighth of
  // the first, so a crew of duplicates loses to a crew that covers what was asked.
  //
  // **Each share is written down beside what the man brought, not only summed** (§4.3,
  // owner's decision 2026-08-27). The debrief screen shows both numbers per hero: what he
  // can do, and how much of it counted. Only the first, and a crew's names add up to more
  // than the need received — a fourth swordsman reads as useful. Only the second, and two
  // identical heroes show different numbers with the sort order deciding which is which.
  // Written here rather than derived by a reader, because deriving it means re-applying
  // `2^k` and knowing this sort — a second statement of the rule. Every rollup a screen
  // wants is then addition, and addition is not a second statement of anything.
  const counted = contributors.map((contributor, index) => ({
    ...contributor,
    counted: divideTowardZero(contributor.amount, 2 ** index)
  }));

  const supplied = counted.reduce((total, contributor) => total + contributor.counted, 0);

  const effective = Math.min(
    supplied,
    divideTowardZero(multiplyInt32(required, SURPLUS_CAP_PERCENT), 100)
  );

  return {
    need,
    weight,
    required,
    supplied,
    effective,
    // Read off `supplied`, never off `effective`: the capped number cannot exceed the
    // ceiling, so a verdict computed from it would call a need closed *at* the ceiling
    // and never beyond — and a crew that brought twice what was asked would read as
    // having barely managed.
    verdict: verdictFor(supplied, required),
    contributors: counted
  };
}

/** §4.1. An absent key is `0` — the hero was never answerable for this need. */
function contributionOf(member: CoverageParticipant, need: NeedId): number {
  const expertise = member.capability.expertise.get(need) ?? 0;
  return divideTowardZero(multiplyInt32(expertise, member.capability.grade), 100);
}

/**
 * §4.3's three verdicts.
 *
 * The floor is compared by cross-multiplication rather than by computing a percentage:
 * `supplied / required >= 0.6` in integers is either a division that truncates the
 * answer away or a float, and the whole arithmetic of this system is integral (`TDD`
 * §7.4).
 */
function verdictFor(supplied: number, required: number): CoverageVerdict {
  if (supplied >= required) {
    return CoverageVerdict.Closed;
  }

  if (multiplyInt32(supplied, 100) >= multiplyInt32(required, COVERAGE_FLOOR_PERCENT)) {
    return CoverageVerdict.Weak;
  }

  return CoverageVerdict.Uncovered;
}
