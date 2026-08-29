import type { BattleEvent, BattleOutcome } from './battle-event.ts';
import type { BattleUnit } from './battle-unit.ts';
import type { DoctrineId } from './doctrine-id.ts';

/**
 * A battle in progress, and a battle that finished (`COMBAT_SPEC` §5, §6.1, §8.1).
 *
 * The record is what the debrief screen reads and what the presentation replays, and it is
 * stored on the resolution the battle produced (§6.4). It is deliberately *whole*: the
 * board it started on, the board it ended on and every event between them, so that
 * "replay this battle" needs no second source and no re-derivation — which is also what
 * makes the presentation layer unable to invent anything (`ADR-002`).
 */
export interface BattleState {
  readonly round: number;
  readonly units: readonly BattleUnit[];
  readonly doctrine: DoctrineId;
  readonly outcome: BattleOutcome | null;
}

export interface BattleRecord {
  readonly initial: BattleState;
  readonly final: BattleState;
  readonly events: readonly BattleEvent[];
  readonly rounds: number;
  readonly outcome: BattleOutcome;
  /**
   * The round the player gave the retreat signal at, or `null` if he never did
   * (`DEC-005`, `COMBAT_SPEC` §7.4).
   *
   * An **input** to the battle rather than a fact discovered inside it, recorded here
   * because the record is what a replay is built from: a battle re-run without it would
   * not be the battle the player watched. It is the one thing in a battle a person
   * decided, and `MVP_PLAN` §6.4 measures how often he reaches for it.
   */
  readonly retreatSignalledAtRound: number | null;
}
