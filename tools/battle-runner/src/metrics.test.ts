import {
  BattleOutcome,
  CoverageVerdict,
  DoctrineId,
  MAX_ROUNDS,
  OutcomeGrade
} from '@oath-and-coin/simulation';
import { describe, expect, it } from 'vitest';

import {
  battleLength,
  dominanceOf,
  forecastAgreement,
  formationChangesOutcome,
  formationDominance,
  threatsBeaten,
  type FoughtCase
} from './metrics.ts';

/**
 * The arithmetic of the eight, on inputs chosen to sit exactly on a boundary.
 *
 * **Every one of these was a false green before external review found it.** The verdict used
 * to be taken on the rounded number: a median of 5.5 rounds became 6 and passed a floor of 6,
 * and six agreements out of eleven became 55% and passed a floor of 55. Both are
 * deterministic, both are wrong, and neither is visible in the printed report — which is
 * precisely why a boundary needs a case rather than a comment.
 */

const battle = (rounds: number, outcome: BattleOutcome = BattleOutcome.TimedOut) => ({
  initial: { round: 0, units: [], doctrine: DoctrineId.HoldTheLine, outcome: null },
  final: { round: rounds, units: [], doctrine: DoctrineId.HoldTheLine, outcome },
  events: [],
  rounds,
  outcome,
  retreatSignalledAtRound: null
});

const fought = (spec: {
  readonly rounds?: number;
  readonly crew?: string;
  readonly shape?: FoughtCase['shape'];
  readonly doctrine?: FoughtCase['doctrine'];
  readonly grade?: OutcomeGrade;
  readonly outcome?: BattleOutcome;
  readonly verdicts?: readonly CoverageVerdict[];
  readonly forecast?: readonly CoverageVerdict[];
}): FoughtCase => ({
  contract: 'core:a',
  crew: spec.crew ?? 'a+b',
  shape: spec.shape ?? 'stacked',
  doctrine: spec.doctrine ?? DoctrineId.HoldTheLine,
  record: battle(spec.rounds ?? 7, spec.outcome ?? BattleOutcome.TimedOut),
  grade: spec.grade ?? OutcomeGrade.Costly,
  verdicts: spec.verdicts ?? [],
  forecast: spec.forecast ?? []
});

describe('a threshold is checked on the exact quantity, never on the printed one', () => {
  it('refuses a median of 5.5 against a floor of 6, and prints it as 6', () => {
    const measured = battleLength([
      fought({ rounds: 5 }),
      fought({ rounds: 5 }),
      fought({ rounds: 6 }),
      fought({ rounds: 6 })
    ]);

    // Sorted: 5 5 6 6 — the two middle values are 5 and 6, so the median is 5.5. Rounded for
    // the report it reads 6 and would pass; exactly, it is below the floor.
    expect(measured.value).toBe(6);
    expect(measured.exact).toEqual({ of: 11, per: 2 });
    expect(measured.status).toBe('fail');
  });

  it('accepts a median of exactly 6', () => {
    const measured = battleLength([fought({ rounds: 6 }), fought({ rounds: 6 })]);

    expect(measured.status).toBe('ok');
  });

  it('breaks the ceiling count down by doctrine, so one broken order of three is visible', () => {
    // The median hides it and that is the point (`COMBAT_SPEC` §12.5): a corridor declared
    // over the whole set averages three doctrines, and the owner's first play found one of
    // them running into the ceiling three quarters of the time while the median sat inside
    // `6–12`. Here every `break_them_first` battle is at the ceiling and the median passes.
    const measured = battleLength([
      fought({ rounds: 6, doctrine: DoctrineId.HoldTheLine }),
      fought({ rounds: 6, doctrine: DoctrineId.SpareThePeople }),
      fought({ rounds: MAX_ROUNDS, doctrine: DoctrineId.BreakThemFirst }),
      fought({ rounds: MAX_ROUNDS, doctrine: DoctrineId.BreakThemFirst })
    ]);

    expect(measured.status).toBe('ok');
    expect(measured.note).toContain('2 of 4');
    expect(measured.note).toContain('break_them_first 2 of 2');
    expect(measured.note).toContain('hold_the_line 0 of 1');
    expect(measured.note).toContain('spare_the_people 0 of 1');
  });

  it('refuses 6 agreements of 11 against a floor of 55%, and prints it as 55%', () => {
    const closed = [CoverageVerdict.Closed];
    const weak = [CoverageVerdict.Weak];
    const cases = [
      ...Array.from({ length: 6 }, () => fought({ verdicts: closed, forecast: closed })),
      ...Array.from({ length: 5 }, () => fought({ verdicts: closed, forecast: weak }))
    ];

    const measured = forecastAgreement(cases);

    // 6/11 is 54.54…%, which rounds to 55 and would pass a floor of 55.
    expect(measured.value).toBe(55);
    expect(measured.exact).toEqual({ of: 600, per: 11 });
    expect(measured.status).toBe('fail');
  });
});

describe('what "the formation changed the outcome" counts', () => {
  it('counts the grade, and says beside it how often the battle itself ended differently', () => {
    // Two scenarios. In the first the grade moves and the battle's ending does not; in the
    // second neither does. The number is 50%, and the note is what stops that reading as
    // "the board decides half the fights".
    const measured = formationChangesOutcome([
      fought({ crew: 'a', shape: 'stacked', grade: OutcomeGrade.Clean }),
      fought({ crew: 'a', shape: 'corridor', grade: OutcomeGrade.Costly }),
      fought({ crew: 'b', shape: 'stacked', grade: OutcomeGrade.Clean }),
      fought({ crew: 'b', shape: 'corridor', grade: OutcomeGrade.Clean })
    ]);

    expect(measured.value).toBe(50);
    expect(measured.note).toContain('the grade moved in 1 of 2 scenarios');
    expect(measured.note).toContain("the battle's own ending moved in 0");
  });

  it('counts a scenario per doctrine, so the order’s effect is not read as the formation’s', () => {
    // **One crew, one contract, two orders, and the formation changes nothing under either.**
    // The right answer is 0 of 2 scenarios. Without the doctrine in the key the four cases
    // collapse into one scenario whose grades differ — and the metric reports 100%, crediting
    // the *formation* with what the *doctrine* did. External review found the key unpinned:
    // every existing case used the default doctrine, so dropping it changed nothing.
    const measured = formationChangesOutcome([
      fought({
        crew: 'a',
        shape: 'stacked',
        doctrine: DoctrineId.HoldTheLine,
        grade: OutcomeGrade.Clean
      }),
      fought({
        crew: 'a',
        shape: 'corridor',
        doctrine: DoctrineId.HoldTheLine,
        grade: OutcomeGrade.Clean
      }),
      fought({
        crew: 'a',
        shape: 'stacked',
        doctrine: DoctrineId.BreakThemFirst,
        grade: OutcomeGrade.Costly
      }),
      fought({
        crew: 'a',
        shape: 'corridor',
        doctrine: DoctrineId.BreakThemFirst,
        grade: OutcomeGrade.Costly
      })
    ]);

    expect(measured.cases).toBe(2);
    expect(measured.exact).toEqual({ of: 0, per: 2 });
    expect(measured.note).toContain('the grade moved in 0 of 2 scenarios');
    expect(measured.note).toContain("the battle's own ending moved in 0");
  });
});

describe('strict dominance is asked of §13.1’s own matrix', () => {
  it('names the three patterns the refuting check names, and their winners', () => {
    // The first edition asked four other patterns and a crew of shipped heroes, and printed a
    // sentence about a set the spec does not name. A shape winning all three of §13.1 and
    // losing a fourth would have passed `3 < 4`.
    const measured = formationDominance();

    expect(measured.cases).toBe(3);
    expect(measured.threshold).toContain('all 3 of §13.1');
    expect(measured.note).toContain('ram→');
    expect(measured.note).toContain('archers→');
    expect(measured.note).toContain('breakers→');
  });

  it('fails when one shape takes all three, which is the row’s whole point', () => {
    // The case the shipped matrix must never produce, and the one the first edition could not
    // see: it asked four other patterns, so a sweep of §13.1 plus one loss elsewhere passed
    // `3 < 4`. Here there is nowhere else to lose.
    const swept = dominanceOf([
      { pattern: 'ram', winner: 'spread' },
      { pattern: 'archers', winner: 'spread' },
      { pattern: 'breakers', winner: 'spread' }
    ]);

    expect(swept.status).toBe('fail');
    expect(swept.value).toBe(3);
  });

  it('a tie is not a win, so three ties pass', () => {
    const tied = ['ram', 'archers', 'breakers'].map((pattern) => ({ pattern, winner: null }));

    expect(dominanceOf(tied).status).toBe('ok');
    expect(dominanceOf(tied).note).toContain('ram→tie');
  });
});

describe('what "the crew beat the held-out threat" counts', () => {
  it('counts a threat beaten when any formation beats it, because the player picks one', () => {
    // Three threats: taken in one shape of three, taken in all three, taken in none. Two
    // beaten. Averaging the nine cells instead gives 4/9 — the number the first edition
    // printed, and a fact about how forgiving the crew is of a bad shape rather than about
    // how many threats it has an answer to.
    expect(
      threatsBeaten([
        [false, true, false],
        [true, true, true],
        [false, false, false]
      ])
    ).toBe(2);
  });

  it('counts nothing beaten when nothing was', () => {
    expect(threatsBeaten([[false, false, false]])).toBe(0);
  });
});
