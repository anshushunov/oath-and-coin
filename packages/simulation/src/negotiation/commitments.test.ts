import { describe, expect, it } from 'vitest';

import { SortedMap } from '../collections/sorted-map.ts';
import { compareContentIds, parseContentId, type ContentId } from '../ids/content-id.ts';
import { OfferPhase, type ContractState } from '../state/contract-state.ts';
import type { GameState } from '../state/game-state.ts';
import { aContract, anOffer, aState } from '../testing/fixtures.ts';

import { canCover, commitmentOf, reservedCommitments } from './commitments.ts';

/**
 * A second contract id, distinct from the fixtures' own `ids.crypt` — needed only by
 * `aStateWithTwoLocked`, where two locked contracts must key two different entries in
 * `GameState.contracts` rather than one overwriting the other.
 */
const secondContractId: ContentId = parseContentId('core:second_locked_contract');

interface LockableTerms {
  readonly advance?: number;
  readonly requiredCrew?: number;
  readonly promisedBonus?: number;
}

function contractWithPhase(
  phase: OfferPhase,
  terms: LockableTerms,
  id: ContentId | undefined = undefined
): ContractState {
  return aContract({
    ...(id === undefined ? {} : { id }),
    // `aContract`'s own default patronFee (70) is below the advance (100) every case
    // in this file exercises, and `0 ≤ advance ≤ patronFee` (`offer-state.ts`) is a
    // real protocol invariant — `NEGOTIATION_SPEC` §2.3's own counterexample states
    // patronFee = 100 too, so this fixture reproduces it rather than an offer the
    // protocol would refuse to build.
    patronFee: 100,
    requiredCrew: terms.requiredCrew ?? 1,
    offer: anOffer({
      phase,
      advance: terms.advance ?? 0,
      promisedBonus: terms.promisedBonus ?? 0
    })
  });
}

function aStateWith(overrides: { phase: OfferPhase } & LockableTerms): GameState {
  const { phase, ...terms } = overrides;
  const contract = contractWithPhase(phase, terms);

  return aState({
    contracts: SortedMap.from(compareContentIds, [[contract.id, contract]])
  });
}

function aStateWithOneLocked(
  terms: LockableTerms,
  stateOverrides: Partial<GameState> = {}
): GameState {
  const contract = contractWithPhase(OfferPhase.Locked, terms);

  return aState({
    contracts: SortedMap.from(compareContentIds, [[contract.id, contract]]),
    ...stateOverrides
  });
}

function aStateWithTwoLocked(terms: LockableTerms): GameState {
  const first = contractWithPhase(OfferPhase.Locked, terms);
  const second = contractWithPhase(OfferPhase.Locked, terms, secondContractId);

  return aState({
    contracts: SortedMap.from(compareContentIds, [
      [first.id, first],
      [second.id, second]
    ])
  });
}

describe('commitmentOf', () => {
  it('is the advance for every seat plus the bonus promised to the key hero alone', () => {
    const contract = contractWithPhase(OfferPhase.Locked, {
      advance: 100,
      requiredCrew: 6,
      promisedBonus: 25
    });
    expect(commitmentOf(contract)).toBe(100 * 6 + 25);
  });
});

describe('reservedCommitments', () => {
  it('reserves the advances of every locked contract, not only the bonuses', () => {
    expect(
      reservedCommitments(aStateWithTwoLocked({ advance: 100, requiredCrew: 6, promisedBonus: 0 }))
    ).toBe(1200);
  });

  it('reserves nothing for a draft or a settled contract', () => {
    expect(reservedCommitments(aStateWith({ phase: OfferPhase.Draft, advance: 100 }))).toBe(0);
    expect(reservedCommitments(aStateWith({ phase: OfferPhase.Settled, advance: 100 }))).toBe(0);
  });
});

describe('canCover', () => {
  it('refuses to cover an offer the other locked contracts already spent', () => {
    const state = aStateWithOneLocked({ advance: 100, requiredCrew: 6 }, { treasury: 600 });
    expect(
      canCover(
        state,
        aContract({ patronFee: 100, requiredCrew: 6, offer: anOffer({ advance: 100 }) })
      )
    ).toBe(false);
  });
});
