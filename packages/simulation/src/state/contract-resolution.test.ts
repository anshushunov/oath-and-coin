import { describe, expect, it } from 'vitest';

import { SortedMap } from '../collections/sorted-map.ts';
import { CommitmentState } from '../domain/commitment.ts';
import { OutcomeGrade, type ContractResolution, type HeroContribution } from '../domain/outcome.ts';
import { BattleOutcome } from '../domain/battle-event.ts';
import type { BattleObjective } from '../domain/battle-objective.ts';
import type { BattleRecord } from '../domain/battle-record.ts';
import type { Cell } from '../domain/battle-cell.ts';
import { CombatRole } from '../domain/combat-role.ts';
import { DoctrineId } from '../domain/doctrine-id.ts';
import { NeedId, compareNeedIds } from '../domain/need-id.ts';
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
    battle: null,
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

/**
 * The route and the result have to agree (`ADR-014` §1, `ADR-016` §5).
 *
 * Three combinations are unreachable through the commands and reachable through a save:
 * `snapshot-codec.ts` decodes `battle`, `deployment` and `resolution.battle` as three
 * independent nullable fields, so an edited file can claim that a fight was settled by the
 * abstract resolver, that a delegated job produced a battle, or that a battle happened from
 * nowhere in particular. External review found all three; each is refused here, which is
 * also where the codec turns them into `SAVE_INCONSISTENT`.
 */
describe('a stored result and the route that produced it (ADR-016 §5)', () => {
  const crew = SortedMap.from(compareHeroIds, [
    [heroId(0), { amount: 40, commitment: CommitmentState.Committed, provenance: [] }]
  ]);

  const plan = {
    objectives: SortedMap.from<NeedId, BattleObjective>(compareNeedIds, [
      [NeedId.Frontline, { kind: 'hold' as const, rounds: 3 }]
    ]),
    foes: [
      {
        id: 'foe:a',
        role: CombatRole.Vanguard,
        cell: { row: 1 as const, column: 1 as const },
        combat: { might: 50, guard: 50, aim: 50, focus: 50, care: 50 }
      }
    ],
    wards: []
  };

  const record: BattleRecord = {
    initial: { round: 0, units: [], doctrine: DoctrineId.HoldTheLine, outcome: null },
    final: {
      round: 1,
      units: [],
      doctrine: DoctrineId.HoldTheLine,
      outcome: BattleOutcome.CrewStanding
    },
    events: [{ kind: 'battle_ended', outcome: BattleOutcome.CrewStanding }],
    rounds: 1,
    outcome: BattleOutcome.CrewStanding,
    retreatSignalledAtRound: null
  };

  const deployment = {
    placement: SortedMap.from<HeroId, Cell>(compareHeroIds, [[heroId(0), { row: 1, column: 1 }]]),
    doctrine: DoctrineId.HoldTheLine,
    retreatBelowPercent: 0
  };

  it('refuses a fight settled by the resolver that fights nothing', () => {
    expect(() =>
      createContractState({
        ...aResolvableContract(aResolution({ contributions: crew })),
        battle: plan
      })
    ).toThrow(/goes to a battle/);
  });

  it('refuses a delegated job that came back with a battle', () => {
    expect(() =>
      createContractState({
        ...aResolvableContract(aResolution({ contributions: crew, battle: record })),
        battle: null
      })
    ).toThrow(/has no battle plan/);
  });

  it('refuses a battle nobody stood anywhere for', () => {
    const contract = aResolvableContract(aResolution({ contributions: crew, battle: record }));

    expect(() => createContractState({ ...contract, battle: plan })).toThrow(/no formation/);

    // And accepts it once the formation is there, so the refusal above is about the
    // formation rather than about the battle.
    expect(() =>
      createContractState({
        ...contract,
        battle: plan,
        offer: { ...contract.offer, deployment }
      })
    ).not.toThrow();
  });

  it('refuses a formation on a contract that never fights', () => {
    const contract = aResolvableContract(null);

    expect(() =>
      createContractState({ ...contract, offer: { ...contract.offer, deployment } })
    ).toThrow(/no battle plan/);
  });
});
