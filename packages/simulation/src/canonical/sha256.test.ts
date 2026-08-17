import { describe, expect, it } from 'vitest';

import { Sha256, sha256Hex, toHex } from './sha256.ts';
import { utf8Bytes } from './utf8.ts';

/**
 * This package implements SHA-256 rather than calling a platform API (see the
 * reasoning at the top of `sha256.ts`), so correctness has to be demonstrated
 * instead of borrowed. These are the FIPS 180-4 example vectors plus the two
 * properties an incremental implementation can get wrong and a one-shot one
 * cannot: chunk boundaries, and a length field that crosses a block.
 *
 * The third leg of the proof is not here — it is in `packages/content`, where the
 * 57 file digests inside `migration/oracle/v1/manifest.json` are recomputed. Those
 * were produced by `System.Security.Cryptography`, so agreeing with them is
 * agreement with an implementation this repository did not write.
 */

/** FIPS 180-4 Appendix B, plus the empty message and a multi-block one. */
const VECTORS: readonly { readonly message: string; readonly digest: string }[] = [
  { message: '', digest: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' },
  { message: 'abc', digest: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' },
  {
    // 448 bits — the longest message that still fits in one padded block.
    message: 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
    digest: '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'
  },
  {
    // 896 bits — padding spills into a second block, which is the case a
    // single-block implementation passes every other vector without handling.
    message:
      'abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu',
    digest: 'cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1'
  }
];

describe('sha256', () => {
  it.each(VECTORS)(
    'reproduces the FIPS 180-4 digest of a $message.length-character message',
    ({ message, digest }) => {
      expect(sha256Hex(utf8Bytes(message))).toBe(digest);
    }
  );

  it('reproduces the digest of a million repeated characters', () => {
    // The vector that exercises many blocks at once and a bit length past 2^20.
    expect(sha256Hex(utf8Bytes('a'.repeat(1_000_000)))).toBe(
      'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0'
    );
  });

  it('does not depend on how the message was chunked', () => {
    // The property that separates an incremental hash from a working one: the
    // digest is a function of the bytes, not of the calls. Sizes chosen to land
    // on both sides of the 64-byte block — 1 never fills one, 64 fills exactly
    // one, 63 and 65 straddle it.
    const message = utf8Bytes('The guild remembers who took the coin. '.repeat(11));
    const expected = sha256Hex(message);

    for (const chunk of [1, 7, 63, 64, 65, 127]) {
      const hash = new Sha256();
      for (let at = 0; at < message.length; at += chunk) {
        hash.update(message.subarray(at, Math.min(at + chunk, message.length)));
      }

      expect(hash.hex(), `chunked into ${chunk} bytes`).toBe(expected);
    }
  });

  it('refuses to be reused after it has been finished', () => {
    // A finished hash that quietly accepted more data would return a digest of
    // neither the first message nor the second.
    const hash = new Sha256().update(utf8Bytes('abc'));
    expect(hash.hex()).toBe(VECTORS[1]!.digest);
    expect(() => hash.update(utf8Bytes('abc'))).toThrow(/after digest/);
    expect(() => hash.digest()).toThrow(/twice/);
  });

  it('renders every byte as two lowercase hex digits', () => {
    // A hex writer that dropped a leading zero would shorten some digests and
    // still look plausible in a report.
    expect(toHex(new Uint8Array([0x00, 0x0f, 0x10, 0xff]))).toBe('000f10ff');
    expect(sha256Hex(new Uint8Array())).toHaveLength(64);
  });
});
