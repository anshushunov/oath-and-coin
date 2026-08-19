import {
  CONTENT_ID_PATTERN,
  canonicalSha256,
  parseContentId,
  type CanonicalValue,
  type ContentId,
  type GameState
} from '@oath-and-coin/simulation';

import {
  SAVE_SCHEMA_VERSION,
  SaveErrorCodes,
  SaveReadError,
  decodeSnapshot,
  decodeUtf8OrThrow,
  encodeSnapshot,
  encodeUtf8,
  requireReadableSnapshot
} from '@oath-and-coin/content';

import { validateGameState } from './validate-game-state.ts';

/**
 * The save envelope: version, signature and refusal table (design spec §2.3-§2.4).
 *
 * The codec in `@oath-and-coin/content` (`snapshot-codec.ts`) is a biection over
 * `GameState` and deliberately checks nothing about *which* campaign it is reading —
 * `decodeSnapshot` accepts any `saveSchemaVersion`, `rulesetVersion` or
 * `contentVersion` a snapshot claims, because a snapshot's own shape cannot know what
 * build is asking. Refusing a save that belongs to a different build is this module's
 * job, and the whole reason a save carries a version at all is so that this layer, not
 * the codec, can say no.
 *
 * `zod` is deliberately not used here even though the codec next door is built on it:
 * `application-imports-only-the-three-layers-below-it` (`.dependency-cruiser.cjs`)
 * allows this package to resolve nothing outside `content`, `presentation` and
 * `simulation` — no npm package, `zod` included. So the envelope's own ten fields are
 * validated by hand, and the one field whose shape genuinely nests (`snapshot`) is
 * handed to `decodeSnapshot`, which already owns that validation and already carries
 * `zod` as its own, declared dependency.
 */

/** The save format version this build reads and writes. */
export const SAVE_FORMAT_VERSION = 1;

/**
 * The largest save file this build produces or hands to a slot store, in bytes.
 *
 * **Declared here because the port is here.** It was declared only in
 * `apps/desktop/src/contract.ts`, where the IPC boundary refused a larger payload, and
 * external review of Task 16 measured the consequence: the IndexedDB store accepted any
 * `Uint8Array` at all, so the same call succeeded in a browser and failed in Electron
 * and no test compared the two. A limit that lives in one implementation is a limit the
 * application does not have.
 *
 * The number is a ceiling on a whole campaign's state, not a guess about a file system:
 * the frozen corpus's largest canonical snapshot — the whole state of a finished
 * campaign — is about 11 KB (`scenarios/screen_incomplete.canonical.json`), and
 * `write()` replaces a slot wholesale rather than appending, so nothing this build ever
 * asks for is more than one campaign at once. 8 MiB is roughly three orders of
 * magnitude above that: generous enough that no real campaign approaches it, finite
 * enough that an untrusted page cannot ask a host process to write an unbounded amount
 * into a data directory.
 *
 * Three places enforce it and none of them may drift: {@link buildSave} refuses to
 * *produce* more, both `SaveStorePort` implementations import this constant and refuse
 * to *store* more, and `apps/desktop/src/contract.ts` states the same number a second
 * time because the host may not import this package at all — held to this one by
 * `tests/architecture/save-size-agreement.test.ts`, the same shape `DESKTOP_SAVE_SLOTS`
 * is held to `SAVE_SLOTS`.
 */
export const MAX_SAVE_BYTES = 8 * 1024 * 1024;

/**
 * `created_at` in the one spelling this build writes and accepts: RFC 3339 / ISO-8601,
 * UTC, milliseconds, `Z` — exactly what `Date.prototype.toISOString` emits, which is
 * what the composition root's `now` is.
 *
 * A pattern rather than "any string", because the field was validated as an arbitrary
 * string and shown to a player. Its length is bounded by the pattern itself (24
 * characters), which is the bound `TDD` §18 asks for on anything read off an untrusted
 * file — there is no separate `.max()` to keep in step with it.
 */
const CREATED_AT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

/**
 * The facts a save-slot screen shows about one save without decoding the whole
 * campaign.
 *
 * `slot` is deliberately absent: nothing in a save's own bytes says which of the three
 * slots it was read from — `buildSave` is never told, and a byte-identical file could
 * legitimately sit under any of them. That fact belongs to whichever layer opened the
 * file by name (a later task's `SaveStorePort`), which already knows the slot for free
 * and can carry it beside this descriptor rather than this module inventing an answer
 * it cannot check.
 */
export interface SaveDescriptor {
  readonly createdAt: string;
  readonly logicalTime: number;
  readonly focusedContract: ContentId;
}

/** The envelope's own ten fields, in the wire's snake_case (design spec §2.3). */
interface RawEnvelope {
  readonly format_version: number;
  readonly save_schema_version: number;
  readonly ruleset_version: string;
  readonly content_version: string;
  readonly campaign_seed: string;
  readonly logical_time: number;
  readonly focused_contract: string;
  readonly snapshot: unknown;
  readonly created_at: string;
  readonly checksum: string;
}

const CAMPAIGN_SEED_PATTERN = /^(0|[1-9][0-9]{0,19})$/u;
const CONTENT_ID_REGEX = new RegExp(CONTENT_ID_PATTERN);

/** The envelope's closed field set — the hand-rolled equivalent of `z.strictObject`'s
 * own refusal of an unrecognized key. */
const ENVELOPE_FIELDS: readonly string[] = Object.freeze([
  'format_version',
  'save_schema_version',
  'ruleset_version',
  'content_version',
  'campaign_seed',
  'logical_time',
  'focused_contract',
  'snapshot',
  'created_at',
  'checksum'
]);

/**
 * Builds a save file's bytes from a campaign and the contract its screen was showing.
 *
 * **This build cannot write a file it would refuse to read.** Every check `readSave`
 * makes about the *contents* — the snapshot's own contract, the campaign's own
 * invariants, `focused_contract` naming a contract that exists, `created_at` in the one
 * spelling this format has, the size ceiling — runs here first, over the same values,
 * through the same functions. Not out of symmetry: external review of Task 16 found two
 * places where a producer could emit what the reader rejects (a 257-character
 * localization key the content loader accepted; nothing at all checking domain
 * invariants on the way out), and the answer to "who owns that gap" is that there is no
 * gap to own.
 *
 * The checks `readSave` makes about *versions* are deliberately not here: this function
 * does not know what build is asking, which is the same reason `decodeSnapshot` does
 * not. Refusing to overwrite a readable save with a foreign one is
 * `session-controller.ts`'s `refusalToWrite`, before this is ever called.
 *
 * @throws {@link SaveReadError} — the same codes reading throws, because they name the
 * same conditions.
 */
export function buildSave(input: {
  readonly state: GameState;
  readonly focusedContract: ContentId;
  /** The moment of snapshotting, ISO-8601. Read by nothing here — the clock lives
   * outside `packages/application` (`AGENTS.md` §6), so it is a parameter, not a
   * read. */
  readonly createdAt: string;
}): Uint8Array {
  const { state, focusedContract, createdAt } = input;

  requireCanonicalCreatedAt(createdAt);
  validateGameState(state);

  if (!state.contracts.has(focusedContract)) {
    throw inconsistent(
      `a save was asked for with focused_contract '${focusedContract}', but the campaign carries ` +
        'no such contract.'
    );
  }

  const snapshot = encodeSnapshot(state);
  requireReadableSnapshot(snapshot);

  const withoutChecksum = {
    format_version: SAVE_FORMAT_VERSION,
    save_schema_version: state.metadata.saveSchemaVersion,
    ruleset_version: state.metadata.rulesetVersion,
    content_version: state.metadata.contentVersion,
    // 64-bit, decimal string — the same reason `snapshot-codec.ts` writes
    // `campaignSeed` this way rather than as a JSON number.
    campaign_seed: String(state.metadata.campaignSeed),
    logical_time: state.metadata.logicalTime,
    focused_contract: focusedContract,
    snapshot,
    // Inside the signature, and that is a decision reversed rather than an oversight
    // carried forward — see {@link saveChecksum}.
    created_at: createdAt
  };

  const envelope = { ...withoutChecksum, checksum: saveChecksum(withoutChecksum) };
  const bytes = encodeUtf8(JSON.stringify(envelope));

  if (bytes.length > MAX_SAVE_BYTES) {
    throw new SaveReadError(
      SaveErrorCodes.OutOfBounds,
      `this campaign encodes to ${String(bytes.length)} bytes, past the ` +
        `${String(MAX_SAVE_BYTES)}-byte ceiling every slot store is held to; a file this build ` +
        'produces but a store may refuse is not a file worth producing.'
    );
  }

  return bytes;
}

/**
 * Reads a save back. @throws {@link SaveReadError} — see the refusal table (design
 * spec §2.4) for which code names which condition.
 *
 * The order every check below runs in is not incidental (design spec §2.3): it is
 * what decides which single code a player sees when two fields are broken at once,
 * and `envelope.test.ts` pins two instances of that ordering with tests of its own,
 * not only with a comment.
 */
export function readSave(
  bytes: Uint8Array,
  expected: { readonly rulesetVersion: string; readonly contentVersion: string }
): { readonly state: GameState; readonly descriptor: SaveDescriptor } {
  const parsed = parseSaveJson(bytes);

  requireSupportedFormatVersion(parsed);

  const envelope = requireEnvelopeShape(parsed);

  const { checksum, ...withoutChecksum } = envelope;
  if (saveChecksum(withoutChecksum) !== checksum) {
    throw new SaveReadError(
      SaveErrorCodes.ChecksumMismatch,
      'save checksum does not match its contents; the file was edited after it was signed.'
    );
  }

  if (envelope.save_schema_version !== SAVE_SCHEMA_VERSION) {
    throw new SaveReadError(
      SaveErrorCodes.SchemaUnsupported,
      `save snapshot version ${String(envelope.save_schema_version)} is not supported; this ` +
        `build reads version ${String(SAVE_SCHEMA_VERSION)}.`
    );
  }

  if (envelope.ruleset_version !== expected.rulesetVersion) {
    throw new SaveReadError(
      SaveErrorCodes.RulesetMismatch,
      `save was written under ruleset '${envelope.ruleset_version}', not the running build's ` +
        `'${expected.rulesetVersion}'.`
    );
  }

  if (envelope.content_version !== expected.contentVersion) {
    throw new SaveReadError(
      SaveErrorCodes.ContentMismatch,
      `save was written against content '${envelope.content_version}', not the running build's ` +
        `'${expected.contentVersion}'.`
    );
  }

  const state = decodeSnapshot(envelope.snapshot);

  validateGameState(state);

  requireDuplicateFieldsAgree(envelope, state);

  const focusedContract = parseContentId(envelope.focused_contract);
  if (!state.contracts.has(focusedContract)) {
    throw inconsistent(
      `envelope names focused_contract '${focusedContract}', but the save carries no such ` +
        'contract.'
    );
  }

  return {
    state,
    descriptor: {
      createdAt: envelope.created_at,
      logicalTime: envelope.logical_time,
      focusedContract
    }
  };
}

/**
 * The campaign's own hash, over the snapshot and nothing else.
 *
 * Separate from {@link saveChecksum}, which signs a *file*, because the two answer
 * different questions and stopped being able to share one number the moment
 * `created_at` went inside the signature. This one answers "which campaign is this",
 * and a screen comparing what is on screen against what is in a slot needs exactly
 * that: saving one unchanged campaign twice, a minute apart, has to produce the same
 * value here, and now produces two different signatures over there. Computed through
 * `encodeSnapshot` — the same projection the file carries — so it is a hash of the
 * campaign as this format states it, not of an in-memory shape that could drift from
 * it.
 */
export function snapshotHash(state: GameState): string {
  return canonicalSha256(encodeSnapshot(state) as CanonicalValue);
}

/**
 * The envelope's contents checksum — `canonicalSha256` over the canonical bytes of
 * every field the save carries except `checksum` itself. **`created_at` is inside it**,
 * and that reverses what the design spec §2.3 wrote down.
 *
 * The spec excluded it to buy one property: saving the same campaign twice would sign
 * identically, so "is this slot the campaign on screen" could be answered by comparing
 * one number. External review of Task 16 priced the other side and it came out higher.
 * A field excluded from the signature is a field nothing protects: `created_at` could be
 * replaced with `not-a-date` in a file nobody re-signed, and the file still read back
 * clean, still claimed integrity, and still reached the interface — while the refusal
 * text this envelope shows for a broken signature says "the file was edited after it was
 * signed", which that file now provably was and was not told. A save format that signs
 * nine of its ten fields signs nothing about the tenth, and the tenth is the one a
 * player reads off the slots screen.
 *
 * The property the exclusion bought is not lost, it moved: {@link snapshotHash} answers
 * "which campaign is this" over the snapshot alone, which is what that question was
 * always about. Two functions for two questions, rather than one number asked to be
 * both a signature and an identity.
 *
 * `unknown` rather than a typed envelope: this function's whole job is to hash
 * whatever JSON-shaped value it is handed, the same way `snapshot-codec.ts`'s own
 * `encodeSnapshot` output is an untyped `unknown` on its way to `JSON.stringify`. A
 * caller that hands this something that is not a plain, JSON-shaped value gets
 * whatever `canonicalSha256` does with it — which is exactly what `saveChecksum` at
 * read time and at write time share, so the two can never silently diverge on what
 * counts as coverable.
 */
export function saveChecksum(envelopeWithoutChecksum: unknown): string {
  return canonicalSha256(envelopeWithoutChecksum as CanonicalValue);
}

function parseSaveJson(bytes: Uint8Array): unknown {
  let text: string;
  try {
    text = decodeUtf8OrThrow(bytes);
  } catch (error) {
    throw new SaveReadError(
      SaveErrorCodes.Malformed,
      `save bytes are not valid UTF-8: ${describeError(error)}`
    );
  }

  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new SaveReadError(
      SaveErrorCodes.Malformed,
      `save bytes do not parse as JSON: ${describeError(error)}`
    );
  }
}

/**
 * `format_version` is checked before anything else about the file is asked, including
 * before the file is even confirmed to be an object (design spec §2.3, `envelope.test.ts`
 * step 6): a version this build does not recognize means the rest of the bytes were
 * written under rules this build does not have, so nothing about them can be said yet
 * — including whether their *shape* is wrong versus merely foreign.
 *
 * That "before confirmed to be an object" still splits into two different refusals,
 * though: bytes that parsed to something with no fields at all — a bare number, a
 * string, an array, `null` — are not "a foreign format_version", they are not an
 * envelope in any sense this function can peek a field out of, and saying so as
 * `SAVE_MALFORMED` is what stops a player reading "save format version undefined is
 * not supported" — a real value (`undefined`) for a field that was never there to have
 * one.
 */
function requireSupportedFormatVersion(parsed: unknown): void {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw malformed('the save is not a JSON object.');
  }

  const value = (parsed as Record<string, unknown>).format_version;

  if (value !== SAVE_FORMAT_VERSION) {
    throw new SaveReadError(
      SaveErrorCodes.FormatUnsupported,
      `save format version ${JSON.stringify(value)} is not supported; this build reads version ` +
        `${String(SAVE_FORMAT_VERSION)}.`
    );
  }
}

/**
 * The envelope's own hand-rolled shape check — this module's "Zod конверта" step,
 * without Zod (see the module doc comment for why). `snapshot` is deliberately not
 * validated here at all: its shape is `decodeSnapshot`'s contract, not a second one
 * this function restates.
 */
function requireEnvelopeShape(value: unknown): RawEnvelope {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw malformed('the save is not a JSON object.');
  }

  const raw = value as Record<string, unknown>;

  const unknownField = Object.keys(raw).find((key) => !ENVELOPE_FIELDS.includes(key));
  if (unknownField !== undefined) {
    throw malformed(`unrecognized field '${unknownField}'.`);
  }

  requireInt(raw.format_version, 'format_version');
  requireInt(raw.save_schema_version, 'save_schema_version');
  requireString(raw.ruleset_version, 'ruleset_version');
  requireString(raw.content_version, 'content_version');
  requireMatch(raw.campaign_seed, CAMPAIGN_SEED_PATTERN, 'campaign_seed');
  requireInt(raw.logical_time, 'logical_time');
  requireMatch(raw.focused_contract, CONTENT_ID_REGEX, 'focused_contract');
  requireString(raw.created_at, 'created_at');
  requireCanonicalCreatedAt(raw.created_at);
  requireString(raw.checksum, 'checksum');

  return raw as unknown as RawEnvelope;
}

/**
 * `created_at` in the one spelling this format has, at both ends: `buildSave` will not
 * stamp anything else and `readSave` will not accept anything else.
 *
 * The pattern alone would accept `2026-13-45T99:99:99.999Z`, so the value is also put
 * through a parse and required to come back out identical — which is what rules out a
 * month 13, a 31st of February and a leap second at once, without this module owning a
 * calendar. **`new Date(string)` is a parser, not a clock.** `AGENTS.md` §6 keeps this
 * layer from *reading* the time (`Date.now()`, `new Date()` with no argument), which is
 * why `createdAt` is a parameter at all; deciding whether a string somebody else handed
 * over is a date is a different act, and it happens to the same value on both sides of
 * the file.
 */
function requireCanonicalCreatedAt(value: string): void {
  const parsed = CREATED_AT_PATTERN.test(value) ? new Date(value) : new Date(Number.NaN);

  // `Number.isNaN(getTime())` before `toISOString()`, because `toISOString` on an
  // invalid date throws a `RangeError` rather than answering — and a `RangeError` out of
  // here would escape `readSave`'s own `@throws SaveReadError` promise on a file whose
  // only fault is a 13th month.
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw malformed(
      `'created_at' must be an ISO-8601 instant in UTC with milliseconds, as in ` +
        `'2026-08-19T09:41:00.000Z'; this save carries ${JSON.stringify(value)}.`
    );
  }
}

function malformed(detail: string): SaveReadError {
  return new SaveReadError(SaveErrorCodes.Malformed, `save envelope is malformed: ${detail}`);
}

function requireInt(value: unknown, field: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw malformed(`'${field}' must be an integer.`);
  }
}

function requireString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string') {
    throw malformed(`'${field}' must be a string.`);
  }
}

function requireMatch(value: unknown, pattern: RegExp, field: string): asserts value is string {
  requireString(value, field);
  if (!pattern.test(value)) {
    throw malformed(`'${field}' does not have the shape this format expects.`);
  }
}

function inconsistent(detail: string): SaveReadError {
  return new SaveReadError(SaveErrorCodes.Inconsistent, detail);
}

/**
 * The envelope fields that duplicate content already inside the snapshot (design spec
 * §2.3: `ruleset_version`, `content_version`, `campaign_seed`, `logical_time`), plus
 * `save_schema_version` for the same reason, checked against their twins one last time
 * now that the snapshot has been decoded. A mismatch here is a file where the wrapper
 * and the campaign it wraps disagree — signed together, by the checksum above, and
 * saying two different things anyway.
 */
function requireDuplicateFieldsAgree(envelope: RawEnvelope, state: GameState): void {
  if (envelope.save_schema_version !== state.metadata.saveSchemaVersion) {
    throw duplicateFieldMismatch('save_schema_version');
  }

  if (envelope.ruleset_version !== state.metadata.rulesetVersion) {
    throw duplicateFieldMismatch('ruleset_version');
  }

  if (envelope.content_version !== state.metadata.contentVersion) {
    throw duplicateFieldMismatch('content_version');
  }

  if (envelope.campaign_seed !== String(state.metadata.campaignSeed)) {
    throw duplicateFieldMismatch('campaign_seed');
  }

  if (envelope.logical_time !== state.metadata.logicalTime) {
    throw duplicateFieldMismatch('logical_time');
  }
}

function duplicateFieldMismatch(field: string): SaveReadError {
  return inconsistent(`envelope field '${field}' disagrees with the snapshot it wraps.`);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
