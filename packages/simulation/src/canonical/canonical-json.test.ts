import { describe, expect, it } from 'vitest';

import { canonicalize, type CanonicalValue } from './canonical-json.ts';

/**
 * The rules of RFC 8785, one at a time and stated as bytes.
 *
 * The corpus-driven half of this proof lives in `packages/content`, where all ten
 * `jcs-compatibility-vectors.json` entries are replayed against their recorded
 * `current` and `rfc8785` hashes. That is where "this port adopted the standard
 * and here is what changed" is demonstrated; here is where each individual rule is
 * pinned so a failure names the rule instead of a hash.
 */

describe('canonicalize — object keys', () => {
  it('sorts keys by UTF-16 code units regardless of insertion order', () => {
    // The corpus's own `object_key_ordering` vector. Uppercase sorts before
    // lowercase and the empty key sorts first, which is what code-unit order
    // means and what a locale-aware sort would get wrong.
    expect(canonicalize({ b: 1, A: 2, a: 3, '': 4, aa: 5 })).toBe(
      '{"":4,"A":2,"a":3,"aa":5,"b":1}'
    );
  });

  it('sorts at every level, not only the top one', () => {
    expect(canonicalize({ outer: { b: 1, a: [{ d: 1, c: 2 }] } })).toBe(
      '{"outer":{"a":[{"c":2,"d":1}],"b":1}}'
    );
  });

  it('omits a key bound to undefined and writes one bound to null', () => {
    // The artifact carries no empty slots: "absent" and "present and null" must
    // not become two spellings of one fact. `DeterminismArtifact` relies on this
    // for `selected_score`, which is omitted when a decision was blocked.
    expect(canonicalize({ present: null, absent: undefined, after: 1 })).toBe(
      '{"after":1,"present":null}'
    );
  });
});

describe('canonicalize — arrays', () => {
  it('preserves array order, because order is content', () => {
    // The order commands ran in and the order decisions happened are data. A
    // canonicalizer that sorted arrays would erase the very sequence a replay
    // compares.
    expect(canonicalize([3, 1, 2])).toBe('[3,1,2]');
    expect(canonicalize([])).toBe('[]');
  });
});

describe('canonicalize — numbers', () => {
  it.each([
    { value: 0, written: '0' },
    // RFC 8785 collapses negative zero, which the C# writer preserved as the
    // author's token — one of the five differences the corpus recorded.
    { value: -0, written: '0' },
    { value: 42, written: '42' },
    { value: -31, written: '-31' },
    { value: 9007199254740991, written: '9007199254740991' },
    { value: -9007199254740991, written: '-9007199254740991' },
    // ECMAScript `Number::toString` is the algorithm RFC 8785 names, so these
    // are the platform's answers rather than this code's. The C# reference
    // refused this whole class rather than approximate it, and asked the port to
    // close the gap; there was nothing to implement.
    { value: 1e21, written: '1e+21' },
    { value: 1e-7, written: '1e-7' },
    { value: 0.000001, written: '0.000001' },
    { value: 5e-324, written: '5e-324' },
    { value: 0.1, written: '0.1' }
  ])('writes $value as $written', ({ value, written }) => {
    expect(canonicalize(value)).toBe(written);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'refuses %s, which JSON has no token for',
    (value) => {
      expect(() => canonicalize(value)).toThrow(/no .*representation|NaN or Infinity/);
    }
  );

  it('does not round-trip a bigint through JSON, and that is the extension it is', () => {
    // External review's objection, pinned. RFC 8785 canonicalizes JSON numbers, which
    // are doubles; writing a 64-bit integer exactly is outside that domain. Calling the
    // whole output "RFC 8785 text" was therefore an overstatement — on the JSON domain
    // it is the standard, on `bigint` it is the standard plus one documented rule.
    const exact = canonicalize({ seed: 18446744073709551615n });
    expect(exact).toBe('{"seed":18446744073709551615}');

    const reparsed = canonicalize(JSON.parse(exact) as CanonicalValue);
    expect(reparsed).not.toBe(exact);
    expect(reparsed).toBe('{"seed":18446744073709552000}');
  });

  it('writes a bigint as plain digits, never as a string', () => {
    // How this port carries C#'s `ulong` (ADR-010 §126). A seed has to reach the
    // artifact as the integer token `7` — the corpus records `"campaign_seed":7`
    // — because `"7"` would be a different document with a different hash.
    expect(canonicalize({ campaign_seed: 424242n })).toBe('{"campaign_seed":424242}');
    expect(canonicalize(18446744073709551615n)).toBe('18446744073709551615');
    expect(canonicalize(0n)).toBe('0');
  });
});

describe('canonicalize — strings', () => {
  it('uses the five short escapes and \\u00xx for every other control character', () => {
    expect(canonicalize('\b\t\n\f\r')).toBe('"\\b\\t\\n\\f\\r"');
    // Built rather than typed. A literal NUL in the source made git treat this whole
    // file as binary, so every diff of it read `Bin 6226 -> 6967 bytes` and reviewed
    // nothing — and `.gitattributes`' line-ending normalization skips binary files.
    expect(canonicalize(String.fromCharCode(0, 0x1f))).toBe('"\\u0000\\u001f"');
  });

  it('escapes only the quote and the backslash among printable ASCII', () => {
    expect(canonicalize('a"b\\c')).toBe('"a\\"b\\\\c"');
    // The set `System.Text.Json`'s default encoder escaped and RFC 8785 does not.
    // `m1-negotiation/1` reaching the artifact with an escaped slash would have been
    // a different document.
    expect(canonicalize(`<>&'+/`)).toBe(`"<>&'+/"`);
  });

  it('emits non-ASCII literally rather than as \\uXXXX', () => {
    expect(canonicalize({ ru: 'Оплата' })).toBe('{"ru":"Оплата"}');
    expect(canonicalize('\u{1f4b0}')).toBe('"\u{1f4b0}"');
  });

  it('refuses an unpaired surrogate instead of substituting a replacement', () => {
    expect(() => canonicalize({ s: '\ud83d' })).toThrow(/unpaired surrogate/);
  });

  it('sorts a key holding an escape by its decoded code units', () => {
    // Two spellings of one key cannot both survive in a JavaScript object, so the
    // risk here is ordering: a comparator over raw spellings would place "\n"
    // after "a".
    expect(canonicalize({ a: 1, '\n': 2 })).toBe('{"\\n":2,"a":1}');
  });
});

describe('canonicalize — documents', () => {
  it('writes an artifact-shaped fragment compactly, with no whitespace at all', () => {
    // Compact output is what makes the bytes a property of the data: any
    // indentation choice is a choice that can drift between two builds.
    const fragment: CanonicalValue = {
      artifact_version: 3,
      rng_algorithm: 'splitmix64-composed/1',
      seed: 7n,
      steps: [{ applied: true, rejection_code: null, hero_definition: 'core:kestrel' }]
    };

    expect(canonicalize(fragment)).toBe(
      '{"artifact_version":3,"rng_algorithm":"splitmix64-composed/1","seed":7,' +
        '"steps":[{"applied":true,"hero_definition":"core:kestrel","rejection_code":null}]}'
    );
  });

  it('writes booleans and null as their bare tokens', () => {
    expect(canonicalize(true)).toBe('true');
    expect(canonicalize(false)).toBe('false');
    expect(canonicalize(null)).toBe('null');
  });
});
