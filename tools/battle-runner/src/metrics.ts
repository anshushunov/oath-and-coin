import type { ContentSet, ContractDefinition } from '@oath-and-coin/content';
import {
  BattleOutcome,
  CombatRole,
  DoctrineId,
  MAX_ROUNDS,
  battleResolver,
  forecastReadiness,
  runBattle,
  startBattle,
  unitFrom,
  type BattleRecord,
  type BattleUnit,
  type Cell,
  type CoverageVerdict,
  type HeroCombatLayer,
  heroId
} from '@oath-and-coin/simulation';

import { crewsOf, inputFor } from './campaign.ts';
import { FORMATION_SHAPES, type FormationShape } from './formations.ts';
import { CORE_PATTERNS, HELD_OUT_PATTERNS, subdueEverything } from './patterns.ts';
import { Thresholds, type Corridor } from './thresholds.ts';

/**
 * The eight measurements `COMBAT_SPEC` §12.5 declares, each computed from battles this
 * repository can re-fight, and each printed beside the command that took it (`AGENTS.md`
 * §11).
 *
 * **Every number here is a share or a median of the frozen set** — never of a sample, never
 * of whatever ran fastest. The set is enumerated in `patterns.ts` and built in
 * `campaign.ts`; what this file does is ask eight questions of it.
 */

export interface Measurement {
  readonly id: string;
  /** What the measurement says, in the units §12.5 states it in. */
  readonly value: number;
  /** How the value should read on a report — per cent, rounds, a count. */
  readonly unit: 'percent' | 'rounds' | 'count';
  /** The corridor or floor §12.5 declared, as a sentence. */
  readonly threshold: string;
  readonly withinThreshold: boolean;
  /**
   * `ok` inside its corridor, `fail` outside it, `open` outside it and left there by a
   * decision (`thresholds.ts`, {@link Thresholds.openByDecision}).
   *
   * The third is not a fourth kind of passing. It says the corridor still stands, the number
   * is still outside it, and somebody decided to live with that on a stated date — which is
   * a different sentence from "the corridor was moved" and has to read differently.
   */
  readonly status: 'ok' | 'fail' | 'open';
  /** How many battles this number was taken over — a share of nothing is not a share. */
  readonly cases: number;
  /** Anything the number alone does not say. */
  readonly note?: string;
}

/**
 * What a measurement's verdict is, once the owner's open list has been consulted.
 *
 * One place, so a measurement cannot be "within" here and "open" there — and so adding a
 * ninth measurement inherits the rule instead of restating it.
 */
function statusOf(id: string, withinThreshold: boolean): Measurement['status'] {
  if (withinThreshold) {
    return 'ok';
  }

  return id in Thresholds.openByDecision ? 'open' : 'fail';
}

/** One fought case of the frozen set. */
export interface FoughtCase {
  readonly contract: string;
  readonly crew: string;
  readonly shape: FormationShape;
  readonly record: BattleRecord;
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
        const input = inputFor({ content, definition, crew, shape });
        const draft = battleResolver(input);

        fought.push({
          contract: definition.id,
          crew: crew.map((hero) => hero.id).join('+'),
          shape,
          record: draft.resolution.battle!,
          verdicts: draft.resolution.coverage.map((row) => row.verdict),
          forecast: forecastReadiness(input).objectives.map((one) => one.verdict)
        });
      }
    }
  }

  return fought;
}

/** §12.5, row 1: the median length of a battle, in rounds. */
export function battleLength(fought: readonly FoughtCase[]): Measurement {
  const rounds = fought.map((one) => one.record.rounds).sort((left, right) => left - right);
  const median = medianOf(rounds);

  return {
    id: 'battle_length_rounds',
    value: median,
    unit: 'rounds',
    threshold: corridorOf(Thresholds.battleLengthRounds, 'median'),
    withinThreshold: inside(median, Thresholds.battleLengthRounds),
    status: statusOf('battle_length_rounds', inside(median, Thresholds.battleLengthRounds)),
    cases: fought.length,
    note: `${String(rounds.filter((one) => one === MAX_ROUNDS).length)} of ${String(rounds.length)} reached the ${String(MAX_ROUNDS)}-round ceiling`
  };
}

/** §12.5, row 2: the share of battles somebody broke the doctrine in. */
export function doctrineBreaches(fought: readonly FoughtCase[]): Measurement {
  const broken = fought.filter((one) =>
    one.record.events.some((event) => event.kind === 'doctrine_broken')
  ).length;

  const percent = shareOf(broken, fought.length);

  return {
    id: 'doctrine_breach_percent',
    value: percent,
    unit: 'percent',
    threshold: corridorOf(Thresholds.doctrineBreachPercent, '', '%'),
    withinThreshold: inside(percent, Thresholds.doctrineBreachPercent),
    status: statusOf('doctrine_breach_percent', inside(percent, Thresholds.doctrineBreachPercent)),
    cases: fought.length
  };
}

/**
 * §12.5, row 3: the share of scenarios where changing the formation changes the outcome.
 *
 * A *scenario* is a contract and a crew; the three shapes are what varies inside it. That is
 * the unit `MVP_PLAN` §6.4 names — "распределение побед при смене расстановки" — and
 * counting battles instead would let one badly-placed crew stand for three.
 */
export function formationChangesOutcome(fought: readonly FoughtCase[]): Measurement {
  const scenarios = new Map<string, Set<string>>();

  for (const one of fought) {
    const key = `${one.contract}|${one.crew}`;
    const seen = scenarios.get(key) ?? new Set<string>();
    seen.add(`${one.record.outcome}:${one.verdicts.join(',')}`);
    scenarios.set(key, seen);
  }

  const moved = [...scenarios.values()].filter((seen) => seen.size > 1).length;
  const percent = shareOf(moved, scenarios.size);

  return {
    id: 'formation_changes_outcome_percent',
    value: percent,
    unit: 'percent',
    threshold: `≥ ${String(Thresholds.formationChangesOutcomePercent)}%`,
    withinThreshold: percent >= Thresholds.formationChangesOutcomePercent,
    status: statusOf(
      'formation_changes_outcome_percent',
      percent >= Thresholds.formationChangesOutcomePercent
    ),
    cases: scenarios.size
  };
}

/**
 * §12.5, row 4: no formation wins every pattern.
 *
 * The value is the largest number of patterns any one shape wins; the threshold is that it
 * is below the number of patterns. Stated that way rather than as a boolean because a
 * report that prints `true` says nothing about how close it came.
 */
export function formationDominance(content: ContentSet): Measurement {
  const definition = firstBattleContract(content);
  const crew = content.heroes.values().slice(0, definition.requiredCrew);
  const wins = new Map<FormationShape, number>();

  for (const [name, foes] of Object.entries(CORE_PATTERNS)) {
    void name;
    const plan = subdueEverything(foes);
    const scored = FORMATION_SHAPES.map((shape) => ({
      shape,
      score: scoreOf(
        battleResolver(inputFor({ content, definition, crew, shape, plan })).resolution.battle!
      )
    })).sort((left, right) => right.score - left.score);

    const [best, second] = scored;

    if (best !== undefined && second !== undefined && best.score > second.score) {
      wins.set(best.shape, (wins.get(best.shape) ?? 0) + 1);
    }
  }

  const patterns = Object.keys(CORE_PATTERNS).length;
  const most = Math.max(0, ...wins.values());

  return {
    id: 'formation_strict_dominance',
    value: most,
    unit: 'count',
    threshold: `no shape wins all ${String(patterns)}`,
    withinThreshold: most < patterns,
    status: statusOf('formation_strict_dominance', most < patterns),
    cases: patterns,
    note: `winners: ${[...wins.entries()].map(([shape, count]) => `${shape}×${String(count)}`).join(', ') || 'none — every pattern tied'}`
  };
}

/**
 * §12.5, row 5: what six do against four **at equal total capability** (`COMBAT_SPEC`
 * §4.7 п.2).
 *
 * **Six against four, not six-against-a-pattern compared with four-against-a-pattern.** The
 * first edition of this measurement did the second, and it answered 100% every time for a
 * reason that had nothing to do with geometry: six men leave more survivors than four
 * against the same enemy, always, so the comparison was of crew sizes rather than of a
 * fight between them.
 *
 * "Equal capability" is the **total**, which is what makes the question about the economy of
 * actions rather than about strength: six at two thirds of the attributes against four at
 * full. Fought directly rather than through a contract — no coverage is involved in "who was
 * left standing", and routing it through one would make the answer depend on what a
 * contract happened to ask for.
 */
export function sixAgainstFour(): Measurement {
  let won = 0;
  let fought = 0;

  for (const shape of FORMATION_SHAPES) {
    for (const layout of Object.keys(FOUR_LAYOUTS)) {
      const record = runBattle(
        startBattle([...sideOfSix(shape), ...sideOfFour(layout)], DoctrineId.HoldTheLine)
      );

      fought += 1;

      if (record.outcome === BattleOutcome.CrewStanding) {
        won += 1;
      }
    }
  }

  const percent = shareOf(won, fought);

  return {
    id: 'six_against_four_percent',
    value: percent,
    unit: 'percent',
    threshold: corridorOf(Thresholds.sixAgainstFourPercent, '', '%'),
    withinThreshold: inside(percent, Thresholds.sixAgainstFourPercent),
    status: statusOf('six_against_four_percent', inside(percent, Thresholds.sixAgainstFourPercent)),
    cases: fought
  };
}

/**
 * §12.5, row 6: a rear unit's action lands for less as its own side crowds the board in
 * front of it (§4.7 п.3).
 *
 * **One archer, and only the number of men in front of him varies.** The first edition took
 * a different crew for every size, so it was measuring rosters: at sizes 5 and 6 the crew
 * changed and the mean rose, which says nothing about obstruction. Here the archer is the
 * same man in the same cell every time, and what changes is how many of his own stand
 * between him and the enemy — which is the mechanism §4.7 declares and demands be measured
 * rather than asserted.
 *
 * The value is the number of steps where the mean did *not* fall; nought is the passing
 * answer.
 */
export function rearEffectByCrewSize(): Measurement {
  const means: { readonly ahead: number; readonly mean: number }[] = [];

  for (const ahead of [0, 1, 2]) {
    const record = runBattle(
      startBattle([...archerBehind(ahead), ...sideOfFour('line')], DoctrineId.HoldTheLine)
    );

    means.push({ ahead, mean: meanRearEffect(record) });
  }

  const rises = means.filter(
    (one, index) => index > 0 && one.mean >= (means[index - 1]?.mean ?? 0)
  ).length;

  return {
    id: 'rear_effect_by_own_men_ahead',
    value: rises,
    unit: 'count',
    threshold: 'falls at every step (0 that do not)',
    withinThreshold: rises === 0,
    status: statusOf('rear_effect_by_own_men_ahead', rises === 0),
    cases: means.length,
    note: means.map((one) => `${String(one.ahead)} ahead: ${String(one.mean)}`).join(', ')
  };
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

  const percent = shareOf(agreed, asked);

  return {
    id: 'forecast_agreement_percent',
    value: percent,
    unit: 'percent',
    threshold: corridorOf(Thresholds.forecastAgreementPercent, '', '%'),
    withinThreshold: inside(percent, Thresholds.forecastAgreementPercent),
    status: statusOf(
      'forecast_agreement_percent',
      inside(percent, Thresholds.forecastAgreementPercent)
    ),
    cases: asked
  };
}

/**
 * §12.5, row 8: no crew dominates the **held-out** set.
 *
 * Read off `HELD_OUT_PATTERNS` and nothing else. A dominance question asked on the set the
 * numbers were tuned against answers about the tuning.
 */
export function dominantCrew(content: ContentSet): Measurement {
  const definition = firstBattleContract(content);
  const pool = content.heroes.values();
  const patterns = Object.entries(HELD_OUT_PATTERNS);
  let most = 0;
  let by = '';

  for (const crew of crewsOf(pool, definition.requiredCrew)) {
    let won = 0;
    let asked = 0;

    for (const [, foes] of patterns) {
      // Every shape, not one: a crew that wins a pattern only when placed exactly right is
      // not a crew that dominates it, and asking with one shape would let the shape decide
      // the answer to a question about crews.
      for (const shape of FORMATION_SHAPES) {
        const record = battleResolver(
          inputFor({ content, definition, crew, shape, plan: subdueEverything(foes) })
        ).resolution.battle!;

        asked += 1;

        if (record.outcome === BattleOutcome.CrewStanding) {
          won += 1;
        }
      }
    }

    const percent = shareOf(won, asked);

    if (percent > most) {
      most = percent;
      by = crew.map((hero) => hero.id).join('+');
    }
  }

  return {
    id: 'dominant_crew_percent',
    value: most,
    unit: 'percent',
    threshold: `≤ ${String(Thresholds.dominantCrewPercent)}%`,
    withinThreshold: most <= Thresholds.dominantCrewPercent,
    status: statusOf('dominant_crew_percent', most <= Thresholds.dominantCrewPercent),
    cases: patterns.length * FORMATION_SHAPES.length,
    note: by === '' ? 'no crew won anything' : `best: ${by}`
  };
}

/** How well a battle went, as one comparable number: outcome, then who is left, then health. */
function scoreOf(record: BattleRecord): number {
  const rank: Readonly<Record<BattleOutcome, number>> = {
    [BattleOutcome.CrewStanding]: 3,
    [BattleOutcome.TimedOut]: 2,
    [BattleOutcome.Retreated]: 1,
    [BattleOutcome.FoesStanding]: 0
  };

  const crew = record.final.units.filter((unit) => unit.side === 'crew' && unit.hero !== null);
  const standing = crew.filter((unit) => unit.standing).length;
  const health = crew.reduce((total, unit) => total + unit.health, 0);

  // Lexicographic, packed: the outcome outranks any number of survivors, and survivors
  // outrank any amount of health. Written as one number so a sort needs no comparator, and
  // the multipliers are far above what the terms below them can reach.
  return rank[record.outcome] * 100_000 + standing * 1_000 + health;
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
 * The contract every geometry measurement is fought on.
 *
 * One of them, and the *first* by content id rather than a hand-picked favourite: these six
 * rows are about the board and not about a job, and the plan they use is a synthetic one
 * anyway (`subdueEverything`). What the contract supplies is the risk, the needs and the
 * crew size — everything a `ResolutionInput` has to have.
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

/**
 * Whether a measurement landed inside its corridor, and how the corridor reads.
 *
 * Both from `thresholds.ts` and from nowhere else — the numbers in this file's prose are
 * commentary, and a corridor written out twice is a corridor that can disagree with itself
 * (`COMBAT_SPEC` §12.5 keeps them in one file for exactly that reason).
 */
const inside = (value: number, corridor: Corridor): boolean =>
  value >= corridor.least && value <= corridor.most;

const corridorOf = (corridor: Corridor, prefix = '', suffix = ''): string =>
  `${prefix === '' ? '' : `${prefix} `}${String(corridor.least)}–${String(corridor.most)}${suffix}`;

const shareOf = (part: number, whole: number): number =>
  whole === 0 ? 0 : Math.round((part * 100) / whole);

function medianOf(sorted: readonly number[]): number {
  if (sorted.length === 0) {
    return 0;
  }

  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 1
    ? sorted[middle]!
    : Math.round(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2);
}

/** Everything §12.5 asks for, in the order it asks for it. */
export function measureAll(content: ContentSet): readonly Measurement[] {
  const fought = fightTheCoreSet(content);

  return [
    battleLength(fought),
    doctrineBreaches(fought),
    formationChangesOutcome(fought),
    formationDominance(content),
    sixAgainstFour(),
    rearEffectByCrewSize(),
    forecastAgreement(fought),
    dominantCrew(content)
  ];
}

/**
 * The two synthetic sides row 5 is fought between (`COMBAT_SPEC` §4.7 п.2).
 *
 * Equal totals: six at two thirds of each attribute against four at full. Written out rather
 * than derived from a ratio so the arithmetic is visible — `6 × 60 = 4 × 90` on every
 * attribute, and the reader can check it without running anything.
 */
const SIX_ATTRIBUTES: HeroCombatLayer = { might: 60, guard: 60, aim: 60, focus: 60, care: 60 };
const FOUR_ATTRIBUTES: HeroCombatLayer = { might: 90, guard: 90, aim: 90, focus: 90, care: 90 };

/** The three shapes, as cells for a side of six on its own board. */
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

  const screen = [1, 2].slice(0, ahead).map((row, index) =>
    unitFrom({
      id: `crew:screen_${String(index)}`,
      side: 'crew',
      hero: heroId(index + 1),
      role: roleForRow(row as 1 | 2 | 3),
      cell: { row: row as 1 | 2 | 3, column: 2 },
      combat: { might: 60, guard: 80, aim: 40, focus: 40, care: 40 }
    })
  );

  return [archer, ...screen];
}

const roleForRow = (row: 1 | 2 | 3): CombatRole =>
  row === 1 ? CombatRole.Vanguard : row === 2 ? CombatRole.Support : CombatRole.Rear;
