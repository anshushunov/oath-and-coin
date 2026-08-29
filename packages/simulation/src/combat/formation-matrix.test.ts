import { describe, expect, it } from 'vitest';

import {
  MATRIX_FORMATIONS,
  MATRIX_PATTERNS,
  compareScores,
  runMatrixBattle,
  scoreOf,
  winnerAgainst
} from './formation-matrix.ts';

/**
 * **`DEC-011`'s refuting check** (`COMBAT_SPEC` §13.1), as a gate rather than a table in a
 * document.
 *
 * The record says the 3×3 field is confirmed only if, on one fixed roster at equal numbers,
 * at least three enemy patterns are won by *different* formations — and that if no such
 * counter-example can be built, the field is cut down to ranks, which is a **pre-accepted
 * outcome and not a failure**. So this file is the one that decides whether the geometry
 * this milestone is built on survives, and it has to be able to say no.
 *
 * Three assertions, and the third is the one the spec's first edition did not ask for:
 * a table showing that each pattern has *a* winner is satisfied by one formation winning
 * everything, which is a dominant answer and the opposite of what the field is for.
 */

const PATTERNS = Object.keys(MATRIX_PATTERNS);
const FORMATIONS = Object.keys(MATRIX_FORMATIONS);

describe('DEC-011: different threats are answered by different formations', () => {
  it('is a matrix of three by three, at equal numbers', () => {
    expect(PATTERNS).toHaveLength(3);
    expect(FORMATIONS).toHaveLength(3);

    for (const pattern of PATTERNS) {
      for (const formation of FORMATIONS) {
        const record = runMatrixBattle(formation, pattern);
        const crew = record.final.units.filter((unit) => unit.side === 'crew');
        const foes = record.final.units.filter((unit) => unit.side === 'foe');

        // Equal numbers is a condition of the check itself, not an incidental property:
        // `DEC-011` §Проверка excludes asymmetric fights from it on purpose, because at one
        // action per unit the numbers explain the result on their own.
        expect(crew, `${formation} vs ${pattern}`).toHaveLength(5);
        expect(foes, `${formation} vs ${pattern}`).toHaveLength(5);
      }
    }
  });

  it('gives every pattern a strict winner, not a tie', () => {
    for (const pattern of PATTERNS) {
      expect(winnerAgainst(pattern), pattern).not.toBeNull();
    }
  });

  it('is won by three different formations — the counter-example DEC-011 asks for', () => {
    const winners = PATTERNS.map((pattern) => winnerAgainst(pattern));

    expect(new Set(winners).size, `winners: ${winners.join(', ')}`).toBe(3);
  });

  it('has no formation that wins them all, which a table of winners alone would allow', () => {
    for (const formation of FORMATIONS) {
      const won = PATTERNS.filter((pattern) => winnerAgainst(pattern) === formation);

      expect(won.length, `${formation} won: ${won.join(', ')}`).toBeLessThan(PATTERNS.length);
    }
  });

  it('holds the matrix the spec prints, cell by cell', () => {
    // `AGENTS.md` §11: a number is published by the run that produced it. The table in
    // `COMBAT_SPEC` §13.1.1 is *this* table, and pinning it here is what makes the document
    // wrong the day the rules move rather than merely out of date.
    const measured = PATTERNS.flatMap((pattern) =>
      FORMATIONS.map((formation) => {
        const score = scoreOf(runMatrixBattle(formation, pattern));

        return `${pattern}/${formation}: ${score.outcome} ${String(score.standing)} ${String(score.health)}`;
      })
    );

    expect(measured).toEqual([
      'ram/stacked: crew_standing 3 81',
      'ram/corridor: crew_standing 4 128',
      'ram/spread: crew_standing 5 102',
      'archers/stacked: timed_out 1 21',
      'archers/corridor: crew_standing 4 105',
      'archers/spread: timed_out 1 2',
      'breakers/stacked: timed_out 1 21',
      'breakers/corridor: foes_standing 0 0',
      'breakers/spread: timed_out 1 5'
    ]);
  });
});

describe('the ordering the matrix is read by', () => {
  it('puts a win above a stalemate above a loss, before it counts anybody', () => {
    const win = { outcome: 'crew_standing' as const, rounds: 5, standing: 1, health: 1 };
    const draw = { outcome: 'timed_out' as const, rounds: 12, standing: 5, health: 200 };

    // A win with one man left beats a stalemate with five: the objective is the outcome, and
    // a rule that summed survivors first would rank losing well above winning badly.
    expect(compareScores(win, draw)).toBeGreaterThan(0);
  });

  it('falls to health only when the outcome and the survivors tie', () => {
    const richer = { outcome: 'timed_out' as const, rounds: 12, standing: 1, health: 21 };
    const poorer = { outcome: 'timed_out' as const, rounds: 12, standing: 1, health: 5 };

    expect(compareScores(richer, poorer)).toBeGreaterThan(0);
    expect(compareScores({ ...richer, standing: 0 }, poorer)).toBeLessThan(0);
  });
});
