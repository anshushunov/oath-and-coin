import { OutcomeGrade, OutcomeIntentKind, type OutcomeIntent } from '../domain/outcome.ts';
import { multiplyInt32 } from '../integer-division.ts';

/**
 * Which of the four steps an outcome landed on, and what that step costs and pays
 * (`RESOLUTION_SPEC` §4.6, §5.1, §5.3).
 */

/** How far below zero the margin may sit and still be an outcome the crew came back from. */
export const COSTLY_PERCENT = 10;

/** How far below zero it may sit and still be a failure rather than a catastrophe. */
export const FAILED_PERCENT = 35;

/** What a patron pays for a contract whose objective was not taken but which was survived. */
export const PARTIAL_FEE_PERCENT = 40;

/** Everything a grade decides about settlement and personal cost (`RESOLUTION_SPEC` §5). */
export interface OutcomeTerms {
  readonly objectiveTaken: boolean;

  /** The patron's share, as a percentage of `patronFee`. */
  readonly patronFeePercent: number;

  /** How many `HeroConsequence` records this grade produces — exactly, not at most. */
  readonly maxConsequences: number;

  /**
   * Whether the promised bonus is still owed. `true` at every grade, and the constant is
   * written out rather than assumed: this is the field a later "failure discharges the
   * promise" idea would have to change on purpose (§5.3).
   */
  readonly promiseStands: boolean;
}

/** What `gradeFromIntents` reads. */
export interface GradeInput {
  /** §4.4's intents. Only the coverage ones are consulted, by kind. */
  readonly intents: readonly OutcomeIntent[];

  readonly margin: number;

  /** `Σ required(n)` across the contract's needs — what the thresholds are a share of. */
  readonly totalRequired: number;
}

const TERMS: Readonly<Record<OutcomeGrade, OutcomeTerms>> = Object.freeze({
  [OutcomeGrade.Clean]: {
    objectiveTaken: true,
    patronFeePercent: 100,
    maxConsequences: 0,
    promiseStands: true
  },
  [OutcomeGrade.Costly]: {
    objectiveTaken: true,
    patronFeePercent: 100,
    maxConsequences: 1,
    promiseStands: true
  },
  [OutcomeGrade.Failed]: {
    objectiveTaken: false,
    patronFeePercent: PARTIAL_FEE_PERCENT,
    maxConsequences: 1,
    promiseStands: true
  },
  [OutcomeGrade.Disaster]: {
    objectiveTaken: false,
    patronFeePercent: 0,
    maxConsequences: 2,
    promiseStands: true
  }
});

/**
 * The step the outcome landed on (`RESOLUTION_SPEC` §4.6).
 *
 * **Read from the intents, not chosen and then decorated.** "Every need closed" is asked
 * of the intents themselves — a `need_short` is exactly a need that did not close — rather
 * than of a verdict list assembled beside them. If the step were picked first, the heroes'
 * own actions could not causally produce it and the trace would be explaining scenery
 * (`ADR-014`).
 *
 * **"Every need closed", not "no need weak".** Edition 1.0 asked only the weaker question,
 * and at unequal weights a large allowed surplus covered a small need that was not
 * supplied at all: `+40` against a requirement of 200 and `−10` against one of 10 gave a
 * positive margin and a formal "clean" with a need nobody answered.
 *
 * **The thresholds are shares of what was asked, cross-multiplied rather than divided.**
 * A margin of `−20` is a catastrophe against a requirement of 50 and a scratch against one
 * of 200; thresholds in absolute points would make small contracts impossible to fail
 * gently and large ones impossible to fail at all. Written as `margin × 100 >= −(percent ×
 * totalRequired)` so no division truncates a boundary into the wrong side of itself.
 */
export function gradeFromIntents(input: GradeInput): OutcomeGrade {
  const everyNeedClosed = !input.intents.some(
    (intent) => intent.kind === OutcomeIntentKind.NeedShort
  );
  const scaled = multiplyInt32(input.margin, 100);

  if (input.margin >= 0) {
    return everyNeedClosed ? OutcomeGrade.Clean : OutcomeGrade.Costly;
  }

  if (scaled >= -multiplyInt32(COSTLY_PERCENT, input.totalRequired)) {
    return OutcomeGrade.Costly;
  }

  if (scaled >= -multiplyInt32(FAILED_PERCENT, input.totalRequired)) {
    return OutcomeGrade.Failed;
  }

  return OutcomeGrade.Disaster;
}

/** What `grade` decides about the settlement and the people (`RESOLUTION_SPEC` §5). */
export function termsOf(grade: OutcomeGrade): OutcomeTerms {
  return TERMS[grade];
}

/**
 * How bad a grade is, as a number that only ever gets compared.
 *
 * Exists so a property can say "boosting a hero never makes the outcome worse" without
 * restating the order of the four steps at every call site — a second statement of that
 * order is a second thing to keep in step.
 */
export function severityOf(grade: OutcomeGrade): number {
  switch (grade) {
    case OutcomeGrade.Clean:
      return 0;
    case OutcomeGrade.Costly:
      return 1;
    case OutcomeGrade.Failed:
      return 2;
    case OutcomeGrade.Disaster:
      return 3;
  }
}
