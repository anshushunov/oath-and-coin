/**
 * What a player may press, stated by the model rather than worked out by the screen.
 *
 * The architecture rule this file serves is the one the contract-loop plan states first:
 * **the screen decides nothing.** Everything pressable is declared here with its allowed
 * values and, when it may not be pressed, with the reason — so a component's only branches
 * stay the two it is allowed: on a field being `null`, and on a list being empty.
 *
 * Three shapes and no more, because a negotiation package has three kinds of term: a
 * number inside a range (the advance, the promised bonus), one choice out of a closed set
 * (the method tag, the key hero) and a fixed-size subset of one (the crew). A fourth kind
 * would be a fourth thing a screen has to know how to draw, so it does not get invented
 * until a term needs it.
 */

/**
 * A number the player may move inside a range.
 *
 * {@link min} and {@link max} are the range the *engine* will accept, not a suggestion:
 * `composeOffer` bounds a term by the patron fee (`NEGOTIATION_SPEC` §3.3) and `lockOffer`
 * bounds the package as a whole by the treasury (§2.3), and a lever that let a player past
 * either would send them into a refusal they had no way to foresee.
 */
export interface NumericLever {
  readonly value: number;
  readonly min: number;
  readonly max: number;
  /** Why this lever cannot be moved right now, or `null` when it can. */
  readonly disabledReasonKey: string | null;
}

/**
 * One choice out of a closed set.
 *
 * Every option carries a {@link ChoiceOption.labelKey} beside its value, because the value
 * is a content id and `TDD` §11.1 forbids one reaching a label. The screen holds no roster
 * of its own to join a name from — that join is this layer's, made once, where the roster
 * actually is.
 */
export interface ChoiceOption<T> {
  readonly value: T;
  readonly labelKey: string;
}

export interface ChoiceLever<T> {
  readonly chosen: T | null;
  readonly options: readonly ChoiceOption<T>[];
  readonly disabledReasonKey: string | null;
}

/**
 * A subset of a closed set, of exactly one size.
 *
 * {@link exactly} rather than a minimum and a maximum: `composeOffer` refuses any crew that
 * is not exactly `requiredCrew` distinct heroes (`RESOLUTION_SPEC` §2.5), and a range would
 * describe a freedom the engine does not grant — the product spec §7 names a variable crew
 * as the thing that would make the whole choice stop being one.
 */
export interface MultiChoiceLever<T> {
  readonly chosen: readonly T[];
  readonly options: readonly ChoiceOption<T>[];
  readonly exactly: number;
  readonly disabledReasonKey: string | null;
}

/**
 * The joint budget constraint over a package's two money terms
 * (`NEGOTIATION_SPEC` §2.3, §3.3).
 *
 * **One ceiling per term is not enough, and that is the whole reason this type exists.**
 * `lockOffer` refuses on `advance × requiredCrew + promisedBonus` against the treasury net
 * of every *other* locked offer's reserve — so the two terms are bound to each other and to
 * the rest of the campaign. A screen offering `advance ≤ treasury` would let a player
 * assemble a package the engine is certain to refuse, which is the refusal-without-warning
 * the plan's own test names.
 *
 * {@link available} excludes this contract's own reserve even while it holds one: revising
 * a package returns it to `draft` (`NEGOTIATION_SPEC` §3.1, `RESOLUTION_SPEC` §6.2), and a
 * draft reserves nothing — so money this very contract is holding is money the next version
 * of this very package may spend.
 *
 * {@link maxAdvance} and {@link maxBonus} are each computed against the *current* value of
 * the other, which is what makes them move together: promising more lowers the advance a
 * player can still afford, and the plan pins exactly that.
 */
export interface OfferBudget {
  readonly available: number;
  readonly maxAdvance: number;
  readonly maxBonus: number;
}

/**
 * The one thing every lever has in common, and the only property a caller iterating over
 * all of them needs. Declared rather than inferred so that "every lever names its reason"
 * is a statement a test can make over a list, instead of five statements it could make
 * about four levers and forget the fifth.
 */
export interface Lever {
  readonly disabledReasonKey: string | null;
}
