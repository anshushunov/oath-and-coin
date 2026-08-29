import type { SortedMap } from '../collections/sorted-map.ts';

import type { Cell } from './battle-cell.ts';
import type { BattleObjective } from './battle-objective.ts';
import type { BattleUnitId } from './battle-unit-id.ts';
import type { HeroCombatLayer } from './combat-attributes.ts';
import type { CombatRole } from './combat-role.ts';
import type { NeedId } from './need-id.ts';

/**
 * What a contract's author says about the fight it leads to (`ADR-016` §1, `COMBAT_SPEC`
 * §6.2).
 *
 * **A contract either has one or does not**, and that is the routing rule `ADR-014` §1 wrote
 * before the battle existed: a contract knows *before it is sent* which resolver settles it.
 * One with a plan goes to the battle resolver; one without is a delegated job the abstract
 * resolver answers, and the same field is what says so.
 *
 * Authored, never derived. The mapping from a need to an objective in particular: "frontline"
 * is a line to hold on one contract and a band to put down on the next, and reading it off
 * the identifier would be the engine inventing the content's meaning (`ADR-016` §1).
 */
export interface ContractBattlePlan {
  /**
   * One objective per need of the contract — exactly its own needs, as sets. Held by the
   * content loader, because it is the one place that can see both halves.
   */
  readonly objectives: SortedMap<NeedId, BattleObjective>;

  /** Who the crew is fighting, where they stand, and what they are made of. */
  readonly foes: readonly AuthoredCombatant[];

  /**
   * Whoever the crew is there to keep alive — carts, scribes, hostages.
   *
   * On the crew's own side of the board and occupying a cell of it, so a `protect` contract
   * is a smaller board for the crew as well as a thing to defend. Empty on a contract with
   * nothing to protect, which is most of them.
   */
  readonly wards: readonly AuthoredCombatant[];
}

/** One authored unit: an identity, a job, a cell and the five attributes. */
export interface AuthoredCombatant {
  /**
   * The battle id this unit fights under — `foe:` or `ward:` and the key its author wrote.
   *
   * Built by the loader rather than authored whole, so a content file names `wight` and
   * cannot accidentally name `crew:bram`.
   */
  readonly id: BattleUnitId;
  readonly role: CombatRole;
  readonly cell: Cell;
  readonly combat: HeroCombatLayer;
}
