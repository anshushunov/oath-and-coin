/**
 * Why a unit did what it did — the three closed vocabularies a battle event names
 * (`COMBAT_SPEC` §4.2, §5.1, §7.3).
 *
 * Every code is artifact-safe and is a localization key, the same two obligations
 * `OutcomeReasonCodes` carries and for the same reasons: the intent line prints one, and
 * the stored battle record carries it (§6.4).
 */

/** Why a target is the target. */
export const TargetReasons = Object.freeze({
  /** The enemy's front cell of that column was occupied — the ordinary case. */
  FrontOfTheColumn: 'combat.reason.front_of_the_column',
  /** Their front cell was empty, so the blow landed deeper in the same column. */
  ReachedThroughTheOpenColumn: 'combat.reason.reached_through_the_open_column',
  /** Their whole column was empty, so the blow went round into the next one. */
  WalkedAroundTheEmptyColumn: 'combat.reason.walked_around_the_empty_column',
  /** A short weapon over one's own front rank: depth one, own column, nothing further. */
  OverTheFrontRank: 'combat.reason.over_the_front_rank',
  /** A shot chosen for landing hardest once the formation had taken its share. */
  ClearestShot: 'combat.reason.clearest_shot',
  /** The ally with the least of his health left. */
  TheWorstHurt: 'combat.reason.the_worst_hurt',
  /** The enemy hardest to knock off his row is the one worth freezing. */
  TheHardestToMove: 'combat.reason.the_hardest_to_move',
  /** The enemy least able to keep his footing. */
  TheEasiestToMove: 'combat.reason.the_easiest_to_move',
  /** Back to the row he belongs in, because his own actions live there (§4.1). */
  BackToHisRow: 'combat.reason.back_to_his_row',
  /**
   * Nothing worth doing from where he stands, so he braced instead.
   *
   * Its own reason and not a missing one: `COMBAT_SPEC` §4.1 asks that "nothing to do"
   * never be a turn that disappears, and a screen printing an empty cause is a turn that
   * disappeared with a line of text over it.
   */
  HeldHisGround: 'combat.reason.held_his_ground'
});

export type TargetReason = (typeof TargetReasons)[keyof typeof TargetReasons];

export const TARGET_REASONS: readonly TargetReason[] = Object.freeze(Object.values(TargetReasons));

/*
 * **`BlockReasons` used to sit here and no longer does** (owner's decision of 2026-08-31).
 *
 * Two codes and a `blocked` event, and nothing in the engine ever produced any of the three:
 * an audit over 630 battles — the whole frozen set at all three doctrines — counted them
 * nought times, and a search of the tree found the event only in its own union and in
 * `unitNamedBy`'s switch. It could not have been otherwise: `COMBAT_SPEC` §4.1 makes
 * `Собраться` available always, and the action choice takes the first *available* thing on
 * the doctrine's list — so "he could not" is not a state the rules can reach.
 *
 * Removed rather than left as a promise. A vocabulary that names an event no battle raises
 * teaches a reader that battles have a shape they do not have, and a screen carrying a line
 * for it is a line nobody will ever see. If a later rule makes a chosen action fail — an
 * ability with a cost, a target that moves between the choice and the blow — the event comes
 * back with that rule and with a producer.
 */

/** Why a unit went against the doctrine, or against the signal. */
export const MotiveReasons = Object.freeze({
  /** A bond with somebody who is losing (`COMBAT_SPEC` §7.3) — the one motive in M2. */
  StoodByAFriend: 'combat.motive.stood_by_a_friend'
});

export type MotiveReason = (typeof MotiveReasons)[keyof typeof MotiveReasons];

export const MOTIVE_REASONS: readonly MotiveReason[] = Object.freeze(Object.values(MotiveReasons));
