/**
 * Which of five shapes the contract-offer screen is in right now.
 *
 * Carried as its own field on the read model rather than inferred from which other
 * fields happen to be populated: two states can otherwise look identical from the
 * outside — an empty roster before any contract is offered, and an empty roster
 * because loading failed — and a hash that never states the state explicitly would
 * call them the same screen. The frozen corpus proves the point from the other end:
 * `screen_loading` and `screen_empty` carry byte-identical content and different
 * `read_model.sha256`, and the state is the only thing that differs.
 */
export const ScreenState = Object.freeze({
  /**
   * The game is still building an outcome to draw from. Never produced by the
   * factory — there is no outcome yet to build from — so it exists as a constant
   * the application layer selects when the scenario's own manifest declares it.
   */
  Loading: 'Loading',
  /** The content set has no contract to offer, or nobody to offer it to. */
  Empty: 'Empty',
  /** The run never reached a contract to offer. `errorCode` names which stage failed. */
  Error: 'Error',
  /** A contract is offered, and at least one hero has not yet answered. */
  Incomplete: 'Incomplete',
  /** A contract is offered, and every hero in the roster has answered. */
  Normal: 'Normal'
});

export type ScreenState = (typeof ScreenState)[keyof typeof ScreenState];

/**
 * The five states, in the order above.
 *
 * `packages/content` declares the same closed set as `KNOWN_SCREEN_STATES`, because a
 * scenario manifest names an expected state and the manifest loader is on that side
 * of the boundary. Two declarations of one closed set is a drift risk, and the
 * boundary rule forbids the import that would collapse them into one — so the
 * agreement is asserted instead, by `tests/locale`, which is allowed to see both.
 */
export const SCREEN_STATES: readonly ScreenState[] = Object.freeze(Object.values(ScreenState));

/**
 * Which way a reason pulled *relative to the answer the hero actually gave* — not
 * "positive" or "negative" in the trace's own terms, which say nothing on their own
 * about the decision they belong to: a risk that pushed toward refusal is a
 * `Supported` reason on a refusal and an `Opposed` one on an acceptance.
 *
 * A model fact, not something the screen may work out for itself. External review of
 * the C# original found the consequence of leaving it out: a hero who accepted a
 * contract was shown three reasons all pointing the other way — "принял, потому что
 * слишком рискованно" — with nothing anywhere in the model able to contradict it.
 */
export const ReasonDirection = Object.freeze({
  /** This reason pulled toward the action the hero chose. */
  Supported: 'Supported',
  /** This reason pulled against the action the hero chose, and lost. */
  Opposed: 'Opposed'
});

export type ReasonDirection = (typeof ReasonDirection)[keyof typeof ReasonDirection];

export const REASON_DIRECTIONS: readonly ReasonDirection[] = Object.freeze(
  Object.values(ReasonDirection)
);
