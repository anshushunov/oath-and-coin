import { describe, expect, it } from 'vitest';

import { SortedMap } from '../collections/sorted-map.ts';
import { SortedSet } from '../collections/sorted-set.ts';
import { BOND_STRONG } from '../combat/decision.ts';
import type { BattleObjective } from '../domain/battle-objective.ts';
import type { Cell } from '../domain/battle-cell.ts';
import { CommitmentState } from '../domain/commitment.ts';
import { CombatRole } from '../domain/combat-role.ts';
import type { ContractBattlePlan } from '../domain/contract-battle-plan.ts';
import type { Deployment } from '../domain/deployment.ts';
import { DoctrineId } from '../domain/doctrine-id.ts';
import { FORECAST_REASON_CODES, ForecastReasonCodes } from '../domain/forecast-reason-codes.ts';
import { NeedId, compareNeedIds } from '../domain/need-id.ts';
import { CoverageVerdict } from '../domain/outcome.ts';
import { compareContentIds, parseContentId } from '../ids/content-id.ts';
import { compareHeroIds, heroId, type HeroId } from '../ids/hero-id.ts';
import { ContractStatus } from '../state/contract-state.ts';
import { OfferPhase, createContractState } from '../state/offer-state.ts';
import { aContract, aHero, anOffer } from '../testing/fixtures.ts';

import type { ResolutionInput } from './contract-resolver.ts';
import { forecastReadiness } from './forecast.ts';

/**
 * `COMBAT_SPEC` §10.1 and §13.2 п.3 — what a plan says about itself before the crew is
 * sent, and the one line the whole control of `DIRECTION_2026-08` §4.8 needs to exist.
 */

const KEY: HeroId = heroId(0);
const FRIEND: HeroId = heroId(1);

const AVERAGE = { might: 50, guard: 50, aim: 50, focus: 50, care: 50 };

const KEY_DEFINITION = parseContentId('core:key_hero');
const FRIEND_DEFINITION = parseContentId('core:friend_hero');

function plan(): ContractBattlePlan {
  return {
    objectives: SortedMap.from<NeedId, BattleObjective>(compareNeedIds, [
      [NeedId.Frontline, { kind: 'subdue', targets: ['foe:a'] }],
      [NeedId.Wilderness, { kind: 'hold', rounds: 3 }]
    ]),
    foes: [
      { id: 'foe:a', role: CombatRole.Vanguard, cell: { row: 1, column: 1 }, combat: AVERAGE },
      { id: 'foe:b', role: CombatRole.Vanguard, cell: { row: 1, column: 2 }, combat: AVERAGE },
      { id: 'foe:c', role: CombatRole.Rear, cell: { row: 3, column: 2 }, combat: AVERAGE }
    ],
    wards: []
  };
}

function contract() {
  const crew = SortedSet.from(compareHeroIds, [KEY, FRIEND]);

  return createContractState(
    aContract({
      requiredCrew: 2,
      risk: 0,
      needs: SortedMap.from<NeedId, number>(compareNeedIds, [
        [NeedId.Frontline, 40],
        [NeedId.Wilderness, 40]
      ]),
      battle: plan(),
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

function deployment(cells: readonly (readonly [HeroId, Cell])[]): Deployment {
  return {
    plan: plan(),
    crew: {
      placement: SortedMap.from<HeroId, Cell>(compareHeroIds, cells),
      doctrine: DoctrineId.HoldTheLine,
      retreatBelowPercent: 0
    },
    retreatSignalledAtRound: null
  };
}

interface CrewSpec {
  readonly bond?: number;
  readonly expertise?: readonly (readonly [NeedId, number])[];
}

function input(
  cells: readonly (readonly [HeroId, Cell])[] | null,
  key: CrewSpec = {},
  friend: CrewSpec = {}
): ResolutionInput {
  const member = (
    id: HeroId,
    definition: typeof KEY_DEFINITION,
    towards: typeof KEY_DEFINITION,
    spec: CrewSpec
  ) => ({
    hero: aHero({
      id,
      definition,
      capability: {
        grade: 100,
        expertise: SortedMap.from<NeedId, number>(compareNeedIds, spec.expertise ?? [])
      },
      relationships:
        spec.bond === undefined
          ? SortedMap.empty<typeof KEY_DEFINITION, number>(compareContentIds)
          : SortedMap.from(compareContentIds, [[towards, spec.bond]])
    }),
    commitment: CommitmentState.Committed
  });

  return {
    contract: contract(),
    crew: [
      member(KEY, KEY_DEFINITION, FRIEND_DEFINITION, key),
      member(FRIEND, FRIEND_DEFINITION, KEY_DEFINITION, friend)
    ],
    ...(cells === null ? {} : { deployment: deployment(cells) })
  };
}

const codesOf = (cells: Parameters<typeof input>[0], key?: CrewSpec, friend?: CrewSpec) =>
  forecastReadiness(input(cells, key, friend)).reasons.map((reason) => reason.code);

describe('a forecast says what the plan is risking, and names no number (DEC-006)', () => {
  it('prints the same three words the debrief will, for the same objectives', () => {
    const forecast = forecastReadiness(
      input(
        [
          [KEY, { row: 1, column: 1 }],
          [FRIEND, { row: 1, column: 2 }]
        ],
        { expertise: [[NeedId.Frontline, 100]] }
      )
    );

    expect(forecast.objectives.map((one) => one.need)).toEqual([
      NeedId.Frontline,
      NeedId.Wilderness
    ]);
    expect(forecast.objectives[0]?.verdict).toBe(CoverageVerdict.Closed);
    expect(forecast.objectives[1]?.verdict).toBe(CoverageVerdict.Uncovered);
  });

  it('names an open column of the crew’s own board', () => {
    // Column 3 has nobody in its front cell, and neither does column 2 — the sentence a
    // player has to understand on his first battle (`COMBAT_SPEC` §4.5).
    const reasons = forecastReadiness(
      input([
        [KEY, { row: 1, column: 1 }],
        [FRIEND, { row: 3, column: 1 }]
      ])
    ).reasons.filter((one) => one.code === ForecastReasonCodes.OpenColumn);

    expect(reasons.map((one) => one.column)).toEqual([2, 3]);
  });

  it('names a hero who will be firing through his own men', () => {
    const reasons = forecastReadiness(
      input([
        [KEY, { row: 1, column: 1 }],
        [FRIEND, { row: 3, column: 1 }]
      ])
    ).reasons.filter((one) => one.code === ForecastReasonCodes.RearBehindOwnMen);

    expect(reasons.map((one) => one.hero)).toEqual([FRIEND]);
  });

  it('says nothing about columns when nobody has been placed yet', () => {
    expect(codesOf(null)).not.toContain(ForecastReasonCodes.OpenColumn);
  });

  it('ranks by a stated order rather than by a score', () => {
    const codes = codesOf([
      [KEY, { row: 1, column: 1 }],
      [FRIEND, { row: 3, column: 1 }]
    ]);

    const ranks = codes.map((code) => FORECAST_REASON_CODES.indexOf(code));

    expect(ranks).toEqual([...ranks].sort((left, right) => left - right));
  });
});

describe('the line the control of DIRECTION §4.8 needs (COMBAT_SPEC §13.2 п.3)', () => {
  const cells: readonly (readonly [HeroId, Cell])[] = [
    [KEY, { row: 1, column: 1 }],
    [FRIEND, { row: 1, column: 2 }]
  ];

  it('names the bond as a factor **before** the crew is sent', () => {
    const forecast = forecastReadiness(input(cells, { bond: BOND_STRONG }));
    const bond = forecast.reasons.find(
      (one) => one.code === ForecastReasonCodes.BondMayBreakTheDoctrine
    );

    expect(bond).toBeDefined();
    expect(bond?.hero).toBe(KEY);
  });

  it('does not name a bond too thin to break anything', () => {
    expect(codesOf(cells, { bond: BOND_STRONG - 1 })).not.toContain(
      ForecastReasonCodes.BondMayBreakTheDoctrine
    );
  });

  it('does not name a bond toward somebody who stayed home', () => {
    // The same weight, pointing at a hero this crew does not contain. A warning about a man
    // who is not there is a warning a player cannot act on.
    const towardsAStranger: ResolutionInput = (() => {
      const built = input(cells, { bond: BOND_STRONG });

      return {
        ...built,
        crew: built.crew.map((member, index) =>
          index === 0
            ? {
                ...member,
                hero: {
                  ...member.hero,
                  relationships: SortedMap.from(compareContentIds, [
                    [parseContentId('core:somebody_else'), BOND_STRONG]
                  ])
                }
              }
            : member
        )
      };
    })();

    expect(forecastReadiness(towardsAStranger).reasons.map((one) => one.code)).not.toContain(
      ForecastReasonCodes.BondMayBreakTheDoctrine
    );
  });
});
