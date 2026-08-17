import { describe, expect, it } from 'vitest';

import {
  MAX_UINT64,
  acceptanceThreshold,
  draw,
  drawInt32,
  RNG_ALGORITHM_VERSION
} from './deterministic-rng.ts';
import { RNG_STREAM_NAMES, RngStream } from './rng-stream.ts';

/**
 * The RNG's own properties, in this package because they need no corpus. The 306 raw
 * vectors and 1764 int32 vectors the C# exporter froze are replayed in `tests/oracle`
 * — this package cannot read a file, by design.
 *
 * The one thing the corpus does *not* cover is here, and it is the important one:
 * every recorded vector reports `ordinals_consumed: "1"`, so the rejection branch is
 * frozen evidence of nothing. That branch is unreachable by sampling — about 5.4e-20
 * for the widest span — so the seed below was constructed by inverting the mixer, and
 * it is reused from the C# test that constructed it. An input belongs in git
 * (`AGENTS.md` §11); recomputing it here would prove the same thing more slowly.
 */

describe('draw', () => {
  it('is a pure function of seed, stream and ordinal', () => {
    // Calling it again, in a different order, interleaved with other draws, has to
    // give the same answer — that is the whole basis of replay and save/continue.
    const first = draw(7n, RngStream.HeroDecision, 3n);
    draw(999n, RngStream.Combat, 1n);
    const again = draw(7n, RngStream.HeroDecision, 3n);

    expect(again).toBe(first);
  });

  it('stays inside 64 bits, which bigint does not do on its own', () => {
    // `bigint` is arbitrary-precision: without the explicit mask every multiply
    // would grow the value instead of wrapping, and the divergence from the C#
    // `ulong` arithmetic would be silent rather than visible.
    for (const ordinal of [0n, 1n, 12345n, MAX_UINT64]) {
      for (const seed of [0n, 1n, MAX_UINT64]) {
        const value = draw(seed, RngStream.WorldTick, ordinal);
        expect(value >= 0n && value <= MAX_UINT64).toBe(true);
      }
    }
  });

  it('gives every stream a different sequence from the same seed and ordinal', () => {
    // The point of folding the stream into the key before the ordinal: a change in
    // one subsystem's draw count must not perturb another's sequence.
    const values = RNG_STREAM_NAMES.map((name) => draw(424242n, RngStream[name], 0n));

    expect(new Set(values).size).toBe(RNG_STREAM_NAMES.length);
  });

  it('gives consecutive ordinals uncorrelated values', () => {
    const values = Array.from({ length: 32 }, (_, ordinal) =>
      draw(424242n, RngStream.HeroDecision, BigInt(ordinal))
    );

    expect(new Set(values).size).toBe(values.length);
  });

  it('names its algorithm, because an artifact records the name and not the code', () => {
    expect(RNG_ALGORITHM_VERSION).toBe('splitmix64-composed/1');
  });
});

describe('acceptanceThreshold', () => {
  it('is an exact multiple of the span and within one span of the maximum', () => {
    // The two halves of "rejection sampling is unbiased". Asserted directly rather
    // than inferred from draws, because no realistic number of draws reaches the
    // rejection branch at all.
    for (const span of [1n, 2n, 3n, 6n, 7n, 255n, 256n, 4294967295n, 4294967296n]) {
      const threshold = acceptanceThreshold(span);

      expect(threshold % span, `span ${span}`).toBe(0n);
      expect(threshold > MAX_UINT64 - span, `span ${span}`).toBe(true);
    }
  });
});

describe('drawInt32', () => {
  it.each([
    { min: 0, max: 1 },
    { min: 0, max: 2 },
    { min: -1, max: 1 },
    { min: -5, max: 6 },
    { min: 0, max: 256 },
    { min: -2147483648, max: 2147483647 }
  ])('stays inside [$min, $max)', ({ min, max }) => {
    for (let ordinal = 0n; ordinal < 64n; ordinal++) {
      const { value } = drawInt32(424242n, RngStream.HeroDecision, ordinal, min, max);

      expect(Number.isInteger(value)).toBe(true);
      expect(value >= min && value < max).toBe(true);
    }
  });

  it('covers its whole range given enough ordinals', () => {
    // A generator that returned a constant, or that lost the low bits, would satisfy
    // every bound check above and fail this.
    const seen = new Set<number>();
    for (let ordinal = 0n; ordinal < 400n; ordinal++) {
      seen.add(drawInt32(7n, RngStream.HeroDecision, ordinal, -5, 6).value);
    }

    expect([...seen].sort((left, right) => left - right)).toEqual([
      -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5
    ]);
  });

  it('reports one ordinal when the first sample is accepted', () => {
    expect(drawInt32(7n, RngStream.HeroDecision, 0n, -5, 6).ordinalsConsumed).toBe(1n);
  });

  it.each([
    { min: 0, max: 0 },
    { min: 5, max: 5 },
    { min: 1, max: 0 }
  ])('refuses the empty range [$min, $max)', ({ min, max }) => {
    expect(() => drawInt32(7n, RngStream.HeroDecision, 0n, min, max)).toThrow(
      /maxExclusive must be greater/
    );
  });

  it.each([1.5, Number.NaN, Number.POSITIVE_INFINITY])('refuses the bound %s', (bound) => {
    expect(() => drawInt32(7n, RngStream.HeroDecision, 0n, 0, bound)).toThrow(/integer bounds/);
  });

  describe('the rejection branch', () => {
    // Constructed, not sampled — see the note at the top of this file. The seed was
    // found by inverting the SplitMix64 finalizer, which is a bijection on 64 bits.
    const REJECTING_SEED = 4892902761533153534n;
    const span = 6n;

    it('has its premise, so the test below cannot pass on an accepted draw', () => {
      // Without this the whole block would be green over a sample that was never
      // rejected, which is the most comfortable way for a branch test to test
      // nothing.
      expect(draw(REJECTING_SEED, RngStream.HeroDecision, 0n)).toBe(MAX_UINT64);
      expect(draw(REJECTING_SEED, RngStream.HeroDecision, 0n)).toBeGreaterThanOrEqual(
        acceptanceThreshold(span)
      );
    });

    it('reports every ordinal a rejection burned', () => {
      const result = drawInt32(REJECTING_SEED, RngStream.HeroDecision, 0n, 0, 6);

      expect(result.ordinalsConsumed).toBe(2n);
    });

    it('returns the accepted sample, which is the last ordinal burned and not the first', () => {
      const result = drawInt32(REJECTING_SEED, RngStream.HeroDecision, 0n, 0, 6);
      const acceptedOrdinal = result.ordinalsConsumed - 1n;
      const acceptedSample = draw(REJECTING_SEED, RngStream.HeroDecision, acceptedOrdinal);

      expect(acceptedSample).toBeLessThan(acceptanceThreshold(span));
      expect(result.value).toBe(Number(acceptedSample % span));
    });

    it('makes resuming at ordinal + ordinalsConsumed a genuinely fresh draw', () => {
      // What the reported count buys, and what hard-coding 1 would cost: resuming
      // one ordinal on replays the sample this call already consumed and accepted.
      const result = drawInt32(REJECTING_SEED, RngStream.HeroDecision, 0n, 0, 6);
      const resumed = drawInt32(
        REJECTING_SEED,
        RngStream.HeroDecision,
        result.ordinalsConsumed,
        0,
        6
      );
      const replayed = drawInt32(REJECTING_SEED, RngStream.HeroDecision, 1n, 0, 6);

      expect(resumed.value).not.toBe(result.value);
      expect(replayed.value).toBe(result.value);
    });
  });
});
