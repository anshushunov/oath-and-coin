import { SortedMap } from '../collections/sorted-map.ts';
import { compareStrings } from '../collections/comparator.ts';
import { STATUS_IDS, StatusId, type StatusInstance } from '../domain/battle-status.ts';
import { compareBattleUnitIds, type BattleUnitId } from '../domain/battle-unit-id.ts';
import type { BattleUnit } from '../domain/battle-unit.ts';
import type { HeroCombatLayer } from '../domain/combat-attributes.ts';
import { CombatRole } from '../domain/combat-role.ts';
import type { HeroId } from '../ids/hero-id.ts';
import { divideTowardZero, multiplyInt32 } from '../integer-division.ts';

import type { BattleSide, Cell } from './field.ts';

/**
 * Every number about a combatant that is not authored (`COMBAT_SPEC` §3.6), and the one
 * way to put a unit on the board.
 *
 * `maxHealth` and `stability` are derived here for the reason `grade` is derived in
 * `grade.ts`: a second authored number beside the attributes is a second truth about how
 * tough a hero is, and the two part company on the first content edit with both sides
 * schema-valid (`DEC-013` §Проверка, `DEC-016` §3).
 *
 * The **shape** of a unit and of a status lives in `domain/` (`battle-unit.ts`,
 * `battle-status.ts`), because a battle record is stored on the contract's resolution
 * (`COMBAT_SPEC` §6.4) and `state/` may only reach `domain/`. What is here is the
 * arithmetic, which nothing outside the combat core needs.
 */

export { STATUS_IDS, StatusId, compareBattleUnitIds };
export type { BattleUnit, BattleUnitId, StatusInstance };

/** §3.5's durations, fixed constants and nothing computed from `focus`. */
export const STATUS_ROUNDS: Readonly<Record<StatusId, number>> = Object.freeze({
  chilled: 1,
  bleeding: 2,
  guarded: 1,
  pinned: 1
});

export const CHILL_EFFECT = 30;
export const BLEED = 3;
export const GUARD_ABSORB = 6;
export const STEADY_BONUS = 15;

/** What a role adds to `stability` — the one thing a role gives beyond a home row. */
const ROLE_STABILITY: Readonly<Record<CombatRole, number>> = Object.freeze({
  [CombatRole.Vanguard]: 15,
  [CombatRole.Support]: 5,
  [CombatRole.Rear]: -5,
  [CombatRole.Breaker]: 0
});

/** §3.6, in order. Integer throughout, truncating toward zero (`TDD` §7.4). */
export function maxHealthOf(combat: HeroCombatLayer): number {
  return 20 + divideTowardZero(multiplyInt32(combat.guard, 3), 10);
}

export function stabilityOf(combat: HeroCombatLayer, role: CombatRole): number {
  return Math.min(100, Math.max(0, combat.guard + ROLE_STABILITY[role]));
}

export function meleeDamageOf(combat: HeroCombatLayer): number {
  return 6 + divideTowardZero(multiplyInt32(combat.might, 6), 100);
}

export function shortDamageOf(combat: HeroCombatLayer): number {
  return 4 + divideTowardZero(multiplyInt32(combat.might, 4), 100);
}

export function rangedDamageOf(combat: HeroCombatLayer): number {
  return 5 + divideTowardZero(multiplyInt32(combat.aim, 7), 100);
}

export function healingOf(combat: HeroCombatLayer): number {
  return 4 + divideTowardZero(multiplyInt32(combat.care, 6), 100);
}

/** Everything a caller has to say to put a unit on the board. */
export interface UnitBlueprint {
  readonly id: BattleUnitId;
  /** Optional: a unit with nobody it cares about carries an empty map. */
  readonly bonds?: SortedMap<BattleUnitId, number>;
  readonly side: BattleSide;
  readonly hero: HeroId | null;
  readonly role: CombatRole;
  readonly cell: Cell;
  readonly combat: HeroCombatLayer;
}

/** A unit at full health, unwounded, unspent, with nothing on it. */
export function unitFrom(blueprint: UnitBlueprint): BattleUnit {
  const maxHealth = maxHealthOf(blueprint.combat);

  return {
    ...blueprint,
    health: maxHealth,
    maxHealth,
    stability: stabilityOf(blueprint.combat, blueprint.role),
    statuses: SortedMap.empty<StatusId, StatusInstance>(compareStrings),
    bonds: blueprint.bonds ?? SortedMap.empty<BattleUnitId, number>(compareBattleUnitIds),
    spent: false,
    brokeDoctrine: false,
    standing: true
  };
}

/** How chilled a unit is, in percentage points off its own actions (§3.5). */
export function chillPointsOf(unit: BattleUnit): number {
  return unit.statuses.has(StatusId.Chilled) ? CHILL_EFFECT : 0;
}

/**
 * Puts a status on a unit, refreshing rather than stacking (`COMBAT_SPEC` §3.5).
 *
 * Refresh is the rule and not the convenient default: stacking would give `bleeding` no
 * ceiling and turn one status into the main arithmetic of the battle. The source is
 * replaced along with the duration, so the last unit to apply it is the one the damage is
 * attributed to.
 */
export function withStatus(
  unit: BattleUnit,
  status: StatusId,
  source: BattleUnitId
): { readonly unit: BattleUnit; readonly refreshed: boolean } {
  const refreshed = unit.statuses.has(status);

  return {
    unit: {
      ...unit,
      statuses: unit.statuses.set(status, {
        remainingRounds: STATUS_ROUNDS[status],
        source
      })
    },
    refreshed
  };
}
