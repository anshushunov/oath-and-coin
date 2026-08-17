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
 * The domain of the C# original, restated: `HeroId` there is
 * `readonly record struct HeroId(int Value)`, so its whole domain is signed
 * 32-bit — negatives included, nothing outside.
 */
export const HERO_ID_MIN = -2147483648;

export const HERO_ID_MAX = 2147483647;

/**
 * Builds a {@link HeroId} from an integer.
 *
 * The C# struct had no check at all, because it did not need one: the compiler
 * would not hand `HeroId(int)` a fractional value, and `int` cannot hold
 * anything outside its own range. TypeScript enforces neither, so this does —
 * and it enforces **exactly** that domain, no wider and no narrower.
 *
 * The first version of this refused negatives, which was a defect external
 * review reproduced: `hero_index: -1` is a value the scenario contract accepts
 * and C# runs, where `state.Heroes.TryGetValue` simply misses and the engine
 * answers `UNKNOWN_HERO`. Refusing it turned a recorded rejection into a thrown
 * exception — a divergence on an input the frozen corpus does not contain and
 * therefore could never have caught. The same version accepted `2147483648`,
 * which C# could not represent at all. The domain was wrong in both directions
 * at once, which is what happens when a bound is chosen from what today's
 * callers pass rather than from what the original could express.
 *
 * A non-integer is still refused for the reason it always was: it silently
 * becomes a map key nothing matches, and the failure surfaces as an absent hero
 * three layers away.
 *
 * @throws if `value` is not an integer inside the signed 32-bit range.
 */
export function heroId(value: number): HeroId {
  if (!Number.isSafeInteger(value) || value < HERO_ID_MIN || value > HERO_ID_MAX) {
    throw new Error(
      `Invalid HeroId ${value}: expected an integer in [${HERO_ID_MIN}, ${HERO_ID_MAX}], the ` +
        'domain of the signed 32-bit id this ports.'
    );
  }

  return value as HeroId;
}

/** Numeric comparison, the comparator shape every sorted collection here expects. */
export function compareHeroIds(left: HeroId, right: HeroId): number {
  return left - right;
}
