/**
 * Integer division with C#'s rounding, which is toward zero — not JavaScript's `/`,
 * which does not round at all, and not `Math.floor`, which rounds toward negative
 * infinity.
 *
 * This is the first trap of the port and it is invisible on today's data. Every
 * dividend the decision rule forms is non-negative on shipped content — patron fee, risk,
 * the risk-minus-patron-fee gap, trust and the trait scales are all bounded at or above
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

/**
 * `a * b` the way C# multiplies two `int`s: 32 bits, wrapping, unchecked.
 *
 * The second trap of the port, and external review had to find it because the corpus
 * cannot: on content-bounded values (patron fee and risk 0..100, scales 0..100) a product
 * never approaches 2^31 and `Math.imul` is indistinguishable from `*`. Outside them the
 * two stop agreeing completely — `2147483647 * 2147483647` is `4611686014132420600` as a
 * double and `1` as an `int` — and the counterexample was a pair of values C# accepts
 * without complaint.
 *
 * Wrapping rather than refusing is the faithful choice, not the lazy one: the original
 * has no `checked` context anywhere (`CheckForOverflowUnderflow` is not set in any
 * project), so an overflowing decision in C# produces a wrong number quietly. A port
 * that threw there would diverge just as surely, only in the other direction, and on a
 * campaign that C# would have kept running.
 */
export function multiplyInt32(left: number, right: number): number {
  return Math.imul(left, right);
}

/**
 * Truncates to a signed 32-bit result, which is what every `int` addition, subtraction
 * and negation in the original does on overflow.
 *
 * A sum may be wrapped once at the end rather than after each term: two's-complement
 * addition is associative modulo 2^32, and the exact intermediate stays inside the
 * double's 53 exact bits for any term count this rule can reach.
 */
export function toInt32(value: number): number {
  return value | 0;
}
