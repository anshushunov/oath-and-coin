/**
 * SHA-256 (FIPS 180-4), implemented here rather than taken from a platform API.
 *
 * The reason is the boundary, and it is worth stating plainly because "wrote our
 * own hash" is normally a warning sign. Three call sites need this hash, and each
 * one is in a layer that cannot reach a platform API:
 *
 * - the presentation layer hashes its read model, and
 *   `presentation-depends-only-on-simulation` keeps it away from both
 *   `node:crypto` and the content package (Task 11);
 * - the browser build hashes in the browser, where `node:crypto` does not exist
 *   and `crypto.subtle.digest` is asynchronous — one hash would have made the
 *   whole read-model API async;
 * - this package may import nothing at all (`simulation-depends-on-nothing`).
 *
 * A hash is a pure function of its bytes, so the layer that owns pure functions
 * is where it belongs. The cost of the choice is that correctness has to be
 * demonstrated rather than borrowed, and it is, three ways: the FIPS 180-4
 * example vectors, the 57 file digests inside `migration/oracle/v1/manifest.json`
 * (produced by `System.Security.Cryptography`, not by this code), and a mutant on
 * a round constant.
 *
 * Incremental on purpose. `ContentDigest` covers every file under `content/`,
 * including ones no loader reads, and the C# version streamed for exactly that
 * reason: whole-file reads would make the memory cost of hashing a property of
 * the largest file anybody dropped in.
 */

const ROUND_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

const INITIAL_STATE = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
]);

const BLOCK_BYTES = 64;

const HEX_DIGITS = '0123456789abcdef';

function rotateRight(value: number, bits: number): number {
  return ((value >>> bits) | (value << (32 - bits))) >>> 0;
}

/** A running SHA-256, fed in chunks and finished once. */
export class Sha256 {
  private readonly state = Uint32Array.from(INITIAL_STATE);
  private readonly schedule = new Uint32Array(64);
  private readonly block = new Uint8Array(BLOCK_BYTES);
  private blockLength = 0;
  private totalBytes = 0;
  private finished = false;

  /** Feeds `bytes` into the hash. */
  update(bytes: Uint8Array): this {
    if (this.finished) {
      throw new Error('Sha256.update was called after digest; start a new instance.');
    }

    this.totalBytes += bytes.length;
    let offset = 0;

    // Top up a partial block first, so the fast path below only ever sees whole
    // blocks and the two paths cannot disagree about what has been consumed.
    if (this.blockLength > 0) {
      const wanted = Math.min(BLOCK_BYTES - this.blockLength, bytes.length);
      this.block.set(bytes.subarray(0, wanted), this.blockLength);
      this.blockLength += wanted;
      offset = wanted;

      if (this.blockLength === BLOCK_BYTES) {
        this.compress(this.block, 0);
        this.blockLength = 0;
      }
    }

    while (bytes.length - offset >= BLOCK_BYTES) {
      this.compress(bytes, offset);
      offset += BLOCK_BYTES;
    }

    if (offset < bytes.length) {
      this.block.set(bytes.subarray(offset), 0);
      this.blockLength = bytes.length - offset;
    }

    return this;
  }

  /** Pads, finishes and returns the 32 digest bytes. */
  digest(): Uint8Array {
    if (this.finished) {
      throw new Error('Sha256.digest was called twice; start a new instance.');
    }
    this.finished = true;

    const bitLength = this.totalBytes * 8;
    const padded = new Uint8Array(this.blockLength < 56 ? BLOCK_BYTES : BLOCK_BYTES * 2);
    padded.set(this.block.subarray(0, this.blockLength), 0);
    padded[this.blockLength] = 0x80;

    // The length is 64 bits big-endian. Split rather than written with one
    // shift: `<<` in JavaScript is a 32-bit operator, so a message over 512 MiB
    // would silently wrap its own length field.
    const high = Math.floor(bitLength / 0x100000000);
    const low = bitLength >>> 0;
    const lengthAt = padded.length - 8;
    padded[lengthAt] = (high >>> 24) & 0xff;
    padded[lengthAt + 1] = (high >>> 16) & 0xff;
    padded[lengthAt + 2] = (high >>> 8) & 0xff;
    padded[lengthAt + 3] = high & 0xff;
    padded[lengthAt + 4] = (low >>> 24) & 0xff;
    padded[lengthAt + 5] = (low >>> 16) & 0xff;
    padded[lengthAt + 6] = (low >>> 8) & 0xff;
    padded[lengthAt + 7] = low & 0xff;

    for (let offset = 0; offset < padded.length; offset += BLOCK_BYTES) {
      this.compress(padded, offset);
    }

    const digest = new Uint8Array(32);
    for (let word = 0; word < 8; word++) {
      const value = this.state[word]!;
      digest[word * 4] = (value >>> 24) & 0xff;
      digest[word * 4 + 1] = (value >>> 16) & 0xff;
      digest[word * 4 + 2] = (value >>> 8) & 0xff;
      digest[word * 4 + 3] = value & 0xff;
    }

    return digest;
  }

  /** The digest as lowercase hex — the spelling every artifact in this repository uses. */
  hex(): string {
    return toHex(this.digest());
  }

  private compress(data: Uint8Array, offset: number): void {
    const schedule = this.schedule;

    for (let index = 0; index < 16; index++) {
      const at = offset + index * 4;
      schedule[index] =
        (data[at]! << 24) | (data[at + 1]! << 16) | (data[at + 2]! << 8) | data[at + 3]!;
    }

    for (let index = 16; index < 64; index++) {
      const previous = schedule[index - 15]!;
      const recent = schedule[index - 2]!;
      const sigma0 = rotateRight(previous, 7) ^ rotateRight(previous, 18) ^ (previous >>> 3);
      const sigma1 = rotateRight(recent, 17) ^ rotateRight(recent, 19) ^ (recent >>> 10);
      schedule[index] = (schedule[index - 16]! + sigma0 + schedule[index - 7]! + sigma1) >>> 0;
    }

    let a = this.state[0]!;
    let b = this.state[1]!;
    let c = this.state[2]!;
    let d = this.state[3]!;
    let e = this.state[4]!;
    let f = this.state[5]!;
    let g = this.state[6]!;
    let h = this.state[7]!;

    for (let index = 0; index < 64; index++) {
      const bigSigma1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choose = (e & f) ^ (~e & g);
      const first = (h + bigSigma1 + choose + ROUND_CONSTANTS[index]! + schedule[index]!) >>> 0;
      const bigSigma0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const second = (bigSigma0 + majority) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + first) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (first + second) >>> 0;
    }

    this.state[0] = (this.state[0]! + a) >>> 0;
    this.state[1] = (this.state[1]! + b) >>> 0;
    this.state[2] = (this.state[2]! + c) >>> 0;
    this.state[3] = (this.state[3]! + d) >>> 0;
    this.state[4] = (this.state[4]! + e) >>> 0;
    this.state[5] = (this.state[5]! + f) >>> 0;
    this.state[6] = (this.state[6]! + g) >>> 0;
    this.state[7] = (this.state[7]! + h) >>> 0;
  }
}

/** Lowercase hex of `bytes`. */
export function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) {
    hex += HEX_DIGITS[byte >> 4]! + HEX_DIGITS[byte & 0x0f]!;
  }

  return hex;
}

/** SHA-256 of `bytes`, lowercase hex. */
export function sha256Hex(bytes: Uint8Array): string {
  return new Sha256().update(bytes).hex();
}
