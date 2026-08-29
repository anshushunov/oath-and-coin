import {
  BATTLE_OUTCOMES,
  BattleOutcome,
  unitNamedBy,
  type BattleEvent,
  type BattleEventKind
} from '../domain/battle-event.ts';
import {
  BLOCK_REASONS,
  BlockReasons,
  MOTIVE_REASONS,
  MotiveReasons,
  type BlockReason,
  type MotiveReason
} from '../domain/battle-reasons.ts';
import { COMBAT_ACTIONS, CombatAction } from '../domain/combat-action.ts';

/**
 * The battle's own event vocabulary, as the combat core reaches it.
 *
 * Every name here is declared in `domain/` and re-exported from this file rather than
 * declared twice. The move happened when the battle record became part of the stored
 * resolution (`COMBAT_SPEC` §6.4): `state/` has to be able to name a battle event, and
 * `lint:deps` lets `state/` reach `domain/` and nothing else. The file stays because every
 * rule in this directory reads the vocabulary through it, and a rule reaching two
 * directories up for a name would put the layering back in each caller's hands.
 */

export {
  BATTLE_OUTCOMES,
  BattleOutcome,
  BLOCK_REASONS,
  BlockReasons,
  COMBAT_ACTIONS,
  CombatAction,
  MOTIVE_REASONS,
  MotiveReasons,
  unitNamedBy
};
export type { BattleEvent, BattleEventKind, BlockReason, MotiveReason };
