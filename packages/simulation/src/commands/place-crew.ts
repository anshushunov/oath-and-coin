import type { Cell } from '../domain/battle-cell.ts';
import type { DoctrineId } from '../domain/doctrine-id.ts';
import type { ContentId } from '../ids/content-id.ts';
import type { HeroId } from '../ids/hero-id.ts';

/**
 * Sets the whole battle plan on a contract's package (`COMBAT_SPEC` §3.7).
 *
 * The seventh command, between `pollCrew` and `resolveContract`. It carries the three
 * decisions §2 lists as belonging to the same moment — where each hero stands, which
 * doctrine they fight under, and how far the crew may be worn down before it pulls out —
 * because they *are* one moment: the player is looking at a board and a crew and deciding
 * how the fight should go.
 *
 * **The whole formation, never a cell at a time.** A per-hero command would make a
 * half-placed crew a state the game can be in and a screen has to draw, and would give
 * `cell_taken` two meanings — "you already put somebody there" and "you are still moving
 * people around". §3.7 says the command places the crew, and this is what that means.
 *
 * **Not an argument to `resolveContract`.** §3.7 is explicit: an argument would be a
 * formation that can be changed at the moment of sending without the screen ever having
 * shown it, and one that does not survive a save.
 */
export interface PlaceCrew {
  /** Identifies this command for the campaign's lifetime; see `ProposeContractToHero`. */
  readonly commandId: number;
  readonly contractId: ContentId;
  /** The state version this command was composed against; see `ProposeContractToHero`. */
  readonly expectedStateVersion: number;

  /**
   * Every hero of the crew and the cell he takes — all of them, in one list.
   *
   * A list rather than a map, because a command is what a screen builds and a screen has
   * an ordered set of controls. The engine keys it by `compareHeroIds` on the way in, so
   * the order this arrives in never reaches state.
   */
  readonly placement: readonly { readonly hero: HeroId; readonly cell: Cell }[];

  readonly doctrine: DoctrineId;

  /**
   * Share of the crew that must still be standing before it withdraws on its own, in per
   * cent (`COMBAT_SPEC` §7.4). `0` is "fight it out".
   */
  readonly retreatBelowPercent: number;
}
