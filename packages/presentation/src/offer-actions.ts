import {
  ContractStatus,
  OfferPhase,
  RejectionCodes,
  canCover,
  type ContractState,
  type GameState
} from '@oath-and-coin/simulation';

/**
 * The six commands of the negotiation protocol, as things a player presses
 * (`NEGOTIATION_SPEC` §3.1, `RESOLUTION_SPEC` §3.1).
 *
 * **`compose` and `ask_key_hero` are two, not one.** `composeOffer` records the terms and
 * `proposeContractToHero` asks the key hero what they think of them. A single "propose"
 * button would have to mean one of two things, and both are wrong: either the terms are
 * never recorded, or the hero is never actually asked.
 */
export const OfferAction = Object.freeze({
  Compose: 'compose',
  AskKeyHero: 'ask_key_hero',
  Lock: 'lock',
  Poll: 'poll',
  Resolve: 'resolve',
  Settle: 'settle'
});

export type OfferAction = (typeof OfferAction)[keyof typeof OfferAction];

/** The six, in the order the protocol runs them. */
export const OFFER_ACTIONS: readonly OfferAction[] = Object.freeze(Object.values(OfferAction));

/**
 * One command, and why it cannot be pressed right now.
 *
 * **Every action is declared on every screen, dark ones included.** A control that vanishes
 * teaches a player nothing about what to do instead; a dark one carrying the refusal it
 * would have got teaches exactly that. The reason is the engine's own
 * {@link RejectionCodes} member — the very code the command would answer with — rather
 * than a second vocabulary invented here, so a player who presses on anyway reads the same
 * sentence twice rather than two different ones.
 */
export interface AvailableAction {
  readonly action: OfferAction;
  readonly disabledReasonKey: string | null;
}

/**
 * What may be pressed on this package, and why the rest may not.
 *
 * **Derived from the whole shape of `OfferState`, never from `phase` and `status` alone.**
 * The plan's own two hard rows are why: a locked package that has been polled through
 * without filling its crew is `locked` + `offered`, exactly like one nobody has polled yet,
 * and the two differ only in whether an invited hero is still owed an answer — the first
 * has no poll left to run and the second does. And a contract needing one hero is `crewed`
 * while still a `draft`, because the key hero's own acceptance filled the only seat
 * (`NEGOTIATION_SPEC` §3.1), so a table keyed on `crewed` would offer `resolve` over a
 * package nothing has frozen and send the player into `OfferNotLocked`.
 *
 * **This is a restatement of `engine.ts`'s preconditions, and that is the risk it carries.**
 * A screen cannot ask the engine whether it would accept a command — each one needs a
 * `commandId` and answers with a whole new campaign — so saying why a button is dark
 * without pressing it means writing the rules a second time, in a second place, where they
 * can drift. What keeps that honest is not care: `offer-actions.test.ts`'s last suite
 * applies all six commands, for real, to every fixture of the table and asserts that the
 * ones the engine accepts are exactly the ones this module calls enabled.
 *
 * Each function below checks in the same order the engine does, so the code a dark button
 * shows is the code that command would actually have answered with — not merely *a* true
 * reason among several.
 */
export function availableActions(state: GameState, contract: ContractState): AvailableAction[] {
  return [
    { action: OfferAction.Compose, disabledReasonKey: composeRefusal(contract) },
    { action: OfferAction.AskKeyHero, disabledReasonKey: askKeyHeroRefusal(contract) },
    { action: OfferAction.Lock, disabledReasonKey: lockRefusal(state, contract) },
    { action: OfferAction.Poll, disabledReasonKey: pollRefusal(contract) },
    { action: OfferAction.Resolve, disabledReasonKey: resolveRefusal(contract) },
    { action: OfferAction.Settle, disabledReasonKey: settleRefusal(contract) }
  ];
}

/**
 * `composeOffer`: legal in `draft`, and in `locked` for as long as the crew has not filled
 * (`NEGOTIATION_SPEC` §3.1, `engine.ts`'s own `revisable`).
 *
 * The second half is not only `RESOLUTION_SPEC` §6.2's way out of a dead end — it is the
 * whole row of the table, so revising is on offer from the moment a package is locked and
 * not merely once a poll has come back short. Narrowing it to the dead end would be this
 * layer inventing a rule the engine does not have (`AGENTS.md` §6).
 */
function composeRefusal(contract: ContractState): string | null {
  const revisable =
    contract.offer.phase === OfferPhase.Draft ||
    (contract.offer.phase === OfferPhase.Locked && contract.status === ContractStatus.Offered);

  return revisable ? null : RejectionCodes.OfferNotInDraft;
}

/**
 * `proposeContractToHero`, asked of the key hero — the only hero this screen ever asks
 * directly, since everybody else answers through `pollCrew`.
 *
 * The engine's order, checked here in the same sequence: the contract must still be on
 * offer, the draft's responder must be the key hero (and before the first `composeOffer`
 * there is no key hero to be — `NotTheKeyHero` is what the engine answers every hero
 * then), and nobody is asked twice.
 */
function askKeyHeroRefusal(contract: ContractState): string | null {
  if (contract.status !== ContractStatus.Offered) {
    return RejectionCodes.ContractAlreadyResolved;
  }

  const { keyHero } = contract.offer;

  if (keyHero === null) {
    return RejectionCodes.NotTheKeyHero;
  }

  return contract.offer.respondedBy.has(keyHero) ? RejectionCodes.AlreadyResponded : null;
}

/**
 * `lockOffer`: a `draft` whose key hero has accepted *this* version, and a treasury that
 * covers the whole commitment (`NEGOTIATION_SPEC` §3.3).
 *
 * The money check is the one the plan's table left out, and it is not a formality: a
 * package the guild cannot afford is refused at the lock and nowhere earlier, so a button
 * offered without it is a button that leads straight into a refusal the player could not
 * see coming — the same failure `OfferBudget` exists to prevent one screen up.
 */
function lockRefusal(state: GameState, contract: ContractState): string | null {
  if (contract.offer.phase !== OfferPhase.Draft) {
    return RejectionCodes.OfferNotInDraft;
  }

  const { keyHero } = contract.offer;

  if (keyHero === null || !contract.offer.acceptedBy.has(keyHero)) {
    return RejectionCodes.KeyHeroHasNotAccepted;
  }

  return canCover(state, contract) ? null : RejectionCodes.TreasuryCannotCoverTheOffer;
}

/**
 * `pollCrew`: a `locked` package whose crew has not filled and whose invited list still
 * holds somebody who has not answered.
 *
 * That last clause is the plan's own hard row. A package polled straight through without
 * filling its seats has nobody left to ask, so a second poll answers `NobodyLeftToPoll` —
 * and the way on is a new version of the package, which is why `composeRefusal` above says
 * `null` in exactly the same state.
 */
function pollRefusal(contract: ContractState): string | null {
  if (contract.offer.phase !== OfferPhase.Locked) {
    return RejectionCodes.OfferNotLocked;
  }

  if (contract.status === ContractStatus.Crewed) {
    return RejectionCodes.CrewAlreadyFilled;
  }

  const everyoneAnswered = contract.offer.invited
    .values()
    .every((heroId) => contract.offer.respondedBy.has(heroId));

  return everyoneAnswered ? RejectionCodes.NobodyLeftToPoll : null;
}

/**
 * `resolveContract`: a `locked`, `crewed` package with no outcome recorded yet
 * (`RESOLUTION_SPEC` §3.2).
 *
 * The engine also guards that `invited` and `acceptedBy` are equal as sets, against a state
 * assembled by hand or read off an edited save. Not repeated here: every campaign this
 * layer is handed came through `createContractState` or through `readSave`, both of which
 * already refuse that shape, and a screen restating a guard against corrupt memory would be
 * describing a package no player can be looking at.
 */
function resolveRefusal(contract: ContractState): string | null {
  if (contract.offer.phase !== OfferPhase.Locked) {
    return RejectionCodes.OfferNotLocked;
  }

  if (contract.status !== ContractStatus.Crewed) {
    return RejectionCodes.CrewNotFilled;
  }

  return contract.resolution === null ? null : RejectionCodes.AlreadyResolved;
}

/**
 * `settleContract`: the crew came back, and the promise has not been answered yet.
 *
 * `AlreadySettled` comes first, exactly as the engine checks it: a settled package is also
 * a package that is not `locked`, and answering "the crew is not filled" about a contract
 * that has already paid out would name the wrong one of two true things.
 */
function settleRefusal(contract: ContractState): string | null {
  if (contract.offer.phase === OfferPhase.Settled) {
    return RejectionCodes.AlreadySettled;
  }

  if (contract.offer.phase !== OfferPhase.Locked || contract.status !== ContractStatus.Crewed) {
    return RejectionCodes.CrewNotFilled;
  }

  return contract.resolution === null ? RejectionCodes.NotResolved : null;
}
