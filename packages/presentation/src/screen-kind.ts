/**
 * Which of the campaign's three screens a read model is.
 *
 * **A discriminant, not a label.** It is the field every reader of {@link
 * import('./screen-model.ts').ScreenModel} narrows on, which is what makes the compiler
 * close each of them: a fourth screen cannot be added without every `switch` over this
 * union failing to build (`switch-exhaustiveness-check`, `noImplicitReturns`), so it cannot
 * silently fall out of the read-model hash, out of the rendered snapshot, or out of the
 * scene behind the page. The same shape `DomainEvent.kind` already has, for the same
 * reason.
 *
 * **No caller supplies it.** Each model's own `create…` gate stamps it on the way out, so a
 * screen cannot be built claiming to be another one and a spread cannot drop it.
 *
 * Its own module rather than a member of `screen-state.ts`: the two answer different
 * questions — this one *which* screen, that one *which of five shapes* the screen is in —
 * and `screen-model.ts` needs both plus all three model files, which is a cycle the moment
 * the constant lives in one of them.
 */
export const ScreenKind = Object.freeze({
  /** The negotiation: one contract's package, its roster and their answers. */
  ContractOffer: 'contract_offer',
  /** The debrief: what the run cost, and the promise still to be answered. */
  AfterAction: 'after_action',
  /** The board: every contract of the campaign and how far each has got. */
  ContractBoard: 'contract_board'
});

export type ScreenKind = (typeof ScreenKind)[keyof typeof ScreenKind];

/** The three, in the order above. */
export const SCREEN_KINDS: readonly ScreenKind[] = Object.freeze(Object.values(ScreenKind));
