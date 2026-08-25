import { describe, expect, it } from 'vitest';

import { SortedMap } from '../collections/sorted-map.ts';
import { SortedSet } from '../collections/sorted-set.ts';
import { RejectionCodes } from '../commands/command-result.ts';
import type { PollCrew } from '../commands/poll-crew.ts';
import { pollCrew } from '../engine.ts';
import { compareContentIds } from '../ids/content-id.ts';
import { compareHeroIds, heroId, type HeroId } from '../ids/hero-id.ts';
import { ContractStatus } from '../state/contract-state.ts';
import { contractOf, type GameState } from '../state/game-state.ts';
import { createContractState, OfferPhase, type OfferState } from '../state/offer-state.ts';
import {
  aContract,
  aHero,
  anOffer,
  aState,
  aTrait,
  compareNumbers,
  ids
} from '../testing/fixtures.ts';

/**
 * `pollCrew` (`NEGOTIATION_SPEC` §3.1, §3.3, §6.1) — the whole roster, minus the key
 * hero already answered by `lockOffer` time, answers a locked package in one command.
 * That is `m1-negotiation/1`; the amendment of 2026-08-25 narrows the poll to the invited
 * crew, and these tests move with the behaviour when the resolution engine builds it.
 *
 * Every fixture below builds its `ContractState` through `createContractState`
 * directly, rather than replaying `composeOffer`/`proposeContractToHero`/`lockOffer`:
 * that keeps `metadata.nextTraceId`/`nextDecisionOrdinal` at their fresh-campaign
 * zero, which is what lets the trace-id and ordinal tests below assert exact,
 * small numbers instead of whatever a real key-hero decision happened to cost. The
 * literal is still validated, not merely hoped consistent — `createContractState`
 * throws on the invariants `NEGOTIATION_SPEC` §2.1 states, the same door every
 * engine command is routed through.
 */

const KEY_HERO: HeroId = heroId(0);

function heroesFor(guaranteedAccept: boolean): readonly ReturnType<typeof aHero>[] {
  return [0, 1, 2, 3].map((index) => {
    const id = heroId(index);
    return guaranteedAccept
      ? aHero({ id, greed: 100, caution: 0, pride: 0, trustInGuild: 0 })
      : aHero({ id });
  });
}

/**
 * A locked package with the key hero already accepted — the state `pollCrew`'s whole
 * job starts from. `guaranteedAccept` tunes every *other* hero's motives so heavily
 * toward acceptance that no mood draw (±5) could turn it into a refusal
 * (`HERO_DECISION_SPEC` §2.5's own bound on what mood can overturn): `advance`,
 * `patronFee` and `greed` all at the scale that makes `advancePull` alone swamp
 * mood, `risk` at zero so nothing opposes it. The key hero's own motives never
 * matter here — his acceptance is asserted directly in the offer literal, not
 * recomputed by `decide()`, because `pollCrew` never asks him again.
 */
function lockedCampaign(
  overrides: { requiredCrew?: number } = {},
  guaranteedAccept = false
): GameState {
  const requiredCrew = overrides.requiredCrew ?? 4;
  const heroes = heroesFor(guaranteedAccept);
  const keyOnly = SortedSet.from(compareHeroIds, [KEY_HERO]);
  const advance = guaranteedAccept ? 100 : 0;
  const patronFee = guaranteedAccept ? 100 : 70;

  const contract = createContractState(
    aContract({
      requiredCrew,
      patronFee,
      risk: guaranteedAccept ? 0 : 80,
      status: requiredCrew === 1 ? ContractStatus.Crewed : ContractStatus.Offered,
      offer: anOffer({
        keyHero: KEY_HERO,
        advance,
        phase: OfferPhase.Locked,
        respondedBy: keyOnly,
        acceptedBy: keyOnly
      })
    })
  );

  return aState({
    heroes: SortedMap.from(
      compareHeroIds,
      heroes.map((hero) => [hero.id, hero] as const)
    ),
    contracts: SortedMap.from(compareContentIds, [[contract.id, contract]])
  });
}

/** `lockedCampaign`, but every hero is tuned to accept regardless of mood. */
function everyoneAcceptsCampaign(overrides: { requiredCrew?: number } = {}): GameState {
  return lockedCampaign(overrides, true);
}

/** `requiredCrew = 1`: the key hero's own draft acceptance already filled the crew. */
function lockedSingleSeatCampaign(): GameState {
  return lockedCampaign({ requiredCrew: 1 });
}

/**
 * Three heroes for one `pollCrew` call, in the pattern the ordinal- and trace-id
 * tests need: gated, scored, gated. `heroId(1)` and `heroId(3)` carry a principle
 * whose tag the contract authors, so `decide()`'s gate closes their decision before
 * any score or mood exists (`HERO_DECISION_SPEC` §2.2); `heroId(2)` carries no such
 * trait, so it scores normally and draws exactly one mood ordinal (the rejection-
 * sampling branch for an 11-wide span is astronomically unlikely — `deterministic-
 * rng.ts`'s own note on `acceptanceThreshold`).
 */
function gatedThenScoredThenGated(): GameState {
  const keyOnly = SortedSet.from(compareHeroIds, [KEY_HERO]);

  const heroes = [
    aHero({ id: KEY_HERO }),
    aHero({ id: heroId(1), traits: [ids.refusesTemples] }),
    aHero({ id: heroId(2) }),
    aHero({ id: heroId(3), traits: [ids.refusesTemples] })
  ];

  const contract = createContractState(
    aContract({
      requiredCrew: 5,
      tags: SortedSet.from(compareContentIds, [ids.temple]),
      status: ContractStatus.Offered,
      offer: anOffer({
        keyHero: KEY_HERO,
        phase: OfferPhase.Locked,
        respondedBy: keyOnly,
        acceptedBy: keyOnly
      })
    })
  );

  return aState({
    heroes: SortedMap.from(
      compareHeroIds,
      heroes.map((hero) => [hero.id, hero] as const)
    ),
    contracts: SortedMap.from(compareContentIds, [[contract.id, contract]]),
    traitRules: SortedMap.from(compareContentIds, [
      [
        ids.refusesTemples,
        aTrait({ id: ids.refusesTemples, tag: ids.temple, isPrinciple: true, weight: 0 })
      ]
    ])
  });
}

/**
 * A locked, unfilled package every hero has already answered — the shape a second
 * `pollCrew` call on an already-fully-polled roster would produce, if the engine let
 * it apply. `requiredCrew` (3) is deliberately above `acceptedBy.size` (1, the key
 * hero alone): every seat is still open, but nobody is left to fill one.
 */
function fullyRespondedButUncrewedCampaign(): GameState {
  const heroes = heroesFor(false);
  const keyOnly = SortedSet.from(compareHeroIds, [KEY_HERO]);
  const everyone = SortedSet.from(compareHeroIds, [0, 1, 2, 3].map(heroId));

  const contract = createContractState(
    aContract({
      requiredCrew: 3,
      status: ContractStatus.Offered,
      offer: anOffer({
        keyHero: KEY_HERO,
        phase: OfferPhase.Locked,
        respondedBy: everyone,
        acceptedBy: keyOnly
      })
    })
  );

  return aState({
    heroes: SortedMap.from(
      compareHeroIds,
      heroes.map((hero) => [hero.id, hero] as const)
    ),
    contracts: SortedMap.from(compareContentIds, [[contract.id, contract]])
  });
}

function aPoll(overrides: Partial<PollCrew> = {}): PollCrew {
  return {
    commandId: 1,
    contractId: ids.crypt,
    expectedStateVersion: 0,
    ...overrides
  };
}

function offerOf(state: GameState): OfferState {
  return contractOf(state, ids.crypt).offer;
}

describe('pollCrew', () => {
  it('asks everyone who has not answered, in hero id order', () => {
    expect(
      pollCrew(lockedCampaign(), aPoll()).events.map((e) => ('heroId' in e ? e.heroId : null))
    ).toEqual([heroId(1), heroId(2), heroId(3)]);
  });

  it('does not stop asking once the seats are full', () => {
    // `everyoneAcceptsCampaign`, not the plain `lockedCampaign` the brief's own
    // fixture would have used: with every polled hero tuned toward acceptance,
    // seats genuinely fill partway through the roster (the key hero plus one more
    // of two required), so this test is only discharged by an implementation that
    // keeps asking past that point. Against `lockedCampaign`'s untuned heroes —
    // review of `DEC-008` Task 13 found this — every polled hero declines (advance
    // 0 against risk 80), `acceptedBy` never grows past the key hero alone, and
    // `toHaveLength(3)` holds just as well for a `pollCrew` that stops the moment
    // seats fill, since none ever do.
    expect(pollCrew(everyoneAcceptsCampaign({ requiredCrew: 2 }), aPoll()).decisions).toHaveLength(
      3
    );
  });

  it('seats only as many as the contract has room for', () => {
    const polled = pollCrew(everyoneAcceptsCampaign({ requiredCrew: 2 }), aPoll()).state;
    expect(offerOf(polled).acceptedBy.values()).toHaveLength(2);
    expect(offerOf(polled).respondedBy.values()).toHaveLength(4);
  });

  it('gives the seats to the first heroes in id order', () => {
    const polled = pollCrew(everyoneAcceptsCampaign({ requiredCrew: 2 }), aPoll()).state;
    expect(offerOf(polled).acceptedBy.values()).toEqual([heroId(0), heroId(1)]);
  });

  it('refuses to poll a contract whose crew is already complete', () => {
    expect(pollCrew(lockedSingleSeatCampaign(), aPoll()).rejectionCode).toBe(
      RejectionCodes.CrewAlreadyFilled
    );
  });

  it('spends an ordinal only on the heroes who actually drew a mood', () => {
    const before = gatedThenScoredThenGated();
    const after = pollCrew(before, aPoll()).state;
    expect(after.metadata.nextDecisionOrdinal - before.metadata.nextDecisionOrdinal).toBe(1n);
  });

  it('gives every decision — gated or scored — its own sequential trace id', () => {
    // `HERO_DECISION_SPEC` §5 exempts a gated decision from spending an *ordinal*
    // (test above), never from being explained: `decide()` builds a full trace —
    // `blockedBy` populated, `traceId` assigned — on the gated path exactly as on
    // the scored one, and `withEvent` stores every one of them under the
    // campaign's next free trace id, gated or not (`engine.test.ts`'s "a decision
    // the gate closed still happened" already pins this for a single hero; this is
    // the same fact for three in one command).
    const result = pollCrew(gatedThenScoredThenGated(), aPoll());
    expect(result.events.map((e) => e.causalTraceId)).toEqual([0, 1, 2]);
  });

  it('refuses to poll a locked package every hero has already answered', () => {
    // §6's edge-case table sends an unfilled crew back to `composeOffer`, not to a
    // second `pollCrew` of the one already fully answered — external review of
    // Task 13: without this, the same command could be issued any number of times
    // against a roster with nobody left to ask, each one legally applying and
    // growing `appliedCommandIds` without ever appending an event.
    expect(pollCrew(fullyRespondedButUncrewedCampaign(), aPoll()).rejectionCode).toBe(
      RejectionCodes.NobodyLeftToPoll
    );
  });

  it('refuses to poll a package that is not locked', () => {
    // §3.1's table: `pollCrew` is legal only once a package is `locked`. A `draft`
    // package — even one whose key hero has already accepted, same as every other
    // fixture here — has nothing for the roster to answer yet.
    const draft = lockedCampaign();
    const contract = contractOf(draft, ids.crypt);
    const stillDraft = {
      ...draft,
      contracts: draft.contracts.set(
        contract.id,
        createContractState({ ...contract, offer: { ...contract.offer, phase: OfferPhase.Draft } })
      )
    };

    expect(pollCrew(stillDraft, aPoll()).rejectionCode).toBe(RejectionCodes.OfferNotLocked);
  });

  it('refuses a stale or duplicate command before touching the contract', () => {
    expect(pollCrew(lockedCampaign(), aPoll({ expectedStateVersion: 99 })).rejectionCode).toBe(
      RejectionCodes.StaleState
    );

    const applied = {
      ...lockedCampaign(),
      appliedCommandIds: SortedSet.from(compareNumbers, [1])
    };
    expect(pollCrew(applied, aPoll()).rejectionCode).toBe(RejectionCodes.DuplicateCommand);
  });

  it('refuses an unknown contract', () => {
    expect(pollCrew(lockedCampaign(), aPoll({ contractId: ids.temple })).rejectionCode).toBe(
      RejectionCodes.UnknownContract
    );
  });

  it('changes nothing at all on a refusal', () => {
    const state = lockedSingleSeatCampaign();
    const result = pollCrew(state, aPoll());
    expect(result.state).toBe(state);
  });
});
