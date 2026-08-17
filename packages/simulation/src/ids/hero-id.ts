/**
 * A stable identifier for a hero instance (`ADR-005`). Ordering is an integer
 * comparison, which is inherently locale-independent.
 *
 * Branded, like {@link import('./content-id.js').ContentId}, and for a reason
 * this domain has already paid for once: a hero's runtime id and a scenario's
 * `hero_index` are the same number by construction
 * (`ContentSet.createInitialState` assigns ids in content-id order), so nothing
 * but a type keeps "the third hero in the roster" from being handed to a
 * function expecting "the hero whose id is 3" in a future where those stop
 * coinciding.
 */

declare const heroIdBrand: unique symbol;

export type HeroId = number & { readonly [heroIdBrand]: 'HeroId' };

/**
 * Builds a {@link HeroId} from an integer.
 *
 * The C# port had no such check — `HeroId(int)` could not be handed a
 * fractional value, because the language would not compile it. TypeScript will,
 * so the check is here rather than absent: a non-integer id silently becomes a
 * map key nothing ever matches, and the failure surfaces as an absent hero
 * three layers away.
 *
 * @throws if `value` is not a non-negative safe integer.
 */
export function heroId(value: number): HeroId {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid HeroId ${value}: expected a non-negative integer.`);
  }

  return value as HeroId;
}

/** Numeric comparison, the comparator shape every sorted collection here expects. */
export function compareHeroIds(left: HeroId, right: HeroId): number {
  return left - right;
}
