import { CommitmentState } from '../domain/commitment.ts';
import type { OutcomeIntent } from '../domain/outcome.ts';
import { divideTowardZero, multiplyInt32, toInt32 } from '../integer-division.ts';

/**
 * The gap between what a contract asked and what its crew brought, and what the crew's
 * willingness does to it (`RESOLUTION_SPEC` §4.5).
 *
 * Two numbers, in this order and no other: the base is a fact about capability, the motive
 * is a fact about people, and the second modifies the first rather than being summed
 * alongside it. Summed, a resentful crew and a shortfall would be the same kind of thing
 * and could cancel; multiplied, unwillingness makes a bad outcome worse and a good one
 * less good, which is what it actually does.
 */

/**
 * Most the crew's mood may move the margin, either way, as a percentage of its size.
 *
 * **Today the clamp cannot bite, and that is a property worth stating rather than a
 * reason to drop it.** `percentOf` answers within `[−20, +20]`, so an average of those
 * answers is already inside the band. It is written because the band is the rule and
 * `percentOf`'s three values are one way of satisfying it — move any of them and the
 * ceiling still holds without a second edit.
 */
export const MOTIVE_LIMIT_PERCENT = 20;

/**
 * What one hero's willingness is worth, in per cent (`RESOLUTION_SPEC` §4.5).
 *
 * `Fragile` costs rather than counting for nothing. At zero, "the yes was bought rather
 * than given" could never become a deficit large enough to be named — and that is the
 * third of the three diagnoses the product spec asks this system to be able to give. The
 * penalty is not a fine for paying well: paying well is fine. It is the price of consent
 * that *rested* on the promise, and would not have been there without it.
 */
export function percentOf(commitment: CommitmentState): number {
  switch (commitment) {
    case CommitmentState.Committed:
      return 20;
    case CommitmentState.Fragile:
      return -10;
    case CommitmentState.Resentful:
      return -20;
  }
}

/**
 * The crew's willingness as one number: the average of what each member is worth, clamped
 * to {@link MOTIVE_LIMIT_PERCENT}.
 *
 * An average and not a sum, so a larger crew is not automatically a more motivated one —
 * six committed heroes are as willing as four, not half again as willing.
 *
 * A crew of nobody answers `0` rather than dividing by zero. No command produces one: a
 * contract is resolved with `acceptedBy.size === requiredCrew` and `requiredCrew >= 1`.
 * This is what the function does when handed state the rules do not build.
 */
export function motiveOf(commitments: readonly CommitmentState[]): number {
  if (commitments.length === 0) {
    return 0;
  }

  const total = commitments.reduce((sum, commitment) => toInt32(sum + percentOf(commitment)), 0);
  const average = divideTowardZero(total, commitments.length);

  return Math.max(-MOTIVE_LIMIT_PERCENT, Math.min(MOTIVE_LIMIT_PERCENT, average));
}

/**
 * The margin: every intent's delta summed, then moved by the crew's motive
 * (`RESOLUTION_SPEC` §4.5).
 *
 * ```
 * base   = Σ marginDelta(intents)
 * margin = base + divideTowardZero(multiplyInt32(abs(base), motive), 100)
 * ```
 *
 * **`abs(base)`, and it is the whole point rather than a detail.** Written as
 * `base + base × motive / 100`, the motive flips sign along with the base: at `base =
 * −100` a committed crew answered `−120` and a resentful one `−80`, which says loyalty
 * makes a failure worse. With the magnitude, a positive motive always moves the margin
 * up and a negative one always moves it down, whichever side of zero the base is on.
 *
 * **Applied once, to the sum.** Applied per contribution it silently exceeds the ceiling:
 * truncation rounds each piece toward zero separately, and three pieces rounded is not the
 * sum rounded.
 *
 * Derived intents (`objective_taken`, `contract_resolved`, and the rest of §4.4) carry
 * `marginDelta = 0`, so passing the whole list is the same as passing only the coverage
 * ones — an outcome must not feed the margin it was derived from.
 */
export function reduceMargin(
  intents: readonly OutcomeIntent[],
  commitments: readonly CommitmentState[]
): number {
  const base = intents.reduce((sum, intent) => toInt32(sum + intent.marginDelta), 0);
  const motive = motiveOf(commitments);

  return toInt32(base + divideTowardZero(multiplyInt32(Math.abs(base), motive), 100));
}
