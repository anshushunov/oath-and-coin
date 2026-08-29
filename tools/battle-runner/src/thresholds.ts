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

  /**
   * Share of battles the **six** win against the four at equal *total* capability, in per
   * cent.
   *
   * **10–35, and it used to read 70–90.** `COMBAT_SPEC` §4.7 п.2 declared the corridor the
   * other way round, on `MVP_PLAN` §6.2's argument that one action per hero makes six a half
   * again the economy of four. The first run of this report measured **22%**, and five levers
   * of §3.6 — obstruction at 15/20/30, absorption at 2/3/4/6, the healing formula, the short
   * strike, the health formula — moved it nowhere: it sat between 11 and 22 on every one.
   *
   * The reason is arithmetic rather than a constant. Strength per unit is linear and fire is
   * focused, so four stronger units beat six weaker ones of equal total: the weaker side's
   * output decays faster as it loses men, and its extra bodies stand in rows two and three,
   * where they strike for less and shoot through their own formation. The action economy
   * exists and is eaten by the geometry rather than absent.
   *
   * **Owner's decision, 2026-08-30: the corridor was wrong, not the numbers.** §4.7 п.2 and
   * §6.2's premise are rewritten to say what was measured, and the threshold stays a gate: a
   * floor of 10 holds the claim that numbers are worth something, a ceiling of 35 that the
   * strong side does not take everything.
   */
  sixAgainstFourPercent: Object.freeze({ least: 10, most: 35 }) satisfies Corridor,

  /**
   * Share of objectives the forecast and the battle agree about, in per cent.
   *
   * Both ends are load-bearing and they fail differently (`ADR-016` §2): below the floor the
   * forecast is noise, above the ceiling it was copied from the battle and carries no
   * information a player could be surprised by.
   */
  forecastAgreementPercent: Object.freeze({ least: 55, most: 85 }) satisfies Corridor,

  /**
   * Most a single crew may win of the held-out set, in per cent, before it dominates.
   *
   * **Measured at 78% and left open by the owner's decision of 2026-08-30**, which is why it
   * is declared beside {@link Thresholds.openByDecision} rather than quietly moved to 80.
   *
   * The one change that brings it inside — flattening health from `20 + guard × 3 / 10` to
   * `30 + guard × 2 / 10` — takes it to 56% and breaks `DEC-011`'s own refuting check: three
   * enemy patterns then have two distinct winning formations instead of three, which is the
   * outcome `DEC-011` §Проверка pre-accepts and answers by reducing the field to ranks. Three
   * flattenings were tried and the matrix broke on each. Between a corridor and the decision
   * the whole milestone rests on, the owner kept the matrix.
   */
  dominantCrewPercent: 60,

  /**
   * Measurements the owner has decided not to gate on, with the date the decision was taken.
   *
   * **Not a relaxed threshold and not a silenced one.** The corridor stays exactly where it
   * was declared, the report prints the number and prints `OPEN`, and the exit code ignores
   * this one measurement. What that buys over widening the corridor is that the disagreement
   * stays visible: a number outside a corridor somebody decided to live with reads
   * differently from a number inside a corridor somebody moved.
   *
   * An entry here is a decision and carries its date, so the next reader can ask whether it
   * is still the right one.
   */
  openByDecision: Object.freeze({
    dominant_crew_percent:
      "owner's decision 2026-08-30: kept open rather than fixed, because the only fix breaks DEC-011's refuting check"
  }) as Readonly<Record<string, string>>
});
