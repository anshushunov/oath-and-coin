/**
 * How a "yes" was given (`RESOLUTION_SPEC` §2.4).
 *
 * Three states rather than a boolean, because the difference between them is what the
 * outcome is allowed to read: a hero who would have come anyway, one whose agreement
 * *stood on* the promised bonus, and one who came carrying a grudge. The middle one is
 * the third diagnosis the debrief screen has to be able to give — "the yes was bought,
 * not given" — and a boolean cannot hold it.
 *
 * The state is computed where the hero answers, on that very `DecisionContext`, and
 * written into the offer. Recomputing it at resolution would answer differently: the
 * crew grows between the key hero's answer and the contract being resolved, so a fragile
 * yes given in solitude would turn firm by the time it was read.
 *
 * Declared here, in `domain/`, and not beside the decision rule: `ContractState` carries
 * these values, the decision rule reads `ContractState`, and a declaration in the rule
 * would close the cycle `RESOLUTION_SPEC` §2.7 names.
 */
export const CommitmentState = Object.freeze({
  /** Would have accepted without the promised bonus. */
  Committed: 'committed',

  /** Accepted, but the counterfactual without the bonus refuses — the yes was bought. */
  Fragile: 'fragile',

  /** Accepted while carrying a grudge against the guild. */
  Resentful: 'resentful'
});

export type CommitmentState = (typeof CommitmentState)[keyof typeof CommitmentState];
