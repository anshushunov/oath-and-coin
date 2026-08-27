import { SortedMap } from '../collections/sorted-map.ts';
import type { CommitmentState } from '../domain/commitment.ts';
import { CommitmentState as Commitment } from '../domain/commitment.ts';
import { compareNeedIds, type NeedId } from '../domain/need-id.ts';
import {
  CoverageVerdict,
  DeficitKind,
  OutcomeGrade,
  OutcomeIntentKind,
  type NeedCoverage,
  type OutcomeIntent
} from '../domain/outcome.ts';
import { OutcomeReasonCodes } from '../domain/outcome-reason-codes.ts';
import { compareHeroIds } from '../ids/hero-id.ts';
import { multiplyInt32, toInt32 } from '../integer-division.ts';

import { coverNeeds, type CoverageContext, type CoverageParticipant } from './needs-coverage.ts';
import { termsOf } from './outcome-grade.ts';

/**
 * What the resolver says happened, in the order it happened (`RESOLUTION_SPEC` §4.4),
 * together with §4.7's classification of a shortfall and §4.8's "worst covered".
 *
 * Every intent becomes one event and one line on the debrief screen. None of them carries
 * a campaign identifier: `eventId` and `stateVersion` are the command's business, and
 * keeping them out is what lets this be exercised on a synthetic crew (`ADR-014` §3).
 */

/** A crew member as the intents read them: what he can do, and how willingly he came. */
export interface CrewMember extends CoverageParticipant {
  readonly commitment: CommitmentState;
}

/** Everything the intent builders read. */
export interface IntentInput {
  readonly needs: SortedMap<NeedId, number>;
  readonly crew: readonly CrewMember[];
  readonly context: CoverageContext;

  /** `coverNeeds(needs, crew, context)`, computed once by the caller and passed in. */
  readonly coverage: readonly NeedCoverage[];
}

/**
 * One intent per need (`RESOLUTION_SPEC` §4.4), in the vocabulary's own order — which is
 * the order `coverNeeds` already answered in, and the order that reaches the artifact.
 *
 * The delta is `effective − required` on both branches, so "covered" and "short" are one
 * piece of arithmetic read two ways rather than two rules that could drift apart. Only
 * these intents carry a non-zero delta; §4.4's derived kinds all carry `0`.
 */
export function coverageIntentsFor(input: IntentInput): readonly OutcomeIntent[] {
  return input.coverage.map((row) => {
    const closed = row.verdict === CoverageVerdict.Closed;

    return {
      kind: closed ? OutcomeIntentKind.NeedCovered : OutcomeIntentKind.NeedShort,
      hero: null,
      need: row.need,
      marginDelta: toInt32(row.effective - row.required),
      reason: needReasonFor(row.verdict),
      // §4.7: classified at creation and written down, never derived later by a reader
      // who no longer has the crew to run the counterfactual against.
      gap: closed ? null : gapFor(row, input),
      consequence: null,
      magnitude: 0
    };
  });
}

/**
 * The heroes who gave way early (`RESOLUTION_SPEC` §4.4).
 *
 * A hero qualifies when his own agreement was less than freely given *and* he is
 * answerable (§2.2) for at least one need that did not close. Both halves matter: a
 * willing hero on a wrecked contract did not give way, and a reluctant hero whose own
 * needs all closed did not either — he was reluctant and still delivered.
 *
 * **At most one per hero.** The same person appearing three times in the feed would read
 * as the reason the contract failed, and §4.4 refuses to say that. The need he carries is
 * the worst covered of *his own* (§4.8) — the line has to be about something he was
 * responsible for, not about the contract's worst moment.
 *
 * Walked in `HeroId` order rather than in the order the crew arrived, so the feed does not
 * depend on how a command assembled its list.
 */
export function falteredEarlyIntentsFor(input: IntentInput): readonly OutcomeIntent[] {
  const byNeed = new Map(input.coverage.map((row) => [row.need, row]));

  return [...input.crew]
    .sort((left, right) => compareHeroIds(left.hero, right.hero))
    .flatMap((crewMember) => {
      if (crewMember.commitment === Commitment.Committed) {
        return [];
      }

      const own = crewMember.capability.expertise
        .keys()
        .map((need) => byNeed.get(need))
        .filter((row): row is NeedCoverage => row !== undefined);

      if (!own.some((row) => row.verdict !== CoverageVerdict.Closed)) {
        return [];
      }

      const need = worstCoveredNeed(own);
      if (need === null) {
        return [];
      }

      return [
        {
          kind: OutcomeIntentKind.FalteredEarly,
          hero: crewMember.hero,
          need,
          marginDelta: 0,
          reason: OutcomeReasonCodes.FalteredEarly,
          gap: null,
          consequence: null,
          magnitude: 0
        }
      ];
    });
}

/**
 * Whether the objective was taken (`RESOLUTION_SPEC` §4.4, §5.3).
 *
 * **Read off the grade, not off the sign of the margin.** The two disagree on a whole band
 * of outcomes and the spec used to say both. "Costly" reaches below zero on purpose (§4.6)
 * — a crew one point short of a hundred still did the job — and §5.3 pays that crew the
 * full fee. Taking the sign instead would put "the objective was lost" in the feed at
 * exactly the outcomes the patron pays for as taken. Owner's decision, 2026-08-27: costly
 * means *done, and it cost you*.
 *
 * This is also why `gradeFromIntents` cannot read this intent: the grade decides it, so
 * asking it to read the answer would close a circle. The order is coverage → margin →
 * grade → objective (§4.6).
 *
 * A list of one rather than a bare intent, so a caller concatenating §4.4's kinds does not
 * have to special-case this one — and so a later rule that answers with none or two does
 * not change the shape at every call site.
 */
export function objectiveIntentsFor(grade: OutcomeGrade): readonly OutcomeIntent[] {
  const taken = termsOf(grade).objectiveTaken;

  return [
    {
      kind: taken ? OutcomeIntentKind.ObjectiveTaken : OutcomeIntentKind.ObjectiveLost,
      hero: null,
      need: null,
      // Derived: an outcome must not feed the margin it was derived from (§4.4).
      marginDelta: 0,
      reason: taken ? OutcomeReasonCodes.ObjectiveTaken : OutcomeReasonCodes.ObjectiveLost,
      gap: null,
      consequence: null,
      magnitude: 0
    }
  ];
}

/**
 * The need covered worst, as a share of what it asked (`RESOLUTION_SPEC` §4.8).
 *
 * Shares and not shortfalls: a need 20 short of 200 was 90 per cent answered, and one 10
 * short of 20 was half answered. The second is the worse failure even though the first
 * number is larger, and a rule reading absolute shortfalls would point the wound at the
 * wrong need every time weights are unequal.
 *
 * Compared by cross-multiplication rather than by dividing into a percentage, for the
 * reason every comparison in this system is: a truncated share puts a boundary on the
 * wrong side of itself. Ties go to `compareNeedIds`.
 */
export function worstCoveredNeed(coverage: readonly NeedCoverage[]): NeedId | null {
  let worst: NeedCoverage | null = null;

  for (const row of coverage) {
    if (worst === null || isWorseCovered(row, worst)) {
      worst = row;
    }
  }

  return worst?.need ?? null;
}

function isWorseCovered(candidate: NeedCoverage, incumbent: NeedCoverage): boolean {
  const left = multiplyInt32(candidate.supplied, incumbent.required);
  const right = multiplyInt32(incumbent.supplied, candidate.required);

  if (left !== right) {
    return left < right;
  }

  return compareNeedIds(candidate.need, incumbent.need) < 0;
}

/**
 * What the feed calls a need that came out this way (`RESOLUTION_SPEC` §4.4).
 *
 * Exported because the debrief screen has to name the same three lines and cannot get the
 * code any other way: §3.4 projects the *verdict* onto the event and not the reason, and
 * `ContractResolution` stores a verdict per need and no code beside it. A screen deriving
 * its own would be a second statement of this mapping in the layer least able to notice it
 * drifting — the shape `ADR-015` refused for `counted`. One statement, two readers.
 */
export function needReasonFor(verdict: CoverageVerdict) {
  switch (verdict) {
    case CoverageVerdict.Closed:
      return OutcomeReasonCodes.NeedClosed;
    case CoverageVerdict.Weak:
      return OutcomeReasonCodes.NeedWeak;
    case CoverageVerdict.Uncovered:
      return OutcomeReasonCodes.NeedUncovered;
  }
}

/**
 * Which of the two shortfall diagnoses this need earned (`RESOLUTION_SPEC` §4.7).
 *
 * A second counterfactual, and it has to be one: "was anybody answerable for this need"
 * is the question that *looks* like the answer and is not. A hero holding the need at an
 * expertise of five is answerable and could not have closed it at any grade — the right
 * people were not there, whatever the roster says. So the rule re-supplies the need with
 * everyone answerable raised to `grade = 100` and asks whether that closes it:
 *
 * - it closes → `Capability`: the right people, not enough skill;
 * - it does not → `Coverage`: nobody in the crew could have answered for it.
 *
 * Exactly two of the three diagnoses the product spec names, and computed rather than
 * assigned.
 */
function gapFor(row: NeedCoverage, input: IntentInput): DeficitKind {
  const perfected: CoverageParticipant[] = input.crew.map((crewMember) =>
    crewMember.capability.expertise.has(row.need)
      ? { hero: crewMember.hero, capability: { ...crewMember.capability, grade: 100 } }
      : crewMember
  );

  const [counterfactual] = coverNeeds(
    SortedMap.from<NeedId, number>(compareNeedIds, [[row.need, row.weight]]),
    perfected,
    input.context
  );

  return counterfactual?.verdict === CoverageVerdict.Closed
    ? DeficitKind.Capability
    : DeficitKind.Coverage;
}
