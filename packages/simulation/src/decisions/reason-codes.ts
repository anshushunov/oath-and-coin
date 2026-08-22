/**
 * Stable, namespaced reason codes usable as `TraceFactor.reasonCode` values (`TDD` §8:
 * "Каждый фактор использует стабильный reason code"). Named constants — not strings
 * assembled inline at each call site — so a factor's meaning cannot drift inside a
 * scoring function, and a rename shows up as a source change rather than a data typo.
 *
 * These stay plain strings while `TraceFactor.sourceEntity` and `Actions` are
 * `ContentId`, and the line between the two conventions is: a reason code is a closed
 * engine vocabulary that becomes a localization key — never authored in content and
 * never addressed from content, so there is nothing for a content-addressable
 * identifier to resolve against. Anything content can author or point at gets a
 * `ContentId`; the engine's own dictionary gets targeted strings.
 *
 * Every code here also has to survive the trip into a canonical artifact, so every one
 * of them is held to `isArtifactSafeText` by a test over {@link REASON_CODES} — the
 * same class of hole external review found in `display_name_key`, closed before it can
 * open: a code with an uppercase letter or a space would make the artifact version's
 * promise of comparability false the first time it was written.
 */

export const ReasonCodes = Object.freeze({
  PaymentAttractive: 'hero.decision.payment_attractive',
  RiskTooHigh: 'hero.decision.risk_too_high',
  TrustsTheGuild: 'hero.decision.trusts_the_guild',
  UnpredictableMood: 'hero.decision.unpredictable_mood',

  /** The offered payment is low enough to be a personal insult. */
  PaymentInsulting: 'hero.decision.payment_insulting',

  /** A personal conviction speaks for taking the contract. */
  PersonalConviction: 'hero.decision.personal_conviction',

  /** A personal aversion speaks against taking the contract. */
  PersonalAversion: 'hero.decision.personal_aversion',

  /** The hero stands with a comrade already committed to this contract. */
  StandsWithComrade: 'hero.decision.stands_with_comrade',

  /** The hero refuses to work alongside someone specific on this contract. */
  WillNotWorkWith: 'hero.decision.will_not_work_with',

  /** A red line — a principle that forbids this action outright, independent of score. */
  PrincipleForbids: 'hero.decision.principle_forbids',

  /**
   * Nothing weighed either way: the motives summed to exactly zero, so accepting and
   * refusing scored the same and the hero went along with the guild. A
   * `CausalTrace.tieBreak` code, not a `TraceFactor.reasonCode` — it has no magnitude,
   * because it is not a motive at all but the rule that settled a dead heat between two
   * equally-scored actions.
   *
   * It exists because of a C# review finding: `score >= 0` quietly resolved that heat
   * toward acceptance while `tieBreak` stayed null, so a hero with zero scales, no
   * trust, no matching trait, no bond and a mood of exactly zero accepted a contract
   * with both factor lists empty and no block — an autonomous decision with not one
   * reason attached, and an optimistic default passed off as character. What the rule
   * chooses is unchanged; what changed is that it says so.
   */
  NoReasonToRefuse: 'hero.decision.no_reason_to_refuse'
});

export type ReasonCode = (typeof ReasonCodes)[keyof typeof ReasonCodes];

/**
 * Every code above, in declaration order.
 *
 * Derived from the object rather than typed out a second time: the C# original kept a
 * hand-written `ImmutableArray` beside the constants and needed a reflection test to
 * stop the two drifting. `Object.values` on a frozen object is that test's job done by
 * construction — a code added above is in this list before anyone remembers the list
 * exists.
 */
export const REASON_CODES: readonly ReasonCode[] = Object.freeze(Object.values(ReasonCodes));

/**
 * The vocabulary split by the **role** a code plays in a {@link CausalTrace}: which codes
 * `contract-decision-rule.ts` can put in a factor list, which in `blockedBy`, and which in
 * `tieBreak`.
 *
 * `REASON_CODES` above says "this is the engine's whole dictionary", and the doc at the
 * top of this file has always said the dictionary is closed — but a *reader* handed a
 * trace off a save file had no set to hold it to. External review of segment 5 measured
 * what that cost: a save with `hero.decision.unknown_but_well_shaped` in a factor,
 * honestly re-signed, passed `readSave`, step restoration and the screen model, and only
 * then reached the strict text catalogue, which throws on a key it does not have. A file
 * that satisfies every format check and kills the screen three layers later is a file the
 * format did not actually validate.
 *
 * Three sets rather than one, because the roles are not interchangeable and the difference
 * is checkable. {@link ReasonCodes.PrincipleForbids} names a red line, which
 * `createDecisionResult` requires to come with a `null` score; a save that moved it into
 * `positiveFactors` would be claiming a hero was *attracted* by a taboo, with a magnitude
 * attached to something the rule states has none. {@link ReasonCodes.NoReasonToRefuse} is
 * not a motive at all — it is the rule that settled a dead heat — and a factor list is
 * exactly where it must not appear. One combined set would accept both of those files.
 *
 * Membership is typed out here rather than derived from the rule, because there is nothing
 * to derive it from: which list a code lands in is a property of the code's meaning, not
 * of any value the rule exports. What is not left to memory is *completeness* —
 * `vocabulary.test.ts` holds the three sets to a partition of `REASON_CODES`, so a code
 * added above and forgotten here reddens rather than becoming a code no save may carry.
 */
export const FACTOR_REASON_CODES: readonly ReasonCode[] = Object.freeze([
  ReasonCodes.PaymentAttractive,
  ReasonCodes.RiskTooHigh,
  ReasonCodes.TrustsTheGuild,
  ReasonCodes.UnpredictableMood,
  ReasonCodes.PaymentInsulting,
  ReasonCodes.PersonalConviction,
  ReasonCodes.PersonalAversion,
  ReasonCodes.StandsWithComrade,
  ReasonCodes.WillNotWorkWith
]);

/** The codes that may appear in {@link CausalTrace.blockedBy}. See
 * {@link FACTOR_REASON_CODES}. */
export const BLOCK_REASON_CODES: readonly ReasonCode[] = Object.freeze([
  ReasonCodes.PrincipleForbids
]);

/** The codes that may appear in {@link CausalTrace.tieBreak}. See
 * {@link FACTOR_REASON_CODES}. */
export const TIE_BREAK_REASON_CODES: readonly ReasonCode[] = Object.freeze([
  ReasonCodes.NoReasonToRefuse
]);
