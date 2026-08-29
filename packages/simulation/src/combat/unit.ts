import { SortedMap } from '../collections/sorted-map.ts';
import { compareStrings } from '../collections/comparator.ts';
import type { HeroCombatLayer } from '../domain/combat-attributes.ts';
import { CombatRole } from '../domain/combat-role.ts';
import type { HeroId } from '../ids/hero-id.ts';
import { divideTowardZero, multiplyInt32 } from '../integer-division.ts';

import type { BattleSide, Cell } from './field.ts';

/**
 * One combatant, and every number about him that is not authored (`COMBAT_SPEC` §3.2,
 * §3.6).
 *
 * `maxHealth` and `stability` are derived here for the reason `grade` is derived in
 * `grade.ts`: a second authored number beside the attributes is a second truth about how
 * tough a hero is, and the two part company on the first content edit with both sides
 * schema-valid (`DEC-013` §Проверка, `DEC-016` §3).
 */

/** A combatant's identity inside one battle. Stable for its length and no longer. */
export type BattleUnitId = string;

export const compareBattleUnitIds = compareStrings;

/** The four statuses of `COMBAT_SPEC` §3.5. */
export const StatusId = Object.freeze({
  Chilled: 'chilled',
  Bleeding: 'bleeding',
  Guarded: 'guarded',
  Pinned: 'pinned'
});

export type StatusId = (typeof StatusId)[keyof typeof StatusId];

export const STATUS_IDS: readonly StatusId[] = Object.freeze(Object.values(StatusId));

/**
 * A status on a unit, **with the unit that put it there**.
 *
 * The source is in the state and not only in the event that applied it, and that is a
 * repair rather than a flourish: `bleeding` deals damage at the end of a round, and the
 * event for that damage has to name an `actor`; `guarded` absorbs a blow, and the
 * absorption has to name a `by`. Both facts are gone by then unless the state remembers
 * them — external review found the hole, and §8.3 could not have built a single aggregate
 * without it.
 */
export interface StatusInstance {
  readonly remainingRounds: number;
  readonly source: BattleUnitId;
}

export interface BattleUnit {
  readonly id: BattleUnitId;
  readonly side: BattleSide;
  /** The hero this unit is, or `null` for a foe (`COMBAT_SPEC` §3.2). */
  readonly hero: HeroId | null;
  readonly role: CombatRole;
  readonly cell: Cell;
  readonly health: number;
  readonly maxHealth: number;
  readonly stability: number;
  readonly combat: HeroCombatLayer;
  readonly statuses: SortedMap<StatusId, StatusInstance>;
  /** Whether the next action has already been spent — by a swap, or by `pinned`. */
  readonly spent: boolean;
  /** Whether the personality reaction has already fired (`COMBAT_SPEC` §7.3: once). */
  readonly brokeDoctrine: boolean;
  /**
   * What this unit thinks of the others, keyed by their battle id (`GDD` §6.4).
   *
   * Resolved once when the battle is set up, from the hero's `relationships`, so the combat
   * core never has to know what a `ContentId` is. It is the **one** thing here that is not
   * the combat layer, and it reaches exactly one rule — the personality reaction of
   * `COMBAT_SPEC` §7.3, which changes which action is chosen and no number
   * (`DEC-016` §4).
   */
  readonly bonds: SortedMap<BattleUnitId, number>;
  readonly standing: boolean;
}

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
