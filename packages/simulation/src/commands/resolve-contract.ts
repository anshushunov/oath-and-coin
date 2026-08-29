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
  /**
   * The round the player gave the retreat signal at, or `null` if he never did
   * (`DEC-005`, `COMBAT_SPEC` §7.4).
   *
   * **The one field this command carries, and the exception proves the rule above.**
   * Everything else the outcome is computed from was decided before this point and lives on
   * the package. This one cannot: it is a decision taken *while the battle is being
   * watched*, and there is no package to write it onto before the battle exists.
   *
   * It is not an interruption of a running simulation. The presentation runs the battle
   * once with `null`, and pressing the button re-runs it with the round filled in;
   * everything before that round is identical by determinism (§9), so what the player
   * watched is a prefix of what he gets.
   *
   * `null` on a contract that never goes to a battle, where there is no lever to pull.
   */
  readonly retreatAtRound: number | null;
}
