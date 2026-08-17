/**
 * A stable, namespaced content identifier (`ADR-005`) in the form
 * `namespace:name`, where both segments match `^[a-z][a-z0-9_]*$`.
 *
 * Ported from `OathAndCoin.Simulation.Ids.ContentId`, and the port is a plain
 * branded string rather than a wrapper object. That is not a shortcut — it
 * deletes a whole class of defect the C# version had to defend against by hand:
 *
 * - The C# struct needed `ContentIdJsonConverter`, attached to the type, because
 *   `System.Text.Json` otherwise wrote `{"Namespace":"core","Name":"bram",...}`
 *   and read it back as `default(ContentId)` silently. A branded string *is* its
 *   own wire format; there is no second representation to disagree with.
 * - It needed `ReadAsPropertyName`/`WriteAsPropertyName` overrides because
 *   dictionary keys travel a different code path. A string is already a valid
 *   key everywhere.
 * - It needed a `default(ContentId)` guard — three nullable fields and an
 *   "uninitialized" exception — because C# forces a zero value on every struct.
 *   TypeScript forces nothing: the only values of this type are the ones
 *   {@link parseContentId} and {@link tryParseContentId} return.
 *
 * What the brand keeps is the guarantee those defences existed for: an
 * out-of-band-invalid identifier cannot be produced by ordinary code, because
 * the type is not assignable from `string`. A deliberate cast defeats it, the
 * same way `Unsafe` defeats the C# version.
 *
 * Ordering and comparison are ordinal — UTF-16 code units, never the host's
 * locale (`TDD` §7.3). That is what JavaScript's own `<` on strings already
 * does, so {@link compareContentIds} is a comparator over it rather than a
 * reimplementation.
 */

declare const contentIdBrand: unique symbol;

export type ContentId = string & { readonly [contentIdBrand]: 'ContentId' };

/**
 * The one statement of what a segment looks like. Everything else about the
 * format is built from it — the per-segment check, the diagnostic an author
 * reads, and the whole-identifier pattern the content schemas state — so the
 * format cannot be tightened in one of those places and left alone in the others.
 */
const SEGMENT_BODY = '[a-z][a-z0-9_]*';

const SEGMENT_PATTERN_TEXT = `^${SEGMENT_BODY}$`;

const SEGMENT_PATTERN = new RegExp(SEGMENT_PATTERN_TEXT);

/**
 * The whole-identifier pattern, for consumers that validate a `namespace:name`
 * string in one step instead of splitting it — the Zod content contracts, and
 * through them the generated JSON Schemas. Exported rather than restated there:
 * a schema whose pattern drifts from this parser is a schema that accepts
 * identifiers the loader then refuses, which is the worst of both.
 */
export const CONTENT_ID_PATTERN = `^${SEGMENT_BODY}:${SEGMENT_BODY}$`;

/**
 * Parses `text` as a {@link ContentId}.
 *
 * @throws if `text` is not a valid `namespace:name` identifier. The message is
 * the C# one word for word: a diagnostic an author has already learned to read
 * should not change spelling just because the language did.
 */
export function parseContentId(text: string | null | undefined): ContentId {
  const parsed = tryParseContentId(text);
  if (parsed === undefined) {
    throw new Error(
      `Invalid ContentId '${text ?? 'null'}'. Expected format 'namespace:name', ` +
        `where each segment matches '${SEGMENT_PATTERN_TEXT}'.`
    );
  }

  return parsed;
}

/** Parses `text`, answering `undefined` instead of throwing on malformed input. */
export function tryParseContentId(text: string | null | undefined): ContentId | undefined {
  if (text === null || text === undefined || text === '') {
    return undefined;
  }

  const separatorIndex = text.indexOf(':');
  // Exactly one separator. `a:b:c` is rejected rather than read as
  // namespace `a` and name `b:c`, which would make two different spellings of
  // one identifier both parse.
  if (separatorIndex < 0 || text.indexOf(':', separatorIndex + 1) >= 0) {
    return undefined;
  }

  const namespaceSegment = text.slice(0, separatorIndex);
  const nameSegment = text.slice(separatorIndex + 1);

  if (!SEGMENT_PATTERN.test(namespaceSegment) || !SEGMENT_PATTERN.test(nameSegment)) {
    return undefined;
  }

  return text as ContentId;
}

/** The namespace segment, e.g. `core` in `core:bram`. */
export function contentIdNamespace(id: ContentId): string {
  return id.slice(0, id.indexOf(':'));
}

/** The name segment, e.g. `bram` in `core:bram`. */
export function contentIdName(id: ContentId): string {
  return id.slice(id.indexOf(':') + 1);
}

/**
 * Ordinal comparison, never locale-dependent. Returns a negative number, zero
 * or a positive number, the shape every sort in this package expects.
 */
export function compareContentIds(left: ContentId, right: ContentId): number {
  if (left < right) {
    return -1;
  }

  return left > right ? 1 : 0;
}
