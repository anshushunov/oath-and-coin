import { describe, expect, it } from 'vitest';

import { SortedMap } from '../collections/sorted-map.ts';
import { SortedSet } from '../collections/sorted-set.ts';
import { RejectionCodes } from '../commands/command-result.ts';
import type { ComposeOffer } from '../commands/compose-offer.ts';
import { composeOffer } from '../engine.ts';
import { compareContentIds } from '../ids/content-id.ts';
import { compareHeroIds, heroId, type HeroId } from '../ids/hero-id.ts';
import { ContractStatus, type ContractState } from '../state/contract-state.ts';
import { contractOf, type GameState } from '../state/game-state.ts';
import { OfferPhase, type OfferState } from '../state/offer-state.ts';
import { aContract, aHero, anOffer, aState, ids } from '../testing/fixtures.ts';

/**
 * `composeOffer` (`NEGOTIATION_SPEC` §3.1, §3.3, §6.1) — the first command of the
 * negotiation protocol, and the only one this file's fixtures need to reach: every
 * campaign starts with nobody keyed and nothing offered (`initialOffer`), so this is
 * the one command that ever moves a contract off that start.
 */

const KEY_HERO: HeroId = heroId(0);

function aCampaign(
  stateOverrides: Partial<GameState> = {},
  contractOverrides: Partial<ContractState> = {}
): GameState {
  return aState({
    heroes: SortedMap.from(compareHeroIds, [[KEY_HERO, aHero({ id: KEY_HERO })]]),
    contracts: SortedMap.from(compareContentIds, [[ids.crypt, aContract(contractOverrides)]]),
    ...stateOverrides
  });
}

/** `state`'s one contract, with its key hero already accepted the current (draft) package. */
function accepted(state: GameState): GameState {
  const contract = contractOf(state, ids.crypt);
  const acceptedBy = SortedSet.from(compareHeroIds, [KEY_HERO]);

  return {
    ...state,
    contracts: state.contracts.set(contract.id, {
      ...contract,
      status:
        acceptedBy.size >= contract.requiredCrew ? ContractStatus.Crewed : ContractStatus.Offered,
      offer: {
        ...contract.offer,
        keyHero: KEY_HERO,
        respondedBy: acceptedBy,
        acceptedBy
      }
    })
  };
}

/**
 * A single-seat contract the key hero has already filled — in `draft`, not `locked`:
 * `NEGOTIATION_SPEC` §3.1's single-seat case fills the crew from the key hero's own
 * draft acceptance, before `lockOffer` (Task 12) ever runs. `composeOffer` is legal
 * in `draft` regardless of status, which is exactly what this fixture exercises.
 */
function crewedSingleSeatCampaign(): GameState {
  const acceptedBy = SortedSet.from(compareHeroIds, [KEY_HERO]);

  return aCampaign(
    {},
    {
      requiredCrew: 1,
      status: ContractStatus.Crewed,
      offer: anOffer({
        keyHero: KEY_HERO,
        phase: OfferPhase.Draft,
        respondedBy: acceptedBy,
        acceptedBy
      })
    }
  );
}

/** A locked package whose crew never filled — composeOffer's one path back to `draft`. */
function lockedButUncrewed(): GameState {
  const acceptedBy = SortedSet.from(compareHeroIds, [KEY_HERO]);

  return aCampaign(
    {},
    {
      requiredCrew: 2,
      status: ContractStatus.Offered,
      offer: anOffer({
        keyHero: KEY_HERO,
        phase: OfferPhase.Locked,
        respondedBy: acceptedBy,
        acceptedBy
      })
    }
  );
}

/** A locked package whose crew is full — the deal is struck, and revising it is refused. */
function lockedAndCrewed(): GameState {
  const acceptedBy = SortedSet.from(compareHeroIds, [KEY_HERO]);

  return aCampaign(
    {},
    {
      requiredCrew: 1,
      status: ContractStatus.Crewed,
      offer: anOffer({
        keyHero: KEY_HERO,
        phase: OfferPhase.Locked,
        respondedBy: acceptedBy,
        acceptedBy
      })
    }
  );
}

function aCompose(overrides: Partial<ComposeOffer> = {}): ComposeOffer {
  return {
    commandId: 1,
    contractId: ids.crypt,
    keyHero: KEY_HERO,
    advance: 0,
    methodTag: null,
    promisedBonus: 0,
    expectedStateVersion: 0,
    ...overrides
  };
}

function offerOf(state: GameState): OfferState {
  return contractOf(state, ids.crypt).offer;
}

describe('composeOffer', () => {
  it('raises the version and leaves no answer behind', () => {
    const revised = composeOffer(accepted(aCampaign()), aCompose({ advance: 50 })).state;
    const offer = offerOf(revised);
    expect(offer.version).toBe(2);
    expect(offer.respondedBy.values()).toEqual([]);
    expect(offer.acceptedBy.values()).toEqual([]);
  });

  it('returns the contract to offered when the crew it had is cleared', () => {
    expect(
      contractOf(composeOffer(crewedSingleSeatCampaign(), aCompose()).state, ids.crypt).status
    ).toBe('offered');
  });

  it('allows a revision while locked as long as the crew never filled', () => {
    const locked = lockedButUncrewed();
    expect(offerOf(composeOffer(locked, aCompose()).state).phase).toBe(OfferPhase.Draft);
  });

  it('refuses a revision once the crew is filled', () => {
    const state = lockedAndCrewed();
    const result = composeOffer(state, aCompose());
    expect(result.rejectionCode).toBe(RejectionCodes.OfferNotInDraft);
    expect(result.state).toBe(state);
  });

  it('refuses a method tag the contract does not offer', () => {
    expect(composeOffer(aCampaign(), aCompose({ methodTag: ids.temple })).rejectionCode).toBe(
      RejectionCodes.OfferTermsOutOfBounds
    );
  });

  it('refuses an advance above the patron fee', () => {
    expect(composeOffer(aCampaign(), aCompose({ advance: 101 })).rejectionCode).toBe(
      RejectionCodes.OfferTermsOutOfBounds
    );
  });

  it('answers with the cheaper rejection when several preconditions are broken at once', () => {
    const state = lockedAndCrewed();
    expect(
      composeOffer(state, aCompose({ expectedStateVersion: 99, advance: 999, keyHero: heroId(99) }))
        .rejectionCode
    ).toBe(RejectionCodes.StaleState);
    expect(composeOffer(state, aCompose({ advance: 999, keyHero: heroId(99) })).rejectionCode).toBe(
      RejectionCodes.UnknownHero
    );
  });
});
