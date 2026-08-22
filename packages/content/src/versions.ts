/**
 * The format versions this build reads and writes.
 *
 * Every content file states its own `schema_version`, and a file that states a
 * different one is refused rather than read under this version's assumptions — the
 * failure a version field exists to prevent is a later format being parsed by an
 * earlier build and silently losing the meaning of a field that was reused.
 *
 * The JSON schemas pin the same numbers with `const`, and `schema:check` asserts
 * the two agree: two independent statements of one rule are only safe while
 * something checks that they still say the same thing.
 */

/**
 * The content format `heroes/`, `contracts/` and `traits/` are read under (`TDD`
 * §11.1). Raised to 3 by `DEC-008` Task 4: a contract file may now declare
 * `negotiable_tags`, the pair of mutually exclusive method tags `NEGOTIATION_SPEC`
 * §2.4 has the player choose between. A version 2 file lacking that field is still
 * a legal version 3 file — the field is optional — but the number moves anyway,
 * because a hand-authored version 2 file is a statement about what its author
 * checked it against, and that statement did not include a field this build now
 * understands.
 */
export const SUPPORTED_CONTENT_SCHEMA_VERSION = 3;

/** The locale file format, versioned separately because it evolves separately. */
export const SUPPORTED_LOCALE_SCHEMA_VERSION = 2;

/**
 * Version of the save envelope the initial state is built for (`TDD` §12). It
 * travels in the campaign's metadata from the first state onward, so a save
 * written today can be recognized — or refused — by a later build, instead of
 * being read with today's assumptions silently applied to yesterday's bytes.
 */
export const SAVE_SCHEMA_VERSION = 1;
