import type { RngStream } from './rng-stream.ts';

/**
 * Counter-based deterministic RNG (`ADR-003`). Every draw is a pure function of
 * `(campaignSeed, stream, ordinal)` — there is no instance, no field, no counter
 * kept anywhere. The caller supplies the ordinal (how many draws have already been
 * made on that stream), so the same triple always reproduces the same value no
 * matter when, how often, or in what order it is asked for. That is what makes
 * save/continue and replay possible: the sequence is derived from game state, not
 * from a generator's memory.
 *
 * Algorithm: two composed applications of the SplitMix64 finalizer. The stream is
 * folded into the first mix to derive a per-stream key; the ordinal is folded into
 * the second to derive the actual draw. This keeps different streams from
 * correlating and consecutive ordinals from correlating, without storing per-stream
 * state anywhere.
 *
 * `bigint`, not `number`, and this is the one place `ADR-010` §126 asks for it: the
 * algorithm's whole behaviour is 64-bit wraparound multiplication, which a double
 * cannot represent — the low bits that carry all the entropy are exactly the ones a
 * double throws away. Every operation is masked back to 64 bits by hand, because
 * `bigint` is arbitrary-precision and would otherwise grow instead of wrapping,
 * which is a silent divergence rather than a visible one.
 */

export const RNG_ALGORITHM_VERSION = 'splitmix64-composed/1';

const GOLDEN_GAMMA = 0x9e3779b97f4a7c15n;

/** 2^64 − 1. Applied after every add, multiply and xor — `bigint` does not wrap on its own. */
const MASK_64 = 0xffffffffffffffffn;

/** The largest value {@link draw} can return, and the value the rejection test lands on exactly. */
export const MAX_UINT64 = MASK_64;

/** What {@link drawInt32} returns: the value, and what it cost. */
export interface Int32Draw {
  readonly value: number;

  /**
   * How many ordinals the draw burned, starting at the one passed in. Always at
   * least 1, and more than 1 exactly when rejection sampling had to re-draw.
   *
   * This travels with the value rather than being left for the caller to guess,
   * and the reason is a defect the C# side actually shipped and then fixed:
   * `drawInt32` used to return a bare integer, a rejected sample advanced a
   * *local* ordinal, and the extra ordinals were invisible. Callers reported 1 —
   * the only number available — so the campaign's next decision ordinal landed on
   * an ordinal already drawn *and accepted*, and the following decision silently
   * reproduced this one's sample. Because the RNG is a pure function, nothing
   * disagreed: replay, save/continue and the golden vectors all agreed with each
   * other and were all wrong about how much randomness the campaign had spent.
   */
  readonly ordinalsConsumed: bigint;
}

/**
 * Draws a raw 64-bit value for the given seed, stream and ordinal. Pure: calling it
 * again with the same arguments — in any order, interleaved with anything — returns
 * the same value.
 */
export function draw(campaignSeed: bigint, stream: RngStream, ordinal: bigint): bigint {
  const key = mix((campaignSeed + (BigInt(stream) + 1n) * GOLDEN_GAMMA) & MASK_64);
  return mix((key + ordinal * GOLDEN_GAMMA) & MASK_64);
}

/**
 * Draws an integer uniformly in `[minInclusive, maxExclusive)`, reporting how many
 * ordinals it cost.
 *
 * Out-of-range draws near the top of the 64-bit space are rejected and re-drawn —
 * advancing only a local ordinal, never mutating any state — so every remaining
 * outcome is equally likely.
 *
 * @throws if `maxExclusive` is not greater than `minInclusive`, or if either bound
 * is not a safe integer.
 */
export function drawInt32(
  campaignSeed: bigint,
  stream: RngStream,
  ordinal: bigint,
  minInclusive: number,
  maxExclusive: number
): Int32Draw {
  if (!Number.isSafeInteger(minInclusive) || !Number.isSafeInteger(maxExclusive)) {
    throw new Error(`drawInt32 needs integer bounds, received [${minInclusive}, ${maxExclusive}).`);
  }

  if (maxExclusive <= minInclusive) {
    throw new Error(
      `maxExclusive must be greater than minInclusive, received [${minInclusive}, ${maxExclusive}).`
    );
  }

  // The span is computed in `bigint` for the same reason C# widened it to `ulong`:
  // the widest possible range, 2^32 − 1, does not fit in the signed 32-bit type the
  // bounds are expressed in, so the subtraction has to be widened before it
  // happens, not after.
  const span = BigInt(maxExclusive) - BigInt(minInclusive);
  const threshold = acceptanceThreshold(span);

  let currentOrdinal = ordinal & MASK_64;
  let ordinalsConsumed = 1n;
  let sample: bigint;

  for (;;) {
    sample = draw(campaignSeed, stream, currentOrdinal);
    if (sample < threshold) {
      break;
    }

    // The ordinal wraps at 2^64, matching the C# `unchecked` increment. The count
    // does not need a ceiling: it was `checked` there because `ulong` could
    // overflow, and a `bigint` cannot.
    currentOrdinal = (currentOrdinal + 1n) & MASK_64;
    ordinalsConsumed += 1n;
  }

  return { value: Number(BigInt(minInclusive) + (sample % span)), ordinalsConsumed };
}

/**
 * The rejection-sampling cutoff for a range of width `span`: the largest multiple of
 * `span` that fits in 64 bits. Samples at or above it are re-drawn, so that every
 * value in `[0, span)` is equally likely — without the cutoff, values near the top
 * of the space would be under-represented by `2^64 − 1 mod span` counts relative to
 * the rest, biasing the draw.
 *
 * Exported rather than private, and for the reason the C# original made it
 * `internal` and reached it through `InternalsVisibleTo`: the invariant that makes
 * rejection sampling unbiased — `threshold % span === 0`, and `threshold` within one
 * span of the maximum — can then be asserted directly for a range of spans instead
 * of only inferred from sampled draws. Sampling cannot reach the rejection branch
 * for realistic spans: the probability is about 5.4e-20 for a span of 2^32 − 1.
 */
export function acceptanceThreshold(span: bigint): bigint {
  return MASK_64 - (MASK_64 % span);
}

function mix(value: bigint): bigint {
  let z = value & MASK_64;
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK_64;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK_64;
  return (z ^ (z >> 31n)) & MASK_64;
}
