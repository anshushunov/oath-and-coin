import {
  CAPABILITY_GRADE_MAX,
  CAPABILITY_GRADE_MIN,
  type HeroCombatLayer
} from '../domain/capability.ts';
import { COMBAT_ATTRIBUTES } from '../domain/combat-attributes.ts';
import { divideTowardZero } from '../integer-division.ts';

/**
 * How good a hero is at all, derived rather than authored (`DEC-016` §3).
 *
 * `DEC-013` §1 called `grade` "an authored constant today, a derivative of attributes,
 * skills and equipment when `BQ-013` closes", and §Проверка of that record made the move
 * an obligation rather than an option: while the constant sits beside the attributes there
 * are two independently editable truths about how strong a hero is, both schema-valid, and
 * nothing catches them drifting apart.
 *
 * **Here rather than in `domain/`.** The vocabulary directory may import only
 * `collections`, `ids` and `canonical` (`ADR-014` §4, enforced by name in `lint:deps`), and
 * this needs `integer-division`. The type stays in `domain/`, where state can see it; the
 * arithmetic lives with the rest of the combat layer.
 */

/**
 * What equipment adds before there is any equipment.
 *
 * Named rather than written as a bare `0` at four call sites: the term is part of the rule
 * `DEC-016` §3 states, and a literal zero threaded through the code would be indis-
 * tinguishable from a caller who forgot the argument. Equipment itself arrives with
 * `COMBAT_SPEC` §3.4 and replaces this at the sites that have an item to read.
 */
export const EQUIPMENT_GRADE_NONE = 0;

/**
 * The mean of the five attributes plus what equipment contributes, clamped to the
 * capability range.
 *
 * Integer throughout and truncating toward zero (`TDD` §7.4): rounding would answer
 * differently on either side of a boundary nobody declared, and this number feeds the
 * coverage arithmetic, which is integral end to end.
 */
export function gradeFrom(combat: HeroCombatLayer, equipmentGrade: number): number {
  // Summed over the declared list rather than by naming the five fields again. The list is
  // derived from the interface, so an attribute added there and forgotten here is a type
  // error rather than a term silently missing from the mean.
  const total = COMBAT_ATTRIBUTES.reduce((sum, attribute) => sum + combat[attribute], 0);

  return clamp(divideTowardZero(total, COMBAT_ATTRIBUTES.length) + equipmentGrade);
}

function clamp(value: number): number {
  return Math.min(CAPABILITY_GRADE_MAX, Math.max(CAPABILITY_GRADE_MIN, value));
}
