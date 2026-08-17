/**
 * The lower bound `bigint` lost when it replaced C#'s `ulong`.
 *
 * External review found this and it is a genuine regression rather than a stylistic
 * one. C# could not express a negative seed or a negative ordinal at all — the type
 * forbade it — and it added ordinals in a `checked` context so an overflow threw. A
 * `bigint` has neither floor nor ceiling, so `withEvent(state, event, trace, -1n)`
 * happily produced `nextDecisionOrdinal === -1n`, and the RNG then masked that value
 * back to 64 bits: an input the original could not represent became a silent alias for
 * a perfectly valid unsigned one, which is the worst possible failure for a
 * reproducibility counter.
 *
 * The journal recorded the lost ceiling (§8.6) and said nothing about the lost floor.
 * This module is both halves in one place, so a value that reaches the RNG has been
 * through exactly one gate.
 */

/** 2^64 − 1, the largest value a C# `ulong` held and the largest this domain accepts. */
export const UINT64_MAX = 0xffffffffffffffffn;

/** Whether `value` is inside `0..2^64 − 1`. */
export function isUint64(value: bigint): boolean {
  return value >= 0n && value <= UINT64_MAX;
}

/**
 * Asserts that `value` is a 64-bit unsigned integer.
 *
 * @param field What to name in the message — a seed, an ordinal, a draw count.
 * @throws if `value` is negative or above 2^64 − 1.
 */
export function requireUint64(field: string, value: bigint): bigint {
  if (!isUint64(value)) {
    throw new Error(
      `${field} is ${value}, outside the 64-bit unsigned range 0..${UINT64_MAX} this value ` +
        'carries. C# expressed it as `ulong`, where neither bound could be crossed; a bigint ' +
        'has no bounds of its own, and the RNG masks whatever it is given back to 64 bits — so ' +
        'an out-of-range value here becomes a silent alias for a valid one rather than an error.'
    );
  }

  return value;
}
