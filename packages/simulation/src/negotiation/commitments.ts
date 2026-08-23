import { OfferPhase, type ContractState } from '../state/contract-state.ts';
import type { GameState } from '../state/game-state.ts';

/**
 * The campaign's starting `GameState.treasury` (`NEGOTIATION_SPEC` §2.3).
 * `ASSUMPTION` (`NEGOTIATION_SPEC` §12): playtest-checked, not derived — see
 * `grievance.ts`'s `GRIEVANCE_MAX` for why this file does not try to justify the
 * number 400 beyond stating that it is a guess awaiting that measurement.
 */
export const STARTING_TREASURY = 400;

/**
 * What a contract's current offer would cost the treasury if every seat filled
 * (`NEGOTIATION_SPEC` §2.3): the advance paid to every hero the contract has room for,
 * plus the bonus promised to the key hero alone.
 *
 * `advance × requiredCrew`, not `advance × acceptedBy.size`. A contract still filling
 * its crew has fewer acceptances than seats, and reserving against the smaller number
 * would let a `locked` offer with empty seats free the treasury it will owe the moment
 * those seats fill — `NEGOTIATION_SPEC` §2.3's own counterexample: two contracts each
 * passing a per-contract check that only counted acceptances, and both together
 * driving the treasury negative once `pollCrew` actually filled them.
 */
export function commitmentOf(contract: ContractState): number {
  return contract.offer.advance * contract.requiredCrew + contract.offer.promisedBonus;
}

/**
 * The treasury already spoken for by every contract whose offer is `locked`
 * (`NEGOTIATION_SPEC` §2.3). Derived from `state.contracts` on every call, never
 * stored — a stored reserve would be a second source of truth about the same set of
 * contracts, and the two could disagree the first time one of them was updated and the
 * other was not.
 *
 * Only a `locked` offer reserves anything: a `draft` has promised nothing yet (the
 * player can still walk away with a `composeOffer` that changes the terms, or never
 * lock it at all), and a `settled` one has already paid — the money has moved, so
 * there is nothing left to reserve against it.
 */
export function reservedCommitments(state: GameState): number {
  let total = 0;

  for (const contract of state.contracts.values()) {
    if (contract.offer.phase === OfferPhase.Locked) {
      total += commitmentOf(contract);
    }
  }

  return total;
}

/**
 * Whether the treasury can afford to lock `contract`'s current offer, on top of every
 * commitment every *other* locked contract already holds (`NEGOTIATION_SPEC` §2.3,
 * §3.3's `lockOffer` check: `treasury − reservedCommitments ≥ advance × requiredCrew +
 * promisedBonus`).
 *
 * `contract` need not already sit in `state.contracts`: `lockOffer` asks this question
 * about the very offer it is about to lock, while `state` still holds that contract's
 * `draft` version — which `reservedCommitments` does not count, because it is not
 * `locked` yet — so nothing here double-counts the offer being evaluated against
 * itself.
 */
export function canCover(state: GameState, contract: ContractState): boolean {
  return state.treasury - reservedCommitments(state) >= commitmentOf(contract);
}
