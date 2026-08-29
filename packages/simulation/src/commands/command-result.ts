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
   * already struck. `lockOffer` reuses this same code for the same reason in the
   * other direction: it is only ever legal against a `draft` package
   * (`NEGOTIATION_SPEC` §3.1's table), so a package already `locked` or `settled`
   * answers here rather than falling through to a `keyHero`-acceptance or treasury
   * check that a repeated lock would otherwise pass — `lockOffer` never clears
   * `acceptedBy`, so a second lock of an already-`locked` package would find the key
   * hero still accepted.
   */
  OfferNotInDraft: 'rejected.offer_not_in_draft',
  /**
   * `advance`, `promisedBonus` or `methodTag` fell outside the bounds `composeOffer`
   * checks before ever building a package (`NEGOTIATION_SPEC` §3.3, §6.1) — money
   * outside `0..patronFee`, or a method tag the contract never offered.
   */
  OfferTermsOutOfBounds: 'rejected.offer_terms_out_of_bounds',
  /**
   * `composeOffer` was given a crew that is not exactly `requiredCrew` distinct heroes
   * (`RESOLUTION_SPEC` §2.5). A repeated hero answers here too, and reads correctly: two
   * names for one person is a crew of one, however many entries the array had.
   *
   * Its own code rather than `OfferTermsOutOfBounds`: the terms are the money and the
   * method, and a player who named the wrong number of people has not got a term wrong.
   */
  CrewSizeMismatch: 'rejected.crew_size_mismatch',
  /**
   * `composeOffer` was given a key hero who is not among the invited
   * (`RESOLUTION_SPEC` §2.5) — a package discussed with somebody it does not ask.
   */
  KeyHeroNotInvited: 'rejected.key_hero_not_invited',
  /**
   * `lockOffer` only freezes a package the key hero has answered *and* accepted, on
   * the exact version currently in play (`NEGOTIATION_SPEC` §3.1, §3.3). `composeOffer`
   * empties `acceptedBy` on every revision, so an acceptance given to a package the
   * player has since changed never satisfies this — there is no separate "stale
   * acceptance" code because the membership check already answers both cases the
   * same way a revision made them: nobody has accepted yet, or the one who did
   * accepted a version that no longer exists.
   */
  KeyHeroHasNotAccepted: 'rejected.key_hero_has_not_accepted',
  /**
   * `lockOffer`'s last and most expensive check (`NEGOTIATION_SPEC` §3.3, §6.1):
   * the treasury, net of every commitment every other `locked` offer already holds
   * (`reservedCommitments`), falls short of this offer's own commitment
   * (`commitmentOf` — `advance × requiredCrew + promisedBonus`, the full crew the
   * contract has room for, not merely who has answered so far).
   */
  TreasuryCannotCoverTheOffer: 'rejected.treasury_cannot_cover_the_offer',
  /**
   * `pollCrew` only asks the rest of the roster once a package is `locked`
   * (`NEGOTIATION_SPEC` §3.1's table) — a package still `draft` has no answer from
   * its key hero to poll against yet, and one already `settled` has nothing left to
   * ask. Checked before {@link CrewAlreadyFilled}: a package that is not locked at
   * all answers with this code regardless of what its (draft) `acceptedBy` happens
   * to hold.
   */
  OfferNotLocked: 'rejected.offer_not_locked',
  /**
   * `pollCrew` refuses a contract whose crew is already complete
   * (`NEGOTIATION_SPEC` §3.1, §6): `requiredCrew = 1` fills the crew from the key
   * hero's own draft acceptance, before `pollCrew` ever runs, so there is nobody left
   * whose answer could still change anything — the next legal move is
   * `settleContract`.
   */
  CrewAlreadyFilled: 'rejected.crew_already_filled',
  /**
   * `pollCrew` refuses a locked package every hero in the roster has already
   * answered — checked after {@link CrewAlreadyFilled}, since that code covers the
   * one case §6 names where `requiredCrew` fills before the roster is exhausted,
   * and this one covers the other: every seat still open, but nobody left to ask.
   * §6's own edge-case table sends an unfilled crew back to `composeOffer` for a
   * new package, not to a second `pollCrew` of the same one — external review of
   * Task 13 found that without this, a player (or a replayed command log) could
   * call `pollCrew` on an already-fully-polled package any number of times, each
   * one a legal, applied command that appended zero events and grew
   * `appliedCommandIds` without bound.
   */
  NobodyLeftToPoll: 'rejected.nobody_left_to_poll',
  /**
   * `settleContract` only settles a package that is `locked` **and** whose contract
   * is `crewed` (`NEGOTIATION_SPEC` §3.1's table) — every other reachable shape,
   * from an untouched `draft` through a `locked` package still waiting on
   * `pollCrew`, answers here. Also covers the one case `NEGOTIATION_SPEC` §6 names
   * without a code of its own: a single-seat contract the key hero has already
   * filled in `draft`, before `lockOffer` (Task 12) ever ran — money has not moved
   * and nothing has been committed, so "the crew is not (yet, lockedly) filled" is
   * the accurate refusal, not a distinct one this table would otherwise need.
   */
  CrewNotFilled: 'rejected.crew_not_filled',
  /**
   * `settleContract` pays out exactly once per contract (`NEGOTIATION_SPEC` §2.3,
   * §3.3): a settled offer's `phase` becomes `settled` and never moves again, so a
   * second `settleContract` against the same contract is refused here rather than
   * paying the patron fee, and any promised bonus, a second time.
   */
  AlreadySettled: 'rejected.already_settled',
  /**
   * `resolveContract` resolves a contract exactly once (`RESOLUTION_SPEC` §3.2): the
   * stored `ContractResolution` is written by one event's effect and never written twice,
   * so a second `resolveContract` against the same contract is refused here rather than
   * raising a second set of outcome events and wounding the same crew again.
   *
   * **Not {@link ContractAlreadyResolved}, and the two are about different things.** That
   * one is `proposeContractToHero`'s, and it means "the contract is no longer on offer —
   * somebody took it"; this one means "the crew already went out and came back". They
   * would read as synonyms in a list of codes and are not, which is why the strings differ
   * as sharply as the names allow.
   */
  AlreadyResolved: 'rejected.already_resolved',
  /**
   * `settleContract` refuses a contract nobody has resolved (`RESOLUTION_SPEC` §2.5, §5.3):
   * the patron's share is a function of the grade, and there is no grade until the crew
   * has come back.
   *
   * Its own code rather than {@link CrewNotFilled}: a crew that never filled and a crew
   * that filled, went out and has not been asked what happened are two different states of
   * the same contract, and telling a player "the crew is not filled" about the second
   * would name the wrong one.
   */
  NotResolved: 'rejected.not_resolved',

  /**
   * `placeCrew` on a contract whose author wrote no battle plan (`ADR-014` §1).
   *
   * A contract without one is settled by the abstract resolver and never sees a board, so
   * a formation on it is a decision about a fight that will not happen. Refused rather
   * than accepted and ignored: silently storing it would put a screen in front of the
   * player showing a plan nothing reads.
   */
  NotABattleContract: 'rejected.not_a_battle_contract',

  /**
   * Two heroes on one cell, or a hero on a cell the contract's own ward stands in
   * (`COMBAT_SPEC` §3.7, §11).
   */
  CellTaken: 'rejected.cell_taken',

  /**
   * A hero who accepted and was given no cell, or a cell given to somebody who is not in
   * the crew (`COMBAT_SPEC` §3.7, §11).
   *
   * One code for both directions, because both are the same defect from the two ends: the
   * formation and the crew disagree about who is going.
   */
  UnplacedHero: 'rejected.unplaced_hero',

  /**
   * `resolveContract` on a battle contract nobody has placed a crew on (`COMBAT_SPEC` §6.3).
   *
   * The command-level half of `deployment_required`: the resolver refuses the same state by
   * throwing, because a battle without a formation would mean inventing where the crew
   * stood, and this is the refusal a player sees instead.
   */
  CrewNotPlaced: 'rejected.crew_not_placed',

  /**
   * A retreat signal that cannot have been given (`DEC-005`, `COMBAT_SPEC` §7.4).
   *
   * Three shapes, one code, because all three are the same defect from different sides: a
   * round below one — a signal given before the battle began — a round that is not a whole
   * number, and a signal on a contract that never goes to a fight. The first two produce a
   * `BattleRecord` this build's own save codec refuses; the third is a lever with nothing
   * behind it.
   */
  RetreatSignalNotPossible: 'rejected.retreat_signal_not_possible'
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

/**
 * Builds the result of a command whose *several* events all explain themselves — the
 * shape `resolveContract` produces and the one neither constructor above could build
 * (`RESOLUTION_SPEC` §3.3).
 *
 * `fromEvent` takes exactly one; `fromDecisions` requires a `DecisionResult` per event and
 * would refuse a list of seven paired with none. A resolution is not a hero's decision —
 * nobody chose anything, the crew went and this is what happened — so there is no trace to
 * pair, and yet there are as many events as the outcome had things to say.
 *
 * The same contract as `fromEvent`, applied to each: every event must carry
 * `causalTraceId === null`. Checked rather than assumed, because a decision-bearing event
 * arriving here would be an explanation stored under no owner.
 *
 * **An empty list is refused.** A command that applied and produced nothing would grow
 * `appliedCommandIds` without growing `history`, which is exactly the counter invariant
 * `validate-game-state.ts` holds (`appliedCommandIds.size <= history.length`) — and it is
 * the failure `pollCrew`'s `NobodyLeftToPoll` exists to prevent one command earlier.
 *
 * @throws if `events` is empty, or if any of them carries a `causalTraceId`.
 */
export function fromEvents(state: GameState, events: readonly DomainEvent[]): CommandResult {
  if (events.length === 0) {
    throw new Error(
      'fromEvents was given no events; a command that applied and produced nothing would grow ' +
        'appliedCommandIds without growing history. A command with nothing to do refuses ' +
        'instead, with a rejection code of its own.'
    );
  }

  for (const event of events) {
    if (event.causalTraceId !== null) {
      throw new Error(
        `fromEvents was given an event ('${event.kind}') whose causalTraceId is ` +
          `${String(event.causalTraceId)}, not null; an event with an explanation is a decision ` +
          'and belongs in fromDecisions, paired with the DecisionResult that produced it.'
      );
    }
  }

  return { applied: true, rejectionCode: null, state, events, decisions: [] };
}
