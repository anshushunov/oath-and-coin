import { MAX_TAGS_PER_CONTRACT } from '@oath-and-coin/simulation';

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

/**
 * Most tags a single contract file may list.
 *
 * Re-exported from `@oath-and-coin/simulation` rather than stated here as a literal
 * `6`: `NEGOTIATION_SPEC` §2.1 needs the same ceiling to bound a contract's
 * *effective* tag set once a negotiated method tag joins it, and that check lives in
 * `createContractState` (`packages/simulation/src/state/offer-state.ts`) — which
 * cannot import this package back (`ADR-002`, `simulation-depends-on-nothing`). One
 * fact needed on both sides of a one-directional boundary has exactly one legal home:
 * the side nothing forbids the other from reading. Exactly the reason `bounds.ts`'s
 * `TRAIT_MAX` derives from the simulation's `TRAIT_SCALE` instead of restating it.
 */
export { MAX_TAGS_PER_CONTRACT };

/**
 * How many tags a contract's `negotiable_tags` names, exactly — never "at least".
 * `NEGOTIATION_SPEC` §2.4: the player chooses which one method tag the job carries,
 * and a choice needs two mutually exclusive options to be a choice at all. One
 * candidate leaves nothing to choose; three stop being mutually exclusive.
 *
 * Lives here rather than in `bounds.ts`, unlike the brief that first introduced it:
 * `bounds.ts`'s own header states it is the one place a content *range* is written
 * down, and this is a cardinality on a collection, the same kind of fact
 * `MAX_TRAITS_PER_HERO` and `MAX_TAGS_PER_CONTRACT` above already state (or, since
 * Task 6, re-export) here. `createContractState` reads `MAX_TAGS_PER_CONTRACT`
 * alongside this one for the rule bounding the contract's effective tag count once a
 * negotiated tag joins it, which reads better as two constants declared beside each
 * other than two files apart.
 */
export const NEGOTIABLE_TAGS_COUNT = 2;

/**
 * Longest artifact-safe string anything in this package accepts — authored or read
 * back off a save file.
 *
 * It lived inside `save/snapshot-codec.ts` and was applied only there, which external
 * review of Task 16 measured as a hole in the bijection rather than a conservative
 * ceiling: `schemas.ts`'s `localizationKey` stated a *pattern* and no length, so a hero
 * file whose `display_name_key` ran to 257 characters loaded, reached
 * `HeroState.displayNameKey`, was written by `encodeSnapshot`, and was then refused by
 * `decodeSnapshot` with `SAVE_OUT_OF_BOUNDS`. Reproduced on real code: the loader
 * accepted it and the round trip did not. A producer must not be able to write what
 * this build's own reader refuses, so the number is stated once, here, and applied on
 * both sides of that circle — by the content contracts (`schemas.ts`), by
 * `createInitialState` for the one string that arrives from a tool rather than a file
 * (`rulesetVersion`), and by the save codec's own `artifactSafeText`.
 *
 * `256` is not derived from a real value the way {@link MAX_TRAITS_PER_HERO} is —
 * nothing states a length ceiling for these fields otherwise; `requireArtifactSafeText`
 * checks charset only. It is a generous, explicit cap far past the longest real value
 * (`content_version` is exactly `CONTENT_VERSION_LENGTH` = 16 hex characters; the
 * longest `ReasonCodes` entry, `hero.decision.stands_with_comrade`, is 34; the longest
 * key in `content/locale/ru.json` is well under a hundred), so a legitimate value never
 * brushes it while a save is still refused for claiming megabytes of text under one
 * field (`TDD` §18).
 */
export const MAX_ARTIFACT_SAFE_TEXT_LENGTH = 256;
