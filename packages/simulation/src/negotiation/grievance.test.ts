import { describe, expect, it } from 'vitest';

import { GRIEVANCE_MAX, grievanceForBrokenPromise } from './grievance.ts';

/**
 * `grievanceForBrokenPromise` (`NEGOTIATION_SPEC` §3.3): what breaking a promise costs
 * the victim and every witness, before either amount is added to an existing
 * `HeroState.grievance` — that addition is `settleContract`'s own arithmetic
 * (`engine.ts`'s `applyBrokenPromise`), not this function's.
 */
describe('grievanceForBrokenPromise', () => {
  it('scales the victim grievance with how much of the fee was withheld', () => {
    expect(grievanceForBrokenPromise(100, 100).victim).toBe(30);
    expect(grievanceForBrokenPromise(50, 100).victim).toBe(15);
  });

  it('never lets a broken promise cost nothing, however small', () => {
    // 30 * 1 / 100 divides toward zero to 0 — Math.max(…, 1) is the only thing standing
    // between that and a promise breaking for free.
    expect(grievanceForBrokenPromise(1, 100)).toEqual({ victim: 1, witness: 1 });
  });

  it('keeps the witness below the victim and both inside the ceiling', () => {
    const { victim, witness } = grievanceForBrokenPromise(100, 100);
    expect(witness).toBeGreaterThan(0);
    expect(witness).toBeLessThanOrEqual(victim);
    expect(victim).toBeLessThanOrEqual(GRIEVANCE_MAX);
  });

  it('scales the witness down by WITNESS_SHARE, not by the victim amount unscaled', () => {
    // Pins both GRIEVANCE_VICTIM and WITNESS_SHARE to concrete numbers: broken = 30,
    // witness = 30 * 40 / 100 = 12. A mutant that drops the WITNESS_SHARE scaling
    // entirely (witness === victim) or that changes its value survives every other
    // test in this file but not this one.
    expect(grievanceForBrokenPromise(100, 100)).toEqual({ victim: 30, witness: 12 });
  });

  it('refuses a promise that was never made', () => {
    expect(() => grievanceForBrokenPromise(0, 100)).toThrow(/promisedBonus/);
    expect(() => grievanceForBrokenPromise(-1, 100)).toThrow(/promisedBonus/);
  });

  it('refuses a patron fee that could not have backed the promise it is handed', () => {
    // promisedBonus > 0 with patronFee ≤ 0 violates `0 ≤ promisedBonus ≤ patronFee`
    // (NEGOTIATION_SPEC §2.1) — a state invariant already broken by the caller, and
    // exactly the shape `divideTowardZero(x, 0)` would otherwise turn into NaN instead
    // of a refusal.
    expect(() => grievanceForBrokenPromise(1, 0)).toThrow(/patronFee/);
  });
});
