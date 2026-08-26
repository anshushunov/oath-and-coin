import { describe, expect, it } from 'vitest';

import { NeedId } from '../domain/need-id.ts';
import { OutcomeGrade, OutcomeIntentKind, type OutcomeIntent } from '../domain/outcome.ts';
import { OutcomeReasonCodes } from '../domain/outcome-reason-codes.ts';

import {
  COSTLY_PERCENT,
  FAILED_PERCENT,
  PARTIAL_FEE_PERCENT,
  gradeFromIntents,
  severityOf,
  termsOf
} from './outcome-grade.ts';

/**
 * `RESOLUTION_SPEC` §4.6 (which step an outcome lands on) and §5.1/§5.3 (what that step
 * costs and pays).
 *
 * Every boundary below is stated at `totalRequired = 100`, where the two cross-multiplied
 * conditions land on whole margins — `−10` and `−35` — so a table can name the exact
 * point rather than a neighbourhood of it.
 */

const TOTAL = 100;

const needCovered = (need: NeedId, delta: number): OutcomeIntent => ({
  kind: OutcomeIntentKind.NeedCovered,
  hero: null,
  need,
  marginDelta: delta,
  reason: OutcomeReasonCodes.NeedClosed,
  gap: null,
  consequence: null,
  magnitude: 0
});

const needShort = (need: NeedId, delta: number): OutcomeIntent => ({
  kind: OutcomeIntentKind.NeedShort,
  hero: null,
  need,
  marginDelta: delta,
  reason: OutcomeReasonCodes.NeedWeak,
  gap: null,
  consequence: null,
  magnitude: 0
});

/** Two needs, both closed — the only shape "clean" is reachable from. */
const allClosed = [needCovered(NeedId.Frontline, 20), needCovered(NeedId.Wilderness, 5)];

const gradeAt = (margin: number, intents = allClosed): OutcomeGrade =>
  gradeFromIntents({ intents, margin, totalRequired: TOTAL });

describe('the step an outcome lands on (§4.6)', () => {
  it('is clean only when the margin holds and every need closed', () => {
    expect(gradeAt(0)).toBe(OutcomeGrade.Clean);
    expect(gradeAt(40)).toBe(OutcomeGrade.Clean);
  });

  it('refuses clean when a need went unclosed, however large the margin', () => {
    // The case edition 1.0 got wrong. Weights 200 and 10: a surplus of +40 on the first
    // outweighs −10 on the second, so the margin is positive — and the second need was
    // not covered at all. "No `weak`" would have called this clean; "every need closed"
    // does not.
    const lopsided = [needCovered(NeedId.Frontline, 40), needShort(NeedId.Wilderness, -10)];

    expect(gradeFromIntents({ intents: lopsided, margin: 30, totalRequired: TOTAL })).toBe(
      OutcomeGrade.Costly
    );
  });

  it('refuses clean for a need that is merely weak rather than missing', () => {
    const weak = [needCovered(NeedId.Frontline, 40), needShort(NeedId.Wilderness, -2)];

    expect(gradeFromIntents({ intents: weak, margin: 38, totalRequired: TOTAL })).toBe(
      OutcomeGrade.Costly
    );
  });

  it.each([
    // The costly floor: margin × 100 >= −(10 × 100), i.e. margin >= −10.
    [-9, OutcomeGrade.Costly],
    [-10, OutcomeGrade.Costly],
    [-11, OutcomeGrade.Failed],
    // The failed floor: margin >= −35.
    [-34, OutcomeGrade.Failed],
    [-35, OutcomeGrade.Failed],
    [-36, OutcomeGrade.Disaster]
  ])('a margin of %i against a requirement of 100 is %s', (margin, expected) => {
    expect(gradeAt(margin)).toBe(expected);
  });

  it.each([
    [-10, OutcomeGrade.Costly, OutcomeGrade.Failed],
    [-35, OutcomeGrade.Failed, OutcomeGrade.Disaster]
  ])('the threshold at %i is checked on both sides and on itself', (at, onIt, below) => {
    expect(gradeAt(at)).toBe(onIt);
    expect(gradeAt(at + 1)).toBe(onIt);
    expect(gradeAt(at - 1)).toBe(below);
  });

  it('scales the thresholds with what was asked, rather than fixing them in points', () => {
    // A margin of −20 is a disaster against a requirement of 50 and merely costly against
    // one of 200. Fixed thresholds would make a small contract impossible to fail gently
    // and a large one impossible to fail at all.
    expect(gradeFromIntents({ intents: allClosed, margin: -20, totalRequired: 50 })).toBe(
      OutcomeGrade.Disaster
    );
    expect(gradeFromIntents({ intents: allClosed, margin: -20, totalRequired: 200 })).toBe(
      OutcomeGrade.Costly
    );
  });

  it('reads the objective off the margin’s sign, so the two can never disagree', () => {
    expect(termsOf(gradeAt(0)).objectiveTaken).toBe(true);
    expect(termsOf(gradeAt(-1)).objectiveTaken).toBe(true);
    expect(termsOf(gradeAt(-11)).objectiveTaken).toBe(false);
  });

  it('states the two percentages the thresholds are built from', () => {
    expect(COSTLY_PERCENT).toBe(10);
    expect(FAILED_PERCENT).toBe(35);
  });
});

describe('what a step costs and pays (§5.1, §5.3)', () => {
  it.each([
    [OutcomeGrade.Clean, true, 100, 0],
    [OutcomeGrade.Costly, true, 100, 1],
    [OutcomeGrade.Failed, false, PARTIAL_FEE_PERCENT, 1],
    [OutcomeGrade.Disaster, false, 0, 2]
  ])('%s: objective %s, patron pays %i%%, %i consequences', (grade, taken, fee, consequences) => {
    const terms = termsOf(grade);

    expect([terms.objectiveTaken, terms.patronFeePercent, terms.maxConsequences]).toEqual([
      taken,
      fee,
      consequences
    ]);
  });

  it.each(Object.values(OutcomeGrade))('the promise still stands after %s', (grade) => {
    // §5.3, and the reason the whole promise mechanic exists: the temptation to break a
    // word is largest exactly when the contract failed and there is no money. A grade that
    // discharged the obligation would remove the choice at the only moment it is
    // interesting.
    expect(termsOf(grade).promiseStands).toBe(true);
  });

  it('pays a failed contract something and a disaster nothing', () => {
    expect(termsOf(OutcomeGrade.Failed).patronFeePercent).toBeGreaterThan(0);
    expect(termsOf(OutcomeGrade.Disaster).patronFeePercent).toBe(0);
  });
});

describe('how bad one step is against another (§4.6)', () => {
  it('orders the four steps, so a property can say “no worse than”', () => {
    const ordered = [
      OutcomeGrade.Clean,
      OutcomeGrade.Costly,
      OutcomeGrade.Failed,
      OutcomeGrade.Disaster
    ];

    expect(ordered.map(severityOf)).toEqual([...ordered.map(severityOf)].sort((a, b) => a - b));
    expect(new Set(ordered.map(severityOf)).size).toBe(4);
  });
});
