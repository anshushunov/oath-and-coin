import type { SortedMap } from '../collections/sorted-map.ts';
import type { HeroId } from '../ids/hero-id.ts';

import type { Cell } from './battle-cell.ts';
import type { DoctrineId } from './doctrine-id.ts';

/**
 * The whole of what a player decides after the crew has said yes and before it goes out
 * (`COMBAT_SPEC` §2, §3.7).
 *
 * **It lives on the contract's package**, beside `acceptedBy` and `commitments`, and not in
 * an argument to the command that sends the crew. §3.7 gives the reason for the formation
 * and it applies to all three: an argument would mean a decision that can be changed at the
 * moment of sending without the screen ever having shown it, and one that does not survive
 * a save.
 *
 * **Three fields and one command, where the spec names one field.** `COMBAT_SPEC` §3.7 names
 * `placeCrew(contractId, placement)` and says nothing about which command records the
 * doctrine or the retreat threshold — but §2 lists all three as decisions of the same moment,
 * and §7.4 makes the threshold "основной путь" out of a losing fight, which means the battle
 * reads it. Two more commands with identical preconditions would be three doors onto one
 * room. Named here rather than assumed: this is an interpretation of a spec that named a
 * command and not its whole argument.
 */
export interface CrewDeployment {
  /**
   * Where each hero of the crew stands. Exactly the heroes who accepted, one cell each, no
   * two on a cell — held by `createContractState` rather than by whoever built this.
   */
  readonly placement: SortedMap<HeroId, Cell>;

  /** The one group order (`COMBAT_SPEC` §7.2). */
  readonly doctrine: DoctrineId;

  /**
   * Share of the crew that must still be standing, in per cent, before it withdraws on its
   * own (`COMBAT_SPEC` §7.4). `0` is "fight it out"; the emergency signal is the other path
   * and is not set here, because it is not known before the battle starts.
   */
  readonly retreatBelowPercent: number;
}

/** Most a `retreatBelowPercent` may be — a share, so a hundred is the whole crew. */
export const RETREAT_THRESHOLD_MAX = 100;
