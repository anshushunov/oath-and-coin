import { CommitmentState } from '../domain/commitment.ts';
import { compareNeedIds } from '../domain/need-id.ts';
import {
  DeficitKind,
  OutcomeIntentKind,
  type Deficit,
  type OutcomeIntent
} from '../domain/outcome.ts';
import { compareHeroIds } from '../ids/hero-id.ts';
import { multiplyInt32, toInt32 } from '../integer-division.ts';

import { reduceMargin } from './margin.ts';
import type { CrewMember } from './outcome-intent.ts';

/**
 * The three ways a crew can come up short, priced so that they can be compared, and which
 * of them — if any — may be called the reason (`RESOLUTION_SPEC` §4.7).
 *
 * **Counterfactual magnitudes, and they have to be.** "Two needs unanswered", "a grade of
 * thirty where sixty was wanted" and "half the crew came for the money" are three
 * different kinds of thing measured in three different units; ranked directly they cannot
 * be ranked at all. Each one is therefore priced by the only question that has a common
 * answer: *how much better would the margin have been without it*.
 */

/** How far the leading deficit must exceed the next before it may be named the reason. */
export const DOMINANCE_MARGIN_PERCENT = 25;

/** What `rankDeficits` reads. */
export interface DeficitInput {
  readonly intents: readonly OutcomeIntent[];
  readonly crew: readonly CrewMember[];
}

export interface RankedDeficits {
  /** Largest first. A deficit that cost nothing or helped is not here at all. */
  readonly ranked: readonly Deficit[];

  /** `null` when nothing leads clearly enough to be called the reason. */
  readonly dominant: DeficitKind | null;
}

/**
 * Every deficit worth naming, ranked, and the one that may be called the reason.
 *
 * **A non-positive magnitude is dropped rather than ranked last.** A committed crew makes
 * the outcome better than a neutral one would have, so its `commitment_drag` counterfactual
 * is *worse* than what happened and prices out negative — that is not a small deficit, it
 * is the absence of one.
 *
 * **`dominant` is allowed to be `null`, and that is the point.** The three classes are not
 * mutually exclusive: a weak hero both fails to close a need and goes unwillingly, so two
 * of them being close together is the normal case rather than a tie to be broken. A model
 * obliged to name the main cause starts inventing one; `null` says "several, comparably"
 * precisely.
 */
export function rankDeficits(input: DeficitInput): RankedDeficits {
  const actual = reduceMargin(input.intents, input.crew.map(commitmentOf));

  const ranked = [
    gapDeficit(DeficitKind.Capability, input, actual),
    gapDeficit(DeficitKind.Coverage, input, actual),
    commitmentDeficit(input, actual)
  ]
    .filter((deficit): deficit is Deficit => deficit !== null && deficit.magnitude > 0)
    .sort(byMagnitudeThenKind);

  return { ranked, dominant: dominantOf(ranked) };
}

/**
 * One of the two coverage diagnoses, priced by removing exactly its shortfalls
 * (`RESOLUTION_SPEC` §4.7).
 *
 * The counterfactual replaces the matching `need_short` deltas with zero rather than
 * deleting the intents: an intent's other fields still describe something that happened,
 * and the margin reads deltas. The crew is untouched, so this measures the shortfall and
 * not the mood.
 */
function gapDeficit(kind: DeficitKind, input: DeficitInput, actual: number): Deficit | null {
  const matches = (intent: OutcomeIntent) =>
    intent.kind === OutcomeIntentKind.NeedShort && intent.gap === kind;

  const needs = input.intents.filter(matches).map((intent) => intent.need!);
  if (needs.length === 0) {
    return null;
  }

  const without = input.intents.map((intent) =>
    matches(intent) ? { ...intent, marginDelta: 0 } : intent
  );

  return {
    kind,
    magnitude: toInt32(reduceMargin(without, input.crew.map(commitmentOf)) - actual),
    needs: [...needs].sort(compareNeedIds),
    // Whoever was answerable (§2.2) for one of these needs. May be empty, and for a
    // `coverage_gap` usually is — a need nobody answered for is what that diagnosis says.
    heroes: input.crew
      .filter((crewMember) => needs.some((need) => crewMember.capability.expertise.has(need)))
      .map((crewMember) => crewMember.hero)
      .sort(compareHeroIds)
  };
}

/**
 * What the crew's unwillingness cost, priced by making them neutral
 * (`RESOLUTION_SPEC` §4.7).
 *
 * The intents are untouched — this is not about what anyone failed to supply — and the
 * motive is replaced with a neutral one. An empty crew is exactly how `motiveOf` states
 * "no motive at all", so it is what the counterfactual passes rather than a second way of
 * saying zero.
 */
function commitmentDeficit(input: DeficitInput, actual: number): Deficit | null {
  const reluctant = input.crew.filter(
    (crewMember) => crewMember.commitment !== CommitmentState.Committed
  );
  if (reluctant.length === 0) {
    return null;
  }

  return {
    kind: DeficitKind.Commitment,
    magnitude: toInt32(reduceMargin(input.intents, []) - actual),
    // Not about any one need: the same drag applies to everything the crew did.
    needs: [],
    heroes: reluctant.map((crewMember) => crewMember.hero).sort(compareHeroIds)
  };
}

/**
 * §4.7's dominance test: the leader must exceed the runner-up by
 * {@link DOMINANCE_MARGIN_PERCENT}, cross-multiplied so no division truncates the
 * boundary onto the wrong side of itself.
 */
function dominantOf(ranked: readonly Deficit[]): DeficitKind | null {
  const [first, second] = ranked;

  if (first === undefined) {
    return null;
  }

  if (second === undefined) {
    return first.kind;
  }

  return multiplyInt32(first.magnitude, 100) >=
    multiplyInt32(second.magnitude, 100 + DOMINANCE_MARGIN_PERCENT)
    ? first.kind
    : null;
}

/** Ties broken by the vocabulary's own order, so a ranking is never arbitrary. */
function byMagnitudeThenKind(left: Deficit, right: Deficit): number {
  if (left.magnitude !== right.magnitude) {
    return right.magnitude - left.magnitude;
  }

  return DEFICIT_ORDER.indexOf(left.kind) - DEFICIT_ORDER.indexOf(right.kind);
}

const DEFICIT_ORDER: readonly DeficitKind[] = [
  DeficitKind.Capability,
  DeficitKind.Coverage,
  DeficitKind.Commitment
];

const commitmentOf = (crewMember: CrewMember): CommitmentState => crewMember.commitment;
