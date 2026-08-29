import type { ContractBattlePlan } from './contract-battle-plan.ts';
import type { CrewDeployment } from './crew-deployment.ts';

/**
 * Everything a battle needs that a contract and a crew do not already say
 * (`ADR-016` §3, `COMBAT_SPEC` §6.3).
 *
 * Assembled by the command that sends the crew out, from the contract's own authored plan
 * and the package's own formation. It is an **optional** field of `ResolutionInput` so that
 * `ContractResolver` stays a one-argument function: a second argument would make the battle
 * implementation unassignable to the type, which is what external review found wrong with
 * the first edition of `ADR-016`.
 *
 * In `domain/` rather than beside the battle resolver, because `ResolutionInput` names it
 * and the battle resolver names `ResolutionInput` — two files each needing the other's type
 * is the cycle `lint:deps` refuses by name, and this is the vocabulary half of the pair.
 */
export interface Deployment {
  /** The contract's own authored pattern and objectives. */
  readonly plan: ContractBattlePlan;

  /** Where the crew stands, under which doctrine, and when it pulls out. */
  readonly crew: CrewDeployment;

  /**
   * The round the player's retreat signal takes effect from, or `null` (`DEC-005`).
   *
   * Not on the package, unlike the three fields above, and that is the one difference
   * between them: this is decided *while the battle is being watched* and cannot be known
   * before it starts. It reaches the resolver through the command that sends the crew.
   */
  readonly retreatSignalledAtRound: number | null;
}
