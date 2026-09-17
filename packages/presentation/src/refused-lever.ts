import { RejectionCodes } from '@oath-and-coin/simulation';

import { OfferAction } from './offer-actions.ts';

/**
 * The places on the offer screen a refusal can stand beside.
 *
 * **A refusal is printed next to the control it is about, and this is the vocabulary of
 * "next to".** Found by the owner playing, 2026-08-31: an advance of 100 against a ceiling
 * of 65 was refused, and `Условие вышло за границы платы заказчика` printed under seven
 * rows of buttons — below the window at 1280×800, while the lever it was about sat in the
 * middle of it. The session stalled there. A sentence about a lever that stands somewhere
 * else on the screen is a sentence a player has to go looking for, and this one he did
 * not find.
 *
 * `Terms` is the three term levers at once — the advance, the method and the promised
 * bonus — and not any one of them, because that is exactly as much as the engine says.
 * `composeOffer` refuses all three with one code (`offer_terms_out_of_bounds`), and a
 * refusal that does not say which term went over cannot be attached to one term without
 * this layer re-checking the bounds itself. The three share one row on the screen, so the
 * row is where the sentence goes. Splitting the code by term is a change to the engine's
 * contract and is not this layer's to make.
 */
export const OfferLeverId = Object.freeze({
  /** The advance, the method and the promised bonus — one row, one ceiling. */
  Terms: 'terms',
  KeyHero: 'key_hero',
  Crew: 'crew',
  /** The board, the doctrine and the retreat threshold (`COMBAT_SPEC` §3.7). */
  Formation: 'formation'
});

export type OfferLeverId = (typeof OfferLeverId)[keyof typeof OfferLeverId];

/**
 * Which lever a refusal is about, or `null` when it is about the package as a whole.
 *
 * **Keyed on the command as well as the code, and the code alone would not do.**
 * `offer_terms_out_of_bounds` is `composeOffer`'s answer for a term past the patron fee
 * *and* `placeCrew`'s for a retreat threshold past one hundred per cent (`engine.ts`),
 * and the two levers are half a screen apart. What is pressed says which.
 *
 * **This is a restatement of which check answers with which code, not of the checks
 * themselves.** Each `RejectionCodes` member's own doc names the command and the term it
 * refuses; this is that doc as a function. Nothing here compares a draft to a bound — a
 * refusal arrives here only after the engine has made it, and the one thing decided is
 * where to print it. `refused-lever.test.ts` holds each row against the engine by running
 * the command and taking the code it actually answered with.
 *
 * `null` is the honest answer for a refusal about the package — its phase, its version,
 * a treasury the *lock* cannot cover is the one money refusal that names the terms — and
 * for one the screen cannot produce at all (`unknown_hero` from a roster the screen was
 * given). Those stand beside the button that was pressed, which is the control they are
 * about.
 */
export function leverOfRefusal(action: OfferAction, rejectionCode: string): OfferLeverId | null {
  switch (action) {
    case OfferAction.Compose:
      switch (rejectionCode) {
        case RejectionCodes.OfferTermsOutOfBounds:
          return OfferLeverId.Terms;
        case RejectionCodes.CrewSizeMismatch:
          return OfferLeverId.Crew;
        case RejectionCodes.KeyHeroNotInvited:
          return OfferLeverId.KeyHero;
        default:
          return null;
      }
    case OfferAction.Lock:
      // `advance × requiredCrew + promisedBonus` against the treasury (`commitmentOf`): the
      // two money levers are what moves that sum, so the sentence stands beside them.
      return rejectionCode === RejectionCodes.TreasuryCannotCoverTheOffer
        ? OfferLeverId.Terms
        : null;
    case OfferAction.Place:
      switch (rejectionCode) {
        case RejectionCodes.OfferTermsOutOfBounds:
        case RejectionCodes.CellTaken:
        case RejectionCodes.UnplacedHero:
          return OfferLeverId.Formation;
        default:
          return null;
      }
    case OfferAction.AskKeyHero:
    case OfferAction.Poll:
    case OfferAction.Resolve:
    case OfferAction.Settle:
      return null;
    default:
      return action satisfies never;
  }
}
