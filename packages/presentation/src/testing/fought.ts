import {
  CombatRole,
  CommitmentState,
  ContractStatus,
  DoctrineId,
  NeedId,
  OfferPhase,
  SortedMap,
  SortedSet,
  compareContentIds,
  compareHeroIds,
  compareNeedIds,
  createContractState,
  heroId,
  placeCrew,
  resolveContract,
  type BattleObjective,
  type Cell,
  type ContractBattlePlan,
  type ContentId,
  type GameState,
  type HeroId
} from '@oath-and-coin/simulation';

import {
  aContract,
  aCrewedContract,
  aHero,
  anOffer,
  aResolvedCampaign,
  aState,
  ids
} from './fixtures.ts';

/**
 * A campaign that has been to a fight, driven through the **real commands**.
 *
 * Shared by every check that needs a battle to have happened rather than a record somebody
 * typed: what has to be true is that these screens read the shape the engine produces, and a
 * hand-built resolution would only prove they read a shape somebody wrote down.
 *
 * Here rather than inside one test file because two now need it, and a test importing another
 * test is a dependency nothing declares.
 */

export const KEY: HeroId = heroId(0);
export const SECOND: HeroId = heroId(1);

const SOLID = { might: 80, guard: 70, aim: 80, focus: 60, care: 50 };
const THIN = { might: 20, guard: 10, aim: 20, focus: 20, care: 0 };

export function plan(): ContractBattlePlan {
  return {
    objectives: SortedMap.from<NeedId, BattleObjective>(compareNeedIds, [
      [NeedId.Frontline, { kind: 'subdue', targets: ['foe:a'] }],
      [NeedId.Wilderness, { kind: 'hold', rounds: 3 }]
    ]),
    foes: [
      { id: 'foe:a', role: CombatRole.Vanguard, cell: { row: 1, column: 1 }, combat: THIN },
      { id: 'foe:b', role: CombatRole.Vanguard, cell: { row: 1, column: 3 }, combat: THIN }
    ],
    wards: []
  };
}

/** A locked, crewed, battle-bound campaign — one command away from a fight. */
export function campaign(): GameState {
  const crew = SortedSet.from(compareHeroIds, [KEY, SECOND]);

  const contract = createContractState(
    aContract({
      requiredCrew: 2,
      risk: 0,
      needs: SortedMap.from<NeedId, number>(compareNeedIds, [
        [NeedId.Frontline, 40],
        [NeedId.Wilderness, 30]
      ]),
      battle: plan(),
      status: ContractStatus.Crewed,
      offer: anOffer({
        keyHero: KEY,
        phase: OfferPhase.Locked,
        invited: crew,
        respondedBy: crew,
        acceptedBy: crew,
        commitments: SortedMap.from(compareHeroIds, [
          [KEY, CommitmentState.Committed],
          [SECOND, CommitmentState.Committed]
        ])
      })
    })
  );

  return aState({
    heroes: SortedMap.from(compareHeroIds, [
      [
        KEY,
        aHero({
          id: KEY,
          definition: ids.bram,
          role: CombatRole.Vanguard,
          combat: SOLID,
          // A bond over the threshold `BOND_STRONG` names, so this crew is one the forecast
          // has something to say about (`COMBAT_SPEC` §7.3, §13.2 п.3). Without it the
          // fixture would be a crew of two strangers, and the one line the forecast
          // vocabulary exists for would have nothing to fire on.
          relationships: SortedMap.from<ContentId, number>(compareContentIds, [[ids.doran, 14]])
        })
      ],
      [SECOND, aHero({ id: SECOND, definition: ids.doran, role: CombatRole.Rear, combat: SOLID })]
    ]),
    contracts: SortedMap.from(compareContentIds, [[contract.id, contract]])
  });
}

const at = (row: 1 | 2 | 3, column: 1 | 2 | 3): Cell => ({ row, column });

/** The campaign one command before the fight: crew placed, nothing resolved. */
export function placedCampaign(): GameState {
  const start = campaign();
  const placed = placeCrew(start, {
    commandId: 1,
    contractId: aContract().id,
    expectedStateVersion: start.metadata.stateVersion,
    placement: [
      { hero: KEY, cell: at(1, 1) },
      { hero: SECOND, cell: at(3, 2) }
    ],
    doctrine: DoctrineId.HoldTheLine,
    retreatBelowPercent: 0
  });

  if (placed.rejectionCode !== null) {
    throw new Error(`placeCrew was refused: ${placed.rejectionCode}`);
  }

  return placed.state;
}

export function fought(): {
  readonly state: GameState;
  readonly contractId: ContentId;
} {
  const start = campaign();
  const contractId = aContract().id;

  const placed = placeCrew(start, {
    commandId: 1,
    contractId,
    expectedStateVersion: start.metadata.stateVersion,
    placement: [
      { hero: KEY, cell: at(1, 1) },
      { hero: SECOND, cell: at(3, 2) }
    ],
    doctrine: DoctrineId.HoldTheLine,
    retreatBelowPercent: 0
  });

  if (placed.rejectionCode !== null) {
    throw new Error(`placeCrew was refused: ${placed.rejectionCode}`);
  }

  const resolved = resolveContract(placed.state, {
    commandId: 2,
    contractId,
    expectedStateVersion: placed.state.metadata.stateVersion,
    retreatAtRound: null
  });

  if (resolved.rejectionCode !== null) {
    throw new Error(`resolveContract was refused: ${resolved.rejectionCode}`);
  }

  return { state: resolved.state, contractId };
}

/**
 * The other half of the pair: a campaign whose contract came back with **no** battle.
 *
 * `ADR-016` §5 routes a contract with no authored plan to the abstract resolver, and the
 * battle screen has to say "there is nothing here to watch" about it — a different sentence
 * from "the fight has not started". One helper beside the other so the two campaigns are
 * built the same way and differ in the one thing under test.
 */
export function resolvedWithoutBattle(): {
  readonly state: GameState;
  readonly contractId: ContentId;
} {
  const hero = aHero({ id: KEY, role: CombatRole.Vanguard, combat: SOLID });

  return {
    state: aResolvedCampaign({
      heroes: [hero],
      contracts: [
        aCrewedContract({
          id: ids.caravan,
          risk: 0,
          needs: [
            [NeedId.Frontline, 40],
            [NeedId.Wilderness, 40]
          ],
          crew: [{ hero, commitment: CommitmentState.Committed }]
        })
      ]
    }),
    contractId: ids.caravan
  };
}
