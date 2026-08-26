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
 *
 * Raised to 4 by the contract-resolution engine's Task 2 (`RESOLUTION_SPEC` §2.8): a
 * hero file now declares `capability` and a contract file `needs`, and unlike
 * `negotiable_tags` **both are required**. That makes the move stronger than the last
 * one rather than the same kind: a version 3 file is not a legal version 4 file at
 * all, and reading one would mean inventing a capability for a hero the author never
 * gave one — the guess a version field exists to refuse.
 */
export const SUPPORTED_CONTENT_SCHEMA_VERSION = 4;

/** The locale file format, versioned separately because it evolves separately. */
export const SUPPORTED_LOCALE_SCHEMA_VERSION = 2;

/**
 * Version of the save envelope the initial state is built for (`TDD` §12). It
 * travels in the campaign's metadata from the first state onward, so a save
 * written today can be recognized — or refused — by a later build, instead of
 * being read with today's assumptions silently applied to yesterday's bytes.
 *
 * **2, not 1, bumped in the DEC-008 negotiation slice's Task 6 fix round, for the
 * same reason and by the same ruling as `ARTIFACT_VERSION`'s move to 4.**
 * `ContractState` gained a nested `offer` object and `moodOrdinals`
 * (`NEGOTIATION_SPEC` §2.1) in place of flat `respondedBy`/`acceptedBy`, and
 * `snapshot-codec.ts`'s `contractValueSchema` is a `strictObject` — a save written
 * under version 1's shape is unreadable under this one, and the reverse. Left at 1,
 * a version-1 save would fail `decodeSnapshot` with `unrecognized_keys`, which
 * `classify` reports as `SAVE_MALFORMED` — telling the player the file is corrupt
 * or hand-edited, when it is simply older. `readSave`'s own version gate
 * (`envelope.ts`) exists precisely to be the layer that says "no" for that reason
 * instead of the codec, and comparing `1 === 1` against an unmoved number cannot
 * do that. This is the plan's own final value (§2.5); one bump inside this
 * unreleased slice reaches it directly. **Task 14 must not bump this again** —
 * `SAVE_SCHEMA_VERSION` is already at the plan's target.
 *
 * **3, moved by the contract-resolution engine's Task 3 (`RESOLUTION_SPEC` §2.8): the
 * fields of state.** `HeroState` gained `capability` and `wounds`, `ContractState`
 * gained `needs` and `resolution`, and `OfferState` gained `invited` and `commitments`
 * — all required keys of `strictObject` schemas, so a version 2 save is unreadable
 * under this one and the reverse.
 *
 * **This number moves a second time, and deliberately not now.** The event variants
 * `resolveContract` raises — and the closed discriminated union plus hand-written
 * `toDomainEvent` that carry them — are a separate change to this format, arriving in a
 * separate task. One number covering both would leave a stretch where the format had
 * changed and the version had not: a save written after the fields landed would claim
 * the same number as one written before them.
 */
export const SAVE_SCHEMA_VERSION = 3;
