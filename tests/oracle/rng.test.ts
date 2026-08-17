import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  RNG_ALGORITHM_VERSION,
  RNG_STREAM_NAMES,
  RngStream,
  draw,
  drawInt32
} from '@oath-and-coin/simulation';
import { describe, expect, it } from 'vitest';

/**
 * Task 7's gate: every RNG vector the C# exporter froze, replayed against this port.
 *
 * 306 raw draws and 1764 integer draws, across all seven streams, boundary seeds,
 * ordinals around zero and the ranges the production rules actually use — plus the
 * cases lifted from the C# golden fixture. If the mixer, the mask, the stream folding
 * or the range mapping differ anywhere, one of these disagrees, and it disagrees with
 * a number this repository did not compute.
 *
 * What these vectors do *not* cover is recorded here rather than left to be
 * discovered: every one of them reports `ordinals_consumed: "1"`, so the rejection
 * branch is absent from the corpus entirely. It is covered by a constructed seed in
 * `packages/simulation/src/random/deterministic-rng.test.ts`.
 */

const repoRoot = resolve(import.meta.dirname, '..', '..');
const corpusRoot = join(repoRoot, 'migration', 'oracle', 'v1');

interface RawDraw {
  readonly campaign_seed: string;
  readonly stream: string;
  readonly stream_value: number;
  readonly ordinal: string;
  readonly value: string;
}

interface Int32DrawVector {
  readonly campaign_seed: string;
  readonly stream: string;
  readonly stream_value: number;
  readonly ordinal: string;
  readonly min_inclusive: number;
  readonly max_exclusive: number;
  readonly value: number;
  readonly ordinals_consumed: string;
}

interface RngVectorFile {
  readonly algorithm_version: string;
  readonly streams: readonly { readonly name: string; readonly value: number }[];
  readonly raw_draws: readonly RawDraw[];
  readonly int32_draws: readonly Int32DrawVector[];
  readonly golden_fixture: {
    readonly campaign_seed: string;
    readonly stream: string;
    readonly ordinals: number;
    readonly source: string;
  };
}

const vectors = JSON.parse(
  readFileSync(join(corpusRoot, 'rng-vectors.json'), 'utf8')
) as RngVectorFile;

/** The corpus names streams by their C# enum member; this is the only place that mapping lives. */
function streamNamed(name: string): RngStream {
  const stream = (RngStream as Readonly<Record<string, RngStream | undefined>>)[name];
  if (stream === undefined) {
    throw new Error(`The corpus names RNG stream '${name}', which this port does not define.`);
  }

  return stream;
}

describe('the RNG contract the corpus recorded', () => {
  it('is the algorithm this port implements', () => {
    // The version string travels in every artifact. A port that changed the mixer and
    // kept the name would produce artifacts that claim to be comparable and are not.
    expect(RNG_ALGORITHM_VERSION).toBe(vectors.algorithm_version);
  });

  it('has the same seven streams, by name and by value', () => {
    // The value is mixed into every key, so renumbering a stream re-rolls every
    // campaign. The C# mutant that proved this test bites was `HeroDecision = 3 → 9`.
    expect(vectors.streams).toHaveLength(RNG_STREAM_NAMES.length);

    for (const recorded of vectors.streams) {
      expect(streamNamed(recorded.name), recorded.name).toBe(recorded.value);
    }
  });

  it('covers the volume it claims to', () => {
    // A corpus quietly reduced to three vectors would pass every assertion below.
    expect(vectors.raw_draws).toHaveLength(306);
    expect(vectors.int32_draws).toHaveLength(1764);
  });
});

describe('raw draws', () => {
  it('reproduces all 306 recorded values', () => {
    // One assertion over the whole set rather than 306 cases: a failure names the
    // first disagreeing vector, and the loop is what makes "all of them" true rather
    // than "the ones somebody listed".
    const disagreements: string[] = [];

    for (const vector of vectors.raw_draws) {
      const actual = draw(
        BigInt(vector.campaign_seed),
        streamNamed(vector.stream),
        BigInt(vector.ordinal)
      );

      if (actual !== BigInt(vector.value)) {
        disagreements.push(
          `seed ${vector.campaign_seed} stream ${vector.stream} ordinal ${vector.ordinal}: ` +
            `expected ${vector.value}, got ${actual}`
        );
      }
    }

    expect(disagreements).toEqual([]);
  });

  it('covers every stream and both ends of the seed space', () => {
    // What the 306 vectors are made of, asserted so a thinned corpus is visible.
    const streams = new Set(vectors.raw_draws.map((vector) => vector.stream));
    const seeds = new Set(vectors.raw_draws.map((vector) => vector.campaign_seed));

    expect(streams.size).toBe(RNG_STREAM_NAMES.length);
    expect(seeds).toContain('0');
    expect(seeds).toContain('18446744073709551615');
  });
});

describe('integer draws', () => {
  it('reproduces all 1764 recorded values and their ordinal costs', () => {
    const disagreements: string[] = [];

    for (const vector of vectors.int32_draws) {
      const actual = drawInt32(
        BigInt(vector.campaign_seed),
        streamNamed(vector.stream),
        BigInt(vector.ordinal),
        vector.min_inclusive,
        vector.max_exclusive
      );

      if (actual.value !== vector.value) {
        disagreements.push(
          `seed ${vector.campaign_seed} stream ${vector.stream} ordinal ${vector.ordinal} ` +
            `[${vector.min_inclusive}, ${vector.max_exclusive}): expected ${vector.value}, ` +
            `got ${actual.value}`
        );
      }

      if (actual.ordinalsConsumed !== BigInt(vector.ordinals_consumed)) {
        disagreements.push(
          `seed ${vector.campaign_seed} ordinal ${vector.ordinal}: expected ` +
            `${vector.ordinals_consumed} ordinals consumed, got ${actual.ordinalsConsumed}`
        );
      }
    }

    expect(disagreements).toEqual([]);
  });

  it('covers the production mood range and the widest possible span', () => {
    const ranges = new Set(
      vectors.int32_draws.map((vector) => `${vector.min_inclusive}..${vector.max_exclusive}`)
    );

    // The mood draw the hero decision rule makes, and the span that forced the C#
    // implementation to widen its subtraction before performing it.
    expect(ranges).toContain('-5..6');
    expect(ranges).toContain('-2147483648..2147483647');
  });

  it('records no rejection anywhere, which is why one is constructed elsewhere', () => {
    // Stated as an assertion rather than as a comment: if a future corpus does start
    // carrying a rejected draw, this fails and the note above stops being true.
    const rejections = vectors.int32_draws.filter(
      (vector) => BigInt(vector.ordinals_consumed) > 1n
    );

    expect(rejections).toEqual([]);
  });
});

describe('the golden fixture the C# test suite used', () => {
  it('replays under the seed and stream it was recorded with', () => {
    // These vectors came from `tests/OathAndCoin.Simulation.Tests/Fixtures/rng-golden.json`,
    // a file Task 19 deletes along with the rest of the C# suite. Their values live on
    // in `raw_draws`, which is the point of freezing them as corpus data.
    const { campaign_seed: seed, stream, ordinals } = vectors.golden_fixture;
    const recorded = vectors.raw_draws.filter(
      (vector) => vector.campaign_seed === seed && vector.stream === stream
    );

    expect(recorded.length).toBeGreaterThanOrEqual(ordinals);

    for (const vector of recorded) {
      expect(draw(BigInt(seed), streamNamed(stream), BigInt(vector.ordinal))).toBe(
        BigInt(vector.value)
      );
    }
  });
});
