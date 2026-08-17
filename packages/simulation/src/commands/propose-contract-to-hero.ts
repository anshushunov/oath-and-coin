import type { ContentId } from '../ids/content-id.ts';
import type { HeroId } from '../ids/hero-id.ts';

/**
 * Offer a contract to one hero and let the hero decide (`DEC-001`: the player proposes,
 * heroes choose — there is no command that makes a hero accept).
 */
export interface ProposeContractToHero {
  /**
   * Identifies this command for the campaign's lifetime. Recorded in
   * `GameState.appliedCommandIds` when applied, and re-applying the same id is refused
   * — the same proposal arriving twice (a retried UI action, a replayed log) must not
   * produce two decisions.
   */
  readonly commandId: number;
  readonly heroId: HeroId;
  readonly contractId: ContentId;
  /**
   * The state version this command was composed against. A mismatch means the campaign
   * moved on since — the offer the sender was looking at is not the offer that exists
   * now — and the command is refused rather than applied to a state it was never meant
   * for.
   */
  readonly expectedStateVersion: number;
}
