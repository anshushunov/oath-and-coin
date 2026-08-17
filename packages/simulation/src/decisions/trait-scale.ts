/**
 * The span a hero's greed, caution and pride are expressed on, and therefore the
 * divisor every trait-weighted term of the decision divides by: a trait at the
 * top of its range contributes the whole of what it weighs, one at the bottom
 * contributes none of it.
 *
 * Declared in the layer that divides by it, and derived *from here* by the content
 * layer's `TRAIT_MAX` — not the other way round, because content already depends
 * on this package and not the reverse. The rule it closes is the content bounds'
 * own, word for word: a range may be stated exactly twice, as a constant and as a
 * literal in the schema, and what must not exist is a third, hand-copied statement
 * of it inside a scoring function. Three such copies did exist in the C# original
 * once — `/ 100` in the payment, risk and insult terms — so raising the authored
 * ceiling would have been accepted by the loader and by the schema while every one
 * of those terms silently weakened.
 *
 * It lives in its own module rather than beside the decision rule because the
 * content package needs the number in Task 6 and the rule itself does not arrive
 * until Task 9. Importing a rule to read a constant would have made the content
 * layer depend on the arithmetic it is only supposed to bound.
 */
export const TRAIT_SCALE = 100;
