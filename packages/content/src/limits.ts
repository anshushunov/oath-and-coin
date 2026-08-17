/**
 * The ceilings every path that reads external data is held to (`TDD` §18:
 * "ограничивать размер и глубину загружаемых структур").
 *
 * Stated once, and public: content is data the player, a mod or a corrupted
 * download can author, and these numbers show up in the diagnostics an author
 * reads, so they are part of this package's contract rather than an internal
 * detail. A second reading path with its own, laxer numbers would be the same as
 * having no limits at all — external data only has to arrive through the laxest
 * one — so every reader goes through `strict-json.ts`, which is the only place
 * these are applied.
 */

/**
 * Largest file any reader will accept. Checked against the file's own length
 * before anything is allocated for it, so an oversized file costs a `stat` call
 * rather than its own size in memory.
 */
export const MAX_FILE_SIZE_BYTES = 256 * 1024;

/**
 * Deepest JSON nesting any reader will accept. Guards the parser's own recursion,
 * which a size limit alone does not: a small file can nest thousands of levels
 * deep.
 */
export const MAX_JSON_DEPTH = 32;

/** Most traits a single hero file may list. */
export const MAX_TRAITS_PER_HERO = 4;

/** Most relationships a single hero file may list. */
export const MAX_RELATIONSHIPS_PER_HERO = 5;

/** Most tags a single contract file may list. */
export const MAX_TAGS_PER_CONTRACT = 6;
