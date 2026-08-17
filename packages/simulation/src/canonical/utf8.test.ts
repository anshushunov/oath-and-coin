import { describe, expect, it } from 'vitest';

import { utf8Bytes } from './utf8.ts';

/**
 * UTF-8 is hand-written here (see `utf8.ts` for why), so its four length classes
 * are checked against known byte sequences rather than assumed. The Cyrillic and
 * astral cases are the ones the frozen corpus names as differences between the C#
 * writer and RFC 8785, so they are the sequences the canonical bytes actually
 * depend on.
 */

describe('utf8Bytes', () => {
  it.each([
    {
      name: 'ASCII, one byte per character',
      text: 'core:bram',
      bytes: [0x63, 0x6f, 0x72, 0x65, 0x3a, 0x62, 0x72, 0x61, 0x6d]
    },
    { name: 'two bytes — Cyrillic', text: 'ме', bytes: [0xd0, 0xbc, 0xd0, 0xb5] },
    { name: 'three bytes — CJK', text: '契', bytes: [0xe5, 0xa5, 0x91] },
    // A surrogate pair is two UTF-16 units and one four-byte character. An
    // encoder that treated the units separately would emit six bytes of two
    // invalid characters and never fail.
    { name: 'four bytes — astral plane', text: '\u{1f4b0}', bytes: [0xf0, 0x9f, 0x92, 0xb0] },
    { name: 'the empty string', text: '', bytes: [] },
    // The boundaries of each length class, where an off-by-one lives.
    { name: 'U+007F, still one byte', text: '', bytes: [0x7f] },
    { name: 'U+0080, first two-byte character', text: '', bytes: [0xc2, 0x80] },
    { name: 'U+07FF, last two-byte character', text: '߿', bytes: [0xdf, 0xbf] },
    { name: 'U+0800, first three-byte character', text: 'ࠀ', bytes: [0xe0, 0xa0, 0x80] },
    { name: 'U+FFFF, last three-byte character', text: '￿', bytes: [0xef, 0xbf, 0xbf] }
  ])('encodes $name', ({ text, bytes }) => {
    expect([...utf8Bytes(text)]).toEqual(bytes);
  });

  it.each([
    { name: 'a high surrogate with nothing after it', text: '\ud83d' },
    { name: 'a high surrogate followed by an ordinary character', text: '\ud83da' },
    { name: 'a low surrogate on its own', text: '\ude00' },
    { name: 'two high surrogates in a row', text: '\ud83d\ud83d' }
  ])('refuses $name', ({ text }) => {
    // RFC 8785 §3.2.2 requires failing on invalid Unicode. Substituting U+FFFD
    // would canonicalize a string nobody supplied, and its hash would look every
    // bit as authoritative as a real one — which is why the C# reference
    // serializer turned off its own encoder fallback and recorded both halves of
    // the pair under `rejected_inputs`.
    expect(() => utf8Bytes(text)).toThrow(/unpaired surrogate/);
  });
});
