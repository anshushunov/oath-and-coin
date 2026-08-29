import type { Cell } from './battle-cell.ts';
import type { AmountProvenance } from './battle-provenance.ts';
import type { BlockReason, MotiveReason, TargetReason } from './battle-reasons.ts';
import type { StatusId } from './battle-status.ts';
import type { BattleUnitId } from './battle-unit-id.ts';
import type { CombatAction } from './combat-action.ts';
import type { DoctrineId } from './doctrine-id.ts';

/**
 * Everything that happens inside a battle (`COMBAT_SPEC` §8.1).
 *
 * **Not `DomainEvent`.** A battle raises dozens of these per round; the campaign's own
 * history goes into the save and into the canonical artifact, and eighty events per
 * contract would multiply a save by two orders of magnitude and make the canonical snapshot
 * unreadable to the person checking it (`ADR-016` §6). These live in the stored
 * `ContractResolution` of the battle that produced them, which is exactly as long as the
 * debrief screen needs them.
 *
 * A discriminated union, like `DomainEvent`, so a `switch` over it fails to build the day a
 * kind is added rather than answering for it silently. And each event carries what its own
 * line of the debrief needs and nothing flattened across the others: a `round_ended` has no
 * hero and an `intent_declared` has no amount.
 */

/** How a battle ended (`COMBAT_SPEC` §6.1). */
export const BattleOutcome = Object.freeze({
  CrewStanding: 'crew_standing',
  FoesStanding: 'foes_standing',
  Retreated: 'retreated',
  TimedOut: 'timed_out'
});

export type BattleOutcome = (typeof BattleOutcome)[keyof typeof BattleOutcome];

export const BATTLE_OUTCOMES: readonly BattleOutcome[] = Object.freeze(
  Object.values(BattleOutcome)
);

export type BattleEvent =
  | {
      readonly kind: 'battle_started';
      readonly crew: readonly BattleUnitId[];
      readonly foes: readonly BattleUnitId[];
      readonly doctrine: DoctrineId;
    }
  | { readonly kind: 'round_started'; readonly round: number }
  | {
      readonly kind: 'intent_declared';
      readonly actor: BattleUnitId;
      readonly action: CombatAction;
      readonly target: BattleUnitId | null;
      readonly reason: TargetReason | MotiveReason;
      /** The doctrine this intent went against, or `null` when it followed it. */
      readonly contraryTo: DoctrineId | null;
    }
  | { readonly kind: 'blocked'; readonly actor: BattleUnitId; readonly reason: BlockReason }
  | {
      readonly kind: 'damage_dealt';
      readonly actor: BattleUnitId;
      readonly target: BattleUnitId;
      readonly amount: number;
      readonly provenance: AmountProvenance;
    }
  | {
      readonly kind: 'healing_done';
      readonly actor: BattleUnitId;
      readonly target: BattleUnitId;
      readonly amount: number;
      readonly provenance: AmountProvenance;
    }
  | {
      readonly kind: 'damage_absorbed';
      readonly target: BattleUnitId;
      readonly by: BattleUnitId;
      readonly amount: number;
    }
  | {
      readonly kind: 'status_applied';
      readonly target: BattleUnitId;
      readonly status: StatusId;
      readonly source: BattleUnitId;
      readonly rounds: number;
      readonly refreshed: boolean;
    }
  | { readonly kind: 'status_expired'; readonly target: BattleUnitId; readonly status: StatusId }
  | {
      readonly kind: 'unit_shifted';
      readonly unit: BattleUnitId;
      readonly from: Cell;
      readonly to: Cell;
      readonly forced: boolean;
      readonly partner: BattleUnitId | null;
    }
  | { readonly kind: 'shift_resisted'; readonly unit: BattleUnitId; readonly by: BattleUnitId }
  | { readonly kind: 'unit_pinned'; readonly unit: BattleUnitId }
  | { readonly kind: 'turn_spent'; readonly unit: BattleUnitId }
  | { readonly kind: 'unit_downed'; readonly unit: BattleUnitId; readonly by: BattleUnitId }
  | {
      readonly kind: 'doctrine_broken';
      readonly unit: BattleUnitId;
      readonly doctrine: DoctrineId;
      readonly motive: MotiveReason;
    }
  /** The player's one lever, given at a round and costed on every hero who moved (`DEC-005`). */
  | { readonly kind: 'retreat_signalled'; readonly round: number }
  | { readonly kind: 'retreat_obeyed'; readonly unit: BattleUnitId }
  | {
      readonly kind: 'retreat_refused';
      readonly unit: BattleUnitId;
      readonly motive: MotiveReason;
    }
  | { readonly kind: 'round_ended'; readonly round: number }
  | { readonly kind: 'battle_ended'; readonly outcome: BattleOutcome };

export type BattleEventKind = BattleEvent['kind'];

/**
 * Which unit an event is about, or `null` for the ones about nobody.
 *
 * One exhaustive `switch`, beside the union rather than beside a reader, for the reason
 * `heroNamedBy` gives at length over `DomainEvent`: every reader that needs this used to
 * write the kinds naming nobody as a list of `!==`, which is the shape that misses whatever
 * is added next.
 */
export function unitNamedBy(event: BattleEvent): BattleUnitId | null {
  switch (event.kind) {
    case 'intent_declared':
    case 'blocked':
      return event.actor;
    case 'damage_dealt':
    case 'healing_done':
      return event.actor;
    case 'damage_absorbed':
    case 'status_applied':
    case 'status_expired':
      return event.target;
    case 'unit_shifted':
    case 'shift_resisted':
    case 'unit_pinned':
    case 'turn_spent':
    case 'unit_downed':
    case 'doctrine_broken':
    case 'retreat_obeyed':
    case 'retreat_refused':
      return event.unit;
    case 'battle_started':
    case 'round_started':
    case 'retreat_signalled':
    case 'round_ended':
    case 'battle_ended':
      return null;
  }
}
