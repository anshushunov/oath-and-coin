import { describe, expect, it } from 'vitest';

import { SortedMap } from '../collections/sorted-map.ts';
import { SortedSet } from '../collections/sorted-set.ts';
import { CommitmentState } from '../domain/commitment.ts';
import { compareContentIds } from '../ids/content-id.ts';
import { compareHeroIds, heroId, type HeroId } from '../ids/hero-id.ts';
import { aContract, anOffer, heroes, ids, setOf, sixTags } from '../testing/fixtures.ts';

import { OfferPhase, createContractState, effectiveTags, initialOffer } from './offer-state.ts';

/**
 * The offer's own invariants, one test per relationship `NEGOTIATION_SPEC` §2.1
 * states — including the one the spec's own prose calls out as the reason
 * `respondedBy`/`acceptedBy` moved inside the offer in the first place: a version is a
 * new object with empty answer sets, so there is nowhere for a stale answer to live.
 */

describe('initialOffer', () => {
  it('starts every contract on version 1 with an empty draft', () => {
    expect(initialOffer()).toEqual({
      version: 1,
      keyHero: null,
      advance: 0,
      methodTag: null,
      promisedBonus: 0,
      phase: OfferPhase.Draft,
      invited: SortedSet.empty<HeroId>(compareHeroIds),
      respondedBy: SortedSet.empty<HeroId>(compareHeroIds),
      acceptedBy: SortedSet.empty<HeroId>(compareHeroIds),
      commitments: SortedMap.empty<HeroId, CommitmentState>(compareHeroIds),
      // `null` and not an empty placement: "nobody has been placed" and "everybody was
      // placed nowhere" are different claims, and only the first is true of a package
      // nobody has composed (`COMBAT_SPEC` §3.7).
      deployment: null
    });
  });
});

describe('createContractState invariants (NEGOTIATION_SPEC §2.1)', () => {
  it('refuses a version below 1', () => {
    // Enforced nowhere in memory before this: only the save schema's own
    // `z.int().min(1)` (`snapshot-codec.ts`) ever bounded it, so a state built or
    // revised without ever round-tripping through a save had no check on it at all.
    expect(() => createContractState(aContract({ offer: anOffer({ version: 0 }) }))).toThrow(
      /version/
    );
  });

  it('refuses an acceptance from someone who never responded', () => {
    expect(() =>
      createContractState(
        aContract({ offer: anOffer({ acceptedBy: heroes(0), respondedBy: heroes(1) }) })
      )
    ).toThrow(/respondedBy/);
  });

  it('refuses a crew larger than the contract has seats', () => {
    expect(() =>
      createContractState(
        aContract({
          requiredCrew: 2,
          offer: anOffer({ acceptedBy: heroes(0, 1, 2), respondedBy: heroes(0, 1, 2) })
        })
      )
    ).toThrow(/seats/);
  });

  it('refuses anyone but the key hero having answered a draft', () => {
    expect(() =>
      createContractState(
        aContract({
          offer: anOffer({ phase: OfferPhase.Draft, keyHero: heroId(0), respondedBy: heroes(1) })
        })
      )
    ).toThrow(/draft/);
  });

  it('refuses a promise with nobody to promise it to', () => {
    expect(() =>
      createContractState(aContract({ offer: anOffer({ keyHero: null, promisedBonus: 10 }) }))
    ).toThrow(/keyHero/);
  });

  it('refuses an advance or a bonus outside the patron fee', () => {
    expect(() =>
      createContractState(aContract({ patronFee: 50, offer: anOffer({ advance: 51 }) }))
    ).toThrow(/advance/);
    expect(() =>
      createContractState(
        aContract({
          patronFee: 50,
          offer: anOffer({ keyHero: heroId(0), promisedBonus: 51 })
        })
      )
    ).toThrow(/promisedBonus/);
  });

  it('refuses a settled offer on a contract that never filled its crew', () => {
    expect(() =>
      createContractState(
        aContract({ status: 'offered', offer: anOffer({ phase: OfferPhase.Settled }) })
      )
    ).toThrow(/settled/);
  });

  it('ties the crewed status to the seats in both directions', () => {
    expect(() =>
      createContractState(
        aContract({
          requiredCrew: 2,
          status: 'crewed',
          offer: anOffer({ acceptedBy: heroes(0), respondedBy: heroes(0) })
        })
      )
    ).toThrow(/crewed/);
    expect(() =>
      createContractState(
        aContract({
          requiredCrew: 1,
          status: 'offered',
          offer: anOffer({ acceptedBy: heroes(0), respondedBy: heroes(0) })
        })
      )
    ).toThrow(/crewed/);
  });

  it('refuses a chosen tag that pushes the contract past the tag ceiling', () => {
    expect(() =>
      createContractState(
        aContract({ tags: sixTags(), offer: anOffer({ methodTag: ids.deception }) })
      )
    ).toThrow(/tags/);
  });
});

describe('createContractState — the crew invariants RESOLUTION_SPEC §2.5 adds', () => {
  it('lets an offer nobody has composed yet invite nobody', () => {
    // The conditional half of the rule, and the reason it is conditional: the loader
    // builds every contract's starting offer with `keyHero: null` before any command
    // runs (`NEGOTIATION_SPEC` §6.1), so an unconditional `invited.size === requiredCrew`
    // would mean a campaign assembled from content cannot pass its own constructor.
    expect(() => createContractState(aContract({ offer: anOffer() }))).not.toThrow();
  });

  it('refuses an uncomposed offer that has invited somebody anyway', () => {
    expect(() =>
      createContractState(aContract({ offer: anOffer({ keyHero: null, invited: heroes(0) }) }))
    ).toThrow(/has no key hero/);
  });

  it.each([1, 3])('refuses a crew of %i where the contract declared 2 seats', (size) => {
    expect(() =>
      createContractState(
        aContract({
          requiredCrew: 2,
          offer: anOffer({ keyHero: heroId(0), invited: heroes(...[0, 1, 2].slice(0, size)) })
        })
      )
    ).toThrow(/invites exactly as many heroes as the job has places/);
  });

  it('accepts a crew of exactly the seats declared', () => {
    expect(() =>
      createContractState(
        aContract({
          requiredCrew: 2,
          offer: anOffer({ keyHero: heroId(0), invited: heroes(0, 1) })
        })
      )
    ).not.toThrow();
  });

  it('refuses a key hero who is not among the invited', () => {
    expect(() =>
      createContractState(
        aContract({ requiredCrew: 1, offer: anOffer({ keyHero: heroId(0), invited: heroes(1) }) })
      )
    ).toThrow(/key hero/);
  });

  it('refuses an answer from someone who was never invited', () => {
    // `respondedBy ⊆ invited`. Distinct from the draft rule above it: that one bounds
    // *when* a non-key hero may answer, this one bounds *who* may answer at all.
    expect(() =>
      createContractState(
        aContract({
          requiredCrew: 2,
          status: 'offered',
          offer: anOffer({
            phase: OfferPhase.Locked,
            keyHero: heroId(0),
            invited: heroes(0, 1),
            respondedBy: heroes(0, 2)
          })
        })
      )
    ).toThrow(/invited/);
  });

  it('refuses an acceptance with no commitment recorded for it', () => {
    // `commitments.keys() === acceptedBy`, the same argument §2.5 makes for it: without
    // the equality, `commitments.get(hero)` in the resolver returns `undefined` for a
    // hero who is demonstrably on the crew.
    expect(() =>
      createContractState(
        aContract({
          requiredCrew: 1,
          status: 'crewed',
          offer: anOffer({
            phase: OfferPhase.Locked,
            keyHero: heroId(0),
            invited: heroes(0),
            respondedBy: heroes(0),
            acceptedBy: heroes(0),
            commitments: SortedMap.empty<HeroId, CommitmentState>(compareHeroIds)
          })
        })
      )
    ).toThrow(/commitment/);
  });

  it('refuses a commitment recorded for someone who did not accept', () => {
    expect(() =>
      createContractState(
        aContract({
          requiredCrew: 2,
          status: 'offered',
          offer: anOffer({
            phase: OfferPhase.Locked,
            keyHero: heroId(0),
            invited: heroes(0, 1),
            respondedBy: heroes(0),
            acceptedBy: heroes(0),
            commitments: SortedMap.from(compareHeroIds, [
              [heroId(0), CommitmentState.Committed],
              [heroId(1), CommitmentState.Committed]
            ])
          })
        })
      )
    ).toThrow(/commitment/);
  });
});

describe('effectiveTags', () => {
  it('adds the chosen method tag to the contract tags', () => {
    const contract = aContract({
      tags: setOf(ids.cult),
      offer: anOffer({ methodTag: ids.deception })
    });

    expect(effectiveTags(contract).values()).toEqual(
      SortedSet.from(compareContentIds, [ids.cult, ids.deception]).values()
    );
  });
});
