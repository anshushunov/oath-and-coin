import type { ContentId } from '../ids/content-id.ts';

/**
 * Sends the crew out and asks what came back (`RESOLUTION_SPEC` §3.1).
 *
 * The sixth command, between `pollCrew` and `settleContract`. It carries nothing of its
 * own beyond the three fields every command in this protocol carries: everything the
 * outcome is computed from — who was invited, who accepted, how willingly, what each of
 * them can do, what the contract asks and how dangerous it is — already lives on the
 * package this command resolves. A field here would be a second place one of those facts
 * could be stated, and the second statement is the one that drifts.
 *
 * **No `pay`, and no choice of any kind.** The player's decisions were all made before
 * this point (who to invite, on what terms, what to promise); this command is where those
 * decisions produce their consequence. The one choice left — whether the guild keeps its
 * word — belongs to `settleContract`, and it is deliberately asked *after* the player has
 * seen the outcome.
 */
export interface ResolveContract {
  /** Identifies this command for the campaign's lifetime; see `ProposeContractToHero`. */
  readonly commandId: number;
  readonly contractId: ContentId;
  /** The state version this command was composed against; see `ProposeContractToHero`. */
  readonly expectedStateVersion: number;
}
