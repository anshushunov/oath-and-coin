/**
 * The eight corridors `COMBAT_SPEC` §12.5 declares, **before** balancing.
 *
 * **A file in the repository and no flag that moves it.** That is §12.5 in as many words,
 * and the reason is the one `MVP_PLAN` §6.4 gives about the frozen set: a threshold a run
 * can be told to relax is a threshold the run agrees with by construction. Changing one is a
 * change to this file, in a commit, with a reason — which is what makes it possible to ask
 * later whether the numbers moved to fit the game or the game moved to fit the numbers.
 *
 * **A violated threshold is a non-zero exit, not a line in the report** (§12.5, a direct
 * finding of external review of the spec). A report that prints a violation and exits zero
 * is not a gate.
 *
 * Every number here is `COMBAT_SPEC` §12.5's own; none is derived and none is rounded off
 * something else. Where the spec states a corridor, both ends are written down.
 */

/** A corridor a measurement has to land inside, both ends inclusive. */
export interface Corridor {
  readonly least: number;
  readonly most: number;
}

export const Thresholds = Object.freeze({
  /** Median rounds a battle lasts. Under six is a scuffle; at twelve it is the ceiling. */
  battleLengthRounds: Object.freeze({ least: 6, most: 12 }) satisfies Corridor,

  /**
   * Share of battles in which somebody broke the doctrine for a friend, in per cent.
   *
   * "Rare" without a number is not measurable (`MVP_PLAN` §6.4), and outside this corridor
   * the answer is a content defect rather than an observation about rarity.
   */
  doctrineBreachPercent: Object.freeze({ least: 10, most: 25 }) satisfies Corridor,

  /**
   * Share of scenarios where changing the formation changes the outcome, in per cent.
   *
   * The floor `MVP_PLAN` §6.4 asks for by name. Below it the board is decoration.
   */
  formationChangesOutcomePercent: 25,

  /** Share of battles the six win against the four at equal capability, in per cent. */
  sixAgainstFourPercent: Object.freeze({ least: 70, most: 90 }) satisfies Corridor,

  /**
   * Share of objectives the forecast and the battle agree about, in per cent.
   *
   * Both ends are load-bearing and they fail differently (`ADR-016` §2): below the floor the
   * forecast is noise, above the ceiling it was copied from the battle and carries no
   * information a player could be surprised by.
   */
  forecastAgreementPercent: Object.freeze({ least: 55, most: 85 }) satisfies Corridor,

  /** Most a single crew may win of the held-out set, in per cent, before it dominates. */
  dominantCrewPercent: 60
});
