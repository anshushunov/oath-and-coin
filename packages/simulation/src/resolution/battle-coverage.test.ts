import { describe, expect, it } from 'vitest';

import { SortedMap } from '../collections/sorted-map.ts';
import type { BattleEvent, BattleOutcome as BattleOutcomeType } from '../domain/battle-event.ts';
import { BattleOutcome } from '../domain/battle-event.ts';
import type { BattleObjective } from '../domain/battle-objective.ts';
import type { BattleRecord } from '../domain/battle-record.ts';
import { compareNeedIds, NeedId } from '../domain/need-id.ts';
import { CombatRole } from '../domain/combat-role.ts';
import { CoverageVerdict } from '../domain/outcome.ts';
import { heroId } from '../ids/hero-id.ts';

import { runBattle, startBattle } from '../combat/battle.ts';
import { DoctrineId } from '../combat/doctrine.ts';
import { unitFrom, type BattleUnit } from '../combat/unit.ts';

import { objectiveCoverage } from './battle-coverage.ts';

/**
 * `COMBAT_SPEC` §6.2.1: a battle produces `supplied`, and it produces it **through
 * increments that were credited to somebody** rather than by measuring progress and
 * attributing it afterwards.
 *
 * The equality `supplied === Σ counted` is what the debrief screen adds up by hand
 * (`DEC-014`), so a row where it does not hold is a number nobody can explain. It is the
 * first thing asked of this module and the reason the module is shaped the way it is.
 */

const AVERAGE = { might: 50, guard: 50, aim: 50, focus: 50, care: 50 };

const needs = (entries: readonly (readonly [NeedId, number])[]) =>
  SortedMap.from(compareNeedIds, entries);

const objectives = (entries: readonly (readonly [NeedId, BattleObjective])[]) =>
  SortedMap.from(compareNeedIds, entries);

function crewman(id: string, hero: number, row: 1 | 2 | 3, column: 1 | 2 | 3): BattleUnit {
  return unitFrom({
    id,
    side: 'crew',
    hero: heroId(hero),
    role: row === 3 ? CombatRole.Rear : CombatRole.Vanguard,
    cell: { row, column },
    combat: { ...AVERAGE, might: 100, aim: 100 }
  });
}

function foe(id: string, column: 1 | 2 | 3, health = 1): BattleUnit {
  return {
    ...unitFrom({
      id,
      side: 'foe',
      hero: null,
      role: CombatRole.Vanguard,
      cell: { row: 1, column },
      combat: { ...AVERAGE, might: 0 }
    }),
    health
  };
}

describe('a battle produces supplied through increments, and the sum closes', () => {
  it('splits a subduing between the men who did it, remainder to the lowest id', () => {
    // `required` is 100 over three targets: 33 each and one point left over. The leftover
    // has to land somewhere stated, or two runs of the same battle disagree about a point.
    const record = runBattle(
      startBattle(
        [
          crewman('crew:a', 0, 1, 1),
          crewman('crew:b', 1, 1, 2),
          foe('foe:x', 1),
          foe('foe:y', 2),
          foe('foe:z', 3)
        ],
        DoctrineId.HoldTheLine
      )
    );

    const [row] = objectiveCoverage({
      record,
      needs: needs([[NeedId.Frontline, 100]]),
      objectives: objectives([
        [NeedId.Frontline, { kind: 'subdue', targets: ['foe:x', 'foe:y', 'foe:z'] }]
      ]),
      risk: 0
    });

    expect(row).toBeDefined();
    expect(row?.required).toBe(100);
    expect(row?.contributors.reduce((sum, one) => sum + one.counted, 0)).toBe(row?.supplied);
    // Exactly the requirement, and that is the half a sum-closes assertion cannot see: a
    // finished job that supplies 99 of 100 reads as short on the debrief for no reason a
    // player could act on, and a check that only asked "the columns add up" is green on it.
    // A live mutant found this — dropping the leftover left all eleven cases passing.
    expect(row?.supplied).toBe(100);
    // Two of the three fell to the first man and one to the second: 33 + 33 and 33, plus
    // the leftover point on the lowest id.
    expect(row?.contributors.map((one) => one.counted)).toEqual([67, 33]);
  });

  it('reads the verdict with the contract loop’s own threshold, not a scale of its own', () => {
    // §6.2: the battle produces `supplied`; `closed`/`weak`/`uncovered` are read off it by
    // the same function coverage already uses. A battle that invented its own three words
    // would give the debrief screen two scales to reconcile.
    const record = runBattle(
      startBattle([crewman('crew:a', 0, 1, 1), foe('foe:x', 1)], DoctrineId.HoldTheLine)
    );

    const [row] = objectiveCoverage({
      record,
      needs: needs([[NeedId.Frontline, 40]]),
      objectives: objectives([[NeedId.Frontline, { kind: 'subdue', targets: ['foe:x'] }]]),
      risk: 0
    });

    expect(row?.verdict).toBe(CoverageVerdict.Closed);
    expect(row?.supplied).toBe(40);
  });

  it('counts what the shooter did as his amount, and what closed the need as his counted', () => {
    const record = runBattle(
      startBattle([crewman('crew:a', 0, 1, 1), foe('foe:x', 1, 4)], DoctrineId.HoldTheLine)
    );

    const [row] = objectiveCoverage({
      record,
      needs: needs([[NeedId.Frontline, 40]]),
      objectives: objectives([[NeedId.Frontline, { kind: 'subdue', targets: ['foe:x'] }]]),
      risk: 0
    });

    const contributor = row?.contributors.find((one) => one.hero === heroId(0));

    // What he personally did to the targets — raw battle damage, the `amount` of §6.2.1 —
    // and what it bought toward the need. Two different numbers on purpose (`DEC-014`).
    expect(contributor?.amount).toBeGreaterThan(0);
    expect(contributor?.counted).toBe(40);
  });

  it('lists every hero of the crew, including the one who did nothing', () => {
    const record = runBattle(
      startBattle(
        [crewman('crew:a', 0, 1, 1), crewman('crew:idle', 7, 3, 3), foe('foe:x', 1)],
        DoctrineId.HoldTheLine
      )
    );

    const [row] = objectiveCoverage({
      record,
      needs: needs([[NeedId.Frontline, 40]]),
      objectives: objectives([[NeedId.Frontline, { kind: 'subdue', targets: ['foe:x'] }]]),
      risk: 0
    });

    expect(row?.contributors.map((one) => one.hero)).toEqual([heroId(0), heroId(7)]);
  });
});

/**
 * §6.2.2's table, one cell at a time: what each kind supplies under each way a battle can
 * end.
 *
 * Built by hand rather than fought for, because the point is the *ending* and a real battle
 * cannot be told to end four different ways from one board. The record is the whole input
 * to this module, so a hand-built one exercises exactly what a fought one would.
 */
describe('what each kind supplies, by the way the battle ended (§6.2.2)', () => {
  const stood = (rounds: number): BattleEvent[] =>
    Array.from({ length: rounds }, (_unused, index) => [
      { kind: 'round_started', round: index + 1 } as BattleEvent,
      { kind: 'round_ended', round: index + 1 } as BattleEvent
    ]).flat();

  function recordOf(
    outcome: BattleOutcomeType,
    rounds: number,
    units: readonly BattleUnit[],
    extra: readonly BattleEvent[] = []
  ): BattleRecord {
    const state = { round: rounds, units, doctrine: DoctrineId.HoldTheLine, outcome };

    return {
      initial: { ...state, round: 0, outcome: null },
      final: state,
      events: [...extra, ...stood(rounds)],
      rounds,
      outcome,
      retreatSignalledAtRound: null
    };
  }

  const alive = crewman('crew:a', 0, 1, 1);
  const wardUnit = {
    ...unitFrom({
      id: 'ward:cart',
      side: 'crew' as const,
      hero: null,
      role: CombatRole.Support,
      cell: { row: 3, column: 2 },
      combat: { ...AVERAGE, guard: 0 }
    })
  };

  const holdOf = (rounds: number) => objectives([[NeedId.Frontline, { kind: 'hold', rounds }]]);

  it('hold: a crew that won by elimination is credited the rounds it never had to fight', () => {
    // §6.2.2: "оставшиеся раунды засчитываются целиком: оспаривать рубеж больше некому".
    const record = recordOf(BattleOutcome.CrewStanding, 2, [alive]);

    const [row] = objectiveCoverage({
      record,
      needs: needs([[NeedId.Frontline, 60]]),
      objectives: holdOf(6),
      risk: 0
    });

    expect(row?.supplied).toBe(60);
    expect(row?.verdict).toBe(CoverageVerdict.Closed);
  });

  it('hold: a timeout is credited what was actually stood through, and no more', () => {
    const record = recordOf(BattleOutcome.TimedOut, 3, [alive]);

    const [row] = objectiveCoverage({
      record,
      needs: needs([[NeedId.Frontline, 60]]),
      objectives: holdOf(6),
      risk: 0
    });

    expect(row?.supplied).toBe(30);
    expect(row?.verdict).toBe(CoverageVerdict.Uncovered);
  });

  it('hold: a retreat freezes the progress where it stood', () => {
    const record = recordOf(BattleOutcome.Retreated, 4, [alive]);

    const [row] = objectiveCoverage({
      record,
      needs: needs([[NeedId.Frontline, 60]]),
      objectives: holdOf(6),
      risk: 0
    });

    expect(row?.supplied).toBe(40);
  });

  it('hold: standing past the rounds asked for supplies the requirement and stops', () => {
    const record = recordOf(BattleOutcome.TimedOut, 9, [alive]);

    const [row] = objectiveCoverage({
      record,
      needs: needs([[NeedId.Frontline, 60]]),
      objectives: holdOf(6),
      risk: 0
    });

    expect(row?.supplied).toBe(60);
  });

  it('protect: what the ward has left, and nothing about how the battle ended', () => {
    const half = { ...wardUnit, health: 10 };
    const record = recordOf(BattleOutcome.FoesStanding, 3, [alive, half]);

    const [row] = objectiveCoverage({
      record,
      needs: needs([[NeedId.Frontline, 100]]),
      objectives: objectives([[NeedId.Frontline, { kind: 'protect', ward: 'ward:cart' }]]),
      risk: 0
    });

    // 100 over a `maxHealth` of 20 is five points of requirement per point of health, and
    // the ward came back with ten of them.
    expect(wardUnit.maxHealth).toBe(20);
    expect(row?.supplied).toBe(50);
    expect(row?.contributors.reduce((sum, one) => sum + one.counted, 0)).toBe(row?.supplied);
  });

  it('protect: a ward who was knocked down supplies nothing', () => {
    const down = { ...wardUnit, health: 0, standing: false };
    const record = recordOf(BattleOutcome.FoesStanding, 3, [alive, down]);

    const [row] = objectiveCoverage({
      record,
      needs: needs([[NeedId.Frontline, 100]]),
      objectives: objectives([[NeedId.Frontline, { kind: 'protect', ward: 'ward:cart' }]]),
      risk: 0
    });

    expect(row?.supplied).toBe(0);
    expect(row?.verdict).toBe(CoverageVerdict.Uncovered);
  });

  it('protect: help from somebody who is not a hero still lands on a hero’s line', () => {
    // A second ward doing the healing. `heroOf(...) === null` used to mean both "not a hero"
    // and "nobody helped", so this case fell through to the equal split — and the debrief
    // credited two heroes with keeping a cart alive that a medic had kept alive. The share
    // goes where §6.2.1 puts every increment nobody in the crew earned: the lowest id.
    const half = { ...wardUnit, health: 10 };
    const second = crewman('crew:b', 1, 1, 2);
    const record = recordOf(
      BattleOutcome.TimedOut,
      3,
      [alive, second, half],
      [
        {
          kind: 'healing_done',
          actor: 'ward:medic',
          target: 'ward:cart',
          amount: 6,
          provenance: { base: 6, steps: [], final: 6 }
        }
      ]
    );

    const [row] = objectiveCoverage({
      record,
      needs: needs([[NeedId.Frontline, 100]]),
      objectives: objectives([[NeedId.Frontline, { kind: 'protect', ward: 'ward:cart' }]]),
      risk: 0
    });

    // Fifty of a hundred: half of it proportional to help nobody in the crew gave, and half
    // split between the two who were standing. 25 + 25/2 each, and the leftover on the
    // lowest id — 38 and 12 rather than the 25/25 an equal split would produce.
    expect(row?.supplied).toBe(50);
    expect(row?.contributors.map((one) => one.counted)).toEqual([38, 12]);
    expect(row?.contributors.reduce((sum, one) => sum + one.counted, 0)).toBe(row?.supplied);
  });

  it('subdue: only the targets that went down count, whoever else fell', () => {
    const record = recordOf(
      BattleOutcome.TimedOut,
      4,
      [alive],
      [
        { kind: 'unit_downed', unit: 'foe:x', by: 'crew:a' },
        { kind: 'unit_downed', unit: 'foe:other', by: 'crew:a' }
      ]
    );

    const [row] = objectiveCoverage({
      record,
      needs: needs([[NeedId.Frontline, 90]]),
      objectives: objectives([
        [NeedId.Frontline, { kind: 'subdue', targets: ['foe:x', 'foe:y', 'foe:z'] }]
      ]),
      risk: 0
    });

    expect(row?.supplied).toBe(30);
  });
});
