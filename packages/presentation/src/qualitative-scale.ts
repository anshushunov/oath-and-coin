/**
 * The five-step qualitative vocabulary every hero-facing number is translated into
 * before it reaches a screen.
 *
 * The interface never shows the player a number besides an objective fact like a
 * patron fee in coins: an exact probability turns a hero's choice into an equation to
 * solve instead of a character to read, and that interpretive space is what
 * `DEC-006` decided to keep. Two different underlying scales map onto the same five
 * grades through two different thresholds, because "35" means something different
 * on a 0..100 authored trait than it does on a reason's unbounded strength.
 */
export const QualitativeGrade = Object.freeze({
  Negligible: 'Negligible',
  Low: 'Low',
  Moderate: 'Moderate',
  High: 'High',
  Extreme: 'Extreme'
});

export type QualitativeGrade = (typeof QualitativeGrade)[keyof typeof QualitativeGrade];

/**
 * The grades, in scale order. `Object.values` of the frozen object rather than a
 * second hand-written list: a written-out list is a second declaration of a closed
 * set that the compiler cannot check against the first, and the completeness check
 * against the locale catalogue would keep passing over a grade nobody translated.
 *
 * The C# original derived the same list from `Enum.GetValues<QualitativeGrade>()`
 * for exactly this reason.
 */
export const QUALITATIVE_GRADES: readonly QualitativeGrade[] = Object.freeze(
  Object.values(QualitativeGrade)
);

/**
 * The hero scale: greed, caution, pride and a contract's risk are all authored
 * within `TRAIT_MIN..TRAIT_MAX` (0..100), and this is the fixed five-band split of
 * that range.
 *
 * Total on purpose — every integer maps to exactly one grade, so no caller has to
 * ask what happens out of range. Plain integer comparisons, no floating point,
 * matching every other gameplay number in the core (`TDD` §7.4).
 */
export function gradeForValue(value: number): QualitativeGrade {
  if (value <= 9) return QualitativeGrade.Negligible;
  if (value <= 34) return QualitativeGrade.Low;
  if (value <= 64) return QualitativeGrade.Moderate;
  if (value <= 89) return QualitativeGrade.High;
  return QualitativeGrade.Extreme;
}

/**
 * The reason scale: a trace factor's magnitude has no authored ceiling — it is a
 * product or a sum of several authored values — so this band is wider and
 * open-ended at the top rather than clamped to 100.
 */
export function gradeForMagnitude(magnitude: number): QualitativeGrade {
  if (magnitude <= 4) return QualitativeGrade.Negligible;
  if (magnitude <= 14) return QualitativeGrade.Low;
  if (magnitude <= 29) return QualitativeGrade.Moderate;
  if (magnitude <= 59) return QualitativeGrade.High;
  return QualitativeGrade.Extreme;
}

/**
 * The localization key a grade resolves to. Exposed rather than assembled at each
 * call site: a player-facing key built by hand somewhere else is exactly the ad hoc
 * string assembly the key modules in this package exist to prevent (`TDD` §11.1).
 */
export function qualitativeKey(grade: QualitativeGrade): string {
  return `qualitative.${grade.toLowerCase()}`;
}

/** Every `qualitative.*` key this scale can produce, for the catalogue-completeness check. */
export const QUALITATIVE_KEYS: readonly string[] = Object.freeze(
  QUALITATIVE_GRADES.map(qualitativeKey)
);
