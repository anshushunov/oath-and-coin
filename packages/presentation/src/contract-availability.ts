/**
 * How far one contract has got, as the board shows it.
 *
 * A vocabulary of this layer's own, not the engine's: `OfferPhase`, `ContractStatus` and
 * `ContractState.resolution` each answer part of the question and none of them answers it
 * whole — a contract is "in progress" whether its package is a draft somebody is still
 * editing or a locked one waiting on a poll, and it is "resolved" while its phase still
 * reads `locked`. A board row that carried the three engine fields would leave the screen
 * to combine them, which is the rule this layer exists to keep out of a component.
 *
 * Its own module rather than a member of {@link import('./screen-state.ts').ScreenState}'s
 * file: {@link import('./keys.ts')} needs the closed set to build a key per member, and
 * the board model needs both — one more file is what keeps that from being a cycle.
 */
export const ContractAvailability = Object.freeze({
  /** Nobody has composed a package for it yet. */
  Open: 'open',
  /** A package exists — draft or locked — and the crew has not come back. */
  InProgress: 'in_progress',
  /** The crew came back and the outcome is stored; the promise has not been answered. */
  Resolved: 'resolved',
  /** The money has moved and the contract is closed. */
  Settled: 'settled'
});

export type ContractAvailability = (typeof ContractAvailability)[keyof typeof ContractAvailability];

/** The four, in the order above. */
export const CONTRACT_AVAILABILITIES: readonly ContractAvailability[] = Object.freeze(
  Object.values(ContractAvailability)
);
