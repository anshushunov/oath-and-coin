import { TRAIT_SCALE } from '@oath-and-coin/simulation';

/**
 * The one place a content range is written down as a number. The JSON schemas
 * state the same ranges again, in the only form a schema can state them — as
 * literals — and `schema:check` asserts the two statements agree.
 *
 * Both statements are needed and neither is redundant: the schema is what an
 * author's editor and the validation stage check against (`TDD` §11.2 stage 1),
 * these constants are what the loader enforces on every load, including the loads
 * that never ran validation. What must not exist is a third, hand-copied
 * statement of the same range inside a scoring function.
 */

export const TRAIT_MIN = 0;

/**
 * Derived from the simulation's `TRAIT_SCALE`, not stated again as a literal: the
 * scoring function divides trait-weighted terms by that span, so a ceiling raised
 * here without the divisor following would be accepted by this loader and by the
 * schema while every one of those terms quietly weakened. `schema:check` holds the
 * schema literal to this value, which makes one chain — divisor, bound, schema —
 * rather than three independent numbers that happen to read 100.
 */
export const TRAIT_MAX = TRAIT_MIN + TRAIT_SCALE;

export const PATRON_FEE_MIN = 0;
export const PATRON_FEE_MAX = 100;

export const RISK_MIN = 0;
export const RISK_MAX = 100;

export const INCLINATION_WEIGHT_MIN = -30;
export const INCLINATION_WEIGHT_MAX = 30;

export const RELATIONSHIP_WEIGHT_MIN = -20;
export const RELATIONSHIP_WEIGHT_MAX = 20;

export const REQUIRED_CREW_MIN = 1;
export const REQUIRED_CREW_MAX = 6;

/**
 * What a hero can do, bounded on its own terms (`DEC-013`, `RESOLUTION_SPEC` §2.2).
 *
 * The numbers coincide with {@link TRAIT_MIN}/{@link TRAIT_MAX} and the constants
 * deliberately do not: `greed` and `expertise` are different quantities that happen to
 * share a range today. `TRAIT_MAX` is derived from the simulation's `TRAIT_SCALE`
 * because the scoring function divides by that span — raising it there has to raise
 * it here, or every trait-weighted term quietly weakens. Nothing divides by the
 * capability span, so borrowing `TRAIT_MAX` for it would tie a change in how greedy
 * a hero may be to a change in how strong a crew is, which is the one coupling
 * `DEC-013` §2 exists to refuse.
 *
 * **`CAPABILITY_GRADE_MIN`/`MAX` used to sit here and no longer do** (`DEC-016` §3).
 * These constants are the ranges an *author* may write, and `grade` stopped being one
 * of them the day it became a derivative: nothing in `content/` states it. The range it
 * is clamped into is a property of the derivation and lives beside it, in
 * `packages/simulation/src/domain/capability.ts`.
 */
export const CAPABILITY_EXPERTISE_MIN = 0;
export const CAPABILITY_EXPERTISE_MAX = 100;

/**
 * What a hero is made of in a fight (`DEC-016` §1, `COMBAT_SPEC` §3.6) — five attributes,
 * every one of them `0..100`.
 *
 * Its own pair rather than `TRAIT_MIN`/`TRAIT_MAX` or the expertise pair, and the reason is
 * the direct instruction of `BQ-013`: the combat layer must not be raisable by an edit
 * aimed at a motivational scale. The numbers coincide today; the quantities never do.
 */
export const COMBAT_ATTRIBUTE_MIN = 0;
export const COMBAT_ATTRIBUTE_MAX = 100;

/**
 * The weight a contract puts on one need (`RESOLUTION_SPEC` §2.3).
 *
 * The floor is **1, not 0**, and that is the rule rather than a rounding of it: a
 * need of weight zero is a second entry that asks for nothing, which leaves the
 * contract with one real need — the degenerate shape `MIN_NEEDS_PER_CONTRACT`
 * exists to rule out, arrived at by the back door.
 */
export const NEED_WEIGHT_MIN = 1;
export const NEED_WEIGHT_MAX = 100;

// Pride deliberately gets no constants of its own: it is a hero scale, the same
// kind of value greed, caution and trust_in_guild are, so its range is
// TRAIT_MIN..TRAIT_MAX. A second pair of constants carrying the same numbers
// would drift from this one the first time either changed.
