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
  AlreadyResponded: 'rejected.already_responded',
  /**
   * `proposeContractToHero` only lets the offer's key hero answer while the package is
   * still a draft (`NEGOTIATION_SPEC` §3.1, §6) — everyone else's turn comes once the
   * package is `locked` (`pollCrew`, Task 13), never before. `keyHero` starts `null`
   * (`initialOffer`), so before the first `composeOffer` this refuses every hero, key
   * or not — there is no key hero yet to be.
   */
  NotTheKeyHero: 'rejected.not_the_key_hero',
  /**
   * `composeOffer` only revises a package in `draft`, or in `locked` while the crew it
   * had has not filled (`NEGOTIATION_SPEC` §3.1) — a locked, crewed offer is a deal
   * already struck.
   */
  OfferNotInDraft: 'rejected.offer_not_in_draft',
  /**
   * `advance`, `promisedBonus` or `methodTag` fell outside the bounds `composeOffer`
   * checks before ever building a package (`NEGOTIATION_SPEC` §3.3, §6.1) — money
   * outside `0..patronFee`, or a method tag the contract never offered.
   */
  OfferTermsOutOfBounds: 'rejected.offer_terms_out_of_bounds'
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
   * Every decision this command's events explain, in the same order as {@link events} —
   * index `i` is the explanation for `events[i]`. Empty for every rejection — a refused
   * command explains itself through {@link rejectionCode}, which is a fact about the
   * command, not a decision anybody made.
   *
   * One decision per event is enforced, not assumed: {@link fromDecisions} throws rather
   * than build a result whose two lists disagree in length, because a caller reading
   * `decisions[i]` as "what explains `events[i]`" would otherwise be trusting a pairing
   * nobody checked.
   */
  readonly decisions: readonly DecisionResult[];
}

export function rejected(state: GameState, rejectionCode: RejectionCode): CommandResult {
  return { applied: false, rejectionCode, state, events: [], decisions: [] };
}

/**
 * Builds the result of an applied command from the events it produced and the decision
 * behind each one, in the same order.
 *
 * Throws rather than silently accepting a result whose two lists disagree in length: a
 * command result is not just "some events and some decisions" — it is one decision per
 * event, and a mismatch here is a bug in the command that built the lists, not a shape
 * downstream code should have to guard against.
 */
export function fromDecisions(
  state: GameState,
  events: readonly DomainEvent[],
  decisions: readonly DecisionResult[]
): CommandResult {
  if (events.length !== decisions.length) {
    throw new Error(
      `fromDecisions requires one decision per event, but got ${String(events.length)} event(s) ` +
        `and ${String(decisions.length)} decision(s).`
    );
  }

  return { applied: true, rejectionCode: null, state, events, decisions };
}

/**
 * Builds the result of a command whose one event explains itself — nobody decided
 * anything, so there is no {@link DecisionResult} to pair it with. `composeOffer`'s
 * `offer_revised` is the first such event (`NEGOTIATION_SPEC` §3.3): the player
 * revised the package, a hero did not.
 *
 * `fromDecisions`'s "one decision per event" invariant does not apply here on
 * purpose — that invariant pairs a *decision* event with the trace that explains it,
 * and `event.causalTraceId` is `null` here for exactly the same reason a decision's
 * never is. Enforcing equal-length lists on a result that will only ever hold one
 * event and zero decisions would just be `fromDecisions` refusing the one shape this
 * function exists to build.
 *
 * @throws if `event.causalTraceId` is not `null` — a decision-bearing event has an
 * explanation, and {@link fromDecisions} is the constructor for that shape, not this
 * one.
 */
export function fromEvent(state: GameState, event: DomainEvent): CommandResult {
  if (event.causalTraceId !== null) {
    throw new Error(
      `fromEvent was given an event ('${event.kind}') whose causalTraceId is ` +
        `${String(event.causalTraceId)}, not null; an event with an explanation is a decision ` +
        'and belongs in fromDecisions, paired with the DecisionResult that produced it.'
    );
  }

  return { applied: true, rejectionCode: null, state, events: [event], decisions: [] };
}
