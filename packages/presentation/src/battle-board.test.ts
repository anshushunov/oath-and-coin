import {
  CombatRole,
  DoctrineId,
  StatusId,
  heroId,
  runBattle,
  startBattle,
  unitFrom,
  type BattleRecord,
  type BattleUnit,
  type Cell,
  type HeroCombatLayer
} from '@oath-and-coin/simulation';
import { describe, expect, it } from 'vitest';

import { boardAfter } from './battle-board.ts';

/**
 * What holds the fold honest: **the board it lands on has to be the board the battle ended
 * on**, over real battles rather than over a list of events somebody typed.
 *
 * This is also a check on the event vocabulary itself. `COMBAT_SPEC` §8.1 says a battle can
 * be replayed from its events; if the fold cannot reach `record.final` then that is false,
 * and the honest place to find out is here rather than on a screen that drifts a token at a
 * time over a long fight.
 */

const at = (row: 1 | 2 | 3, column: 1 | 2 | 3): Cell => ({ row, column });

const STRONG: HeroCombatLayer = { might: 90, guard: 70, aim: 80, focus: 70, care: 60 };
const SOFT: HeroCombatLayer = { might: 30, guard: 20, aim: 30, focus: 30, care: 20 };
const HEALER: HeroCombatLayer = { might: 20, guard: 40, aim: 40, focus: 80, care: 90 };

function crewman(index: number, role: CombatRole, cell: Cell, combat: HeroCombatLayer) {
  return unitFrom({
    id: `crew:${String(index)}`,
    side: 'crew',
    hero: heroId(index),
    role,
    cell,
    combat
  });
}

function foe(index: number, role: CombatRole, cell: Cell, combat: HeroCombatLayer) {
  return unitFrom({ id: `foe:${String(index)}`, side: 'foe', hero: null, role, cell, combat });
}

/**
 * Five battles that end differently and reach different parts of the vocabulary: a rout, a
 * defeat, a healer keeping somebody up, a fight that runs to the ceiling, and one the player
 * pulls the crew out of.
 */
function battles(): readonly { readonly name: string; readonly record: BattleRecord }[] {
  const strongCrew: readonly BattleUnit[] = [
    crewman(0, CombatRole.Vanguard, at(1, 1), STRONG),
    crewman(1, CombatRole.Vanguard, at(1, 2), STRONG),
    crewman(2, CombatRole.Rear, at(3, 2), STRONG)
  ];

  const softCrew: readonly BattleUnit[] = [
    crewman(0, CombatRole.Vanguard, at(1, 1), SOFT),
    crewman(1, CombatRole.Rear, at(3, 3), SOFT)
  ];

  const withHealer: readonly BattleUnit[] = [
    crewman(0, CombatRole.Vanguard, at(1, 2), SOFT),
    crewman(1, CombatRole.Support, at(2, 2), HEALER)
  ];

  const softFoes: readonly BattleUnit[] = [
    foe(0, CombatRole.Vanguard, at(1, 1), SOFT),
    foe(1, CombatRole.Rear, at(3, 1), SOFT)
  ];

  const strongFoes: readonly BattleUnit[] = [
    foe(0, CombatRole.Vanguard, at(1, 1), STRONG),
    foe(1, CombatRole.Vanguard, at(1, 2), STRONG),
    foe(2, CombatRole.Support, at(2, 2), STRONG)
  ];

  const stalemate: readonly BattleUnit[] = [
    foe(0, CombatRole.Rear, at(3, 3), { ...SOFT, guard: 90 })
  ];

  return [
    {
      name: 'a rout',
      record: runBattle(startBattle([...strongCrew, ...softFoes], DoctrineId.BreakThemFirst))
    },
    {
      name: 'a defeat',
      record: runBattle(startBattle([...softCrew, ...strongFoes], DoctrineId.HoldTheLine))
    },
    {
      name: 'a healer at work',
      record: runBattle(startBattle([...withHealer, ...softFoes], DoctrineId.SpareThePeople))
    },
    {
      name: 'a fight that runs out of rounds',
      record: runBattle(startBattle([...softCrew, ...stalemate], DoctrineId.HoldTheLine))
    },
    {
      name: 'a withdrawal',
      record: runBattle(startBattle([...softCrew, ...softFoes], DoctrineId.HoldTheLine), {
        belowPercent: 0,
        signalledAtRound: 1
      })
    }
  ];
}

describe('folding every event lands on the board the battle ended on', () => {
  it.each(battles().map((one) => [one.name, one.record] as const))(
    '%s',
    (_name, record: BattleRecord) => {
      const folded = boardAfter(record, record.events.length);
      const byId = new Map(folded.units.map((unit) => [unit.unit, unit]));

      expect(folded.outcome).toBe(record.outcome);

      for (const unit of record.final.units) {
        const drawn = byId.get(unit.id);

        expect(drawn, unit.id).toBeDefined();
        expect(drawn?.cell, `${unit.id} cell`).toEqual(unit.cell);
        expect(drawn?.health, `${unit.id} health`).toBe(unit.health);
        expect(drawn?.standing, `${unit.id} standing`).toBe(unit.standing);
        expect(
          drawn?.statuses.map((one) => [one.status, one.remainingRounds]),
          `${unit.id} statuses`
        ).toEqual([...unit.statuses.entries()].map(([id, one]) => [id, one.remainingRounds]));
      }
    }
  );
});

describe('the board at a position that is not the end', () => {
  it('is the opening board at nought, before anything has been applied', () => {
    const record = battles()[0]!.record;
    const opening = boardAfter(record, 0);

    expect(opening.outcome).toBeNull();
    expect(opening.units.map((unit) => unit.health)).toEqual(
      record.initial.units.map((unit) => unit.maxHealth)
    );
  });

  it('never goes backwards in health as the feed goes forwards', () => {
    // The property that catches a fold applying an event twice, which is the failure a
    // sliced re-fold is exposed to and an incremental one is not.
    const record = battles()[1]!.record;
    let previous = boardAfter(record, 0);

    for (let applied = 1; applied <= record.events.length; applied += 1) {
      const next = boardAfter(record, applied);

      for (const unit of next.units) {
        const before = previous.units.find((one) => one.unit === unit.unit);

        if (before !== undefined && before.standing && unit.standing) {
          expect(unit.health, `${unit.unit} after ${String(applied)}`).toBeLessThanOrEqual(
            before.health + unit.maxHealth
          );
        }
      }

      previous = next;
    }
  });

  it('says how a man left the field, which the record’s own flag deliberately does not', () => {
    const withdrawal = battles()[4]!.record;
    const folded = boardAfter(withdrawal, withdrawal.events.length);
    const gone = folded.units.filter((unit) => !unit.standing);

    expect(gone.length).toBeGreaterThan(0);
    expect(gone.every((unit) => unit.left !== null)).toBe(true);
    expect(gone.some((unit) => unit.left === 'withdrew')).toBe(true);
  });

  it('keeps nobody on two cells when two men change places', () => {
    for (const { name, record } of battles()) {
      for (let applied = 0; applied <= record.events.length; applied += 1) {
        const standing = boardAfter(record, applied).units.filter((unit) => unit.standing);
        const cells = standing.map(
          (unit) => `${unit.side}:${String(unit.cell.row)}:${String(unit.cell.column)}`
        );

        expect(new Set(cells).size, `${name} after ${String(applied)}`).toBe(cells.length);
      }
    }
  });

  it('asks nothing of an index past the end, and gives the final board', () => {
    const record = battles()[0]!.record;

    expect(boardAfter(record, record.events.length + 50)).toEqual(
      boardAfter(record, record.events.length)
    );
  });
});

describe('what the board carries for the screen', () => {
  it('marks a status with the unit that put it there, so the screen can say by whom', () => {
    const record = battles().find((one) =>
      one.record.events.some((event) => event.kind === 'status_applied')
    );

    expect(record, 'no shipped fixture applied a status').toBeDefined();

    const applied = record!.record.events.findIndex((event) => event.kind === 'status_applied') + 1;
    const board = boardAfter(record!.record, applied);
    const marked = board.units.flatMap((unit) => unit.statuses);

    expect(marked.length).toBeGreaterThan(0);
    expect(marked.every((one) => STATUSES.includes(one.status))).toBe(true);
    expect(marked.every((one) => one.source.length > 0)).toBe(true);
  });
});

const STATUSES: readonly StatusId[] = Object.values(StatusId);
