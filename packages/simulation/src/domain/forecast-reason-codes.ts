/**
 * Why a plan looks the way it does, **before** the crew is sent (`COMBAT_SPEC` §10.1,
 * `DEC-006`).
 *
 * A third closed vocabulary beside the decision codes and the outcome codes, and a third
 * one on purpose. `ReasonCodes` says why a *person* answered; `OutcomeReasonCodes` says
 * what *happened*; these say what a plan is risking — a claim about the future, and the one
 * kind of claim `DEC-006` will not let carry a number. The `forecast.` namespace is what
 * keeps the three from colliding, and `vocabulary.test.ts` holds them disjoint.
 *
 * **Declaration order is the ranking.** `DEC-006` asks for ranked reasons and qualitative
 * assessments, not probabilities, so the order is a stated rule rather than a score: a need
 * nobody covers outranks a hole in the formation, which outranks a shot fired through one's
 * own men, and so on down. Two reasons of the same kind are then ordered by what they name.
 * A weighted sum here would be a probability with the number filed off.
 */
export const ForecastReasonCodes = Object.freeze({
  /** An objective the crew is not covering at all — the plainest thing to say first. */
  ObjectiveUncovered: 'forecast.objective_uncovered',

  /**
   * A column of the crew's own board whose front cell is empty (`COMBAT_SPEC` §4.4).
   *
   * The sentence a player has to understand on his first battle, and it is one sentence
   * rather than two: an empty column is his line of fire **and** their road to his rear.
   */
  OpenColumn: 'forecast.open_column',

  /** A rear hero firing through his own men, and paying obstruction for it (§4.3). */
  RearBehindOwnMen: 'forecast.rear_behind_own_men',

  /** More of them than of us — the economy of actions §4.7 warns about. */
  Outnumbered: 'forecast.outnumbered',

  /** An objective the crew covers thinly enough that little has to go wrong. */
  ObjectiveWeak: 'forecast.objective_weak',

  /**
   * Somebody in this crew holds somebody else in it dear enough to break formation over
   * (`COMBAT_SPEC` §7.3, §13.2 п.3).
   *
   * **The reason this vocabulary exists at all.** `DIRECTION_2026-08` §4.8 asks that the
   * knowledge of a *person* change the player's preparation, and a control that only
   * measures it after the fact cannot be acted on. This is the line that says it before the
   * crew goes out, and §13.2's third technical prerequisite is exactly that it be said.
   */
  BondMayBreakTheDoctrine: 'forecast.bond_may_break_the_doctrine'
});

export type ForecastReasonCode = (typeof ForecastReasonCodes)[keyof typeof ForecastReasonCodes];

/** Every code above, in declaration order — which is the ranking. */
export const FORECAST_REASON_CODES: readonly ForecastReasonCode[] = Object.freeze(
  Object.values(ForecastReasonCodes)
);
