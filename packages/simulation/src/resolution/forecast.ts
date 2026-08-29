import { COLUMNS, ROWS, type Column } from '../domain/battle-cell.ts';
import {
  FORECAST_REASON_CODES,
  ForecastReasonCodes,
  type ForecastReasonCode
} from '../domain/forecast-reason-codes.ts';
import type { NeedId } from '../domain/need-id.ts';
import { CoverageVerdict } from '../domain/outcome.ts';
import { compareHeroIds, type HeroId } from '../ids/hero-id.ts';
import { BOND_STRONG } from '../combat/decision.ts';

import { draftResolution, type ResolutionInput } from './contract-resolver.ts';

/**
 * What the plan is risking, said before the crew is sent (`COMBAT_SPEC` §10.1,
 * `ADR-016` §2, §3).
 *
 * **A function, not a resolver, and that is the whole of `ADR-016` §3.** A forecast has to
 * be able to say "column 2 is open", which means reading the formation; a resolver of
 * coverage must not, and does not (§12.1 п.8). One function cannot be both a pure sum over
 * capability and a reader of columns, so there are two, and this is the one that knows
 * where people stand.
 *
 * **What it prints, and what it refuses to print.** Ranked reasons and the same three
 * verdicts the debrief uses — never a probability (`DEC-006`). The ranking is declaration
 * order in `ForecastReasonCodes`, which is a stated rule; a weighted score would be a
 * probability with the number filed off.
 *
 * **It is a forecast and not a promise** (§10.1). The debrief prints it beside what
 * happened, and a disagreement between the two is content rather than a defect —
 * `ADR-016` §2 makes that measurable: the share of objectives the two agree about has an
 * announced corridor, because a forecast that always agrees carries no information and one
 * that never agrees is noise.
 */

export interface ForecastReason {
  readonly code: ForecastReasonCode;
  /** The need this is about, or `null`. */
  readonly need: NeedId | null;
  /** The hero this is about, or `null`. */
  readonly hero: HeroId | null;
  /** The column this is about, or `null`. */
  readonly column: Column | null;
}

export interface ForecastObjective {
  readonly need: NeedId;
  /**
   * What the abstract resolver expects of this objective (`ADR-016` §2).
   *
   * The same three words the battle answers with, from the same function — which is the
   * point of the whole arrangement: the debrief can put "promised" and "delivered" in one
   * row because both were said in one language.
   */
  readonly verdict: CoverageVerdict;
}

export interface ReadinessForecast {
  readonly objectives: readonly ForecastObjective[];
  /** Ranked, the thing worth saying first at the front. */
  readonly reasons: readonly ForecastReason[];
}

export function forecastReadiness(input: ResolutionInput): ReadinessForecast {
  // The abstract resolver, run on the same crew — `ADR-016` §2's "прогноз и экзамен говорят
  // на одном языке". It is handed the whole input and reads none of the formation, which is
  // the property §12.1 п.8 holds.
  const draft = draftResolution(input);

  const objectives: readonly ForecastObjective[] = draft.resolution.coverage.map((row) => ({
    need: row.need,
    verdict: row.verdict
  }));

  const reasons = [
    ...coverageReasons(objectives),
    ...formationReasons(input),
    ...numbersReasons(input),
    ...bondReasons(input)
  ];

  return { objectives, reasons: [...reasons].sort(byRank) };
}

/** Declaration order first, then whatever the reason names, so no two runs disagree. */
function byRank(left: ForecastReason, right: ForecastReason): number {
  const rank = FORECAST_REASON_CODES.indexOf(left.code) - FORECAST_REASON_CODES.indexOf(right.code);

  if (rank !== 0) {
    return rank;
  }

  if (left.need !== right.need) {
    return (left.need ?? '') < (right.need ?? '') ? -1 : 1;
  }

  if (left.hero !== null && right.hero !== null && left.hero !== right.hero) {
    return compareHeroIds(left.hero, right.hero);
  }

  return (left.column ?? 0) - (right.column ?? 0);
}

function coverageReasons(objectives: readonly ForecastObjective[]): readonly ForecastReason[] {
  return objectives.flatMap((objective) => {
    if (objective.verdict === CoverageVerdict.Closed) {
      return [];
    }

    return [
      {
        code:
          objective.verdict === CoverageVerdict.Uncovered
            ? ForecastReasonCodes.ObjectiveUncovered
            : ForecastReasonCodes.ObjectiveWeak,
        need: objective.need,
        hero: null,
        column: null
      }
    ];
  });
}

/**
 * What the shape of the formation says (`COMBAT_SPEC` §4.3, §4.4).
 *
 * Silent when there is no formation yet, and that is not a gap: this same function answers
 * for a contract nobody has placed a crew on, and a plan whose formation does not exist has
 * nothing to say about columns.
 */
function formationReasons(input: ResolutionInput): readonly ForecastReason[] {
  const deployment = input.deployment;

  if (deployment === undefined) {
    return [];
  }

  const placement = deployment.crew.placement;

  // Both sides of the crew's own board: the heroes the player placed and whatever the
  // contract put there to be kept alive. A ward stands in a cell like anybody else, so a
  // column with a ward in its front is not an open column.
  const occupied = new Set<string>([
    ...placement.values().map((cell) => `${String(cell.row)}:${String(cell.column)}`),
    ...deployment.plan.wards.map((ward) => `${String(ward.cell.row)}:${String(ward.cell.column)}`)
  ]);

  const open: ForecastReason[] = COLUMNS.filter(
    (column) => !occupied.has(`1:${String(column)}`)
  ).map((column) => ({
    code: ForecastReasonCodes.OpenColumn,
    need: null,
    hero: null,
    column
  }));

  const behind: ForecastReason[] = [...placement.entries()]
    .filter(([, cell]) =>
      ROWS.some((row) => row < cell.row && occupied.has(`${String(row)}:${String(cell.column)}`))
    )
    .map(([hero, cell]) => ({
      code: ForecastReasonCodes.RearBehindOwnMen,
      need: null,
      hero,
      column: cell.column
    }));

  return [...open, ...behind];
}

function numbersReasons(input: ResolutionInput): readonly ForecastReason[] {
  const deployment = input.deployment;

  if (deployment === undefined || deployment.plan.foes.length <= input.crew.length) {
    return [];
  }

  return [{ code: ForecastReasonCodes.Outnumbered, need: null, hero: null, column: null }];
}

/**
 * Who in this crew would break formation for whom (`COMBAT_SPEC` §7.3, §13.2 п.3).
 *
 * **Said before the crew is sent, which is the whole reason this line exists.**
 * `DIRECTION_2026-08` §4.8 asks that knowing a *person* change the player's preparation,
 * and knowledge that only arrives in the debrief cannot change a preparation that already
 * happened. The bond is named, the hero who holds it is named, and no number is: how much
 * he holds the other man at is exactly the sort of thing `DEC-006` keeps off a screen.
 *
 * Both ends have to be going. A bond toward somebody who stayed home changes nothing about
 * this battle, and printing it would be a warning about a man who is not there.
 */
function bondReasons(input: ResolutionInput): readonly ForecastReason[] {
  const going = new Set(input.crew.map((member) => member.hero.definition));

  return input.crew
    .filter((member) =>
      member.hero.relationships
        .entries()
        .some(([definition, weight]) => weight >= BOND_STRONG && going.has(definition))
    )
    .map((member) => ({
      code: ForecastReasonCodes.BondMayBreakTheDoctrine,
      need: null,
      hero: member.hero.id,
      column: null
    }));
}
