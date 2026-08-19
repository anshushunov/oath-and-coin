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
  encodeUtf8
} from '@oath-and-coin/content';

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

/** Builds a save file's bytes from a campaign and the contract its screen was showing. */
export function buildSave(input: {
  readonly state: GameState;
  readonly focusedContract: ContentId;
  /** The moment of snapshotting, ISO-8601. Read by nothing here — the clock lives
   * outside `packages/application` (`AGENTS.md` §6), so it is a parameter, not a
   * read. */
  readonly createdAt: string;
}): Uint8Array {
  const { state, focusedContract, createdAt } = input;

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
    snapshot: encodeSnapshot(state)
  };

  const envelope = {
    ...withoutChecksum,
    created_at: createdAt,
    checksum: saveChecksum(withoutChecksum)
  };

  return encodeUtf8(JSON.stringify(envelope));
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

  const { checksum, created_at: createdAt, ...withoutChecksum } = envelope;
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

  checkReferentialIntegrity(state);

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
      createdAt,
      logicalTime: envelope.logical_time,
      focusedContract
    }
  };
}

/**
 * The envelope's contents checksum — `canonicalSha256` over the canonical bytes of
 * every field the save carries except `created_at` and `checksum` itself (design spec
 * §2.3). The one algorithm the segment's saves are hashed with: Task 16.7 reuses this
 * function rather than restating the rule.
 *
 * `unknown` rather than a typed envelope: this function's whole job is to hash
 * whatever JSON-shaped value it is handed, the same way `snapshot-codec.ts`'s own
 * `encodeSnapshot` output is an untyped `unknown` on its way to `JSON.stringify`. A
 * caller that hands this something that is not a plain, JSON-shaped value gets
 * whatever `canonicalSha256` does with it — which is exactly what `saveChecksum` at
 * read time and at write time share, so the two can never silently diverge on what
 * counts as coverable.
 */
export function saveChecksum(envelopeWithoutCreatedAtAndChecksum: unknown): string {
  return canonicalSha256(envelopeWithoutCreatedAtAndChecksum as CanonicalValue);
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
  requireString(raw.checksum, 'checksum');

  return raw as unknown as RawEnvelope;
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

/**
 * The referential integrity `decodeSnapshot` deliberately leaves unchecked: a map's
 * own key-equals-identity is the codec's contract, but a *reference between* two maps
 * — an event's `heroId` or `contractId`, an event's `causalTraceId` pointing at a
 * trace, a contract's `respondedBy` or `acceptedBy` naming a hero — spans two of
 * `snapshot-codec.ts`'s independently-built maps, and nothing there checks across
 * that seam.
 *
 * This is the envelope's job rather than a second codec concern: a save is a
 * `GameState` plus the promise that *this* build can trust it, and a save whose event
 * log names a hero or a contract its own roster does not have is not a save this build
 * can trust, whatever `decodeSnapshot`'s per-map checks already passed.
 * `SaveErrorCodes.Inconsistent` is reused rather than a new code minted for it — a
 * dangling reference is the same kind of failure `decodeSnapshot` already reports
 * under that code for a map's own key.
 */
function checkReferentialIntegrity(state: GameState): void {
  for (const event of state.history) {
    if (!state.heroes.has(event.heroId)) {
      throw inconsistent(
        `history event ${String(event.eventId)} names hero#${String(event.heroId)}, but the ` +
          'save carries no such hero.'
      );
    }

    if (!state.contracts.has(event.contractId)) {
      throw inconsistent(
        `history event ${String(event.eventId)} names contract '${event.contractId}', but the ` +
          'save carries no such contract.'
      );
    }

    if (event.causalTraceId !== null && !state.traces.has(event.causalTraceId)) {
      throw inconsistent(
        `history event ${String(event.eventId)} references causalTraceId ` +
          `${String(event.causalTraceId)}, but the save stores no trace under that id.`
      );
    }
  }

  for (const [contractId, contract] of state.contracts.entries()) {
    for (const heroId of contract.respondedBy.values()) {
      if (!state.heroes.has(heroId)) {
        throw inconsistent(
          `contract '${contractId}' lists hero#${String(heroId)} in respondedBy, but the save ` +
            'carries no such hero.'
        );
      }
    }

    for (const heroId of contract.acceptedBy.values()) {
      if (!state.heroes.has(heroId)) {
        throw inconsistent(
          `contract '${contractId}' lists hero#${String(heroId)} in acceptedBy, but the save ` +
            'carries no such hero.'
        );
      }
    }
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
