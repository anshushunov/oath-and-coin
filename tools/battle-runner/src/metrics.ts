import type { ContentSet, ContractDefinition } from '@oath-and-coin/content';
import {
  BattleOutcome,
  CombatRole,
  DOCTRINE_IDS,
  DoctrineId,
  MATRIX_PATTERNS,
  MAX_ROUNDS,
  battleResolver,
  forecastReadiness,
  heroId,
  runBattle,
  startBattle,
  unitFrom,
  winnerAgainst,
  type BattleRecord,
  type BattleUnit,
  type Cell,
  type CoverageVerdict,
  type HeroCombatLayer,
  type OutcomeGrade
} from '@oath-and-coin/simulation';

import { crewsOf, inputFor } from './campaign.ts';
import { FORMATION_SHAPES, type FormationShape } from './formations.ts';
import { HELD_OUT_PATTERNS, subdueEverything } from './patterns.ts';
import { Thresholds, type Corridor } from './thresholds.ts';

/**
 * The eight measurements `COMBAT_SPEC` §12.5 declares, each computed from battles this
 * repository can re-fight, and each printed beside the command that took it (`AGENTS.md`
 * §11).
 *
 * **Every number is a share or a median of the frozen set** — never of a sample, never of
 * whatever ran fastest. The set is enumerated in `patterns.ts` and built in `campaign.ts`;
 * what this file does is ask eight questions of it.
 *
 * **Every verdict is taken on an exact ratio, and only the printed number is rounded.**
 * External review found two false greens in that gap: a median of 5.5 rounds to 6 and passes
 * a floor of 6, and six agreements out of eleven round to 55 and pass a floor of 55.
 */

export interface Ratio {
  readonly of: number;
  readonly per: number;
}

export interface Measurement {
  readonly id: string;
  /**
   * What the measurement says, in the units §12.5 states it in — **rounded for the report
   * only**. The verdict is taken on {@link exact}.
   */
  readonly value: number;
  /** The same quantity as a ratio, which is what every corridor is checked against. */
  readonly exact: Ratio;
  /** How the value should read on a report — per cent, rounds, a count. */
  readonly unit: 'percent' | 'rounds' | 'count';
  /** The corridor or floor §12.5 declared, as a sentence. */
  readonly threshold: string;
  readonly withinThreshold: boolean;
  /**
   * `ok` inside its corridor, `fail` outside it, `open` outside it and left there by a
   * decision (`thresholds.ts`).
   *
   * The third is not a fourth kind of passing. It says the corridor still stands, the number
   * is still outside it, and somebody decided to live with that on a stated date.
   */
  readonly status: 'ok' | 'fail' | 'open';
  /** How many cases this number was taken over — a share of nothing is not a share. */
  readonly cases: number;
  /** Anything the number alone does not say. */
  readonly note?: string;
}

const ratio = (of: number, per: number): Ratio => ({ of, per });

/** Cross-multiplied, so no boundary is rounded onto the wrong side of itself (`TDD` §7.4). */
const atLeast = (value: Ratio, least: number): boolean => value.of >= least * value.per;
const atMost = (value: Ratio, most: number): boolean => value.of <= most * value.per;

const insideExactly = (value: Ratio, corridor: Corridor): boolean =>
  atLeast(value, corridor.least) && atMost(value, corridor.most);

/** For the report only. Never for a verdict. */
const rounded = (value: Ratio): number => (value.per === 0 ? 0 : Math.round(value.of / value.per));

/** A share in per cent, exactly: `part` of `whole`, scaled by a hundred. */
const percentOf = (part: number, whole: number): Ratio => ratio(part * 100, whole);

/**
 * The verdict, once the owner's open list has been consulted.
 *
 * One place, so a measurement cannot be "within" here and "open" there — and so a ninth
 * measurement inherits the rule instead of restating it.
 */
function statusOf(id: string, withinThreshold: boolean): Measurement['status'] {
  if (withinThreshold) {
    return 'ok';
  }

  return id in Thresholds.openByDecision ? 'open' : 'fail';
}

function measurement(spec: Omit<Measurement, 'value' | 'status'>): Measurement {
  return {
    ...spec,
    value: rounded(spec.exact),
    status: statusOf(spec.id, spec.withinThreshold)
  };
}

/** One fought case of the frozen set. */
export interface FoughtCase {
  readonly contract: string;
  readonly crew: string;
  readonly shape: FormationShape;
  /**
   * The order this crew went out under.
   *
   * **The fourth dimension of the set, added 2026-08-31 by the owner's decision.** Until it
   * was there the whole report was taken under `hold_the_line` alone, and an audit found what
   * that hid: under that one doctrine `status` and `shift` are never chosen at all, so two of
   * the eight actions of §4.1 and two of the four statuses of §3.5 took no part in any of the
   * eight numbers. A corridor measured over a third of the battle is a corridor about a third
   * of the battle.
   */
  readonly doctrine: DoctrineId;
  readonly record: BattleRecord;
  readonly grade: OutcomeGrade;
  readonly verdicts: readonly CoverageVerdict[];
  readonly forecast: readonly CoverageVerdict[];
}

/**
 * Everything the shipped battle contracts produce: every legal crew, in all three shapes.
 *
 * Enumerated rather than sampled, for the reason `MVP_PLAN` §6.4 freezes the set at all: a
 * distribution over a sample is a fact about the sample. There is no seed here and no set of
 * seeds — the battle carries no randomness (`COMBAT_SPEC` §9), so the distribution is taken
 * over *scenarios*.
 */
export function fightTheCoreSet(content: ContentSet): readonly FoughtCase[] {
  const contracts = content.contracts.values().filter((one) => one.battle !== null);
  const pool = content.heroes.values();
  const fought: FoughtCase[] = [];

  for (const definition of contracts) {
    for (const crew of crewsOf(pool, definition.requiredCrew)) {
      for (const shape of FORMATION_SHAPES) {
        for (const doctrine of DOCTRINE_IDS) {
          const input = inputFor({ content, definition, crew, shape, doctrine });
          const draft = battleResolver(input);

          fought.push({
            contract: definition.id,
            crew: crew.map((hero) => hero.id).join('+'),
            shape,
            doctrine,
            record: draft.resolution.battle!,
            grade: draft.resolution.grade,
            verdicts: draft.resolution.coverage.map((row) => row.verdict),
            forecast: forecastReadiness(input).objectives.map((one) => one.verdict)
          });
        }
      }
    }
  }

  return fought;
}

/** §12.5, row 1: the median length of a battle, in rounds. */
export function battleLength(fought: readonly FoughtCase[]): Measurement {
  const rounds = fought.map((one) => one.record.rounds).sort((left, right) => left - right);
  const median = medianOf(rounds);

  return measurement({
    id: 'battle_length_rounds',
    exact: median,
    unit: 'rounds',
    threshold: corridorOf(Thresholds.battleLengthRounds, 'median'),
    withinThreshold: insideExactly(median, Thresholds.battleLengthRounds),
    cases: fought.length,
    note: `${String(rounds.filter((one) => one === MAX_ROUNDS).length)} of ${String(rounds.length)} reached the ${String(MAX_ROUNDS)}-round ceiling`
  });
}

/** §12.5, row 2: the share of battles somebody broke the doctrine in. */
export function doctrineBreaches(fought: readonly FoughtCase[]): Measurement {
  const broken = fought.filter((one) =>
    one.record.events.some((event) => event.kind === 'doctrine_broken')
  ).length;

  const share = percentOf(broken, fought.length);

  return measurement({
    id: 'doctrine_breach_percent',
    exact: share,
    unit: 'percent',
    threshold: corridorOf(Thresholds.doctrineBreachPercent, '', '%'),
    withinThreshold: insideExactly(share, Thresholds.doctrineBreachPercent),
    cases: fought.length
  });
}

/**
 * §12.5, row 3: the share of scenarios where changing the formation changes the outcome.
 *
 * A *scenario* is a contract and a crew; the three shapes are what varies inside it. That is
 * the unit `MVP_PLAN` §6.4 names — "распределение побед при смене расстановки" — and counting
 * battles instead would let one badly-placed crew stand for three.
 *
 * **The outcome is the grade, and the note says how often the battle's own ending moved.**
 * The first edition keyed on the battle outcome *and* the objective verdicts together, which
 * external review reproduced as the difference between 43% and 3%: the verdicts moved in
 * thirteen of thirty scenarios and `BattleOutcome` in one. Both numbers are real and they
 * answer different questions — the grade is what the player is judged on and what
 * `RESOLUTION_SPEC` §4.6 calls the outcome, so it is what the threshold reads. How rarely the
 * *battle* ends differently is printed beside it rather than folded into it: it is the weaker
 * fact, and hiding it would be the report flattering itself.
 */
export function formationChangesOutcome(fought: readonly FoughtCase[]): Measurement {
  const grades = new Map<string, Set<string>>();
  const endings = new Map<string, Set<string>>();

  for (const one of fought) {
    // A scenario is a contract, a crew **and a doctrine**: the three shapes are what varies
    // inside it. Letting the doctrine vary within a scenario would fold "the order changed
    // the outcome" into "the formation changed the outcome" and report the sum as the second.
    const key = `${one.contract}|${one.crew}|${one.doctrine}`;
    grades.set(key, (grades.get(key) ?? new Set<string>()).add(one.grade));
    endings.set(key, (endings.get(key) ?? new Set<string>()).add(one.record.outcome));
  }

  const moved = [...grades.values()].filter((seen) => seen.size > 1).length;
  const endingsMoved = [...endings.values()].filter((seen) => seen.size > 1).length;
  const share = percentOf(moved, grades.size);

  return measurement({
    id: 'formation_changes_outcome_percent',
    exact: share,
    unit: 'percent',
    threshold: `≥ ${String(Thresholds.formationChangesOutcomePercent)}%`,
    withinThreshold: atLeast(share, Thresholds.formationChangesOutcomePercent),
    cases: grades.size,
    note:
      `the grade moved in ${String(moved)} of ${String(grades.size)} scenarios; ` +
      `the battle's own ending moved in ${String(endingsMoved)}`
  });
}

/**
 * §12.5, row 4: no formation wins all three patterns of §13.1.
 *
 * **The matrix of §13.1 and nothing else**, through the same `winnerAgainst` the refuting
 * check itself uses. The first edition asked the question of four other patterns and a crew
 * of shipped heroes, and printed "no shape wins all 4" — a sentence about a set the spec does
 * not name. External review found the input on which the two disagree: one shape winning
 * `ram`, `archers` and `breakers` but losing a fourth pattern passes `3 < 4` and violates the
 * row.
 */
export function formationDominance(): Measurement {
  const patterns = Object.keys(MATRIX_PATTERNS);

  return dominanceOf(patterns.map((pattern) => ({ pattern, winner: winnerAgainst(pattern) })));
}

/**
 * The arithmetic of the row, apart from the matrix that feeds it.
 *
 * Separate so a case can hand it a sweep — the same shape winning all three — without having
 * to balance the game into one. That case is the whole point of the row, and it is exactly
 * the one the shipped matrix must never produce.
 */
export function dominanceOf(
  results: readonly { readonly pattern: string; readonly winner: string | null }[]
): Measurement {
  const wins = new Map<string, number>();

  for (const { winner } of results) {
    if (winner !== null) {
      wins.set(winner, (wins.get(winner) ?? 0) + 1);
    }
  }

  const most = Math.max(0, ...wins.values());

  return measurement({
    id: 'formation_strict_dominance',
    exact: ratio(most, 1),
    unit: 'count',
    threshold: `no formation wins all ${String(results.length)} of §13.1`,
    withinThreshold: most < results.length,
    cases: results.length,
    note: `winners: ${results.map((one) => `${one.pattern}→${one.winner ?? 'tie'}`).join(', ')}`
  });
}

/**
 * §12.5, row 5: what six do against four **at equal total capability** (§4.7 п.2).
 *
 * **Six against four, not six-against-a-pattern compared with four-against-a-pattern.** The
 * first edition did the second, and it answered 100% every time for a reason that had nothing
 * to do with geometry: six men leave more survivors than four against the same enemy, always.
 *
 * "Equal capability" is the **total**: six at two thirds of the attributes against four at
 * full. Fought directly rather than through a contract — no coverage is involved in "who was
 * left standing".
 */
export function sixAgainstFourCases(): readonly {
  readonly name: string;
  readonly units: readonly BattleUnit[];
}[] {
  return FORMATION_SHAPES.flatMap((shape) =>
    Object.keys(FOUR_LAYOUTS).map((layout) => ({
      name: `${shape}/${layout}`,
      units: [...sideOfSix(shape), ...sideOfFour(layout)]
    }))
  );
}

export function sixAgainstFour(): Measurement {
  const cases = sixAgainstFourCases();
  const won = cases.filter(
    (one) =>
      runBattle(startBattle(one.units, DoctrineId.HoldTheLine)).outcome ===
      BattleOutcome.CrewStanding
  ).length;

  const share = percentOf(won, cases.length);

  return measurement({
    id: 'six_against_four_percent',
    exact: share,
    unit: 'percent',
    threshold: corridorOf(Thresholds.sixAgainstFourPercent, '', '%'),
    withinThreshold: insideExactly(share, Thresholds.sixAgainstFourPercent),
    cases: cases.length
  });
}

/**
 * §12.5, row 6: a rear unit's action lands for less as its own side crowds the board in front
 * of it (§4.7 п.3).
 *
 * **One archer, and only the number of men in front of him varies.** The first edition took a
 * different crew at every size, so it was measuring rosters. The value is the number of steps
 * where the mean did *not* fall; nought is the passing answer.
 */
export function rearEffectByCrewSize(): Measurement {
  const means = [0, 1, 2].map((ahead) => ({
    ahead,
    mean: meanRearEffect(
      runBattle(
        startBattle([...archerBehind(ahead), ...sideOfFour('line')], DoctrineId.HoldTheLine)
      )
    )
  }));

  const rises = means.filter(
    (one, index) => index > 0 && one.mean >= (means[index - 1]?.mean ?? 0)
  ).length;

  return measurement({
    id: 'rear_effect_by_own_men_ahead',
    exact: ratio(rises, 1),
    unit: 'count',
    threshold: 'falls at every step (0 that do not)',
    withinThreshold: rises === 0,
    cases: means.length,
    note: means.map((one) => `${String(one.ahead)} ahead: ${String(one.mean)}`).join(', ')
  });
}

/**
 * §12.5, row 7: how often the forecast and the battle agree about an objective.
 *
 * Both ends of the corridor fail differently (`ADR-016` §2): below it the forecast is noise,
 * above it the forecast was copied from the battle and can surprise nobody.
 */
export function forecastAgreement(fought: readonly FoughtCase[]): Measurement {
  let agreed = 0;
  let asked = 0;

  for (const one of fought) {
    one.verdicts.forEach((verdict, index) => {
      asked += 1;

      if (one.forecast[index] === verdict) {
        agreed += 1;
      }
    });
  }

  const share = percentOf(agreed, asked);

  return measurement({
    id: 'forecast_agreement_percent',
    exact: share,
    unit: 'percent',
    threshold: corridorOf(Thresholds.forecastAgreementPercent, '', '%'),
    withinThreshold: insideExactly(share, Thresholds.forecastAgreementPercent),
    cases: asked
  });
}

/**
 * §12.5, row 8: no crew dominates the **held-out** set.
 *
 * **A threat is beaten if the crew beats it in any legal formation.** The player chooses the
 * formation, so averaging over all three measures how forgiving a crew is of a bad one — a
 * different question, and the one the first edition accidentally answered: a crew that took
 * every held-out threat in some shape printed as 78% rather than 100%. External review found
 * it; the honest number is larger, and the finding it stays open on is correspondingly
 * sharper.
 */
export function dominantCrew(content: ContentSet): Measurement {
  const definition = firstBattleContract(content);
  const pool = content.heroes.values();
  const patterns = Object.values(HELD_OUT_PATTERNS);
  let best = 0;
  let by = '';
  let sweeping = 0;
  let crews = 0;

  for (const crew of crewsOf(pool, definition.requiredCrew)) {
    const won = threatsBeaten(
      patterns.map((foes) =>
        FORMATION_SHAPES.map(
          (shape) =>
            battleResolver(
              inputFor({ content, definition, crew, shape, plan: subdueEverything(foes) })
            ).resolution.battle!.outcome === BattleOutcome.CrewStanding
        )
      )
    );

    crews += 1;

    if (won === patterns.length) {
      sweeping += 1;
    }

    if (won > best) {
      best = won;
      by = crew.map((hero) => hero.id).join('+');
    }
  }

  const share = percentOf(best, patterns.length);

  return measurement({
    id: 'dominant_crew_percent',
    exact: share,
    unit: 'percent',
    threshold: `≤ ${String(Thresholds.dominantCrewPercent)}%`,
    withinThreshold: atMost(share, Thresholds.dominantCrewPercent),
    cases: patterns.length,
    // How many crews swept, not only that one did. One crew winning everything is a dominant
    // crew; every crew winning everything is a held-out set nobody has to prepare for, and
    // only the second is answered by making the fight harder.
    note:
      by === ''
        ? 'no crew won anything'
        : `best: ${by}; ${String(sweeping)} of ${String(crews)} crews took every threat`
  });
}

/**
 * How many threats a crew beat, given how each of its formations fared against each.
 *
 * One row per threat, one entry per shape. **A threat is beaten if any shape beats it** — the
 * player picks the formation, so a crew that has an answer has an answer. Averaging the rows
 * instead would count the shapes that lost, which is a question about how forgiving the crew
 * is of a bad choice, and the one the first edition answered without meaning to.
 */
export function threatsBeaten(byThreat: readonly (readonly boolean[])[]): number {
  return byThreat.filter((shapes) => shapes.some((won) => won)).length;
}

/** The mean of what a rear unit's actions actually landed for, in this battle. */
function meanRearEffect(record: BattleRecord): number {
  const rear = new Set(
    record.initial.units
      .filter((unit) => unit.side === 'crew' && unit.role === CombatRole.Rear)
      .map((unit) => unit.id)
  );

  const amounts = record.events.flatMap((event) =>
    (event.kind === 'damage_dealt' || event.kind === 'healing_done') && rear.has(event.actor)
      ? [event.amount]
      : []
  );

  return amounts.length === 0
    ? 0
    : Math.round(amounts.reduce((sum, one) => sum + one, 0) / amounts.length);
}

/**
 * The contract the held-out question is asked on.
 *
 * The *first* by content id rather than a hand-picked favourite, and the plan it is asked
 * with is synthetic (`subdueEverything`): what the contract supplies is the risk, the needs
 * and the crew size — everything a `ResolutionInput` has to have.
 */
function firstBattleContract(content: ContentSet): ContractDefinition {
  const definition = content.contracts.values().find((one) => one.battle !== null);

  if (definition === undefined) {
    throw new Error(
      'No shipped contract goes to a battle, so the balance report has nothing to measure. ' +
        'The set is built from content rather than invented here, and this is that absence ' +
        'said out loud rather than reported as eight zeroes.'
    );
  }

  return definition;
}

/** The median, exactly — `.5` stays `.5` rather than becoming the floor it would pass. */
function medianOf(sorted: readonly number[]): Ratio {
  if (sorted.length === 0) {
    return ratio(0, 1);
  }

  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 1
    ? ratio(sorted[middle]!, 1)
    : ratio((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0), 2);
}

const corridorOf = (corridor: Corridor, prefix = '', suffix = ''): string =>
  `${prefix === '' ? '' : `${prefix} `}${String(corridor.least)}–${String(corridor.most)}${suffix}`;

/**
 * The two synthetic sides row 5 is fought between (`COMBAT_SPEC` §4.7 п.2).
 *
 * Equal totals: six at two thirds of each attribute against four at full. Written out rather
 * than derived from a ratio so the arithmetic is visible — `6 × 60 = 4 × 90` on every
 * attribute, and a reader can check it without running anything.
 */
const SIX_ATTRIBUTES: HeroCombatLayer = { might: 60, guard: 60, aim: 60, focus: 60, care: 60 };
const FOUR_ATTRIBUTES: HeroCombatLayer = { might: 90, guard: 90, aim: 90, focus: 90, care: 90 };

const SIX_CELLS: Readonly<Record<FormationShape, readonly Cell[]>> = Object.freeze({
  stacked: [
    { row: 1, column: 2 },
    { row: 1, column: 1 },
    { row: 2, column: 2 },
    { row: 2, column: 1 },
    { row: 3, column: 2 },
    { row: 3, column: 1 }
  ],
  corridor: [
    { row: 1, column: 1 },
    { row: 1, column: 3 },
    { row: 2, column: 1 },
    { row: 2, column: 3 },
    { row: 3, column: 1 },
    { row: 3, column: 3 }
  ],
  spread: [
    { row: 1, column: 1 },
    { row: 1, column: 2 },
    { row: 1, column: 3 },
    { row: 2, column: 2 },
    { row: 3, column: 1 },
    { row: 3, column: 3 }
  ]
});

/** Three shapes for the four, so the answer is not a fact about one enemy layout. */
const FOUR_LAYOUTS: Readonly<Record<string, readonly Cell[]>> = Object.freeze({
  line: [
    { row: 1, column: 1 },
    { row: 1, column: 2 },
    { row: 1, column: 3 },
    { row: 2, column: 2 }
  ],
  wedge: [
    { row: 1, column: 2 },
    { row: 2, column: 1 },
    { row: 2, column: 3 },
    { row: 3, column: 2 }
  ],
  deep: [
    { row: 1, column: 2 },
    { row: 2, column: 2 },
    { row: 3, column: 2 },
    { row: 1, column: 1 }
  ]
});

function sideOfSix(shape: FormationShape): readonly BattleUnit[] {
  return SIX_CELLS[shape].map((cell, index) =>
    unitFrom({
      id: `crew:six_${String(index)}`,
      side: 'crew',
      hero: heroId(index),
      role: roleForRow(cell.row),
      cell,
      combat: SIX_ATTRIBUTES
    })
  );
}

function sideOfFour(layout: string): readonly BattleUnit[] {
  return (FOUR_LAYOUTS[layout] ?? FOUR_LAYOUTS['line']!).map((cell, index) =>
    unitFrom({
      id: `foe:four_${String(index)}`,
      side: 'foe',
      hero: null,
      role: roleForRow(cell.row),
      cell,
      combat: FOUR_ATTRIBUTES
    })
  );
}

/** One archer at the back of column 2, with `ahead` of his own between him and the enemy. */
function archerBehind(ahead: number): readonly BattleUnit[] {
  const archer = unitFrom({
    id: 'crew:archer',
    side: 'crew',
    hero: heroId(0),
    role: CombatRole.Rear,
    cell: { row: 3, column: 2 },
    combat: { might: 40, guard: 60, aim: 90, focus: 90, care: 40 }
  });

  const screen = ([1, 2] as const).slice(0, ahead).map((row, index) =>
    unitFrom({
      id: `crew:screen_${String(index)}`,
      side: 'crew',
      hero: heroId(index + 1),
      role: roleForRow(row),
      cell: { row, column: 2 },
      combat: { might: 60, guard: 80, aim: 40, focus: 40, care: 40 }
    })
  );

  return [archer, ...screen];
}

const roleForRow = (row: 1 | 2 | 3): CombatRole =>
  row === 1 ? CombatRole.Vanguard : row === 2 ? CombatRole.Support : CombatRole.Rear;

/** Everything §12.5 asks for, in the order it asks for it. */
export function measureAll(content: ContentSet): readonly Measurement[] {
  const fought = fightTheCoreSet(content);

  return [
    battleLength(fought),
    doctrineBreaches(fought),
    formationChangesOutcome(fought),
    formationDominance(),
    sixAgainstFour(),
    rearEffectByCrewSize(),
    forecastAgreement(fought),
    dominantCrew(content)
  ];
}
