import { REASON_CODES, ReasonCodes, type ReasonCode } from '@oath-and-coin/simulation';

import type { HeroCard, ResponseLine } from './contract-offer-screen-model.ts';
import { HeroStance, heroOfferRows } from './hero-offer-row.ts';
import { BlockerKeys } from './keys.ts';
import { OfferLeverId } from './refused-lever.ts';
import { ReasonDirection } from './screen-state.ts';

/**
 * What changes one reason: where on the screen its lever stands, and the word the summary
 * prints for it.
 *
 * `leverId` is `null` exactly when nothing in this package changes the reason — the guild's
 * reputation, a hero's mood, a trait on a tag the contract carries itself. `remedyKey` is never
 * `null`: "this package does not change it" is a line the player reads, not a blank.
 */
export interface Remedy {
  readonly leverId: OfferLeverId | null;
  readonly remedyKey: string;
}

/**
 * One line of the offer screen's "what stands in the way" (`DEC-019`): a reason that held at
 * least one hero back, every hero it held, and what changes it.
 *
 * One line per reason *and remedy*: an aversion that fired on the contract's own tag for one
 * hero and on the chosen method for another is two lines, because one lever cannot be true of
 * both.
 */
export interface BlockingReason {
  /** The engine's own code — itself the localization key of the reason's name. */
  readonly reasonCode: string;
  readonly leverId: OfferLeverId | null;
  readonly remedyKey: string;
  /** Who this reason held back, in the order the squad is drawn in (`heroOfferRows`). */
  readonly heroDisplayNameKeys: readonly string[];
}

const TERMS = OfferLeverId.Terms;

/**
 * Every reason code the engine has, and what changes it (`DEC-019`, the table).
 *
 * **Total by construction and by test.** Typed as a `Record` over `ReasonCode`, so a code the
 * engine gains without a line here stops compiling; `blocking-reasons.test.ts` walks
 * `REASON_CODES` against it in both directions, so it reddens without the compiler too. The
 * whole dictionary (13), not `FACTOR_REASON_CODES` (11): a principle and a tie-break are codes
 * an answer carries as well, and a table that skipped them "because the summary handles them
 * elsewhere" would be the hand-picked subset the test exists to forbid.
 *
 * **Derived, not invented:** the lever is the one that moves the input the factor reads in
 * `decide` (`contract-decision-rule.ts`). `null` — "never in the summary" — only for the
 * tie-break, which settles a dead heat toward accepting and so never stands behind a refusal.
 *
 * The rows for reasons that pull toward *accepting* (payment, promise, conviction, comrade,
 * trust) are never reached by the summary — on a refusal only the negative factors support
 * the answer — and are here for totality, not for the screen.
 *
 * **The three rows that read a tag are the rows for the contract's own tag.** A conviction, an
 * aversion and a principle read `effectiveTags` — the contract's authored tags plus the chosen
 * method — and of those the package moves only the method. So this table answers for a tag
 * the contract carries itself ("not changed by this package", "cannot be bargained with"), and
 * {@link LEVER_ON_CHOSEN_METHOD} for the method's tag; which of the two applies is the
 * factory's fact on the line (`ReasonLine.onChosenMethod`, `ResponseLine.blockedOnChosenMethod`).
 */
export const LEVER_OF_REASON: Readonly<Record<ReasonCode, Remedy | null>> = Object.freeze({
  [ReasonCodes.PaymentAttractive]: { leverId: TERMS, remedyKey: BlockerKeys.Advance },
  [ReasonCodes.PaymentInsulting]: { leverId: TERMS, remedyKey: BlockerKeys.Advance },
  [ReasonCodes.PromiseOfABonus]: { leverId: TERMS, remedyKey: BlockerKeys.Promise },
  [ReasonCodes.StandsWithComrade]: { leverId: OfferLeverId.Crew, remedyKey: BlockerKeys.Crew },
  [ReasonCodes.WillNotWorkWith]: { leverId: OfferLeverId.Crew, remedyKey: BlockerKeys.Crew },
  [ReasonCodes.PersonalConviction]: { leverId: null, remedyKey: BlockerKeys.NotThisPackage },
  [ReasonCodes.PersonalAversion]: { leverId: null, remedyKey: BlockerKeys.NotThisPackage },
  // The owner's decision of 2026-09-20: "outweighed by the advance", not "cannot be helped".
  [ReasonCodes.RiskTooHigh]: { leverId: TERMS, remedyKey: BlockerKeys.OutweighedByAdvance },
  [ReasonCodes.PrincipleForbids]: { leverId: null, remedyKey: BlockerKeys.Principle },
  [ReasonCodes.TrustsTheGuild]: { leverId: null, remedyKey: BlockerKeys.Reputation },
  [ReasonCodes.GuildBrokeItsWord]: { leverId: null, remedyKey: BlockerKeys.Reputation },
  [ReasonCodes.UnpredictableMood]: { leverId: null, remedyKey: BlockerKeys.NotThisPackage },
  [ReasonCodes.NoReasonToRefuse]: null
});

/**
 * What changes a trait that fired on the tag the chosen method adds: the method. One remedy
 * for all three codes that read a tag — another method takes the tag away, whatever the trait
 * did with it (`DEC-019`; `method_choice_flips_the_key_hero` opens a hero closed by
 * `core:refuses_deception` exactly so).
 */
export const LEVER_ON_CHOSEN_METHOD: Remedy = Object.freeze({
  leverId: TERMS,
  remedyKey: BlockerKeys.Method
});

/**
 * The "what stands in the way" summary of the offer screen (`DEC-019`), one line per reason.
 *
 * **Only what supports a refusal.** A refused hero's reasons with `direction: Supported`; the
 * strongest counter-argument a response also carries is a reason *for* the contract, and
 * printing it under "what stands in the way" would be the lie `DEC-004` forbids. An accepting
 * hero adds nothing. A hero closed by a principle adds his name to a principle line at the
 * end — a red line has no strength to outweigh.
 *
 * **The lever follows the tag's source.** A reason on the chosen method's tag gets
 * {@link LEVER_ON_CHOSEN_METHOD}, any other its row of the table; a principle likewise, by
 * `blockedOnChosenMethod`. Same code, different remedy — different line.
 *
 * **Order.** Lines in the order a reason is first met walking the squad as the screen draws it
 * (`heroOfferRows`: refusals first, roster order inside) and each answer's reasons strongest
 * first; names in that same order, each once per line. The principle lines close the list, in
 * the order their first hero is met. No sort of its own: the order is the squad's, so the
 * summary and the cards under it read the same way down.
 *
 * Takes the two lists it reads, like `heroOfferRows`, rather than the whole model.
 *
 * @throws when an answer carries a code the table does not know — the engine's dictionary is
 * closed and a save is held to it on the way in, so such a code is a defect upstream, and the
 * summary does not pick a lever for it silently.
 */
export function blockingReasons(source: {
  readonly roster: readonly HeroCard[];
  readonly responses: readonly ResponseLine[];
}): readonly BlockingReason[] {
  const reasons = new SummaryLines();
  const principles = new SummaryLines();

  for (const row of heroOfferRows(source)) {
    if (row.response === null) {
      continue;
    }

    const hero = row.hero.displayNameKey;

    if (row.stance === HeroStance.Blocked) {
      const remedy = row.response.blockedOnChosenMethod
        ? LEVER_ON_CHOSEN_METHOD
        : remedyOf(ReasonCodes.PrincipleForbids);

      if (remedy !== null) {
        principles.add(ReasonCodes.PrincipleForbids, remedy, hero);
      }

      continue;
    }

    if (row.stance !== HeroStance.Refused) {
      continue;
    }

    for (const reason of row.response.reasons) {
      if (reason.direction !== ReasonDirection.Supported) {
        continue;
      }

      const remedy = reason.onChosenMethod ? LEVER_ON_CHOSEN_METHOD : remedyOf(reason.reasonCode);

      if (remedy !== null) {
        reasons.add(reason.reasonCode, remedy, hero);
      }
    }
  }

  return [...reasons.list(), ...principles.list()];
}

/** Lines of the summary keyed by reason and remedy, in the order each is first met. */
class SummaryLines {
  readonly #lines = new Map<
    string,
    { readonly reasonCode: string; readonly remedy: Remedy; readonly heroes: string[] }
  >();

  add(reasonCode: string, remedy: Remedy, hero: string): void {
    // A reason code is `[a-z_.]` and a key the same, so a space cannot occur in either.
    const key = `${reasonCode} ${remedy.remedyKey}`;
    const line = this.#lines.get(key) ?? { reasonCode, remedy, heroes: [] };

    if (!line.heroes.includes(hero)) {
      line.heroes.push(hero);
    }

    this.#lines.set(key, line);
  }

  list(): BlockingReason[] {
    return [...this.#lines.values()].map(({ reasonCode, remedy, heroes }) => ({
      reasonCode,
      leverId: remedy.leverId,
      remedyKey: remedy.remedyKey,
      heroDisplayNameKeys: heroes
    }));
  }
}

function remedyOf(reasonCode: string): Remedy | null {
  if (!isReasonCode(reasonCode)) {
    throw new Error(
      `A refusal carries reason '${reasonCode}', which is not in the engine's closed dictionary ` +
        '(REASON_CODES) — a defect upstream, not a reason the summary can name a lever for.'
    );
  }

  return LEVER_OF_REASON[reasonCode];
}

function isReasonCode(code: string): code is ReasonCode {
  return (REASON_CODES as readonly string[]).includes(code);
}
