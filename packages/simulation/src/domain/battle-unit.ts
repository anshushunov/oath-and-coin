import type { SortedMap } from '../collections/sorted-map.ts';
import type { HeroId } from '../ids/hero-id.ts';

import type { Cell, BattleSide } from './battle-cell.ts';
import type { StatusId, StatusInstance } from './battle-status.ts';
import type { BattleUnitId } from './battle-unit-id.ts';
import type { HeroCombatLayer } from './combat-attributes.ts';
import type { CombatRole } from './combat-role.ts';

/**
 * One combatant (`COMBAT_SPEC` §3.2).
 *
 * Every number here that is not authored is **derived** — `maxHealth` and `stability` come
 * out of the combat layer by the formulas of §3.6, which live in `combat/unit.ts`. A second
 * authored number beside the attributes would be a second truth about how tough a hero is,
 * and the two part company on the first content edit with both sides schema-valid
 * (`DEC-013` §Проверка, `DEC-016` §3).
 */
export interface BattleUnit {
  readonly id: BattleUnitId;
  readonly side: BattleSide;
  /** The hero this unit is, or `null` for a foe or a ward (`COMBAT_SPEC` §3.2). */
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
   * the combat layer, and it reaches exactly two rules — the personality reaction of
   * `COMBAT_SPEC` §7.3 and the refusal of a retreat signal (§7.4), both of which change
   * *which* action is chosen and no number (`DEC-016` §4).
   */
  readonly bonds: SortedMap<BattleUnitId, number>;
  /**
   * Whether this unit is still on the field.
   *
   * `false` covers two different endings and the events say which: a unit that was knocked
   * down (`unit_downed`) and one that walked off on the retreat signal (`retreat_obeyed`).
   * The distinction matters to the consequences — a wound is for the first — and it is a
   * fact about *events*, not a third value of this flag, because a flag with three values
   * would have every reader of "is he still fighting" branch on which of the two it was.
   */
  readonly standing: boolean;
}
