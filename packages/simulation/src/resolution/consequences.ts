import {
  ConsequenceKind,
  type HeroConsequence,
  type NeedCoverage,
  type OutcomeGrade,
  type OutcomeIntent
} from '../domain/outcome.ts';
import { OutcomeReasonCodes } from '../domain/outcome-reason-codes.ts';
import { compareHeroIds, type HeroId } from '../ids/hero-id.ts';

import { termsOf } from './outcome-grade.ts';
import { worstCoveredNeed } from './outcome-intent.ts';

/**
 * What an outcome costs the people who went (`RESOLUTION_SPEC` §5.1, §5.2).
 *
 * Its own module rather than a corner of the resolver, because these are the rules a
 * balancing pass and a playtest argue about — "who gets hurt when a contract goes wrong"
 * is the part of an outcome a player remembers — and they are answerable on hand-built
 * coverage without a contract, a crew or a grade being assembled around them.
 *
 * **Nothing here is assigned to "whoever brought least".** In an additive model the
 * weakest member still improved the result, and an obligatory culprit after every
 * imperfect outcome teaches the player to look for a scapegoat rather than at his own
 * choice of crew (§6.3).
 */

/** What one wound costs the hero who takes it (`RESOLUTION_SPEC` §5.1). */
export const WOUND_MAGNITUDE = 1;

/** What one grudge adds to a hero's grievance. */
export const GRUDGE_MAGNITUDE = 1;

/** What a catastrophe costs the key hero's trust in the guild. */
export const TRUST_LOST_MAGNITUDE = 1;

/** Everything §5.1 and §5.2 read. */
export interface ConsequenceInput {
  readonly grade: OutcomeGrade;

  /** Every need, with who was answerable for it and what each of them personally brought. */
  readonly coverage: readonly NeedCoverage[];

  /** §4.4's `faltered_early` intents — at most one per hero, each naming his own need. */
  readonly faltered: readonly OutcomeIntent[];

  /** The one man the guild dealt with; `null` only on state no command builds. */
  readonly keyHero: HeroId | null;
}

/**
 * Who this outcome cost, and what (`RESOLUTION_SPEC` §5.1).
 *
 * **The count comes from `termsOf`, and the recipe is chosen by it.** §5.1 declares two
 * non-empty shapes and no others: one record at the two middle steps, two at a
 * catastrophe. Reading the count from the grade's own terms rather than restating the
 * table keeps "how many" stated once.
 *
 * **A grudge comes before a wound wherever only one record is allowed.** Edition 1.0 put
 * the wound first at a limit of one, which made `Grudge` unreachable at those grades
 * entirely — a rule that could never fire is a rule that is not there.
 *
 * **Fewer records than declared is possible in exactly one case, and it is written down**
 * (§5.2): a crew answerable for none of the contract's needs has nobody who was on the
 * point, so there is no wound to record. No command assembles such a crew out of the
 * shipped content; the absence is declared rather than discovered.
 */
export function consequencesFor(input: ConsequenceInput): readonly HeroConsequence[] {
  const declared = termsOf(input.grade).maxConsequences;

  if (declared === 0) {
    return [];
  }

  if (declared === 1) {
    return present(input.faltered.length > 0 ? grudge(input) : wound(input));
  }

  // A catastrophe: the wound first, then either the man who gave way or the guild's own
  // standing with the hero it dealt with.
  return [
    ...present(wound(input)),
    ...present(input.faltered.length > 0 ? grudge(input) : trustLost(input))
  ];
}

const present = (consequence: HeroConsequence | null): readonly HeroConsequence[] =>
  consequence === null ? [] : [consequence];

/**
 * The hero who was on the point (`RESOLUTION_SPEC` §5.2).
 *
 * Two steps: the need that came out worst *of those anybody answered for*, and then, among
 * the heroes answerable for it, the one who personally brought the most to it.
 *
 * **"Of those anybody answered for" is the owner's decision of 2026-08-27, not a
 * convenience.** A need nobody in the crew held is supplied nothing and is therefore the
 * worst-covered of all — and has nobody to wound, while §5.1 declares exactly one record.
 * Read literally, a reachable outcome (a small unheld need beside a closed large one)
 * produced no consequence at all. Passing over it puts the wound on whoever held the worst
 * of the needs the crew did answer for; the hole in the crew stays a `coverage_gap` and
 * maims nobody.
 *
 * **The greatest contributor, not the smallest.** The line the screen writes is "he was on
 * the point" — the man who carried the most of the need that went worst is the one that is
 * true of.
 */
function wound(input: ConsequenceInput): HeroConsequence | null {
  const held = input.coverage.filter((row) => row.contributors.length > 0);

  // §4.8's comparison, borrowed rather than restated: shares by cross-multiplication, ties
  // by the vocabulary's own order.
  const need = worstCoveredNeed(held);
  const row = held.find((candidate) => candidate.need === need);
  if (row === undefined) {
    return null;
  }

  let onThePoint: (typeof row.contributors)[number] | null = null;
  for (const contributor of row.contributors) {
    if (onThePoint === null || isFurtherForward(contributor, onThePoint)) {
      onThePoint = contributor;
    }
  }

  return onThePoint === null
    ? null
    : {
        hero: onThePoint.hero,
        kind: ConsequenceKind.Wound,
        reason: OutcomeReasonCodes.WoundOnThePoint,
        magnitude: WOUND_MAGNITUDE
      };
}

interface Brought {
  readonly hero: HeroId;
  readonly amount: number;
}

/** Carried more of the need than the incumbent did; ties by hero id, so neither is arbitrary. */
function isFurtherForward(candidate: Brought, incumbent: Brought): boolean {
  return candidate.amount === incumbent.amount
    ? compareHeroIds(candidate.hero, incumbent.hero) < 0
    : candidate.amount > incumbent.amount;
}

/**
 * Carried less of it. Written out rather than expressed as `!isFurtherForward(...)`,
 * because the negation of "more, ties by lower id" is "less or equal, ties by *higher*
 * id" — which would answer the wrong hero on every tie.
 */
function broughtLess(candidate: Brought, incumbent: Brought): boolean {
  return candidate.amount === incumbent.amount
    ? compareHeroIds(candidate.hero, incumbent.hero) < 0
    : candidate.amount < incumbent.amount;
}

/**
 * The hero who resents it (`RESOLUTION_SPEC` §5.2): among those who gave way early, the
 * one who brought least to **his own** need — the need his own `faltered_early` names.
 *
 * His own, and not the contract's worst: two heroes can give way on two different needs,
 * and looking both up in one of them would find the other absent at nought and point at
 * him every time, whatever he actually did.
 */
function grudge(input: ConsequenceInput): HeroConsequence | null {
  let least: Brought | null = null;

  for (const intent of input.faltered) {
    const hero = intent.hero;
    if (hero === null) {
      continue;
    }

    const candidate = { hero, amount: broughtTo(input.coverage, intent.need, hero) };
    if (least === null || broughtLess(candidate, least)) {
      least = candidate;
    }
  }

  return least === null
    ? null
    : {
        hero: least.hero,
        kind: ConsequenceKind.Grudge,
        reason: OutcomeReasonCodes.GrudgeAfterFaltering,
        magnitude: GRUDGE_MAGNITUDE
      };
}

/**
 * What a catastrophe costs the guild's standing (`RESOLUTION_SPEC` §5.2): the key hero,
 * and nobody else.
 *
 * Edition 1.0 spent this on the whole crew, which produced up to six records where §5.1
 * declares two. It belongs to the one man the guild actually dealt with.
 */
function trustLost(input: ConsequenceInput): HeroConsequence | null {
  return input.keyHero === null
    ? null
    : {
        hero: input.keyHero,
        kind: ConsequenceKind.TrustLost,
        reason: OutcomeReasonCodes.TrustLostInDisaster,
        magnitude: TRUST_LOST_MAGNITUDE
      };
}

/** What one hero personally brought to one need, or nought if the need was not his. */
function broughtTo(
  coverage: readonly NeedCoverage[],
  need: OutcomeIntent['need'],
  hero: HeroId
): number {
  const row = coverage.find((candidate) => candidate.need === need);
  return row?.contributors.find((contributor) => contributor.hero === hero)?.amount ?? 0;
}
