import { describe, expect, it } from 'vitest';

import { HERO_ID_MAX, HERO_ID_MIN, compareHeroIds, heroId } from './hero-id.ts';

/**
 * The domain, and only the domain, the C# `readonly record struct HeroId(int Value)`
 * had.
 *
 * The first version of this suite asserted that `-1` is refused "which C# could not
 * express" — and that sentence was the whole defect. C# expresses it fine: `int` is
 * signed, `state.Heroes.TryGetValue` misses, and the engine answers `UNKNOWN_HERO`.
 * The test had invented its own requirement and then passed it, which is the failure
 * mode `FULL_TYPESCRIPT_MIGRATION` §8.4 already recorded once for `deepEqual(-0, 0)`.
 * External review reproduced this one.
 */

describe('heroId', () => {
  it('accepts the roster positions a campaign assigns', () => {
    expect(heroId(0)).toBe(0);
    expect(heroId(5)).toBe(5);
  });

  it('accepts a negative id, because the engine answers UNKNOWN_HERO for one', () => {
    expect(heroId(-1)).toBe(-1);
  });

  it('accepts both ends of the signed 32-bit range', () => {
    expect(heroId(HERO_ID_MIN)).toBe(HERO_ID_MIN);
    expect(heroId(HERO_ID_MAX)).toBe(HERO_ID_MAX);
  });

  it.each([
    [1.5, 'a fraction becomes a map key nothing matches'],
    [Number.NaN, 'NaN is not equal to itself, so it matches nothing including itself'],
    [Number.POSITIVE_INFINITY, 'not an integer'],
    [HERO_ID_MAX + 1, 'outside the range a signed 32-bit field can hold'],
    [HERO_ID_MIN - 1, 'outside the range a signed 32-bit field can hold'],
    [2 ** 53, 'far outside it, and past the safe-integer boundary as well']
  ])('refuses %s — %s', (value) => {
    expect(() => heroId(value)).toThrow(/Invalid HeroId/);
  });
});

describe('compareHeroIds', () => {
  it('orders numerically', () => {
    const ids = [heroId(10), heroId(2), heroId(0)].sort(compareHeroIds);
    expect(ids).toEqual([0, 2, 10]);
  });

  it('orders a negative id below every roster position', () => {
    expect(compareHeroIds(heroId(-1), heroId(0))).toBeLessThan(0);
  });
});
