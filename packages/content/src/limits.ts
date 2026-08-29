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
 * Fewest needs a contract may name (`RESOLUTION_SPEC` §2.3).
 *
 * **Two, and the number is the model.** One need makes "take the strongest hero
 * available" the optimal answer to every contract, which is the kill-criterion
 * `MVP_PLAN` §3.2 names by that word: independent needs with weights are the only
 * reason "the strongest crew" and "the right crew" are different crews. A floor of
 * one would leave the whole coverage model reachable but pointless on the contract
 * that skipped it.
 */
export const MIN_NEEDS_PER_CONTRACT = 2;

/**
 * Most needs a contract may name (`RESOLUTION_SPEC` §2.3).
 *
 * **A literal, deliberately not `NEED_IDS.length`.** The two are equal today and that
 * is a coincidence of arithmetic, not one rule: how many needs one contract may ask
 * for is a statement about contracts, and how many needs exist is a statement about
 * the world. Derived from the vocabulary, adding a fourth `NeedId` would silently
 * permit a four-need contract — a change to what the game *is*, arriving through a
 * `.length` and without a decision, which `AGENTS.md` §5 forbids taking inside an
 * implementation.
 *
 * The coincidence is held by a tripwire in `schemas.test.ts` rather than by this
 * declaration: it reddens the day a fourth need is authored, which is exactly when
 * somebody has to decide whether contracts may name four.
 */
export const MAX_NEEDS_PER_CONTRACT = 3;

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

/**
 * Most wounds a save file may claim for one hero.
 *
 * **A read-path ceiling, not a domain rule.** `RESOLUTION_SPEC` §2.6 states plainly that
 * M1 gives wounds no domain cap — they accumulate, they are visible, and nothing reads
 * them — so this number must not be mistaken for one: it is the same kind of guard
 * `MAX_ARTIFACT_SAFE_TEXT_LENGTH` is, and lives here for the same reason. A save is
 * external data (`TDD` §18), and a hero claiming a wound count no sequence of contracts
 * could have produced is a file to refuse, not a campaign to load.
 *
 * Generous by two orders of magnitude on purpose: a campaign of the length M1 plays
 * cannot approach it, so a legitimate save never brushes this the way a real
 * `content_version` never brushes the text ceiling. Raising the domain cap later, if one
 * is ever introduced, is a separate decision from raising this.
 */
export const WOUNDS_CEILING = 10_000;

/**
 * Largest magnitude any number inside a stored `ContractResolution` may carry.
 *
 * The same argument as {@link WOUNDS_CEILING} and as the trace-factor ceiling in
 * `save/snapshot-codec.ts`: these are *derived* quantities — coverage totals, margins,
 * counterfactual deficit sizes — so no content bound constrains them directly, and
 * `RESOLUTION_SPEC` §4.8 promises only that every one of them stays inside `int32`. What
 * a save must not be able to do is claim a number outside that promise and hand the
 * debrief screen arithmetic the engine could never have produced.
 *
 * Real values are small: a contribution is capped by `grade` (100), a requirement by a
 * weight raised by risk (200), and a crew is at most six heroes over three needs. This
 * ceiling sits far above all of them and far below `int32`, which is exactly where a
 * guard against a tampered file belongs.
 */
export const MAX_RESOLUTION_MAGNITUDE = 1_000_000;

/**
 * Most combatants a stored battle record may name.
 *
 * The rules allow a crew of six, a ward or two the contract authored, and a pattern of at
 * most six foes on a 3×3 board — sixteen leaves headroom over every one of those without
 * approaching a number a file could use to make a load expensive (`TDD` §18).
 */
export const MAX_BATTLE_UNITS = 16;

/**
 * Most events a stored battle record may carry.
 *
 * The spike measured **82** events for a five-a-side battle of five rounds
 * (`SPIKE_2026-08-29`), and `MAX_ROUNDS` is 12. Four thousand is two orders of magnitude
 * above what the rules can produce and still small enough that a tampered file cannot use
 * this array to make a load expensive — the same kind of guard, and the same argument, as
 * {@link WOUNDS_CEILING}.
 */
export const MAX_BATTLE_EVENTS = 4_096;

/**
 * Most provenance steps one number may carry (`COMBAT_SPEC` §8.2).
 *
 * The pipeline of §3.6 has four: perk and equipment, the actor's chill, obstruction, and
 * the target's shield. Doubled, for the same headroom reason every other ceiling here is.
 */
export const MAX_PROVENANCE_STEPS = 8;

/**
 * The enemy pattern a contract may author (`COMBAT_SPEC` §4.7, `MVP_PLAN` §6.2).
 *
 * Two is the floor because a single foe is not a formation and the geometry it is meant to
 * exercise has nothing to say about it; six is the ceiling because the board is 3×3 and a
 * side that fills more than six of nine cells has no empty cell left for §4.5's decision to
 * be about.
 */
export const MIN_FOES_PER_CONTRACT = 2;
export const MAX_FOES_PER_CONTRACT = 6;

/**
 * Most wards one contract may put on the crew's own board.
 *
 * Every ward takes one of the nine cells the crew stands in, so two is already a crew of at
 * most seven on a board of nine. A third would leave a crew of six nowhere legal to stand.
 */
export const MAX_WARDS_PER_CONTRACT = 2;

/**
 * Most rounds a `hold` objective may ask for.
 *
 * `MAX_ROUNDS` is 12 (`COMBAT_SPEC` §6.1), so an objective asking for more than that could
 * never be closed by any battle this build can run — a requirement nothing can satisfy is a
 * content defect, and this is the loader catching it rather than a player discovering it.
 * Stated here rather than imported from the simulation because `limits.ts` is where content's
 * own ceilings live; `battle-plan.test.ts` holds the two numbers to each other.
 */
export const MAX_BATTLE_ROUNDS_ASKED = 12;
