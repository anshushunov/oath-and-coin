import type { HeroCombatLayer } from '../domain/combat-attributes.ts';
import { CombatRole } from '../domain/combat-role.ts';

import { runBattle, startBattle, type BattleRecord } from './battle.ts';
import { DoctrineId } from './doctrine.ts';
import { BattleOutcome } from './events.ts';
import type { Column, Row } from './field.ts';
import { heroId } from '../ids/hero-id.ts';

import { unitFrom, type BattleUnit } from './unit.ts';

/**
 * The frozen set behind `DEC-011`'s refuting check (`COMBAT_SPEC` §13.1).
 *
 * One roster, three legal formations of it, three enemy patterns — nine battles at equal
 * numbers. `DEC-011` §Проверка asks for at least three patterns whose winners are
 * *different* formations, with a cause statable without numerical crutches; if no such
 * counter-example exists the field is reduced to ranks, and that is a **pre-accepted
 * outcome rather than a failure**.
 *
 * **In code and under git rather than generated**, because this is an input: `AGENTS.md`
 * §11 puts inputs — scenarios, fixtures, expected values — in the repository and outputs in
 * the run's artifacts. It is also frozen *before* balancing, which is what stops it becoming
 * a set assembled to agree with whatever the numbers happen to do (`MVP_PLAN` §6.4).
 *
 * There is no seed here and no set of seeds. The battle carries no randomness at all
 * (`COMBAT_SPEC` §9), so a distribution is taken over *scenarios* — patterns and
 * formations — and one input has exactly one outcome.
 */

const attributes = (overrides: Partial<HeroCombatLayer> = {}): HeroCombatLayer => ({
  might: 50,
  guard: 50,
  aim: 50,
  focus: 50,
  care: 50,
  ...overrides
});

type Placement = readonly [Row, Column];

interface Fighter {
  readonly key: string;
  readonly role: CombatRole;
  readonly combat: HeroCombatLayer;
}

/**
 * The one roster all nine battles are fought with (`DEC-011` §Проверка: "на одном
 * фиксированном ростере").
 *
 * Five, not six, so every formation below can keep each man in the row his own actions
 * belong to — the comparison is meant to be between *shapes*, and a formation that had to
 * park a rear unit in the front rank would be losing for a reason that is not geometry.
 */
export const MATRIX_ROSTER: readonly Fighter[] = Object.freeze([
  {
    key: 'van',
    role: CombatRole.Vanguard,
    combat: attributes({ might: 70, guard: 80, focus: 40 })
  },
  { key: 'brk', role: CombatRole.Breaker, combat: attributes({ might: 85, guard: 55, focus: 60 }) },
  { key: 'sup', role: CombatRole.Support, combat: attributes({ care: 80, guard: 60, focus: 55 }) },
  { key: 'arc', role: CombatRole.Rear, combat: attributes({ aim: 85, guard: 35, focus: 70 }) },
  { key: 'mag', role: CombatRole.Rear, combat: attributes({ aim: 75, guard: 30, focus: 80 }) }
]);

/**
 * Three legal formations of that roster. Every man stands in his own row in all three; what
 * differs is where the gaps are.
 *
 * - **stacked** — column 2 carries three: the archer fires through two of his own and is
 *   very hard to reach.
 * - **corridor** — column 2 is empty in front of the archer: he fires at full strength, and
 *   that same column is a road to him.
 * - **spread** — never more than two to a column: everyone shoots a little worse than in
 *   the corridor and nobody has a road to the rear.
 */
export const MATRIX_FORMATIONS: Readonly<Record<string, Readonly<Record<string, Placement>>>> =
  Object.freeze({
    stacked: Object.freeze<Record<string, Placement>>({
      van: [1, 2],
      brk: [1, 1],
      sup: [2, 2],
      arc: [3, 2],
      mag: [3, 1]
    }),
    corridor: Object.freeze<Record<string, Placement>>({
      van: [1, 1],
      brk: [1, 3],
      sup: [2, 1],
      arc: [3, 2],
      mag: [3, 3]
    }),
    spread: Object.freeze<Record<string, Placement>>({
      van: [1, 1],
      brk: [1, 3],
      sup: [2, 2],
      arc: [3, 1],
      mag: [3, 3]
    })
  });

interface Foe {
  readonly key: string;
  readonly role: CombatRole;
  readonly combat: HeroCombatLayer;
  readonly cell: Placement;
}

/**
 * Three threats that punish different shapes, and each is a kind of enemy rather than a
 * counter built against a formation.
 *
 * - **ram** — everything in the front rank, so an open column is a road they will take.
 * - **archers** — three rear units and no second melee: they cannot punish an open column
 *   at all, and they out-shoot anybody firing through his own men.
 * - **breakers** — two of them, whose work is knocking people out of their rows.
 */
export const MATRIX_PATTERNS: Readonly<Record<string, readonly Foe[]>> = Object.freeze({
  ram: Object.freeze<readonly Foe[]>([
    {
      key: 'v1',
      role: CombatRole.Vanguard,
      combat: attributes({ might: 90, guard: 90 }),
      cell: [1, 1]
    },
    {
      key: 'v2',
      role: CombatRole.Vanguard,
      combat: attributes({ might: 90, guard: 90 }),
      cell: [1, 2]
    },
    {
      key: 'v3',
      role: CombatRole.Vanguard,
      combat: attributes({ might: 90, guard: 90 }),
      cell: [1, 3]
    },
    {
      key: 'b1',
      role: CombatRole.Breaker,
      combat: attributes({ might: 85, guard: 65 }),
      cell: [2, 2]
    },
    {
      key: 's1',
      role: CombatRole.Support,
      combat: attributes({ care: 85, guard: 65 }),
      cell: [3, 2]
    }
  ]),
  archers: Object.freeze<readonly Foe[]>([
    {
      key: 'v1',
      role: CombatRole.Vanguard,
      combat: attributes({ might: 70, guard: 80 }),
      cell: [1, 2]
    },
    {
      key: 's1',
      role: CombatRole.Support,
      combat: attributes({ care: 85, guard: 65 }),
      cell: [2, 2]
    },
    { key: 'r1', role: CombatRole.Rear, combat: attributes({ aim: 100, guard: 65 }), cell: [3, 1] },
    { key: 'r2', role: CombatRole.Rear, combat: attributes({ aim: 100, guard: 65 }), cell: [3, 2] },
    { key: 'r3', role: CombatRole.Rear, combat: attributes({ aim: 100, guard: 65 }), cell: [3, 3] }
  ]),
  breakers: Object.freeze<readonly Foe[]>([
    {
      key: 'b1',
      role: CombatRole.Breaker,
      combat: attributes({ might: 100, guard: 65 }),
      cell: [1, 1]
    },
    {
      key: 'b2',
      role: CombatRole.Breaker,
      combat: attributes({ might: 100, guard: 65 }),
      cell: [1, 3]
    },
    {
      key: 'v1',
      role: CombatRole.Vanguard,
      combat: attributes({ might: 75, guard: 85 }),
      cell: [1, 2]
    },
    {
      key: 's1',
      role: CombatRole.Support,
      combat: attributes({ care: 85, guard: 65 }),
      cell: [2, 2]
    },
    { key: 'r1', role: CombatRole.Rear, combat: attributes({ aim: 85, guard: 65 }), cell: [3, 2] }
  ])
});

/** The doctrine all nine are fought under, so the matrix measures the formation alone. */
export const MATRIX_DOCTRINE = DoctrineId.HoldTheLine;

/** One battle of the matrix, run. */
export function runMatrixBattle(formation: string, pattern: string): BattleRecord {
  const placement = MATRIX_FORMATIONS[formation];
  const foes = MATRIX_PATTERNS[pattern];

  if (placement === undefined || foes === undefined) {
    throw new Error(`No such matrix cell: '${formation}' against '${pattern}'.`);
  }

  const crew: BattleUnit[] = MATRIX_ROSTER.map((fighter, index) => {
    const cell = placement[fighter.key];

    if (cell === undefined) {
      throw new Error(
        `Formation '${formation}' places nobody at '${fighter.key}'. Every formation is the ` +
          'same five men in different cells, so a missing one is a different roster.'
      );
    }

    return unitFrom({
      id: `crew:${fighter.key}`,
      side: 'crew',
      // A `HeroId` and not `null`, although this roster is synthetic: the crew's side is
      // counted by its heroes (`COMBAT_SPEC` §6.1, §7.4 — a ward is not a man holding the
      // line), and a matrix whose crew were all wards would end every battle before the
      // first round. The number itself reaches no rule but the tie-break every comparison
      // here already states.
      hero: heroId(index),
      role: fighter.role,
      cell: { row: cell[0], column: cell[1] },
      combat: fighter.combat
    });
  });

  const enemy: BattleUnit[] = foes.map((foe) =>
    unitFrom({
      id: `foe:${foe.key}`,
      side: 'foe',
      hero: null,
      role: foe.role,
      cell: { row: foe.cell[0], column: foe.cell[1] },
      combat: foe.combat
    })
  );

  return runBattle(startBattle([...crew, ...enemy], MATRIX_DOCTRINE));
}

/**
 * How well a formation did, as a number two results can be compared by.
 *
 * Three keys in order and no weighting between them, because a weighted sum would be a
 * balance decision taken inside a measurement: **the outcome first**, then how many of the
 * crew were left standing, then how much health they had between them. The third is only
 * ever reached when the first two tie, which on this matrix happens exactly once — and that
 * is stated in the gate rather than hidden inside a formula.
 */
export interface MatrixScore {
  readonly outcome: BattleOutcome;
  readonly rounds: number;
  readonly standing: number;
  readonly health: number;
}

export function scoreOf(record: BattleRecord): MatrixScore {
  const crew = record.final.units.filter((unit) => unit.side === 'crew');

  return {
    outcome: record.outcome,
    rounds: record.rounds,
    standing: crew.filter((unit) => unit.standing).length,
    health: crew.reduce((total, unit) => total + unit.health, 0)
  };
}

const OUTCOME_RANK: Readonly<Record<BattleOutcome, number>> = Object.freeze({
  [BattleOutcome.CrewStanding]: 3,
  [BattleOutcome.TimedOut]: 2,
  [BattleOutcome.Retreated]: 1,
  [BattleOutcome.FoesStanding]: 0
});

/** Negative when `left` did worse, positive when it did better, nought when they tied. */
export function compareScores(left: MatrixScore, right: MatrixScore): number {
  return (
    OUTCOME_RANK[left.outcome] - OUTCOME_RANK[right.outcome] ||
    left.standing - right.standing ||
    left.health - right.health
  );
}

/** The best formation against one pattern, or `null` when two of them tied outright. */
export function winnerAgainst(pattern: string): string | null {
  const ranked = Object.keys(MATRIX_FORMATIONS)
    .map((formation) => ({ formation, score: scoreOf(runMatrixBattle(formation, pattern)) }))
    .sort((left, right) => compareScores(right.score, left.score));

  const [best, second] = ranked;

  if (best === undefined || second === undefined) {
    return null;
  }

  return compareScores(best.score, second.score) === 0 ? null : best.formation;
}
