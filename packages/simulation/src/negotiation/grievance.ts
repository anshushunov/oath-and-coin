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
 *
 * **A note for whoever next reads `NEGOTIATION_SPEC` §2.2 and §12 closely, not
 * something this code silently works around:** those two sections name the witness
 * side of the invariant `GRIEVANCE_WITNESS` — an absolute grievance value, the same
 * kind of number `GRIEVANCE_VICTIM` is. §3.3's own worked formula, and the brief this
 * module implements, instead compute the witness's share as a *percentage* of the
 * victim's raw grievance (`WITNESS_SHARE = 40`), which is what this file follows. Read
 * literally over the *constants*, `0 < GRIEVANCE_WITNESS ≤ GRIEVANCE_VICTIM` is false
 * for these values — there is no fixed `GRIEVANCE_WITNESS` here, and `WITNESS_SHARE`
 * (40) is not even the same kind of quantity as `GRIEVANCE_VICTIM` (30), let alone
 * bounded by it. The invariant is true, and is proven true below, over the *returned
 * pair* `{ victim, witness }` for every input this function accepts — which is the
 * reading that actually matters to the decision rule. The mismatch in the spec's own
 * text is for the spec's owner to resolve, not this implementation.
 */
export const WITNESS_SHARE = 40;

/**
 * What breaking a promise of `promisedBonus` on a contract paying `patronFee` costs the
 * victim and every witness, in `grievance` (`NEGOTIATION_SPEC` §3.3). Returns the
 * amounts a broken promise adds — not the victim's or a witness's resulting
 * `HeroState.grievance` — because this function is not handed an existing `grievance`
 * to add to; folding the two together (`min(grievance + …, GRIEVANCE_MAX)`) is
 * `settleContract`'s own arithmetic (`engine.ts`'s `applyBrokenPromise`, which this
 * function's two results feed directly), not this function's.
 *
 * Divides before flooring: {@link divideTowardZero} first, `Math.max(…, 1)` second —
 * load-bearing, because flooring the raw ratio and only then dividing would be a
 * different number entirely. The floor is what stops a broken promise costing nothing:
 * a one-coin promise on a hundred-coin fee divides to `0`, and `max(0, 1)` is the only
 * thing standing between that and a promise breaking for free —
 * `NEGOTIATION_SPEC` §3.3 is explicit that this is not a promise, it is a free line of
 * dialogue. (The floor and the {@link GRIEVANCE_MAX} ceiling that follows it, by
 * contrast, commute — `min(max(b, 1), 60) === max(min(b, 60), 1)` for any integer `b`,
 * since `1 ≤ 60` — so their relative order is not itself a fact worth leaning on; only
 * "divide happens before either clamp" is.)
 *
 * The {@link GRIEVANCE_MAX} clamp inside this function is a safety net against a
 * caller this function cannot see, not a live step of the spec's own arithmetic: on
 * every input this function accepts (`0 < promisedBonus ≤ patronFee`, enforced below),
 * `broken ≤ GRIEVANCE_VICTIM` (30), already under the ceiling (60), so the clamp never
 * actually fires here. The spec's real ceiling is on the *running total*
 * (`min(grievance + max(broken, 1), GRIEVANCE_MAX)`, §3.3) — that addition, and the
 * ceiling that matters, belong to `settleContract`'s own arithmetic (`engine.ts`'s
 * `applyBrokenPromise`), not to this function.
 *
 * Both results are nonetheless clamped independently, so `0 < witness ≤ victim ≤
 * GRIEVANCE_MAX` holds on the pair this function alone hands back for every input in
 * its domain — see this function's own test suite for the proof this comment
 * summarizes.
 *
 * @throws if `promisedBonus` is not positive — there is no promise to have broken, and
 * `NEGOTIATION_SPEC` §3.3 states that not promising costs nothing *by construction*,
 * not by this function returning a computed zero it never actually produces — or if
 * `patronFee` is not positive while `promisedBonus` is. `createContractState`
 * (`NEGOTIATION_SPEC` §2.1) holds `0 ≤ promisedBonus ≤ patronFee` on every
 * `ContractState` this package can build in memory, so a positive `promisedBonus`
 * paired with a non-positive `patronFee` is a state invariant already broken upstream
 * of this call — and, unlike that in-memory door, `decodeSnapshot`
 * (`packages/content/src/save/snapshot-codec.ts`) reads `advance`/`promisedBonus`
 * against the patron-fee *range*, not the sibling contract's own `patronFee`, so a
 * tampered or malformed save is exactly the kind of caller this guard exists to catch
 * before it reaches a division.
 */
export function grievanceForBrokenPromise(
  promisedBonus: number,
  patronFee: number
): { readonly victim: number; readonly witness: number } {
  if (promisedBonus <= 0) {
    throw new Error(
      `grievanceForBrokenPromise received promisedBonus ${String(promisedBonus)}, which is not ` +
        'positive; a promise must have been made to have been broken, and NEGOTIATION_SPEC §3.3 ' +
        'holds that not promising costs nothing by construction — the caller must not reach this ' +
        'function for promisedBonus ≤ 0.'
    );
  }

  if (patronFee <= 0) {
    throw new Error(
      `grievanceForBrokenPromise received patronFee ${String(patronFee)} with promisedBonus ` +
        `${String(promisedBonus)}; createContractState (NEGOTIATION_SPEC §2.1) holds ` +
        '0 ≤ promisedBonus ≤ patronFee on every ContractState this package can build, so a ' +
        'positive promisedBonus paired with a non-positive patronFee names a state invariant ' +
        'already broken upstream of this call, not a promise this function can price.'
    );
  }

  const broken = divideTowardZero(GRIEVANCE_VICTIM * promisedBonus, patronFee);

  const victim = Math.min(Math.max(broken, 1), GRIEVANCE_MAX);
  const witnessShare = divideTowardZero(broken * WITNESS_SHARE, 100);
  const witness = Math.min(Math.max(witnessShare, 1), GRIEVANCE_MAX);

  return { victim, witness };
}
