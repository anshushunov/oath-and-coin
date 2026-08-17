/**
 * Integer division with C#'s rounding, which is toward zero — not JavaScript's `/`,
 * which does not round at all, and not `Math.floor`, which rounds toward negative
 * infinity.
 *
 * This is the first trap of the port and it is invisible on today's data. Every
 * dividend the decision rule forms is non-negative on shipped content — payment, risk,
 * the risk-minus-payment gap, trust and the trait scales are all bounded at or above
 * zero — so `Math.floor` and `Math.trunc` agree on every one of the 54 frozen corpus
 * entries. A mutant swapping one for the other therefore stays **green** against the
 * corpus, which is exactly why the corpus is not what guards this: `divideTowardZero`
 * is tested directly on negative dividends, and `contract-decision-rule.test.ts` poses
 * one negative-scale context whose score differs by one between the two roundings.
 *
 * The bound is not a promise about the future either. A hero scale is `number` in
 * state; nothing in this package refuses a negative one, and the moment a later rule
 * forms a signed dividend the two roundings part ways at the exact place a decision
 * flips.
 *
 * The zero is normalized, and that is not tidiness. `Math.trunc(-1 / 100)` is `-0`, a
 * value C# integer division cannot produce at all — `int` has one zero. A `-0` reaching
 * a factor magnitude or a score is invisible to `===`, to `<` and to `>`, so it would
 * travel silently until something compared it with `Object.is` or divided by it: the
 * canonical writer emits `0` for both, `deepEqual` treats them as equal, and this is
 * exactly the shape of defect §8.4 records from the other direction — a test that had
 * *demanded* `deepEqual(-0, 0) === false` and was itself the invention. The port's
 * answer is to not produce the value in the first place.
 */
export function divideTowardZero(dividend: number, divisor: number): number {
  const quotient = Math.trunc(dividend / divisor);
  return quotient === 0 ? 0 : quotient;
}
