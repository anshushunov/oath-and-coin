/**
 * UTF-8 encoding, written out rather than delegated to `TextEncoder`.
 *
 * `TextEncoder` exists in Node, in every browser and in Electron, so this is not
 * about availability — it is about the type surface. This package compiles under
 * `lib: ["ES2023"]` and nothing else (`packages/simulation/tsconfig.json`),
 * because `simulation-depends-on-nothing` bans reaching outside the package for
 * modules and the same argument applies to reaching outside ES for globals: the
 * moment `types: ["node"]` appears here to make one call typecheck, `readFileSync`
 * typechecks too, and the boundary external review had to repair becomes a
 * boundary again only by convention.
 *
 * The encoding itself is RFC 3629, and it is thirty lines. Correctness is not
 * assumed: it is checked against known byte sequences, including the astral-plane
 * and Cyrillic cases the frozen corpus names in
 * `migration/oracle/v1/jcs-compatibility-vectors.json`.
 */

/**
 * Encodes `text` as UTF-8.
 *
 * @throws if `text` holds an unpaired surrogate. RFC 8785 §3.2.2 requires
 * failing on invalid Unicode rather than substituting anything — a replacement
 * character would canonicalize a string nobody supplied, and its hash would look
 * every bit as authoritative as a real one. The C# reference serializer reached
 * the same conclusion by turning off `Encoding.UTF8`'s default fallback; the
 * corpus records both halves of the pair under `rejected_inputs`.
 */
export function utf8Bytes(text: string): Uint8Array {
  // Worst case is three bytes per UTF-16 code unit (a surrogate pair is two
  // units and four bytes, which is less). Allocated once, sliced at the end.
  const bytes = new Uint8Array(text.length * 3);
  let at = 0;

  for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index);

    if (unit < 0x80) {
      bytes[at++] = unit;
      continue;
    }

    if (unit < 0x800) {
      bytes[at++] = 0xc0 | (unit >> 6);
      bytes[at++] = 0x80 | (unit & 0x3f);
      continue;
    }

    if (unit < 0xd800 || unit > 0xdfff) {
      bytes[at++] = 0xe0 | (unit >> 12);
      bytes[at++] = 0x80 | ((unit >> 6) & 0x3f);
      bytes[at++] = 0x80 | (unit & 0x3f);
      continue;
    }

    // A surrogate. Only a high one followed by a low one is a character; every
    // other arrangement is invalid Unicode and is refused rather than repaired.
    const low = index + 1 < text.length ? text.charCodeAt(index + 1) : Number.NaN;
    if (unit > 0xdbff || !(low >= 0xdc00 && low <= 0xdfff)) {
      throw new Error(
        `Cannot encode an unpaired surrogate U+${unit.toString(16).toUpperCase()} at index ` +
          `${index}: RFC 8785 §3.2.2 requires failing on invalid Unicode rather than ` +
          'substituting a replacement character.'
      );
    }

    index++;
    const codePoint = 0x10000 + ((unit - 0xd800) << 10) + (low - 0xdc00);
    bytes[at++] = 0xf0 | (codePoint >> 18);
    bytes[at++] = 0x80 | ((codePoint >> 12) & 0x3f);
    bytes[at++] = 0x80 | ((codePoint >> 6) & 0x3f);
    bytes[at++] = 0x80 | (codePoint & 0x3f);
  }

  return bytes.subarray(0, at);
}
