import type { DecisionResult } from '../decisions/causal-trace.ts';
import type { DomainEvent } from '../events/domain-event.ts';
import type { GameState } from '../state/game-state.ts';

/**
 * Stable codes for every way a command can be refused. Named constants for the same
 * reason the reason codes are: a code assembled inline at one call site drifts from the
 * "same" code assembled at another, and these end up in logs, tests and — eventually —
 * localized UI text.
 */
export const RejectionCodes = Object.freeze({
  /** The campaign moved on since the command was composed. */
  StaleState: 'rejected.stale_state',
  /** This command id was already applied to this campaign. */
  DuplicateCommand: 'rejected.duplicate_command',
  UnknownHero: 'rejected.unknown_hero',
  UnknownContract: 'rejected.unknown_contract',
  /** The contract is no longer on offer — somebody took it. */
  ContractAlreadyResolved: 'rejected.contract_already_resolved',
  /** This hero already answered this offer; nobody is asked twice. */
  AlreadyResponded: 'rejected.already_responded'
});

export type RejectionCode = (typeof RejectionCodes)[keyof typeof RejectionCodes];

/**
 * What a command did: the resulting state, the events it produced, and — when it was a
 * hero's decision — the explanation that came out of the same computation as the choice.
 *
 * A rejection carries the *same* state object it was given, not a copy. A caller can
 * then compare by reference to know that nothing happened, and the tests assert exactly
 * that.
 */
export interface CommandResult {
  readonly applied: boolean;
  /** A {@link RejectionCodes} value when {@link applied} is false; `null` otherwise. */
  readonly rejectionCode: RejectionCode | null;
  /** The state after the command, or the untouched input state if it was refused. */
  readonly state: GameState;
  readonly events: readonly DomainEvent[];
  /**
   * The hero's decision, when the command produced one. `null` for every rejection — a
   * refused command explains itself through {@link rejectionCode}, which is a fact
   * about the command, not a decision anybody made.
   */
  readonly decision: DecisionResult | null;
}

export function rejected(state: GameState, rejectionCode: RejectionCode): CommandResult {
  return { applied: false, rejectionCode, state, events: [], decision: null };
}

export function fromDecision(
  state: GameState,
  domainEvent: DomainEvent,
  decision: DecisionResult
): CommandResult {
  return { applied: true, rejectionCode: null, state, events: [domainEvent], decision };
}
