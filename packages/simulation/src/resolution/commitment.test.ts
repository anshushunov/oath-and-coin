import { describe, expect, it } from 'vitest';

import { SortedMap } from '../collections/sorted-map.ts';
import { SortedSet } from '../collections/sorted-set.ts';
import { CommitmentState } from '../domain/commitment.ts';
import { pollCrew, proposeContractToHero } from '../engine.ts';
import { compareContentIds, type ContentId } from '../ids/content-id.ts';
import { compareHeroIds, heroId, type HeroId } from '../ids/hero-id.ts';
import { ContractStatus } from '../state/contract-state.ts';
import { contractOf, type GameState } from '../state/game-state.ts';
import { OfferPhase } from '../state/offer-state.ts';
import { aContext, aContract, aHero, anOffer, aState, aTrait, ids } from '../testing/fixtures.ts';

import { commitmentFor } from './commitment.ts';

/**
 * `RESOLUTION_SPEC` §2.4 — whether a yes was given or bought, decided at the moment it is
 * given.
 *
 * **Every case here is decided before the mood is drawn.** A mood contributes at most ±5
 * (`MOOD_MIN`/`MOOD_MAX`), and every fixture below puts its pre-mood score outside that
 * band in both the real and the counterfactual run, so no case turns on which mood a
 * particular `(seed, ordinal)` happens to draw. A table pinned to one draw would be a
 * table about the RNG.
 */

const KEY_HERO: HeroId = heroId(0);
const COMRADE: HeroId = heroId(1);

/**
 * A context where the promised bonus is what carries the decision: without it the hero is
 * 20 short, with it he is 20 clear, and the mood cannot reach either edge.
 *
 * `greed: 100` so the bonus arrives at face value — `bonusPull = bonus × greed / 100` —
 * which keeps the case about the counterfactual rather than about a multiplication.
 */
function bonusDecides(overrides: { readonly grievance?: number } = {}) {
  return aContext({
    hero: aHero({
      id: KEY_HERO,
      greed: 100,
      caution: 0,
      pride: 0,
      trustInGuild: 0,
      grievance: overrides.grievance ?? 0
    }),
    // An aversion of 20 against a bonus worth 40: −20 alone, +20 with the bonus.
    traits: [aTrait({ weight: -20 })],
    contract: aContract({
      patronFee: 70,
      risk: 0,
      offer: anOffer({ keyHero: KEY_HERO, advance: 0, promisedBonus: 40 })
    })
  });
}

describe('commitmentFor (RESOLUTION_SPEC §2.4)', () => {
  it('calls a yes that would not have been given without the bonus fragile', () => {
    expect(commitmentFor(bonusDecides())).toBe(CommitmentState.Fragile);
  });

  it('calls a yes fragile when the bonus also happens to remove the insult', () => {
    // The case a *subtraction* misses and a *re-run* catches. Removing the bonus does two
    // things at once: it takes 55 off the payment, and it drops what the hero stands to
    // receive below the risk being asked, which creates a `PaymentInsulting` of 50 that
    // was not there before. Subtracting the bonus factor alone leaves 65 − 55 = 10 and
    // reads as still-accepted; recomputing answers −40 (`RESOLUTION_SPEC` §2.4).
    const context = aContext({
      hero: aHero({ id: KEY_HERO, greed: 100, caution: 0, pride: 100, trustInGuild: 0 }),
      contract: aContract({
        patronFee: 70,
        risk: 60,
        offer: anOffer({ keyHero: KEY_HERO, advance: 10, promisedBonus: 55 })
      })
    });

    expect(commitmentFor(context)).toBe(CommitmentState.Fragile);
  });

  it('leaves a yes that honest pay already earned committed', () => {
    // The bonus is surplus here: the advance alone carries the decision by 60, so taking
    // the promise away changes nothing about whether this hero goes.
    const context = aContext({
      hero: aHero({ id: KEY_HERO, greed: 100, caution: 0, pride: 0, trustInGuild: 0 }),
      contract: aContract({
        patronFee: 100,
        risk: 0,
        offer: anOffer({ keyHero: KEY_HERO, advance: 60, promisedBonus: 40 })
      })
    });

    expect(commitmentFor(context)).toBe(CommitmentState.Committed);
  });

  it('calls a yes from an aggrieved hero resentful without recomputing anything', () => {
    // Same numbers as the fragile case, plus a grievance. §2.4 step 1 answers before the
    // counterfactual runs at all, so an implementation that ran the re-run first — or
    // that checked the grievance only as a tiebreak afterwards — would answer `fragile`
    // here and this case would be red.
    expect(commitmentFor(bonusDecides({ grievance: 30 }))).toBe(CommitmentState.Resentful);
  });

  it('calls an aggrieved hero resentful even when nothing bought his yes', () => {
    // The case that pins step 1 *ahead* of step 3 rather than beside it. Here the
    // counterfactual accepts — honest pay of 60 carries the decision with or without the
    // promise — so an implementation that ran the re-run first and only consulted the
    // grievance when the re-run declined would answer `committed`. The aggrieved case
    // above cannot catch that: its counterfactual declines anyway, so both orders agree.
    const context = aContext({
      hero: aHero({
        id: KEY_HERO,
        greed: 100,
        caution: 0,
        pride: 0,
        trustInGuild: 0,
        grievance: 30
      }),
      contract: aContract({
        patronFee: 100,
        risk: 0,
        offer: anOffer({ keyHero: KEY_HERO, advance: 60, promisedBonus: 40 })
      })
    });

    expect(commitmentFor(context)).toBe(CommitmentState.Resentful);
  });
});

/**
 * A campaign where the key hero's own answer is bought (the bonus decides it) *and* where
 * a comrade joining later would change that answer — the bond is worth 60, which is more
 * than enough to carry the counterfactual on its own.
 *
 * That second half is what makes the stability test below mean something: if the state
 * were recomputed when the contract resolves, this hero's `fragile` would have turned
 * into `committed` by then, and §2.4's whole reason for existing is that it must not.
 */
function aCampaignWhereTheBonusDecides(): GameState {
  const key = aHero({
    id: KEY_HERO,
    definition: ids.bram,
    greed: 100,
    caution: 0,
    pride: 0,
    trustInGuild: 0,
    traits: [ids.hatesUndead],
    relationships: SortedMap.from<ContentId, number>(compareContentIds, [[ids.doran, 60]])
  });
  const comrade = aHero({ id: COMRADE, definition: ids.doran, greed: 100, caution: 0, pride: 0 });

  const contract = aContract({
    patronFee: 70,
    risk: 0,
    requiredCrew: 2,
    offer: anOffer({
      keyHero: KEY_HERO,
      advance: 0,
      promisedBonus: 40,
      phase: OfferPhase.Draft,
      invited: SortedSet.from(compareHeroIds, [KEY_HERO, COMRADE])
    })
  });

  return aState({
    heroes: SortedMap.from(compareHeroIds, [
      [KEY_HERO, key],
      [COMRADE, comrade]
    ]),
    contracts: SortedMap.from(compareContentIds, [[contract.id, contract]]),
    traitRules: SortedMap.from(compareContentIds, [
      [ids.hatesUndead, aTrait({ id: ids.hatesUndead, weight: -20 })]
    ])
  });
}

describe('where the commitment is computed (RESOLUTION_SPEC §2.4)', () => {
  it('records the key hero’s state at the moment he answers, not a constant', () => {
    const answered = proposeContractToHero(aCampaignWhereTheBonusDecides(), {
      commandId: 1,
      heroId: KEY_HERO,
      contractId: ids.crypt,
      expectedStateVersion: 0
    });

    expect(answered.applied).toBe(true);
    expect(contractOf(answered.state, ids.crypt).offer.acceptedBy.has(KEY_HERO)).toBe(true);
    expect(contractOf(answered.state, ids.crypt).offer.commitments.get(KEY_HERO)).toBe(
      CommitmentState.Fragile
    );
  });

  it('does not let the crew filling up afterwards change what was recorded', () => {
    // The bond this hero has with the comrade is worth 60 — more than the 20 the bonus
    // was covering — so a state recomputed once the crew is full would read `committed`.
    // The answer given alone is the one that stands.
    const answered = proposeContractToHero(aCampaignWhereTheBonusDecides(), {
      commandId: 1,
      heroId: KEY_HERO,
      contractId: ids.crypt,
      expectedStateVersion: 0
    });
    const atAnswer = contractOf(answered.state, ids.crypt).offer.commitments.get(KEY_HERO);

    const contract = contractOf(answered.state, ids.crypt);
    const crewed = {
      ...answered.state,
      contracts: answered.state.contracts.set(contract.id, {
        ...contract,
        status: ContractStatus.Crewed,
        offer: {
          ...contract.offer,
          acceptedBy: contract.offer.acceptedBy.add(COMRADE),
          respondedBy: contract.offer.respondedBy.add(COMRADE),
          commitments: contract.offer.commitments.set(COMRADE, CommitmentState.Committed)
        }
      })
    };

    expect(contractOf(crewed, ids.crypt).offer.commitments.get(KEY_HERO)).toBe(atAnswer);
    expect(atAnswer).toBe(CommitmentState.Fragile);
  });

  it('runs the counterfactual on the ordinal the mood was pinned to, not on the next one', () => {
    // The one case in this file decided *inside* the mood band, and deliberately: every
    // other fixture sits far outside it so no case turns on a particular draw — which is
    // exactly why none of them can see which ordinal the counterfactual was handed. Here
    // the counterfactual's whole answer is the mood.
    //
    // The hero's mood is already pinned to ordinal 4 (`NEGOTIATION_SPEC` §2.1.1: pinned on
    // the first draw, not redrawn on every revised package), while the campaign's next
    // ordinal is 2 — so the pinned one and the fresh one are different numbers that draw
    // different moods (−5 and +4 at seed 7).
    //
    // Pay of 1 and a bonus of 40. With the bonus the hero accepts by a mile either way.
    // Without it the counterfactual scores 1 + mood: −4 on the pinned ordinal (declines →
    // fragile), +5 on the campaign's next one (accepts → committed). So a counterfactual
    // handed `state.metadata.nextDecisionOrdinal`, or `context.decisionOrdinal + 1n`
    // (ordinal 5 draws +3), answers `committed` and this case is red.
    const hero = aHero({
      id: KEY_HERO,
      greed: 100,
      caution: 0,
      pride: 0,
      trustInGuild: 0
    });
    const contract = aContract({
      patronFee: 70,
      risk: 0,
      requiredCrew: 1,
      moodOrdinals: SortedMap.from<HeroId, bigint>(compareHeroIds, [[KEY_HERO, 4n]]),
      offer: anOffer({ keyHero: KEY_HERO, advance: 1, promisedBonus: 40 })
    });
    const state = aState({
      metadata: { ...aState().metadata, nextDecisionOrdinal: 2n },
      heroes: SortedMap.from(compareHeroIds, [[KEY_HERO, hero]]),
      contracts: SortedMap.from(compareContentIds, [[contract.id, contract]])
    });

    const answered = proposeContractToHero(state, {
      commandId: 1,
      heroId: KEY_HERO,
      contractId: ids.crypt,
      expectedStateVersion: 0
    });

    expect(contractOf(answered.state, ids.crypt).offer.acceptedBy.has(KEY_HERO)).toBe(true);
    expect(contractOf(answered.state, ids.crypt).offer.commitments.get(KEY_HERO)).toBe(
      CommitmentState.Fragile
    );
    // A pinned mood is a mood already drawn, so neither run spends anything.
    expect(answered.state.metadata.nextDecisionOrdinal).toBe(2n);
  });

  it('records an aggrieved crew member polled into the crew as resentful', () => {
    // `pollCrew` is the second caller of the rule and had no test of the *value* it
    // writes: the mutant that puts `CommitmentState.Committed` back in that one line
    // keeps `commitments.keys() === acceptedBy` intact and stays green on every shipped
    // scenario, because nobody polled in them carries a grievance. This crew member does.
    //
    // Not the key hero, so no bonus reaches him and the counterfactual is the same
    // decision he just made — without §2.4 step 1 he would read `committed`.
    const key = aHero({ id: KEY_HERO, greed: 100, caution: 0, pride: 0, trustInGuild: 0 });
    const aggrieved = aHero({
      id: COMRADE,
      definition: ids.doran,
      greed: 100,
      caution: 0,
      pride: 0,
      trustInGuild: 0,
      grievance: 20
    });
    const accepted = SortedSet.from(compareHeroIds, [KEY_HERO]);

    const contract = aContract({
      patronFee: 70,
      risk: 0,
      requiredCrew: 2,
      status: ContractStatus.Offered,
      offer: anOffer({
        keyHero: KEY_HERO,
        advance: 60,
        promisedBonus: 0,
        phase: OfferPhase.Locked,
        invited: SortedSet.from(compareHeroIds, [KEY_HERO, COMRADE]),
        respondedBy: accepted,
        acceptedBy: accepted
      })
    });
    const state = aState({
      heroes: SortedMap.from(compareHeroIds, [
        [KEY_HERO, key],
        [COMRADE, aggrieved]
      ]),
      contracts: SortedMap.from(compareContentIds, [[contract.id, contract]])
    });

    const polled = pollCrew(state, {
      commandId: 1,
      contractId: ids.crypt,
      expectedStateVersion: 0
    });

    const offer = contractOf(polled.state, ids.crypt).offer;

    expect(offer.acceptedBy.has(COMRADE)).toBe(true);
    expect(offer.commitments.get(COMRADE)).toBe(CommitmentState.Resentful);
    // §2.5's invariant, restated where a second writer could break it.
    expect(offer.commitments.keys()).toEqual(offer.acceptedBy.values());
  });

  it('spends no randomness on the counterfactual', () => {
    // `decide` is a pure function of `(campaignSeed, decisionOrdinal)`, and the campaign's
    // counter is moved by `withEvent`, not by the rule — so running the decision a second
    // time on the same ordinal costs nothing. One answer, one ordinal (`ADR-003`,
    // measured off `metadata`, not off the readonly input).
    const before = aCampaignWhereTheBonusDecides();
    const answered = proposeContractToHero(before, {
      commandId: 1,
      heroId: KEY_HERO,
      contractId: ids.crypt,
      expectedStateVersion: 0
    });

    expect(answered.state.metadata.nextDecisionOrdinal).toBe(
      before.metadata.nextDecisionOrdinal + 1n
    );
  });
});
