import { describe, expect, it } from 'vitest';

import { SortedMap } from './collections/sorted-map.ts';
import { SortedSet } from './collections/sorted-set.ts';
import { RejectionCodes } from './commands/command-result.ts';
import type { ProposeContractToHero } from './commands/propose-contract-to-hero.ts';
import { Actions } from './decisions/actions.ts';
import type { HeldTrait } from './decisions/held-trait.ts';
import { ReasonCodes } from './decisions/reason-codes.ts';
import { proposeContractToHero } from './engine.ts';
import { compareContentIds, parseContentId, type ContentId } from './ids/content-id.ts';
import { compareHeroIds, heroId } from './ids/hero-id.ts';
import { ContractStatus } from './state/contract-state.ts';
import type { GameState } from './state/game-state.ts';
import { aContract, aHero, anOffer, aState, aTrait, ids } from './testing/fixtures.ts';

/**
 * What the engine adds on top of the rule: the order commands are refused in, and the
 * promise that a refusal costs the campaign nothing.
 *
 * The second one is the obligation `FULL_TYPESCRIPT_MIGRATION` §8.7 names and the reason
 * the cheap checks come first. A rejection that had already advanced the RNG ordinal
 * would make the campaign's randomness a function of the commands that *failed* — and
 * every replay would reproduce it faithfully, so nothing downstream would ever
 * disagree.
 */

const traitRules = SortedMap.from<ContentId, HeldTrait>(compareContentIds, [
  [ids.loyal, aTrait({ id: ids.loyal, tag: ids.undead, weight: 7 })],
  [ids.squeamish, aTrait({ id: ids.squeamish, tag: ids.temple, weight: -3 })],
  [
    ids.refusesTemples,
    aTrait({ id: ids.refusesTemples, tag: ids.temple, isPrinciple: true, weight: 0 })
  ]
]);

const bram = aHero({
  id: heroId(0),
  definition: ids.bram,
  // Authored in reverse id order on purpose: the engine sorts before handing them to the
  // rule, and the rule refuses an unsorted list rather than sorting it itself.
  traits: [ids.squeamish, ids.loyal]
});

const zara = aHero({
  id: heroId(1),
  definition: ids.zara,
  greed: 0,
  caution: 0,
  pride: 0,
  trustInGuild: 0,
  traits: [ids.refusesTemples]
});

function aCampaign(overrides: Partial<GameState> = {}): GameState {
  return aState({
    heroes: SortedMap.from(compareHeroIds, [
      [bram.id, bram],
      [zara.id, zara]
    ]),
    contracts: SortedMap.from(compareContentIds, [[ids.crypt, aContract()]]),
    traitRules,
    ...overrides
  });
}

function aProposal(overrides: Partial<ProposeContractToHero> = {}): ProposeContractToHero {
  return {
    commandId: 1,
    heroId: bram.id,
    contractId: ids.crypt,
    expectedStateVersion: 0,
    ...overrides
  };
}

describe('a refused command changes nothing at all', () => {
  it.each([
    ['a stale state version', { expectedStateVersion: 9 }, RejectionCodes.StaleState],
    ['an unknown hero', { heroId: heroId(7) }, RejectionCodes.UnknownHero],
    [
      'an unknown contract',
      { contractId: parseContentId('core:no_such') },
      RejectionCodes.UnknownContract
    ]
  ])('refuses %s', (_name, overrides, code) => {
    const state = aCampaign();
    const result = proposeContractToHero(state, aProposal(overrides));

    expect(result.applied).toBe(false);
    expect(result.rejectionCode).toBe(code);
    expect(result.decisions).toEqual([]);
    expect(result.events).toEqual([]);
    // The same object, not an equal one: a caller compares by reference to know that
    // nothing happened.
    expect(result.state).toBe(state);
  });

  it('refuses a command id that was already applied', () => {
    const first = proposeContractToHero(aCampaign(), aProposal());
    const again = proposeContractToHero(
      first.state,
      aProposal({ expectedStateVersion: first.state.metadata.stateVersion })
    );

    expect(again.rejectionCode).toBe(RejectionCodes.DuplicateCommand);
    expect(again.state).toBe(first.state);
  });

  it('refuses a hero who already answered this offer', () => {
    // Two seats, so the offer is still open after the first acceptance — otherwise the
    // command would be refused as already-resolved and this case would never be reached.
    const twoSeats = aCampaign({
      contracts: SortedMap.from(compareContentIds, [[ids.crypt, aContract({ requiredCrew: 2 })]])
    });

    const first = proposeContractToHero(twoSeats, aProposal());
    const again = proposeContractToHero(
      first.state,
      aProposal({ commandId: 2, expectedStateVersion: first.state.metadata.stateVersion })
    );

    expect(again.rejectionCode).toBe(RejectionCodes.AlreadyResponded);
  });

  it('refuses an offer somebody already crewed', () => {
    const crewed = aCampaign({
      contracts: SortedMap.from(compareContentIds, [
        [ids.crypt, aContract({ status: ContractStatus.Crewed })]
      ])
    });

    expect(proposeContractToHero(crewed, aProposal()).rejectionCode).toBe(
      RejectionCodes.ContractAlreadyResolved
    );
  });

  it('leaves the RNG ordinal exactly where it was', () => {
    const state = aCampaign();
    const refused = proposeContractToHero(state, aProposal({ expectedStateVersion: 9 }));

    expect(refused.state.metadata.nextDecisionOrdinal).toBe(0n);
  });

  it('does not change the decision the next accepted command makes', () => {
    // The sharp version of the property: a refusal is not merely cheap, it is invisible.
    // If any rejection path advanced the ordinal, this hero's mood — and possibly the
    // answer — would depend on how many commands had been thrown away first.
    const state = aCampaign();

    const withoutRefusals = proposeContractToHero(state, aProposal());

    let afterRefusals = state;
    for (const overrides of [
      { expectedStateVersion: 9 },
      { heroId: heroId(7) },
      { contractId: parseContentId('core:no_such') }
    ]) {
      afterRefusals = proposeContractToHero(afterRefusals, aProposal(overrides)).state;
    }

    const withRefusals = proposeContractToHero(afterRefusals, aProposal());

    expect(withRefusals.decisions).toEqual(withoutRefusals.decisions);
    expect(withRefusals.state.metadata.nextDecisionOrdinal).toBe(
      withoutRefusals.state.metadata.nextDecisionOrdinal
    );
  });
});

describe('an applied command records what the hero decided', () => {
  it('advances the campaign and stores the explanation', () => {
    const result = proposeContractToHero(aCampaign(), aProposal());

    expect(result.applied).toBe(true);
    expect(result.rejectionCode).toBeNull();
    expect(result.events).toHaveLength(1);
    expect(result.state.metadata.stateVersion).toBe(1);
    expect(result.state.metadata.nextEventId).toBe(1);
    expect(result.state.metadata.nextTraceId).toBe(1);
    expect(result.state.metadata.nextDecisionOrdinal).toBe(1n);
    expect(result.state.traces.get(0)).toEqual(result.decisions[0]?.trace);
    expect(result.state.appliedCommandIds.has(1)).toBe(true);
  });

  it('resolves the hero traits through the rulebook, in id order', () => {
    // Bram authors `[squeamish, loyal]`; the contract carries `undead`, so only `loyal`
    // matches. The rule would throw outright if the engine passed them through unsorted.
    const result = proposeContractToHero(aCampaign(), aProposal());

    expect(
      result.decisions[0]?.trace.positiveFactors.some(
        (factor) =>
          factor.reasonCode === ReasonCodes.PersonalConviction && factor.sourceEntity === ids.loyal
      )
    ).toBe(true);
  });

  it('fails loudly when a hero carries a trait id the rulebook has no entry for', () => {
    const state = aCampaign({ traitRules: SortedMap.empty(compareContentIds) });

    expect(() => proposeContractToHero(state, aProposal())).toThrow(/content-loading bug/);
  });

  it('names the event after the answer', () => {
    const accepted = proposeContractToHero(
      aCampaign({
        contracts: SortedMap.from(compareContentIds, [
          [ids.crypt, aContract({ patronFee: 100, risk: 0 })]
        ])
      }),
      aProposal()
    );

    expect(accepted.decisions[0]?.selectedAction).toBe(Actions.Accept);
    expect(accepted.events[0]?.kind).toBe('hero_accepted_contract');
    expect(accepted.events[0]?.causalTraceId).toBe(0);
  });

  it('leaves the offer open when a hero declines, and records the refusal', () => {
    const declined = proposeContractToHero(
      aCampaign({
        contracts: SortedMap.from(compareContentIds, [
          [ids.crypt, aContract({ patronFee: 0, risk: 100 })]
        ])
      }),
      aProposal()
    );

    const contract = declined.state.contracts.get(ids.crypt)!;

    expect(declined.decisions[0]?.selectedAction).toBe(Actions.Decline);
    expect(declined.events[0]?.kind).toBe('hero_declined_contract');
    expect(contract.status).toBe(ContractStatus.Offered);
    expect(contract.offer.respondedBy.has(bram.id)).toBe(true);
    expect(contract.offer.acceptedBy.has(bram.id)).toBe(false);
  });

  it('crews the offer only when every seat is filled', () => {
    const twoSeats = aCampaign({
      contracts: SortedMap.from(compareContentIds, [
        [ids.crypt, aContract({ patronFee: 100, risk: 0, requiredCrew: 2 })]
      ])
    });

    const first = proposeContractToHero(twoSeats, aProposal());
    expect(first.state.contracts.get(ids.crypt)!.status).toBe(ContractStatus.Offered);

    const second = proposeContractToHero(
      first.state,
      aProposal({ commandId: 2, heroId: zara.id, expectedStateVersion: 1 })
    );

    expect(second.decisions[0]?.selectedAction).toBe(Actions.Accept);
    expect(second.state.contracts.get(ids.crypt)!.status).toBe(ContractStatus.Crewed);
  });

  it('fails loudly when acceptedBy names a hero the campaign does not have', () => {
    const state = aCampaign({
      contracts: SortedMap.from(compareContentIds, [
        [
          ids.crypt,
          aContract({
            offer: anOffer({ acceptedBy: SortedSet.from(compareHeroIds, [heroId(7)]) })
          })
        ]
      ])
    });

    expect(() => proposeContractToHero(state, aProposal())).toThrow(/no such hero/);
  });

  it('keeps acceptedBy a subset of respondedBy on both answers', () => {
    // Recorded because an equivalence argument rests on it. Building the crew table from
    // `respondedBy` instead of `acceptedBy` is a mutant that stays green — the rule walks
    // `acceptedBy` for bonds and only looks ids *up* in the table, so a table with spare
    // entries answers identically. That holds exactly while this subset does, and nothing
    // else in the package states it: `ContractState` calls acceptedBy "a subset of
    // respondedBy" in prose only. The day a transition breaks it, this reddens and the
    // equivalence stops being quietly false.
    const threeSeats = aCampaign({
      contracts: SortedMap.from(compareContentIds, [
        [ids.crypt, aContract({ patronFee: 0, risk: 100, requiredCrew: 3 })]
      ])
    });

    const first = proposeContractToHero(threeSeats, aProposal());
    const second = proposeContractToHero(
      first.state,
      aProposal({ commandId: 2, heroId: zara.id, expectedStateVersion: 1 })
    );

    const contract = second.state.contracts.get(ids.crypt)!;

    // Bram refuses an unpaid, dangerous job; Zara, who cares about none of it, does not.
    // So the two sets genuinely differ and the subset is not trivially true.
    expect(first.decisions[0]?.selectedAction).toBe(Actions.Decline);
    expect(second.decisions[0]?.selectedAction).toBe(Actions.Accept);
    expect(contract.offer.respondedBy.values()).toEqual([bram.id, zara.id]);
    expect(contract.offer.acceptedBy.values()).toEqual([zara.id]);
    for (const accepter of contract.offer.acceptedBy.values()) {
      expect(contract.offer.respondedBy.has(accepter)).toBe(true);
    }
  });

  it('carries the comrades who already accepted into the decision', () => {
    // Zara thinks well of Bram, and only because Bram is in `acceptedBy` does that reach
    // the score at all.
    const zaraLikesBram = aHero({
      ...zara,
      relationships: SortedMap.from(compareContentIds, [[ids.bram, 9]])
    });

    const state = aCampaign({
      heroes: SortedMap.from(compareHeroIds, [
        [bram.id, bram],
        [zaraLikesBram.id, zaraLikesBram]
      ]),
      contracts: SortedMap.from(compareContentIds, [
        [ids.crypt, aContract({ patronFee: 100, risk: 0, requiredCrew: 2 })]
      ])
    });

    const first = proposeContractToHero(state, aProposal());
    const second = proposeContractToHero(
      first.state,
      aProposal({ commandId: 2, heroId: zaraLikesBram.id, expectedStateVersion: 1 })
    );

    expect(second.decisions[0]?.trace.positiveFactors).toContainEqual({
      reasonCode: ReasonCodes.StandsWithComrade,
      sourceEntity: ids.bram,
      magnitude: 9
    });
  });
});

describe('a decision the gate closed still happened', () => {
  it('advances the campaign but spends no randomness', () => {
    const state = aCampaign({
      contracts: SortedMap.from(compareContentIds, [
        [ids.crypt, aContract({ tags: SortedSet.from(compareContentIds, [ids.temple]) })]
      ])
    });

    const result = proposeContractToHero(state, aProposal({ heroId: zara.id }));

    expect(result.applied).toBe(true);
    expect(result.decisions[0]?.selectedScore).toBeNull();
    expect(result.decisions[0]?.trace.blockedBy).toHaveLength(1);
    expect(result.state.metadata.stateVersion).toBe(1);
    expect(result.state.metadata.nextTraceId).toBe(1);
    expect(result.state.metadata.nextDecisionOrdinal).toBe(0n);
  });
});
