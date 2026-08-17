import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { Sha256 } from '@oath-and-coin/simulation';

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
 * SHA-256 over every file under `contentRoot`: each file's root-relative path and
 * then its bytes, in ordinal path order, lowercase hex.
 *
 * Three details are what make the result a property of the content and not of the
 * machine that computed it:
 *
 * - paths are made relative to `contentRoot` and normalized to `/`, so the same
 *   tree hashes the same on Windows and on Linux and does not change when the
 *   checkout moves;
 * - ordering is ordinal, never the filesystem's own enumeration order or a
 *   culture-aware sort;
 * - paths and contents are separated by a byte that cannot occur in a path.
 *
 * The path is part of the hash, not just the bytes: renaming a file changes what
 * content exists, so it must change the version.
 *
 * Incremental, not one buffer over the whole tree — the digest covers every file
 * under the content root, including ones no loader ever reads, so hashing them all
 * at once would make the memory cost a property of the largest file anybody
 * dropped into `content/`. The size ceiling is the loader's own (`TDD` §18): a file
 * too large to load is not one this version should quietly account for either.
 */
export function computeContentDigest(contentRoot: string): string {
  const files = listFilesInOrdinalOrder(contentRoot);
  const hash = new Sha256();
  const separatorBytes = FIELD_SEPARATOR;

  for (const file of files) {
    hash.update(utf8OfPath(file.relativePath));
    hash.update(separatorBytes);
    hash.update(readBounded(file.relativePath, file.fullPath));
    hash.update(separatorBytes);
  }

  return hash.hex();
}

/** The first {@link CONTENT_VERSION_LENGTH} characters of the digest. */
export function computeContentVersion(contentRoot: string): string {
  return computeContentDigest(contentRoot).slice(0, CONTENT_VERSION_LENGTH);
}

export interface ContentFile {
  /** Root-relative, POSIX separators — what the digest covers and what diagnostics name. */
  readonly relativePath: string;
  readonly fullPath: string;
}

/**
 * Every file under `root`, deepest included, in ordinal path order.
 *
 * Ordinal, never the filesystem's: enumeration order differs between platforms and
 * filesystems, and it decides which of two duplicate definitions is reported as
 * "the second one" — so a diagnostic would name a different file depending on
 * where the tree was checked out.
 */
export function listFilesInOrdinalOrder(root: string, extension?: string): readonly ContentFile[] {
  const found: ContentFile[] = [];

  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (extension !== undefined && !entry.name.endsWith(extension)) {
        continue;
      }
      found.push({ relativePath: toRelativePosixPath(root, fullPath), fullPath });
    }
  };

  walk(root);
  found.sort((left, right) => (left.relativePath < right.relativePath ? -1 : 1));

  return found;
}

/** Root-relative with `/` separators, so the same tree reads the same on both platforms. */
export function toRelativePosixPath(root: string, fullPath: string): string {
  return relative(root, fullPath).split(sep).join('/').replace(/\\/g, '/');
}

/** Whether `path` names a directory that exists. */
export function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * UTF-8 of a path. `Buffer.from` rather than the simulation's own `utf8Bytes`
 * because this is the layer that owns paths and encodings anyway (`ADR-002`), and a
 * path is text this process produced rather than external data to be defended
 * against.
 */
function utf8OfPath(path: string): Uint8Array {
  return Buffer.from(path, 'utf8');
}
