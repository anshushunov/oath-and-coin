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
 *
 * Raised to 5 by Milestone 2's first segment ([`DEC-016`](../../../docs/decisions/DEC-016-hero-combat-layer.md)):
 * a hero file now declares `combat` — the five attributes `GDD` §6.2 names — and `role`,
 * both required, and **no longer declares `capability.grade` at all**. `grade` became a
 * derivative of the combat layer and equipment, which `DEC-013` §Проверка made an
 * obligation rather than an option: while the constant sat beside the attributes there were
 * two independently editable truths about how strong a hero is, both schema-valid, and
 * nothing caught them drifting apart.
 *
 * The move is of the strongest kind — a version 4 file is not a legal version 5 file and
 * the reverse is also false, because `heroCapabilityFileSchema` is a `strictObject` and
 * refuses the retired key by name.
 *
 * Raised to 6 by Milestone 2's segment C (`ADR-016` §1, `COMBAT_SPEC` §6.2): a contract file
 * may now declare `battle` — the mapping from each of its needs to a battle objective, the
 * enemy pattern, and whatever the crew is there to keep alive.
 *
 * **Optional, and the number moves anyway**, exactly as it did for `negotiable_tags`: a
 * version 5 file lacking it is still a legal version 6 file, but a hand-authored version 5
 * file is a statement about what its author checked it against, and that statement did not
 * include the field that now decides *which resolver settles the contract*. That is a
 * stronger reason than the tag pair had: the field is not extra detail, it is the routing
 * rule (`ADR-014` §1).
 */
export const SUPPORTED_CONTENT_SCHEMA_VERSION = 6;

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
 * **4, moved by Task 7: `NeedCoverage.contributors` gained `counted`**
 * (`RESOLUTION_SPEC` §4.3, owner's decision 2026-08-27 — see
 * [`DEC-014`](../../../docs/decisions/DEC-014-two-numbers-and-who-is-wounded.md)). A
 * required key of a `strictObject`, so a version 3 save carrying a resolution is
 * unreadable under this one.
 *
 * **The first edition of that change did not move this number, and the argument was
 * wrong.** It reasoned that `resolution` is `null` in every state this build produces —
 * true of the *commands*, and irrelevant, because `buildSave` encodes whatever
 * `GameState` it is handed and `createContractState` will build a resolved contract for
 * anyone who asks (`snapshot-codec.test.ts` does exactly that). The format's reachability
 * is a property of the codec's own surface, not of which paths happen to exercise it
 * today. The evidence offered was the 42 canonical snapshots staying byte-identical,
 * which only established that none of *them* carries a resolution. Found by external
 * review; recorded because the shape of the mistake — checking the callers instead of the
 * boundary — is the one that will be available again.
 *
 * **5, moved by Task 8: the seven events a resolution raises** (`RESOLUTION_SPEC` §3.4).
 * `domainEventSchema` is a closed discriminated union and `toDomainEvent` is written by
 * hand, so a save whose history holds a `contract_resolved` is unreadable by any earlier
 * build — and this is also the change that first *produces* such a history, because
 * `resolveContract` arrives with it. §2.8: the fields and the events of one change are
 * versioned together, and this is that change.
 *
 * **6, moved by Milestone 2's first segment (`DEC-016` §3).** `HeroState` gained `combat`
 * and `role`, both required keys of a `strictObject`, and the codec stopped writing
 * `capability.grade`: a number derived from `combat` and also stored beside it would be a
 * third truth about a hero's strength, and the save is exactly where the three would first
 * disagree — an old save loaded into a new build would carry a grade its own attributes no
 * longer produce.
 *
 * **7, moved by Milestone 2's segment C (`COMBAT_SPEC` §3.7, §6.4, `ADR-016` §4).** Three
 * required keys of `strictObject` schemas arrive together, and they arrive together because
 * they are one change: `HeroState` gains `retreats`, `OfferState` gains the `deployment`
 * the player set before sending the crew, and `ContractResolution` gains the `battle` that
 * produced it. A version 6 save is not a legal version 7 save and the reverse is also
 * false.
 *
 * The battle log is in the save although it is **not** in the canonical artifact, and the
 * asymmetry is `ADR-016` §6 rather than an oversight: a save is read by the game and
 * `RESOLUTION_SPEC` §6.4 routes a loaded resolved campaign straight to the debrief, whose
 * feed this is; an artifact is read by a person, and eighty events per contract makes that
 * unreadable.
 */
export const SAVE_SCHEMA_VERSION = 7;
