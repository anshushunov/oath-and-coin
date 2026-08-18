import { Sha256, utf8Bytes } from '@oath-and-coin/simulation';

import type { ContentFileSource } from './file-source.ts';
import { readBounded } from './strict-json.ts';

/**
 * The content version, computed from the content itself (`ADR-004`) rather than
 * declared in a constant somebody has to remember to bump. A declared version is
 * wrong exactly when it matters most — after an edit — and a replay that says
 * "same content version" while the numbers underneath moved is worse than one that
 * admits it cannot reproduce the run.
 */

/**
 * Number of leading hex characters of {@link computeContentDigest}'s output used as
 * the content version. 16 hex characters are 64 bits — short enough to read out of
 * a bug report, far past any accident.
 */
export const CONTENT_VERSION_LENGTH = 16;

/** A byte that cannot occur in a path, so `ab` + `c` and `a` + `bc` cannot hash alike. */
const FIELD_SEPARATOR = new Uint8Array([0x1f]);

/**
 * SHA-256 over every file the source holds: each file's root-relative path and
 * then its bytes, in ordinal path order, lowercase hex.
 *
 * Three details are what make the result a property of the content and not of the
 * machine that computed it:
 *
 * - paths are relative to the source root and spelled with `/`, so the same tree
 *   hashes the same on Windows and on Linux, does not change when the checkout
 *   moves, and does not change when the files arrive from a bundle instead of a
 *   disk;
 * - ordering is ordinal, never the filesystem's own enumeration order or a
 *   culture-aware sort;
 * - paths and contents are separated by a byte that cannot occur in a path.
 *
 * The path is part of the hash, not just the bytes: renaming a file changes what
 * content exists, so it must change the version.
 *
 * That the source is an argument rather than a directory is what makes
 * `content_version` comparable across the two ways this package is reached. The
 * Node loader and the browser bundle hash the same (path, bytes) pairs through
 * this one function, so their versions agree byte for byte — which is asserted
 * rather than assumed, by digesting one tree through both.
 *
 * Incremental, not one buffer over the whole tree — the digest covers every file
 * the source holds, including ones no loader ever reads, so hashing them all at
 * once would make the memory cost a property of the largest file anybody dropped
 * into `content/`. The size ceiling is the loader's own (`TDD` §18): a file too
 * large to load is not one this version should quietly account for either.
 */
export function computeContentDigest(source: ContentFileSource): string {
  const hash = new Sha256();

  for (const path of source.list('')) {
    hash.update(utf8Bytes(path));
    hash.update(FIELD_SEPARATOR);
    hash.update(readBounded(source, path));
    hash.update(FIELD_SEPARATOR);
  }

  return hash.hex();
}

/** The first {@link CONTENT_VERSION_LENGTH} characters of the digest. */
export function computeContentVersion(source: ContentFileSource): string {
  return computeContentDigest(source).slice(0, CONTENT_VERSION_LENGTH);
}
