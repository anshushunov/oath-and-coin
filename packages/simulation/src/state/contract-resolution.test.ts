import { describe, expect, it } from 'vitest';

import { SortedMap } from '../collections/sorted-map.ts';
import { CommitmentState } from '../domain/commitment.ts';
import { OutcomeGrade, type ContractResolution, type HeroContribution } from '../domain/outcome.ts';
import { compareHeroIds, heroId, type HeroId } from '../ids/hero-id.ts';
import { aContract, anOffer, heroes } from '../testing/fixtures.ts';

import { createContractState, OfferPhase } from './offer-state.ts';

/**
 * The half of `RESOLUTION_SPEC` §2.5 that is about a *stored* result rather than about
 * the package around it. Its own file for the reason `offer-state.ts` gives for holding
 * the offer's own: these rules read `ContractResolution`, and the argument for each is
 * about what a command would find missing, not about the negotiation lifecycle.
 */

function aResolution(overrides: Partial<ContractResolution> = {}): ContractResolution {
  return {
    grade: OutcomeGrade.Clean,
    coverage: [],
    contributions: SortedMap.empty<HeroId, HeroContribution>(compareHeroIds),
    deficits: [],
    dominant: null,
    consequences: [],
    ...overrides
  };
}

/** A crewed, locked contract of one seat — the smallest state a resolution may sit on. */
function aResolvableContract(resolution: ContractResolution | null) {
  return aContract({
    requiredCrew: 1,
    status: 'crewed',
    resolution,
    offer: anOffer({
      phase: OfferPhase.Locked,
      keyHero: heroId(0),
      invited: heroes(0),
      respondedBy: heroes(0),
      acceptedBy: heroes(0),
      commitments: SortedMap.from(compareHeroIds, [[heroId(0), CommitmentState.Committed]])
    })
  });
}

describe('a resolution stored on a contract', () => {
  it('is allowed on a locked, crewed contract', () => {
    const contributions = SortedMap.from(compareHeroIds, [
      [heroId(0), { amount: 40, commitment: CommitmentState.Committed, provenance: [] }]
    ]);

    expect(() =>
      createContractState(aResolvableContract(aResolution({ contributions })))
    ).not.toThrow();
  });

  it('is refused on a draft', () => {
    // A resolved draft would mean a crew went out on a package the player can still
    // edit underneath them (`RESOLUTION_SPEC` §2.5).
    expect(() =>
      createContractState({
        ...aResolvableContract(aResolution()),
        offer: anOffer({
          phase: OfferPhase.Draft,
          keyHero: heroId(0),
          invited: heroes(0),
          respondedBy: heroes(0),
          acceptedBy: heroes(0),
          commitments: SortedMap.from(compareHeroIds, [[heroId(0), CommitmentState.Committed]])
        })
      })
    ).toThrow(/resolution/);
  });

  it('is refused on a contract that never filled its crew', () => {
    expect(() =>
      createContractState(
        aContract({
          requiredCrew: 2,
          status: 'offered',
          resolution: aResolution(),
          offer: anOffer({
            phase: OfferPhase.Locked,
            keyHero: heroId(0),
            invited: heroes(0, 1),
            respondedBy: heroes(0),
            acceptedBy: heroes(0),
            commitments: SortedMap.from(compareHeroIds, [[heroId(0), CommitmentState.Committed]])
          })
        })
      )
    ).toThrow(/resolution/);
  });

  it('accounts for exactly the heroes who accepted, and no others', () => {
    // The same argument §2.5 makes for `commitments`, applied to the sibling field the
    // debrief screen reads: `resolution.contributions.get(hero)` returning `undefined`
    // for a hero who is demonstrably on the crew is not a state any command produces,
    // so it is a state the constructor refuses. Amended into §2.5 rather than enforced
    // silently.
    expect(() => createContractState(aResolvableContract(aResolution()))).toThrow(/contribution/);

    const stranger = SortedMap.from(compareHeroIds, [
      [heroId(0), { amount: 40, commitment: CommitmentState.Committed, provenance: [] }],
      [heroId(1), { amount: 10, commitment: CommitmentState.Committed, provenance: [] }]
    ]);

    expect(() =>
      createContractState(aResolvableContract(aResolution({ contributions: stranger })))
    ).toThrow(/contribution/);
  });

  it('is absent by default, on every contract a campaign starts with', () => {
    expect(aContract().resolution).toBeNull();
  });
});
