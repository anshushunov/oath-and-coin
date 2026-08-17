import { describe, expect, it } from 'vitest';

import { compareHeroIds, heroId } from './hero-id.ts';

describe('heroId', () => {
  it('accepts the roster positions a campaign assigns', () => {
    expect(heroId(0)).toBe(0);
    expect(heroId(5)).toBe(5);
  });

  it.each([1.5, -1, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53])(
    'refuses %s, which C# could not express and TypeScript can',
    (value) => {
      // A non-integer id becomes a map key nothing ever matches, and the failure
      // surfaces as an absent hero three layers away from the mistake.
      expect(() => heroId(value)).toThrow(/Invalid HeroId/);
    }
  );
});

describe('compareHeroIds', () => {
  it('orders numerically', () => {
    const ids = [heroId(10), heroId(2), heroId(0)].sort(compareHeroIds);
    expect(ids).toEqual([0, 2, 10]);
  });
});
