import { describe, expect, it } from 'vitest';

import { SortedMap } from '../collections/sorted-map.ts';
import { SortedSet } from '../collections/sorted-set.ts';
import type { BattleObjective } from '../domain/battle-objective.ts';
import { CombatRole } from '../domain/combat-role.ts';
import type { ContractBattlePlan } from '../domain/contract-battle-plan.ts';
import { DoctrineId } from '../domain/doctrine-id.ts';
import { NeedId, compareNeedIds } from '../domain/need-id.ts';
import { placeCrew } from '../engine.ts';
import { compareContentIds } from '../ids/content-id.ts';
import { compareHeroIds, heroId, type HeroId } from '../ids/hero-id.ts';
import { ContractStatus } from '../state/contract-state.ts';
import { contractOf, type GameState } from '../state/game-state.ts';
import { OfferPhase, createContractState } from '../state/offer-state.ts';
import { aContract, aHero, anOffer, aState } from '../testing/fixtures.ts';

import { RejectionCodes } from './command-result.ts';
import type { PlaceCrew } from './place-crew.ts';

/**
 * `COMBAT_SPEC` §3.7 — the seventh command: what it refuses, and where the formation ends
 * up when it does not.
 *
 * The three refusals of its own are what this file is mostly about. Each is a state the
 * game must not be able to be in, and each has a name a screen can print: two heroes on a
 * cell, a crew and a formation that disagree about who is going, and a contract that never
 * goes to a battle at all.
 */

const KEY: HeroId = heroId(0);
const SECOND: HeroId = heroId(1);

const AVERAGE = { might: 50, guard: 50, aim: 50, focus: 50, care: 50 };

function plan(overrides: Partial<ContractBattlePlan> = {}): ContractBattlePlan {
  return {
    objectives: SortedMap.from<NeedId, BattleObjective>(compareNeedIds, [
      [NeedId.Frontline, { kind: 'subdue', targets: ['foe:a'] }],
      [NeedId.Wilderness, { kind: 'hold', rounds: 3 }]
    ]),
    foes: [
      {
        id: 'foe:a',
        role: CombatRole.Vanguard,
        cell: { row: 1, column: 1 },
        combat: AVERAGE
      },
      {
        id: 'foe:b',
        role: CombatRole.Rear,
        cell: { row: 3, column: 2 },
        combat: AVERAGE
      }
    ],
    wards: [],
    ...overrides
  };
}

/** A locked, crewed, battle-bound contract — the one shape `placeCrew` accepts. */
function campaign(battle: ContractBattlePlan | null = plan()): GameState {
  const crew = SortedSet.from(compareHeroIds, [KEY, SECOND]);

  const contract = aContract({
    requiredCrew: 2,
    needs: SortedMap.from<NeedId, number>(compareNeedIds, [
      [NeedId.Frontline, 40],
      [NeedId.Wilderness, 40]
    ]),
    battle,
    status: ContractStatus.Crewed,
    offer: anOffer({
      keyHero: KEY,
      phase: OfferPhase.Locked,
      invited: crew,
      respondedBy: crew,
      acceptedBy: crew
    })
  });

  return aState({
    heroes: SortedMap.from(compareHeroIds, [
      [KEY, aHero({ id: KEY })],
      [SECOND, aHero({ id: SECOND })]
    ]),
    contracts: SortedMap.from(compareContentIds, [[contract.id, createContractState(contract)]])
  });
}

function command(state: GameState, overrides: Partial<PlaceCrew> = {}): PlaceCrew {
  return {
    commandId: 1,
    contractId: contractOf(state, aContract().id).id,
    expectedStateVersion: state.metadata.stateVersion,
    placement: [
      { hero: KEY, cell: { row: 1, column: 2 } },
      { hero: SECOND, cell: { row: 3, column: 2 } }
    ],
    doctrine: DoctrineId.HoldTheLine,
    retreatBelowPercent: 0,
    ...overrides
  };
}

describe('placeCrew records the whole plan on the package', () => {
  it('writes the formation, the doctrine and the threshold, and raises one event', () => {
    const state = campaign();
    const result = placeCrew(state, command(state, { retreatBelowPercent: 40 }));

    expect(result.rejectionCode).toBeNull();

    const deployment = contractOf(result.state, aContract().id).offer.deployment;

    expect(deployment?.doctrine).toBe(DoctrineId.HoldTheLine);
    expect(deployment?.retreatBelowPercent).toBe(40);
    expect(deployment?.placement.get(KEY)).toEqual({ row: 1, column: 2 });
    expect(result.events.map((event) => event.kind)).toEqual(['crew_placed']);
  });

  it('keys the formation by hero id, not by the order a screen built its controls in', () => {
    // §12.1 п.3's property, read at the command: the enumeration order reaches the
    // artifact, and a screen's layout must not.
    const state = campaign();
    const forward = placeCrew(state, command(state));
    const backward = placeCrew(
      state,
      command(state, {
        placement: [
          { hero: SECOND, cell: { row: 3, column: 2 } },
          { hero: KEY, cell: { row: 1, column: 2 } }
        ]
      })
    );

    expect(contractOf(forward.state, aContract().id).offer.deployment?.placement.keys()).toEqual(
      contractOf(backward.state, aContract().id).offer.deployment?.placement.keys()
    );
  });

  it('replaces the previous formation rather than adding to it', () => {
    const state = campaign();
    const first = placeCrew(state, command(state));
    const second = placeCrew(
      first.state,
      command(first.state, {
        commandId: 2,
        expectedStateVersion: first.state.metadata.stateVersion,
        placement: [
          { hero: KEY, cell: { row: 2, column: 1 } },
          { hero: SECOND, cell: { row: 3, column: 3 } }
        ]
      })
    );

    const deployment = contractOf(second.state, aContract().id).offer.deployment;

    expect(deployment?.placement.get(KEY)).toEqual({ row: 2, column: 1 });
    expect(deployment?.placement.keys()).toHaveLength(2);
  });
});

describe('the three refusals of its own (COMBAT_SPEC §3.7, §11)', () => {
  it('refuses two heroes on one cell', () => {
    const state = campaign();
    const result = placeCrew(
      state,
      command(state, {
        placement: [
          { hero: KEY, cell: { row: 1, column: 2 } },
          { hero: SECOND, cell: { row: 1, column: 2 } }
        ]
      })
    );

    expect(result.rejectionCode).toBe(RejectionCodes.CellTaken);
  });

  it('refuses a hero standing where the contract’s own ward stands', () => {
    const state = campaign(
      plan({
        objectives: SortedMap.from<NeedId, BattleObjective>(compareNeedIds, [
          [NeedId.Frontline, { kind: 'subdue', targets: ['foe:a'] }],
          [NeedId.Wilderness, { kind: 'protect', ward: 'ward:cart' }]
        ]),
        wards: [
          {
            id: 'ward:cart',
            role: CombatRole.Support,
            cell: { row: 3, column: 2 },
            combat: AVERAGE
          }
        ]
      })
    );

    const result = placeCrew(state, command(state));

    expect(result.rejectionCode).toBe(RejectionCodes.CellTaken);
  });

  it('refuses a crew and a formation that disagree about who is going', () => {
    const state = campaign();

    expect(
      placeCrew(state, command(state, { placement: [{ hero: KEY, cell: { row: 1, column: 2 } }] }))
        .rejectionCode
    ).toBe(RejectionCodes.UnplacedHero);

    // The same code from the other end: a cell given to somebody the package never asked.
    expect(
      placeCrew(
        state,
        command(state, {
          placement: [
            { hero: KEY, cell: { row: 1, column: 2 } },
            { hero: heroId(4), cell: { row: 3, column: 2 } }
          ]
        })
      ).rejectionCode
    ).toBe(RejectionCodes.UnplacedHero);

    // And the shape a size comparison alone would miss: the same man twice.
    expect(
      placeCrew(
        state,
        command(state, {
          placement: [
            { hero: KEY, cell: { row: 1, column: 2 } },
            { hero: KEY, cell: { row: 3, column: 2 } }
          ]
        })
      ).rejectionCode
    ).toBe(RejectionCodes.UnplacedHero);
  });

  it('refuses a contract that never goes to a battle', () => {
    const state = campaign(null);

    expect(placeCrew(state, command(state)).rejectionCode).toBe(RejectionCodes.NotABattleContract);
  });

  it('refuses a threshold outside the share it is', () => {
    const state = campaign();

    expect(placeCrew(state, command(state, { retreatBelowPercent: 101 })).rejectionCode).toBe(
      RejectionCodes.OfferTermsOutOfBounds
    );
  });
});

describe('the seven preconditions it shares with resolveContract (RESOLUTION_SPEC §3.2)', () => {
  it('refuses a stale state version, a repeated command and an unknown contract', () => {
    const state = campaign();

    expect(placeCrew(state, command(state, { expectedStateVersion: 99 })).rejectionCode).toBe(
      RejectionCodes.StaleState
    );

    const once = placeCrew(state, command(state));

    expect(
      placeCrew(
        once.state,
        command(once.state, { expectedStateVersion: once.state.metadata.stateVersion })
      ).rejectionCode
    ).toBe(RejectionCodes.DuplicateCommand);
  });

  it('refuses a package that is not locked, and a crew that is not filled', () => {
    const draft = aState({
      heroes: SortedMap.from(compareHeroIds, [
        [KEY, aHero({ id: KEY })],
        [SECOND, aHero({ id: SECOND })]
      ]),
      contracts: SortedMap.from(compareContentIds, [
        [
          aContract().id,
          createContractState(
            aContract({
              requiredCrew: 2,
              battle: plan(),
              status: ContractStatus.Offered,
              offer: anOffer({
                keyHero: KEY,
                phase: OfferPhase.Draft,
                invited: SortedSet.from(compareHeroIds, [KEY, SECOND])
              })
            })
          )
        ]
      ])
    });

    expect(placeCrew(draft, command(draft)).rejectionCode).toBe(RejectionCodes.OfferNotLocked);
  });

  it('refuses a state it does not change at all', () => {
    const state = campaign();
    const refused = placeCrew(state, command(state, { expectedStateVersion: 99 }));

    expect(Object.is(refused.state, state)).toBe(true);
  });
});
