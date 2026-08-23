import { divideTowardZero } from '../integer-division.ts';

/**
 * Ceiling on a hero's `HeroState.grievance` (`NEGOTIATION_SPEC` §2.2, §3.3) — the
 * qualitative shelf that keeps a broken promise's memory soluble against the decision
 * rule's other terms instead of degenerating into "extremely" on an unbounded counter.
 *
 * `ASSUMPTION` (`NEGOTIATION_SPEC` §12): this number, {@link GRIEVANCE_VICTIM} and
 * {@link WITNESS_SHARE} are the spec's first-approximation authoring, not a value
 * derived from anything else in this file. They are checked by playtest — the share of
 * players who break a promise at an explicit payoff (`DIRECTION_2026-08` §7) — not by
 * argument, and this comment deliberately does not try to justify the number 60 beyond
 * stating that it is a guess awaiting that measurement.
 */
export const GRIEVANCE_MAX = 60;

/**
 * The victim's grievance at a promise withheld in full (`promisedBonus = patronFee`),
 * before the ceiling and before a witness's share of it is scaled down by
 * {@link WITNESS_SHARE}. `ASSUMPTION`, same as {@link GRIEVANCE_MAX} — playtest-checked,
 * not derived.
 */
export const GRIEVANCE_VICTIM = 30;

/**
 * How much of the victim's raw grievance a witness inherits, as a percentage
 * (`NEGOTIATION_SPEC` §3.3): a witness watched the guild break its word to someone
 * else, so the wound is real but never the victim's own. `ASSUMPTION`, same as
 * {@link GRIEVANCE_MAX}.
 */
export const WITNESS_SHARE = 40;

/**
 * What breaking a promise of `promisedBonus` on a contract paying `patronFee` costs the
 * victim and every witness, in `grievance` (`NEGOTIATION_SPEC` §3.3). Returns the
 * amounts a broken promise adds — not the victim's or a witness's resulting
 * `HeroState.grievance` — because this function is not handed an existing `grievance`
 * to add to; folding the two together (`min(grievance + …, GRIEVANCE_MAX)`) is
 * `settleContract`'s own arithmetic, and no command wires it yet (`NEGOTIATION_SPEC`
 * §3.3 names the command; nothing in this package invokes it).
 *
 * Three steps, in this exact order, and the order is load-bearing rather than
 * cosmetic: {@link divideTowardZero} first, `Math.max(…, 1)` second,
 * {@link GRIEVANCE_MAX} last. Reversing the last two would let the ceiling clip a value
 * on its way down before the floor ever ran — irrelevant only for a `promisedBonus`
 * large enough to already sit above the ceiling before flooring, and load-bearing for
 * the case the floor exists to catch: a one-coin promise on a hundred-coin fee divides
 * to `0`, and `max(0, 1)` is the only thing standing between that and a broken promise
 * costing nothing at all — which `NEGOTIATION_SPEC` §3.3 is explicit is not a promise,
 * it is a free line of dialogue.
 *
 * Both results are clamped to {@link GRIEVANCE_MAX} independently, not only as part of
 * a later addition to an existing `grievance` — so `0 < witness ≤ victim ≤ GRIEVANCE_MAX`
 * (`NEGOTIATION_SPEC` §2.2's constant invariant) holds on the pair this function alone
 * hands back, for every `promisedBonus` and `patronFee` the offer protocol can produce.
 *
 * `patronFee > 0` is assumed, never checked: `createContractState` (`NEGOTIATION_SPEC`
 * §2.1) already holds `0 ≤ promisedBonus ≤ patronFee` on every `ContractState` this
 * package can construct, so a promise (`promisedBonus > 0`, the only case
 * `settleContract` calls this for) can only exist on a contract whose `patronFee` is
 * positive too — the state this function is fed can never carry a zero divisor here.
 */
export function grievanceForBrokenPromise(
  promisedBonus: number,
  patronFee: number
): { readonly victim: number; readonly witness: number } {
  const broken = divideTowardZero(GRIEVANCE_VICTIM * promisedBonus, patronFee);

  const victim = Math.min(Math.max(broken, 1), GRIEVANCE_MAX);
  const witnessShare = divideTowardZero(broken * WITNESS_SHARE, 100);
  const witness = Math.min(Math.max(witnessShare, 1), GRIEVANCE_MAX);

  return { victim, witness };
}
