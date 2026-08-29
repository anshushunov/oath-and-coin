import { describe, expect, it } from 'vitest';

import { CHILL_EFFECT } from './unit.ts';
import {
  ModifierCodes,
  absorbedBy,
  applyEffect,
  eatenByTheFormation,
  type EffectInput
} from './effect.ts';

/**
 * `COMBAT_SPEC` §8.2's invariant, and the arithmetic under it.
 *
 * The invariant — `base + Σ delta === final` — is the mechanical form of `GDD` §21.4: a
 * number that cannot be taken apart does not reach the screen. Every case below asserts it
 * as well as the value, because a pipeline that computed the right answer and recorded the
 * wrong reasons would pass a value check and fail the screen.
 */

const effect = (overrides: Partial<EffectInput> = {}): EffectInput => ({
  base: 10,
  chillPoints: 0,
  blockers: 0,
  absorb: null,
  actor: 'crew:one',
  ...overrides
});

const holds = (input: EffectInput): void => {
  const provenance = applyEffect(input);
  const sum = provenance.steps.reduce((total, step) => total + step.delta, provenance.base);

  expect(sum, JSON.stringify(provenance)).toBe(provenance.final);
};

describe('an effect keeps the reasons it changed', () => {
  it('records nothing when nothing happened to it', () => {
    const provenance = applyEffect(effect());

    expect(provenance).toEqual({ base: 10, steps: [], final: 10 });
  });

  it('names obstruction, and the delta is the whole of what it cost', () => {
    const provenance = applyEffect(effect({ base: 10, blockers: 1 }));

    expect(provenance.final).toBe(7);
    expect(provenance.steps).toEqual([
      { code: ModifierCodes.Obstruction, source: 'crew:one', delta: -3 }
    ]);
    expect(eatenByTheFormation(provenance)).toBe(3);
  });

  it('names chilling and obstruction separately, and the two still add up', () => {
    // 100 − 30 − 30 = 40, applied once to the base: 10 → 4. Chilling alone would have left
    // 7, so the chill step is −3 and obstruction takes the remaining −3.
    const provenance = applyEffect(effect({ base: 10, blockers: 1, chillPoints: CHILL_EFFECT }));

    expect(provenance.final).toBe(4);
    expect(provenance.steps.map((step) => step.code)).toEqual([
      ModifierCodes.Chilled,
      ModifierCodes.Obstruction
    ]);
    holds(effect({ base: 10, blockers: 1, chillPoints: CHILL_EFFECT }));
  });

  it('takes the shield off last, and says who held it', () => {
    const provenance = applyEffect(effect({ base: 10, absorb: { amount: 6, by: 'crew:shield' } }));

    expect(provenance.final).toBe(4);
    expect(provenance.steps).toEqual([
      { code: ModifierCodes.Guarded, source: 'crew:shield', delta: -6 }
    ]);
    expect(absorbedBy(provenance)).toBe(6);
  });

  it('absorbs no more than there was, and never goes below nothing', () => {
    const provenance = applyEffect(effect({ base: 4, absorb: { amount: 6, by: 'crew:shield' } }));

    expect(provenance.final).toBe(0);
    expect(absorbedBy(provenance)).toBe(4);
    holds(effect({ base: 4, absorb: { amount: 6, by: 'crew:shield' } }));
  });

  it('records no shield step when the shield took nothing', () => {
    const provenance = applyEffect(effect({ base: 0, absorb: { amount: 6, by: 'crew:shield' } }));

    expect(provenance.steps).toEqual([]);
  });

  it.each([
    [10, 0, 0, 10],
    [10, 1, 0, 7],
    [10, 2, 0, 4],
    [10, 3, 0, 2],
    [10, 4, 0, 2],
    [10, 0, CHILL_EFFECT, 7],
    [12, 2, CHILL_EFFECT, 3],
    [7, 1, 0, 4]
  ])('base %i behind %i blockers at %i chill points is %i', (base, blockers, chill, final) => {
    const input = effect({ base, blockers, chillPoints: chill });

    expect(applyEffect(input).final).toBe(final);
    holds(input);
  });

  it('holds the invariant on every combination of the three reductions', () => {
    for (const base of [0, 1, 7, 10, 12]) {
      for (const blockers of [0, 1, 2, 3, 4]) {
        for (const chillPoints of [0, CHILL_EFFECT]) {
          for (const absorb of [null, { amount: 6, by: 'crew:shield' }]) {
            holds(effect({ base, blockers, chillPoints, absorb }));
          }
        }
      }
    }
  });
});
