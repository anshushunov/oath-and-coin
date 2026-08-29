import { describe, expect, it } from 'vitest';

import { SortedMap } from '../collections/sorted-map.ts';
import { SortedSet } from '../collections/sorted-set.ts';
import type { BattleObjective } from '../domain/battle-objective.ts';
import { CommitmentState } from '../domain/commitment.ts';
import { CombatRole } from '../domain/combat-role.ts';
import type { ContractBattlePlan } from '../domain/contract-battle-plan.ts';
import type { Deployment } from '../domain/deployment.ts';
import { DoctrineId } from '../domain/doctrine-id.ts';
import { NeedId, compareNeedIds } from '../domain/need-id.ts';
import { ConsequenceKind, OutcomeIntentKind } from '../domain/outcome.ts';
import { OutcomeReasonCodes } from '../domain/outcome-reason-codes.ts';
import { compareContentIds } from '../ids/content-id.ts';
import { compareHeroIds, heroId, type HeroId } from '../ids/hero-id.ts';
import type { Cell } from '../domain/battle-cell.ts';
import { ContractStatus } from '../state/contract-state.ts';
import { OfferPhase, createContractState } from '../state/offer-state.ts';
import { placeCrew, resolveContract } from '../engine.ts';
import type { GameState } from '../state/game-state.ts';
import { aContract, aHero, anOffer, aState } from '../testing/fixtures.ts';

import { RejectionCodes } from '../commands/command-result.ts';

import { DEPLOYMENT_REQUIRED, WOUND_DOWNED, battleResolver } from './battle-resolver.ts';
import { draftResolution, type ResolutionInput } from './contract-resolver.ts';
import { goesToBattle, resolverFor } from './routing.ts';

/**
 * `ADR-016` — the second resolver: what it refuses, what it produces, and the two
 * properties that keep the first one out of its way.
 */

const KEY: HeroId = heroId(0);
const SECOND: HeroId = heroId(1);

const STRONG = { might: 90, guard: 70, aim: 90, focus: 60, care: 40 };
const FRAIL = { might: 10, guard: 0, aim: 10, focus: 10, care: 0 };

function plan(): ContractBattlePlan {
  return {
    objectives: SortedMap.from<NeedId, BattleObjective>(compareNeedIds, [
      [NeedId.Frontline, { kind: 'subdue', targets: ['foe:a'] }],
      [NeedId.Wilderness, { kind: 'hold', rounds: 3 }]
    ]),
    foes: [
      { id: 'foe:a', role: CombatRole.Vanguard, cell: { row: 1, column: 1 }, combat: FRAIL },
      { id: 'foe:b', role: CombatRole.Vanguard, cell: { row: 1, column: 3 }, combat: FRAIL }
    ],
    wards: []
  };
}

function contract(battle: ContractBattlePlan | null = plan()) {
  const crew = SortedSet.from(compareHeroIds, [KEY, SECOND]);

  return createContractState(
    aContract({
      requiredCrew: 2,
      risk: 0,
      needs: SortedMap.from<NeedId, number>(compareNeedIds, [
        [NeedId.Frontline, 40],
        [NeedId.Wilderness, 30]
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
    })
  );
}

const placement = (cells: readonly [HeroId, Cell][]) =>
  SortedMap.from<HeroId, Cell>(compareHeroIds, cells);

function deployment(overrides: Partial<Deployment> = {}): Deployment {
  return {
    plan: plan(),
    crew: {
      placement: placement([
        [KEY, { row: 1, column: 1 }],
        [SECOND, { row: 3, column: 2 }]
      ]),
      doctrine: DoctrineId.HoldTheLine,
      retreatBelowPercent: 0
    },
    retreatSignalledAtRound: null,
    ...overrides
  };
}

function input(overrides: Partial<ResolutionInput> = {}): ResolutionInput {
  return {
    contract: contract(),
    crew: [
      {
        hero: aHero({
          id: KEY,
          role: CombatRole.Vanguard,
          combat: STRONG,
          capability: {
            grade: 80,
            expertise: SortedMap.from<NeedId, number>(compareNeedIds, [[NeedId.Frontline, 80]])
          }
        }),
        commitment: CommitmentState.Committed
      },
      {
        hero: aHero({
          id: SECOND,
          role: CombatRole.Rear,
          combat: STRONG,
          capability: {
            grade: 80,
            expertise: SortedMap.from<NeedId, number>(compareNeedIds, [[NeedId.Wilderness, 80]])
          }
        }),
        commitment: CommitmentState.Committed
      }
    ],
    deployment: deployment(),
    ...overrides
  };
}

/** The campaign a `resolveContract` is applied to: this contract, this crew, placed. */
function campaignOf(subject: ReturnType<typeof contract>): GameState {
  const heroes = SortedMap.from(compareHeroIds, [
    [KEY, aHero({ id: KEY, role: CombatRole.Vanguard, combat: STRONG })],
    [SECOND, aHero({ id: SECOND, role: CombatRole.Rear, combat: STRONG })]
  ]);

  const state = aState({
    heroes,
    contracts: SortedMap.from(compareContentIds, [[subject.id, subject]])
  });

  if (subject.battle === null) {
    return state;
  }

  const placed = placeCrew(state, {
    commandId: 1,
    contractId: subject.id,
    expectedStateVersion: state.metadata.stateVersion,
    placement: [
      { hero: KEY, cell: { row: 1, column: 1 } },
      { hero: SECOND, cell: { row: 3, column: 2 } }
    ],
    doctrine: DoctrineId.HoldTheLine,
    retreatBelowPercent: 0
  });

  if (placed.rejectionCode !== null) {
    throw new Error(`placeCrew was refused: ${placed.rejectionCode}`);
  }

  return placed.state;
}

const resolveWith = (state: GameState, retreatAtRound: number | null) =>
  resolveContract(state, {
    commandId: 9,
    contractId: aContract().id,
    expectedStateVersion: state.metadata.stateVersion,
    retreatAtRound
  });

describe('the battle resolver refuses what it cannot honestly answer', () => {
  it('names deployment_required rather than inventing a formation', () => {
    const { deployment: _dropped, ...withoutDeployment } = input();

    expect(() => battleResolver(withoutDeployment)).toThrow(new RegExp(DEPLOYMENT_REQUIRED, 'u'));
  });
});

describe('what a battle answers with (ADR-016 §1, §4)', () => {
  it('fills the contract’s own coverage table and stores the battle beside it', () => {
    const draft = battleResolver(input());

    expect(draft.resolution.coverage.map((row) => row.need)).toEqual([
      NeedId.Frontline,
      NeedId.Wilderness
    ]);
    expect(draft.resolution.battle).not.toBeNull();
    expect(draft.resolution.battle?.events.at(0)?.kind).toBe('battle_started');
    // The equality the debrief adds up by hand (`DEC-014`), on every row a battle produces.
    for (const row of draft.resolution.coverage) {
      expect(row.contributors.reduce((sum, one) => sum + one.counted, 0)).toBe(row.supplied);
    }
  });

  it('closes with `contract_resolved`, as both resolvers must (RESOLUTION_SPEC §3.3)', () => {
    const draft = battleResolver(input());

    expect(draft.intents.at(-1)?.kind).toBe(OutcomeIntentKind.ContractResolved);
  });

  it('wounds the men the battle actually knocked down, and nobody else (§6.5)', () => {
    // A crew of two paper men against two who hit hard: whoever falls, falls because the
    // battle says so rather than because a grade allotted a casualty.
    const draft = battleResolver(
      input({
        crew: input().crew.map((member) => ({
          ...member,
          hero: { ...member.hero, combat: FRAIL }
        })),
        deployment: deployment({
          plan: {
            ...plan(),
            foes: [
              {
                id: 'foe:a',
                role: CombatRole.Vanguard,
                cell: { row: 1, column: 1 },
                combat: STRONG
              },
              {
                id: 'foe:b',
                role: CombatRole.Vanguard,
                cell: { row: 1, column: 2 },
                combat: STRONG
              }
            ]
          }
        })
      })
    );

    const wounds = draft.resolution.consequences.filter(
      (one) => one.kind === ConsequenceKind.Wound
    );
    const downed = new Set(
      draft.resolution.battle?.events
        .filter((event) => event.kind === 'unit_downed')
        .map((event) => (event.kind === 'unit_downed' ? event.unit : ''))
    );

    expect(wounds.length).toBeGreaterThan(0);
    expect(wounds.every((one) => one.magnitude === WOUND_DOWNED)).toBe(true);
    expect(wounds.length).toBe([...downed].filter((id) => id.startsWith('crew:')).length);
  });

  it('costs every hero who moved when the player pulls the lever (DEC-005, §6.5)', () => {
    const draft = battleResolver(input({ deployment: deployment({ retreatSignalledAtRound: 2 }) }));

    const retreats = draft.resolution.consequences.filter(
      (one) => one.kind === ConsequenceKind.Retreat
    );

    expect(draft.resolution.battle?.outcome).toBe('retreated');
    expect(retreats.map((one) => one.hero).sort(compareHeroIds)).toEqual([KEY, SECOND]);
  });

  it('names the geometry on a line the geometry explains (§6.4 п.2)', () => {
    // Held to the end and the objective closed: the line says so rather than repeating the
    // verdict, which is what "код геометрии на need_short" asks for from the other side.
    const draft = battleResolver(input());
    const held = draft.intents.find(
      (intent) =>
        intent.kind === OutcomeIntentKind.NeedCovered &&
        intent.reason === OutcomeReasonCodes.HeldTheLine
    );

    expect(held).toBeDefined();
  });
});

describe('the lever is checked before it reaches the battle (COMBAT_SPEC §11)', () => {
  it('refuses a round below one — a signal given before the fight began', () => {
    const state = campaignOf(contract());

    // `0` is not "the first round". Taken as one, the record comes back carrying
    // `retreatSignalledAtRound: 0`, which this build's own save codec refuses (`min(1)`) —
    // an engine producing a campaign it cannot store. Found by external review.
    expect(resolveWith(state, 0).rejectionCode).toBe(RejectionCodes.RetreatSignalNotPossible);
    expect(resolveWith(state, 1.5).rejectionCode).toBe(RejectionCodes.RetreatSignalNotPossible);
  });

  it('refuses a signal on a contract that never goes to a fight', () => {
    const state = campaignOf(contract(null));

    expect(resolveWith(state, 2).rejectionCode).toBe(RejectionCodes.RetreatSignalNotPossible);
    // And accepts the absence of one on the same contract, so the refusal above is about
    // the signal rather than about the contract.
    expect(resolveWith(state, null).rejectionCode).toBeNull();
  });

  it('changes nothing at all when it refuses', () => {
    const state = campaignOf(contract());

    expect(Object.is(resolveWith(state, 0).state, state)).toBe(true);
  });
});

describe('the two properties that keep the resolvers out of each other’s way', () => {
  it('the abstract resolver does not read `deployment` at all (§12.1 п.8)', () => {
    // **Weights of 100 and not the fixture's 40 and 30**, and a live mutant is why. A
    // resolver reading the formation would most plausibly do it by nudging one of the
    // numbers the coverage arithmetic already takes; at a weight of 40 a nudge of one point
    // to `risk` truncates away in `weight × (100 + risk) / 100` and the check stayed green
    // over a resolver that was reading the formation. At a hundred, a point is a point.
    const sensitive = (over: Partial<Deployment> = {}): ResolutionInput => ({
      ...input(),
      contract: {
        ...contract(),
        needs: SortedMap.from<NeedId, number>(compareNeedIds, [
          [NeedId.Frontline, 100],
          [NeedId.Wilderness, 100]
        ])
      },
      deployment: deployment(over)
    });
    const { deployment: _dropped, ...bare } = sensitive();
    const answer = JSON.stringify(draftResolution(bare));

    // **Several formations, each moving one thing**, and a second live mutant is why. The
    // first version compared one formation against none, and every field of that formation
    // happened to be nought or a default — so `risk + (deployment?.crew.retreatBelowPercent
    // ?? 0)` read the formation, added nothing on both inputs, and survived. Each entry
    // below moves one field a resolver could plausibly reach for.
    const varied: readonly Partial<Deployment>[] = [
      {},
      { crew: { ...deployment().crew, retreatBelowPercent: 1 } },
      { crew: { ...deployment().crew, doctrine: DoctrineId.BreakThemFirst } },
      {
        crew: {
          ...deployment().crew,
          placement: placement([
            [KEY, { row: 2, column: 3 }],
            [SECOND, { row: 1, column: 1 }]
          ])
        }
      },
      { retreatSignalledAtRound: 1 },
      { plan: { ...plan(), foes: plan().foes.slice(0, 1) } }
    ];

    for (const over of varied) {
      expect(JSON.stringify(draftResolution(sensitive(over))), JSON.stringify(over)).toBe(answer);
    }

    expect(draftResolution(sensitive()).resolution.battle).toBeNull();
  });

  it('routes by the contract, before the crew is sent (ADR-014 §1)', () => {
    expect(goesToBattle(contract())).toBe(true);
    expect(goesToBattle(contract(null))).toBe(false);
    expect(resolverFor(contract(null))).toBe(draftResolution);
    expect(resolverFor(contract())).toBe(battleResolver);
  });

  it('is deterministic, and independent of the order the crew was assembled in', () => {
    const forward = battleResolver(input());
    const backward = battleResolver(input({ crew: [...input().crew].reverse() }));

    expect(JSON.stringify(forward.resolution.battle?.events)).toBe(
      JSON.stringify(backward.resolution.battle?.events)
    );
  });
});
