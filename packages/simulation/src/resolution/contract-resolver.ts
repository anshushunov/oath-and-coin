import { SortedMap } from '../collections/sorted-map.ts';
import type { CommitmentState } from '../domain/commitment.ts';
import {
  OutcomeIntentKind,
  type ContractResolution,
  type HeroConsequence,
  type HeroContribution,
  type NeedCoverage,
  type OutcomeGrade,
  type OutcomeIntent,
  type ResolutionDraft
} from '../domain/outcome.ts';
import { OutcomeReasonCodes } from '../domain/outcome-reason-codes.ts';
import { compareHeroIds, type HeroId } from '../ids/hero-id.ts';
import { toInt32 } from '../integer-division.ts';
import type { ContractState } from '../state/contract-state.ts';
import type { HeroState } from '../state/hero-state.ts';

import { consequencesFor } from './consequences.ts';
import { rankDeficits } from './deficits.ts';
import { reduceMargin } from './margin.ts';
import { coverNeeds, type CoverageContext } from './needs-coverage.ts';
import { gradeFromIntents, termsOf } from './outcome-grade.ts';
import {
  coverageIntentsFor,
  falteredEarlyIntentsFor,
  objectiveIntentsFor,
  type CrewMember,
  type IntentInput
} from './outcome-intent.ts';

/**
 * The whole of `RESOLUTION_SPEC` §4 and §5 as one answer: a contract, the crew that went
 * out on it, and what came back.
 *
 * **Here rather than in `domain/`, and that is §2.7 rather than an exception to it.**
 * {@link ResolutionInput} and {@link ContractResolver} name `ContractState` and
 * `HeroState`, so putting them beside the rest of §2.1's vocabulary would close exactly
 * the cycle the split exists to prevent (`domain/outcome.ts → state/contract-state.ts →
 * domain/outcome.ts`). They live above state, which is also the first place they are
 * callable.
 *
 * **The order of derivation is fixed and is part of the rule** (§4.6, as amended
 * 2026-08-27): coverage → the coverage intents → the margin → the grade → the objective →
 * the consequences → `contract_resolved`. It is the only non-circular order there is. The
 * objective follows the grade rather than the sign of the margin, because "costly" reaches
 * below zero on purpose and §5.3 pays that crew in full; and the grade therefore cannot
 * read the objective back, which is why `gradeFromIntents` is given the coverage intents
 * and not the finished list.
 *
 * **No campaign identifier goes in or comes out.** The draft is events-to-be and a result
 * to store; `eventId`, `stateVersion` and `commandId` belong to the command that applies
 * it (§3.3). Keeping them out is what lets this be exercised on a synthetic crew and
 * batch-run over the shipped roster for balancing (`ADR-014` §3).
 */

/** A contract and the crew that went out on it (`RESOLUTION_SPEC` §2.1). */
export interface ResolutionInput {
  readonly contract: ContractState;
  readonly crew: readonly {
    readonly hero: HeroState;
    /** How willingly he came, recorded when he answered and never recomputed (§2.4). */
    readonly commitment: CommitmentState;
  }[];
}

export type ContractResolver = (input: ResolutionInput) => ResolutionDraft;

/**
 * What happened when the crew went out (`RESOLUTION_SPEC` §4, §5).
 *
 * Deterministic and integral throughout: no clock, no randomness, no reading of anything
 * but the two arguments (`ADR-003`, `TDD` §7.4). The same contract and the same crew — in
 * any order — answer identically.
 */
export const draftResolution: ContractResolver = (input) => {
  const crew = input.crew.map(asCrewMember);
  const context: CoverageContext = { risk: input.contract.risk };

  // 1. Coverage: what was asked against what was brought (§4.1–§4.3).
  const coverage = coverNeeds(input.contract.needs, crew, context);
  const intentInput: IntentInput = { needs: input.contract.needs, crew, context, coverage };

  // 2. The intents that read off it — the ones that carry a delta, and the ones about the
  //    people who gave way. Both are facts about the coverage, so both are known before
  //    any of the arithmetic below.
  const covered = coverageIntentsFor(intentInput);
  const gaveWay = falteredEarlyIntentsFor(intentInput);

  // 3. The margin (§4.5) and 4. the step it lands on (§4.6). `covered` and not the whole
  //    list: the derived intents all carry a delta of nought, so passing them would change
  //    nothing — but `gradeFromIntents` also asks "did every need close", and that question
  //    is only about the coverage intents.
  const margin = reduceMargin(covered, crew.map(willingness));
  const totalRequired = coverage.reduce((sum, row) => toInt32(sum + row.required), 0);
  const grade = gradeFromIntents({ intents: covered, margin, totalRequired });

  // 5. The objective follows the step; 6. so does what the outcome cost the people.
  const objective = objectiveIntentsFor(grade);
  const consequences = consequencesFor({
    grade,
    coverage,
    faltered: gaveWay,
    keyHero: input.contract.offer.keyHero
  });

  // 7. And the closing intent, whose effect is what writes the result onto the contract —
  //    inside the transition rather than after it (§3.3).
  const intents: readonly OutcomeIntent[] = [
    ...covered,
    ...gaveWay,
    ...objective,
    ...consequences.map(sufferedIntentFor),
    resolvedIntentFor(grade)
  ];

  const { ranked, dominant } = rankDeficits({ intents: covered, crew });

  return {
    intents,
    resolution: {
      grade,
      coverage,
      contributions: contributionsOf(crew, coverage, intents),
      deficits: ranked,
      dominant,
      consequences
    } satisfies ContractResolution
  };
};

/**
 * A `HeroState` as this layer reads it: what he can do, and how willingly he came.
 *
 * Everything else about him — what he wanted, what he feared, what he would not do — was
 * spent when he answered. A principle that would have kept him at home does not reduce the
 * contribution of the man who went.
 */
function asCrewMember(crewMember: ResolutionInput['crew'][number]): CrewMember {
  return {
    hero: crewMember.hero.id,
    capability: crewMember.hero.capability,
    commitment: crewMember.commitment
  };
}

const willingness = (crewMember: CrewMember): CommitmentState => crewMember.commitment;

/**
 * One line per consequence (`RESOLUTION_SPEC` §3.4): the same fact the stored result
 * carries, in the chronology the debrief screen reads.
 */
function sufferedIntentFor(consequence: HeroConsequence): OutcomeIntent {
  return {
    kind: OutcomeIntentKind.ConsequenceSuffered,
    hero: consequence.hero,
    need: null,
    // Derived: an outcome must not feed the margin it was derived from (§4.4).
    marginDelta: 0,
    reason: consequence.reason,
    gap: null,
    consequence: consequence.kind,
    magnitude: consequence.magnitude
  };
}

/**
 * The closing intent (`RESOLUTION_SPEC` §3.3), always last.
 *
 * **Its reason is the objective's own, and §2.1 is why.** `OUTCOME_REASON_CODES` names no
 * code for "the contract was resolved" — the nine it declares are about needs, about
 * giving way, about the objective and about what people suffered — and inventing a tenth
 * here would grow the outcome vocabulary from inside an implementation. What this intent
 * says is exactly what the objective one said: whether the job was done. The event it
 * becomes carries the grade (§3.4), which is the fact that is not a repetition.
 */
function resolvedIntentFor(grade: OutcomeGrade): OutcomeIntent {
  return {
    kind: OutcomeIntentKind.ContractResolved,
    hero: null,
    need: null,
    marginDelta: 0,
    reason: termsOf(grade).objectiveTaken
      ? OutcomeReasonCodes.ObjectiveTaken
      : OutcomeReasonCodes.ObjectiveLost,
    gap: null,
    consequence: null,
    magnitude: 0
  };
}

/**
 * What each member of the crew is recorded as having brought (`RESOLUTION_SPEC` §2.5,
 * §6.1).
 *
 * **Every member, including one who brought nothing.** §2.5 requires
 * `contributions.keys() === acceptedBy` in both directions: a hero the debrief screen looks
 * up and does not find is a hole where a number should be, and a contribution recorded for
 * somebody who never accepted is a number attributed to a man who was not there.
 *
 * **`amount` is what he personally brought, before §4.3's halving.** The halving is a fact
 * about how many people answered for the same need and in what order they sorted — two
 * identical heroes would otherwise be recorded as having brought different amounts, which
 * on a screen reads as arbitrary. What the halving produced is `supplied`, and it is
 * already on the need's own row.
 */
function contributionsOf(
  crew: readonly CrewMember[],
  coverage: readonly NeedCoverage[],
  intents: readonly OutcomeIntent[]
): SortedMap<HeroId, HeroContribution> {
  return SortedMap.from(
    compareHeroIds,
    crew.map((crewMember) => [
      crewMember.hero,
      {
        amount: coverage.reduce((sum, row) => toInt32(sum + broughtTo(row, crewMember.hero)), 0),
        commitment: crewMember.commitment,
        provenance: provenanceFor(crewMember, intents)
      }
    ])
  );
}

function broughtTo(row: NeedCoverage, hero: HeroId): number {
  return row.contributors.find((contributor) => contributor.hero === hero)?.amount ?? 0;
}

/**
 * The reasons that are about this hero (`GDD` §21.4: every number names where it came
 * from).
 *
 * Two ways an intent is about him, and no third: it names him, or it is about a need he is
 * **answerable** for (§2.2). The second half is why a verdict on somebody else's need is
 * not part of his story — and the first is why the wound that named him is.
 *
 * In the order the intents were produced, which is canonical (needs in the vocabulary's
 * order, then who gave way in hero order, then the consequences), and deduplicated: the
 * same code twice would read on screen as two separate reasons.
 */
function provenanceFor(crewMember: CrewMember, intents: readonly OutcomeIntent[]) {
  const named = intents.filter(
    (intent) =>
      intent.hero === crewMember.hero ||
      (intent.hero === null &&
        intent.need !== null &&
        crewMember.capability.expertise.has(intent.need))
  );

  return [...new Set(named.map((intent) => intent.reason))];
}
