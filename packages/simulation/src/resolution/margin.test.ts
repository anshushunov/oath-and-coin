import { describe, expect, it } from 'vitest';

import { CommitmentState } from '../domain/commitment.ts';
import { NeedId } from '../domain/need-id.ts';
import { OutcomeIntentKind, type OutcomeIntent } from '../domain/outcome.ts';
import { OutcomeReasonCodes } from '../domain/outcome-reason-codes.ts';

import { MOTIVE_LIMIT_PERCENT, motiveOf, percentOf, reduceMargin } from './margin.ts';

/**
 * `RESOLUTION_SPEC` §4.5 — the gap the crew left, and what their willingness does to it.
 */

/** A `need_short`/`need_covered` carrying `delta` and nothing else worth reading. */
const contribution = (delta: number): OutcomeIntent => ({
  kind: delta >= 0 ? OutcomeIntentKind.NeedCovered : OutcomeIntentKind.NeedShort,
  hero: null,
  need: NeedId.Frontline,
  marginDelta: delta,
  reason: delta >= 0 ? OutcomeReasonCodes.NeedClosed : OutcomeReasonCodes.NeedWeak,
  gap: null,
  consequence: null,
  magnitude: 0
});

/** Intents whose deltas add up to exactly `total`, spread over three of them. */
const summingTo = (total: number): readonly OutcomeIntent[] => [
  contribution(total - 20),
  contribution(12),
  contribution(8)
];

const allOf = (state: CommitmentState, size = 4): readonly CommitmentState[] =>
  Array.from({ length: size }, () => state);

describe('what one hero’s willingness is worth (§4.5)', () => {
  it.each([
    [CommitmentState.Committed, 20],
    [CommitmentState.Fragile, -10],
    [CommitmentState.Resentful, -20]
  ])('%s counts for %i per cent', (state, expected) => {
    expect(percentOf(state)).toBe(expected);
  });

  it('prices a fragile yes below a given one rather than at nothing', () => {
    // `RESOLUTION_SPEC` §4.5: at zero, "the yes was bought rather than given" could never
    // become a deficit, and that is one of the three diagnoses the product spec names.
    // The penalty is not for paying well — it is for consent that *rested* on the bonus.
    expect(percentOf(CommitmentState.Fragile)).toBeLessThan(percentOf(CommitmentState.Committed));
    expect(percentOf(CommitmentState.Fragile)).toBeLessThan(0);
  });
});

describe('the crew’s motive (§4.5)', () => {
  it('averages over the crew, truncating toward zero', () => {
    // 20 + 20 + (−10) = 30 over three heroes is 10 exactly.
    expect(
      motiveOf([CommitmentState.Committed, CommitmentState.Committed, CommitmentState.Fragile])
    ).toBe(10);
  });

  it.each([
    // 20 + 20 + 20 + (−10) = 50 over four is 12.5 → 12, not 13.
    [
      [
        CommitmentState.Committed,
        CommitmentState.Committed,
        CommitmentState.Committed,
        CommitmentState.Fragile
      ],
      12
    ],
    // −10 + −10 + −10 + 20 = −10 over four is −2.5 → −2, not −3: toward zero, both signs.
    [
      [
        CommitmentState.Fragile,
        CommitmentState.Fragile,
        CommitmentState.Fragile,
        CommitmentState.Committed
      ],
      -2
    ]
  ])('truncates toward zero, not down: %j is %i', (crew, expected) => {
    expect(motiveOf(crew)).toBe(expected);
  });

  it('answers zero for a crew of nobody rather than dividing by it', () => {
    // Unreachable through a command — a resolved contract has `acceptedBy.size ===
    // requiredCrew` and `requiredCrew >= 1` — so this is what the function does when
    // handed state no command builds, not a case the rules produce.
    expect(motiveOf([])).toBe(0);
  });
});

describe('the margin motive shapes (§4.5)', () => {
  it.each([
    // Base +100
    [100, CommitmentState.Committed, 120],
    [100, CommitmentState.Fragile, 90],
    [100, CommitmentState.Resentful, 80],
    // Base −100: the direction has to survive the sign.
    //
    // **The middle row is −110, and the implementation plan said −90.** That number is
    // what `base + base × motive / 100` answers — the edition-1.0 formula §4.5 names as
    // the error `abs(base)` exists to fix — so the plan's row was a leftover from before
    // the fix. Its own neighbours prove it: −80 for a committed crew and −120 for a
    // resentful one are both the `abs` formula, and only the middle row was not.
    [-100, CommitmentState.Committed, -80],
    [-100, CommitmentState.Fragile, -110],
    [-100, CommitmentState.Resentful, -120]
  ])('a base of %i with a crew all %s answers %i', (base, state, expected) => {
    expect(reduceMargin(summingTo(base), allOf(state))).toBe(expected);
  });

  it.each([100, -100])(
    'on a base of %i a committed crew is strictly better off than a resentful one',
    (base) => {
      expect(reduceMargin(summingTo(base), allOf(CommitmentState.Committed))).toBeGreaterThan(
        reduceMargin(summingTo(base), allOf(CommitmentState.Resentful))
      );
    }
  );

  it('applies the motive once, to the sum, not to each contribution', () => {
    // Three contributions of +40 at +20% each would be 40×1.2 × 3 = 144 if applied
    // piecewise under truncation; applied once to the sum of 120 it is 144 as well — so
    // the case has to be one where truncation bites. Deltas of 7, 7 and 7: piecewise
    // gives 3 × (7 + trunc(7×20/100)) = 3 × 8 = 24; once, to the sum, it is
    // 21 + trunc(21×20/100) = 21 + 4 = 25.
    const three = [contribution(7), contribution(7), contribution(7)];

    expect(reduceMargin(three, allOf(CommitmentState.Committed))).toBe(25);
  });

  it('leaves a base of zero at zero whatever the crew feels', () => {
    // `abs(0) × motive / 100` is zero either way, so a crew's mood cannot manufacture a
    // margin out of a contract nobody over- or under-delivered on.
    expect(reduceMargin([contribution(0)], allOf(CommitmentState.Committed))).toBe(0);
    expect(reduceMargin([contribution(0)], allOf(CommitmentState.Resentful))).toBe(0);
  });

  it('reads only the deltas, so a derived intent cannot feed the margin it came from', () => {
    // §4.4: derived intents carry `marginDelta = 0`. This states the consequence — adding
    // one changes nothing — rather than trusting every producer to remember.
    const derived: OutcomeIntent = {
      kind: OutcomeIntentKind.ObjectiveTaken,
      hero: null,
      need: null,
      marginDelta: 0,
      reason: OutcomeReasonCodes.ObjectiveTaken,
      gap: null,
      consequence: null,
      magnitude: 0
    };

    expect(reduceMargin([...summingTo(100), derived], allOf(CommitmentState.Committed))).toBe(
      reduceMargin(summingTo(100), allOf(CommitmentState.Committed))
    );
  });

  it('states the ceiling the motive is clamped to', () => {
    expect(MOTIVE_LIMIT_PERCENT).toBe(20);
  });
});
