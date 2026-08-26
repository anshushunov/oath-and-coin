import { decide } from '../decisions/contract-decision-rule.ts';
import type { DecisionContext } from '../decisions/context.ts';
import { Actions } from '../decisions/actions.ts';
import { CommitmentState } from '../domain/commitment.ts';

/**
 * Whether a yes was given or bought (`RESOLUTION_SPEC` §2.4).
 *
 * **Computed where the hero answers, on that very context — never later.**
 * `DecisionContext` carries the contract with its own `acceptedBy` and the `crew` those
 * acceptances resolve to, and the crew grows between one hero's answer and the moment the
 * contract resolves. A key hero who agreed alone would, at resolution time, be answering
 * beside a full crew whose bonds he can read; his fragile yes would have turned into a
 * firm one, and the record would say he went willingly when he did not. So this takes the
 * context the answer was actually given on, and the caller writes what it returns into
 * the package right there.
 *
 * **Three states, and the first one does not compute anything.** A hero the guild has
 * already betrayed is resentful whatever the terms — that is a fact about him, not about
 * this offer, and re-running the decision would only ask a question whose answer changes
 * nothing. The other two come from one counterfactual: the same decision, on the same
 * ordinal and the same trace id, with the promised bonus taken away.
 *
 * **A re-run rather than a subtraction, and the difference is not stylistic.** Taking the
 * bonus away can *create or enlarge* a `PaymentInsulting`: pay that is acceptable with a
 * promise on top becomes a personal insult without it, because the insult is measured
 * against what the hero stands to receive. Subtracting the one `PromiseOfABonus` factor
 * sees the payment shrink and misses the insult appearing — it would call bought consent
 * freely given in exactly the case the distinction exists for.
 *
 * **Deliberately not exported from the package index**, unlike `coverNeeds` next door.
 * Nothing outside this package has a `DecisionContext` to hand it, and the only way to
 * obtain one after the fact is to rebuild it — on a package that has moved on, which is
 * the one thing this whole design exists to prevent. An export would be an invitation to
 * do exactly that.
 *
 * **The counterfactual spends no randomness.** `decide` is a pure function of
 * `(campaignSeed, decisionOrdinal)`, and the campaign's counter is advanced by
 * `withEvent`, not by the rule — so drawing the same mood from the same ordinal a second
 * time costs nothing. What this returns is discarded except for the answer, including the
 * trace and the `ordinalsConsumed` the second run reports (`ADR-003`).
 */
export function commitmentFor(context: DecisionContext): CommitmentState {
  if (context.hero.grievance > 0) {
    return CommitmentState.Resentful;
  }

  // A plain spread rather than `createContractState`: this contract is never stored, it
  // is an argument to a pure rule and is discarded on the next line. Routing it through
  // the constructor would buy nothing — lowering a bonus cannot break an invariant the
  // real package already satisfies — and would cost the ability to answer at all if some
  // later invariant ever threw on a shape only this counterfactual produces.
  const withoutTheBonus = decide({
    ...context,
    contract: {
      ...context.contract,
      offer: { ...context.contract.offer, promisedBonus: 0 }
    }
  });

  return withoutTheBonus.result.selectedAction === Actions.Accept
    ? CommitmentState.Committed
    : CommitmentState.Fragile;
}
