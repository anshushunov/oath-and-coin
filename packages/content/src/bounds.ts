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

// Pride deliberately gets no constants of its own: it is a hero scale, the same
// kind of value greed, caution and trust_in_guild are, so its range is
// TRAIT_MIN..TRAIT_MAX. A second pair of constants carrying the same numbers
// would drift from this one the first time either changed.
