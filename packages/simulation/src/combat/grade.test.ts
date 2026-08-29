import { describe, expect, it } from 'vitest';

import { CAPABILITY_GRADE_MAX, CAPABILITY_GRADE_MIN } from '../domain/capability.ts';
import type { HeroCombatLayer } from '../domain/combat-attributes.ts';

import { EQUIPMENT_GRADE_NONE, gradeFrom } from './grade.ts';

/**
 * `DEC-016` §3: `grade` stops being an authored constant and becomes a derivative of the
 * combat layer and equipment.
 *
 * The point of the rule is the one `DEC-013` §Проверка named: two independently editable
 * truths about how strong a hero is drift apart on the first content edit, and nothing
 * catches it because both sides are schema-valid. So the check that matters is not "the
 * formula computes what the formula says" — it is that **moving an attribute moves the
 * grade**, which is what a constant cannot do.
 */

const layer = (values: Partial<HeroCombatLayer> = {}): HeroCombatLayer => ({
  might: 50,
  guard: 50,
  aim: 50,
  focus: 50,
  care: 50,
  ...values
});

describe('gradeFrom', () => {
  it('is the mean of the five attributes when nothing is equipped', () => {
    expect(gradeFrom(layer(), EQUIPMENT_GRADE_NONE)).toBe(50);
  });

  it('truncates toward zero rather than rounding', () => {
    // 50 + 50 + 50 + 50 + 52 = 252; 252 / 5 = 50.4, and every division in this
    // repository truncates (`TDD` §7.4). A rule that rounded would answer 50 here and 51
    // at 253 — the same input class answering two ways depending on a boundary nobody
    // declared.
    expect(gradeFrom(layer({ care: 52 }), EQUIPMENT_GRADE_NONE)).toBe(50);
    expect(gradeFrom(layer({ care: 55 }), EQUIPMENT_GRADE_NONE)).toBe(51);
  });

  it('moves when any one of the five moves — which is the whole of DEC-016 §3', () => {
    const base = gradeFrom(layer(), EQUIPMENT_GRADE_NONE);

    for (const attribute of ['might', 'guard', 'aim', 'focus', 'care'] as const) {
      expect(
        gradeFrom(layer({ [attribute]: 100 }), EQUIPMENT_GRADE_NONE),
        attribute
      ).toBeGreaterThan(base);
    }
  });

  it('adds what equipment contributes', () => {
    expect(gradeFrom(layer(), 7)).toBe(57);
  });

  it('clamps to the capability bounds rather than leaving the range', () => {
    expect(gradeFrom(layer({ might: 100, guard: 100, aim: 100, focus: 100, care: 100 }), 40)).toBe(
      CAPABILITY_GRADE_MAX
    );
    expect(gradeFrom(layer({ might: 0, guard: 0, aim: 0, focus: 0, care: 0 }), -40)).toBe(
      CAPABILITY_GRADE_MIN
    );
  });
});
