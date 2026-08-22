import { SortedSet } from '../collections/sorted-set.ts';
import type { ContentId } from '../ids/content-id.ts';
import { compareHeroIds, type HeroId } from '../ids/hero-id.ts';

import {
  ContractStatus,
  OfferPhase,
  type ContractState,
  type OfferState
} from './contract-state.ts';

// Re-exported rather than re-declared: `OfferState` is a field of `ContractState`, so
// its shape lives in `contract-state.ts` beside the type that carries it — the
// alternative, this file and that one each importing the other's type, is the cycle
// `lint:deps`'s `no-circular` rule refuses (found by running into it, not by
// foresight). Every other module still reaches both names through this file, which is
// where `NEGOTIATION_SPEC` §2.1's invariants over that shape live.
export { OfferPhase, type OfferState };

/**
 * Largest number of tags a contract's *effective* tag set may carry once a chosen
 * method tag joins the authored ones (`NEGOTIATION_SPEC` §2.1, §2.4).
 *
 * The same ceiling content states as `MAX_TAGS_PER_CONTRACT`
 * (`packages/content/src/limits.ts`) — one fact, not two numbers that happen to read
 * 6. It is declared here, in the layer that enforces it at runtime
 * ({@link createContractState}), rather than in content, for the reason `TRAIT_SCALE`
 * is declared in `decisions/trait-scale.ts` instead of in content's own `bounds.ts`:
 * `packages/simulation` cannot depend on `packages/content`
 * (`ADR-002`, the `simulation-depends-on-nothing` dependency-cruiser rule), so a
 * constant both layers need has exactly one place it can live — the one neither
 * direction is forbidden from reading. Content imports this constant rather than
 * restating it, the same way `bounds.ts` imports `TRAIT_SCALE` rather than restating
 * it as `TRAIT_MAX`.
 */
export const MAX_TAGS_PER_CONTRACT = 6;

/**
 * The offer every contract starts on (`NEGOTIATION_SPEC` §6.1): version 1, nobody
 * keyed, nothing offered, an empty draft. Whole and complete on its own, so a state
 * built from content never has to assemble the starting shape from a hand-written
 * literal — the one place that number, that phase and those two empty sets are stated
 * is this function.
 */
export function initialOffer(): OfferState {
  return {
    version: 1,
    keyHero: null,
    advance: 0,
    methodTag: null,
    promisedBonus: 0,
    phase: OfferPhase.Draft,
    respondedBy: SortedSet.empty<HeroId>(compareHeroIds),
    acceptedBy: SortedSet.empty<HeroId>(compareHeroIds)
  };
}

/**
 * The tags a hero's decision is actually weighed against: the contract's authored
 * tags, plus the chosen method tag if the current offer has one
 * (`NEGOTIATION_SPEC` §2.4, §4). The method tag joins gates and inclinations exactly
 * like an authored one — no separate code path exists for it, because none should.
 */
export function effectiveTags(contract: ContractState): SortedSet<ContentId> {
  const { methodTag } = contract.offer;
  return methodTag === null ? contract.tags : contract.tags.add(methodTag);
}

/**
 * The one door a {@link ContractState} may be built or rebuilt through. Every
 * invariant `NEGOTIATION_SPEC` §2.1 states is checked here and nowhere else — not
 * left to be maintained by discipline at each of the several places a contract is
 * assembled, because a literal `{ ...contract, offer: revised }` has no invariant to
 * fail on. The only way any of these relationships means something is if the sole
 * function that hands back a complete, usable `ContractState` is the one every
 * caller is forced through, including the content loader (`initial-state.ts`).
 *
 * Returns `contract` itself — this function validates, it does not copy.
 *
 * @throws if `contract` violates any invariant of `NEGOTIATION_SPEC` §2.1. Every
 * message names both values a violated relationship compares: a message with only
 * the one number that happened to be wrong leaves the reader to reconstruct the
 * other half of the comparison from the source.
 */
export function createContractState(contract: ContractState): ContractState {
  const { offer } = contract;

  // acceptedBy ⊆ respondedBy — a hero cannot have accepted a version it never
  // answered.
  for (const acceptedHeroId of offer.acceptedBy.values()) {
    if (!offer.respondedBy.has(acceptedHeroId)) {
      throw new Error(
        `Contract '${contract.id}' offer accepts hero#${String(acceptedHeroId)}, but its ` +
          `respondedBy does not include hero#${String(acceptedHeroId)}; acceptedBy ` +
          `(${String(offer.acceptedBy.size)} hero(es)) must be a subset of respondedBy ` +
          `(${String(offer.respondedBy.size)} hero(es)).`
      );
    }
  }

  // acceptedBy.size ≤ requiredCrew — places are exactly the seats the contract
  // declared, not "however many said yes".
  if (offer.acceptedBy.size > contract.requiredCrew) {
    throw new Error(
      `Contract '${contract.id}' offer has ${String(offer.acceptedBy.size)} accepted hero(es), ` +
        `but the contract has ${String(contract.requiredCrew)} seats (requiredCrew); acceptedBy.size ` +
        'must not exceed the number of seats.'
    );
  }

  // status = 'crewed' ⇔ acceptedBy.size = requiredCrew — both directions, checked
  // before the draft/responder rule below so a contract that is inconsistent about
  // *being crewed* is reported as that, rather than as an unrelated draft violation
  // its own empty defaults happen to also trip.
  const seatsFilled = offer.acceptedBy.size === contract.requiredCrew;
  const isCrewed = contract.status === ContractStatus.Crewed;
  if (isCrewed !== seatsFilled) {
    throw new Error(
      `Contract '${contract.id}' has status '${contract.status}', but its offer has ` +
        `${String(offer.acceptedBy.size)} of ${String(contract.requiredCrew)} seats ` +
        "(requiredCrew) filled; status must be 'crewed' exactly when acceptedBy.size equals " +
        'requiredCrew, in both directions.'
    );
  }

  // phase = 'draft' ⇒ respondedBy ⊆ {keyHero} — in a draft, only the key hero has
  // been asked.
  if (offer.phase === OfferPhase.Draft) {
    for (const respondedHeroId of offer.respondedBy.values()) {
      if (respondedHeroId !== offer.keyHero) {
        throw new Error(
          `Contract '${contract.id}' offer is in phase 'draft', but hero#${String(respondedHeroId)} ` +
            `is in respondedBy while the key hero is ` +
            `${offer.keyHero === null ? 'null' : `hero#${String(offer.keyHero)}`}; a draft may ` +
            'only have been answered by its key hero.'
        );
      }
    }
  }

  // promisedBonus > 0 ⇒ keyHero ≠ null — a promise needs a named recipient.
  if (offer.promisedBonus > 0 && offer.keyHero === null) {
    throw new Error(
      `Contract '${contract.id}' offer promises a bonus of ${String(offer.promisedBonus)}, but ` +
        'keyHero is null; a promise needs someone to promise it to.'
    );
  }

  // 0 ≤ advance ≤ patronFee
  if (offer.advance < 0 || offer.advance > contract.patronFee) {
    throw new Error(
      `Contract '${contract.id}' offer has advance ${String(offer.advance)}, which is outside ` +
        `0..${String(contract.patronFee)} (patronFee); advance must stay within the patron fee.`
    );
  }

  // 0 ≤ promisedBonus ≤ patronFee
  if (offer.promisedBonus < 0 || offer.promisedBonus > contract.patronFee) {
    throw new Error(
      `Contract '${contract.id}' offer promises a bonus of ${String(offer.promisedBonus)}, ` +
        `which is outside 0..${String(contract.patronFee)} (patronFee); promisedBonus must stay ` +
        'within the patron fee.'
    );
  }

  // phase = 'settled' ⇒ status = 'crewed' — a settled offer belongs to a filled crew.
  if (offer.phase === OfferPhase.Settled && contract.status !== ContractStatus.Crewed) {
    throw new Error(
      `Contract '${contract.id}' offer is in phase 'settled', but the contract's status is ` +
        `'${contract.status}', not 'crewed'; a settled offer must belong to a crewed contract.`
    );
  }

  // The chosen method tag must not push the contract's effective tags past the
  // ceiling every contract's tags are already held to.
  const effectiveTagCount = effectiveTags(contract).size;
  if (effectiveTagCount > MAX_TAGS_PER_CONTRACT) {
    throw new Error(
      `Contract '${contract.id}' would carry ${String(effectiveTagCount)} tags once its chosen ` +
        `method tag joins the ${String(contract.tags.size)} already authored, past the ceiling ` +
        `of ${String(MAX_TAGS_PER_CONTRACT)} (MAX_TAGS_PER_CONTRACT); the offer cannot choose a ` +
        "method tag that pushes the contract's effective tags past that ceiling."
    );
  }

  return contract;
}
