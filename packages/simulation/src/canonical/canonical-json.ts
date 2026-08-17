import { compareStrings } from '../collections/comparator.ts';

import { Sha256 } from './sha256.ts';
import { utf8Bytes } from './utf8.ts';

/**
 * Canonical JSON — RFC 8785 (JSON Canonicalization Scheme).
 *
 * The C# original (`OathAndCoin.Content.CanonicalJson`) was a structural
 * transform over `JsonNode`: sort object keys ordinally, keep array order, and
 * let `Utf8JsonWriter` write every scalar. It was canonical in the sense that
 * mattered — the same data always produced the same bytes — but it was canonical
 * *to itself*, because `Utf8JsonWriter`'s default encoder escapes things the
 * standard does not.
 *
 * This port implements the standard instead, which is the debt
 * `FULL_TYPESCRIPT_MIGRATION` §3.3 and §4.5 booked against Task 6. The frozen
 * corpus already measured what changes and what does not
 * (`migration/oracle/v1/jcs-compatibility-vectors.json`): five of its ten vectors
 * are byte-identical under both rules and carry `same_artifact_version: true`,
 * five differ and carry `false`. The five that differ are non-ASCII text,
 * HTML-sensitive ASCII, negative zero, control characters and an astral-plane
 * character.
 *
 * **The determinism artifact's version therefore does not step, and that is the
 * recorded decision rather than an omission.** A version step is how two builds
 * say "we disagree about the shape"; here they do not disagree about any artifact
 * that exists, because every string a determinism artifact holds is drawn from
 * `[a-z0-9_.:/-]` and every number is a safe integer — precisely the domain the
 * five `true` vectors cover. Stepping the version would make 54 byte-identical
 * artifacts formally incomparable and destroy the parity evidence the whole
 * segment is measured on. What the rule forbids is a *silent* re-shoot; the
 * mapping of old hash to new hash is kept, vector by vector, in the corpus, and
 * the tests here assert both halves of it.
 *
 * Numbers are the one place this port is *more* trustworthy than the reference it
 * was measured against. RFC 8785 defers number serialization to ECMAScript
 * `Number::toString`, and the C# reference refused integers beyond ±(2^53−1)
 * rather than approximate that algorithm — the corpus records the refusal and asks
 * the TypeScript port to close it. There is nothing to close: this code runs on
 * ECMAScript, so the specified algorithm is the platform's own and is not
 * reimplemented here.
 */

/** Everything a canonical document may hold. A key bound to `undefined` is omitted. */
export type CanonicalValue =
  | null
  | boolean
  | number
  | bigint
  | string
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue | undefined };

/** Canonicalizes `value` to its RFC 8785 text. */
export function canonicalize(value: CanonicalValue): string {
  const parts: string[] = [];
  write(value, parts);
  return parts.join('');
}

/** Canonicalizes `value` to its RFC 8785 bytes — UTF-8, which is what the hash covers. */
export function canonicalBytes(value: CanonicalValue): Uint8Array {
  return utf8Bytes(canonicalize(value));
}

/** SHA-256 of {@link canonicalBytes}, lowercase hex. */
export function canonicalSha256(value: CanonicalValue): string {
  return new Sha256().update(canonicalBytes(value)).hex();
}

/**
 * `Array.isArray` narrows its argument to `any[]`, which does not remove
 * `readonly CanonicalValue[]` from the union in the *negative* branch — so the
 * object writer below would still see an array in its type. This guard states the
 * narrowing both branches need.
 */
function isArray(value: CanonicalValue): value is readonly CanonicalValue[] {
  return Array.isArray(value);
}

function write(value: CanonicalValue, parts: string[]): void {
  if (value === null) {
    parts.push('null');
    return;
  }

  if (isArray(value)) {
    // Array order is content — the order commands ran in, the order decisions
    // happened — never presentation, so it is preserved exactly.
    parts.push('[');
    for (let index = 0; index < value.length; index++) {
      if (index > 0) {
        parts.push(',');
      }
      write(value[index]!, parts);
    }
    parts.push(']');
    return;
  }

  // An if-chain rather than a `switch (typeof value)`: the switch would have to
  // enumerate `symbol`, `function` and `undefined` — three cases `CanonicalValue`
  // already excludes — to satisfy the exhaustiveness rule, and three unreachable
  // branches are three places for a future reader to wonder what they are for.
  if (typeof value === 'boolean') {
    parts.push(value ? 'true' : 'false');
    return;
  }

  if (typeof value === 'number') {
    parts.push(writeNumber(value));
    return;
  }

  if (typeof value === 'bigint') {
    // Plain decimal digits. `bigint` is how this port carries C#'s `ulong`
    // (ADR-010 §126: the 64-bit values stay `bigint` and never cross the JSON
    // boundary as one) — a seed reaches the artifact as the integer `7`, the same
    // token the C# writer produced, not as the string `"7"`. It is also the only
    // way to write an integer past 2^53 exactly, which is why seeds are `bigint`
    // and not `number` (see the note on the number domain in the parity test).
    parts.push(value.toString());
    return;
  }

  if (typeof value === 'string') {
    parts.push(writeString(value));
    return;
  }

  writeObject(value, parts);
}

function writeObject(
  value: { readonly [key: string]: CanonicalValue | undefined },
  parts: string[]
): void {
  // Keys sorted by UTF-16 code units, which is what RFC 8785 §3.2.3 specifies
  // and what the C# original's ordinal comparer did. A key bound to `undefined`
  // is dropped rather than written as `null`: the artifact carries no empty
  // slots, so "absent" and "present and null" must not become two spellings of
  // one fact (see `DeterminismArtifact`'s treatment of `selected_score`).
  const keys = Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort(compareStrings);

  parts.push('{');
  for (let index = 0; index < keys.length; index++) {
    if (index > 0) {
      parts.push(',');
    }
    const key = keys[index]!;
    parts.push(writeString(key), ':');
    write(value[key]!, parts);
  }
  parts.push('}');
}

function writeNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(
      `Cannot canonicalize the number ${String(value)}: RFC 8785 §3.2.2.3 has no ` +
        'representation for NaN or Infinity, and JSON has no token for either.'
    );
  }

  // ECMAScript `Number::toString`, which is the algorithm RFC 8785 names. It
  // already answers "0" for negative zero — the fourth of the five differences
  // the corpus recorded against the C# writer, which preserved the author's
  // token.
  return String(value);
}

const SHORT_ESCAPES = new Map<number, string>([
  [0x08, '\\b'],
  [0x09, '\\t'],
  [0x0a, '\\n'],
  [0x0c, '\\f'],
  [0x0d, '\\r'],
  [0x22, '\\"'],
  [0x5c, '\\\\']
]);

function writeString(value: string): string {
  let written = '"';

  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    const short = SHORT_ESCAPES.get(unit);

    if (short !== undefined) {
      written += short;
      continue;
    }

    if (unit < 0x20) {
      // Four lowercase hex digits, per RFC 8785 §3.2.2.2. Everything else — every
      // non-ASCII character, and the `< > & ' +` set the C# encoder escaped by
      // default — is emitted literally.
      written += `\\u${unit.toString(16).padStart(4, '0')}`;
      continue;
    }

    // Invalid Unicode is refused here rather than only when the text is encoded
    // to bytes. `utf8Bytes` rejects an unpaired surrogate too, but a writer that
    // relied on that would hand a caller of `canonicalize` a string RFC 8785
    // §3.2.2 says must not exist, and the failure would surface wherever those
    // characters were next touched instead of here. Found by the test for this
    // rule, which passed against the byte path and not against the text one.
    if (unit >= 0xd800 && unit <= 0xdfff) {
      const low = index + 1 < value.length ? value.charCodeAt(index + 1) : Number.NaN;
      if (unit > 0xdbff || !(low >= 0xdc00 && low <= 0xdfff)) {
        throw new Error(
          `Cannot canonicalize an unpaired surrogate U+${unit.toString(16).toUpperCase()}: ` +
            'RFC 8785 §3.2.2 requires failing on invalid Unicode rather than substituting a ' +
            'replacement character.'
        );
      }

      written += value[index]! + value[index + 1]!;
      index++;
      continue;
    }

    written += value[index]!;
  }

  return `${written}"`;
}
