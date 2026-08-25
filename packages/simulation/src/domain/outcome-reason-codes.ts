/**
 * Why a number in the outcome is what it is (`RESOLUTION_SPEC` §2.1).
 *
 * The outcome's own closed vocabulary, and a second one on purpose. `ReasonCodes` names
 * why a *person* answered the way he did; these name what *happened* on the contract.
 * `vocabulary.test.ts` holds the first set to a partition of the three trace roles, and a
 * code from here appearing among them would claim a hero was moved by an event that had
 * not happened when he answered — `outcome-reason-codes.test.ts` holds the two
 * vocabularies disjoint.
 *
 * The same two obligations as over there apply here, for the same reasons: every code is
 * artifact-safe, because it reaches a canonical artifact through the events a resolution
 * produces, and every code is a localization key, because the debrief screen prints it.
 * Its own `outcome.` namespace is what keeps it from colliding with either the decision
 * vocabulary or an error code.
 */
export const OutcomeReasonCodes = Object.freeze({
  /** A need nobody supplied enough for — below the coverage floor entirely. */
  NeedUncovered: 'outcome.need_uncovered',

  /** A need supplied above the floor but below its requirement. */
  NeedWeak: 'outcome.need_weak',

  /** A need supplied to its requirement or beyond. */
  NeedClosed: 'outcome.need_closed',

  /**
   * A hero whose agreement was fragile or resentful gave way early on a need he is
   * answerable for. At most one per hero: the same person appearing three times in the
   * feed would read as the cause of the failure.
   */
  FalteredEarly: 'outcome.faltered_early',

  /** The contract's objective was achieved. */
  ObjectiveTaken: 'outcome.objective_taken',

  /** The contract's objective was not achieved. */
  ObjectiveLost: 'outcome.objective_lost',

  /**
   * The wound went to whoever was on the point of the worst-covered need — never to the
   * weakest contributor. An obligatory scapegoat after every imperfect outcome teaches a
   * player to look for one (`RESOLUTION_SPEC` §5.2).
   */
  WoundOnThePoint: 'outcome.wound_on_the_point',

  /** A hero who gave way early carries a grudge out of it. */
  GrudgeAfterFaltering: 'outcome.grudge_after_faltering',

  /** The key hero's trust in the guild did not survive a disaster. */
  TrustLostInDisaster: 'outcome.trust_lost_in_disaster'
});

export type OutcomeReasonCode = (typeof OutcomeReasonCodes)[keyof typeof OutcomeReasonCodes];

/**
 * Every code above, in declaration order — derived, not typed a second time. See
 * `REASON_CODES` for why the hand-written twin is the thing being avoided.
 */
export const OUTCOME_REASON_CODES: readonly OutcomeReasonCode[] = Object.freeze(
  Object.values(OutcomeReasonCodes)
);
