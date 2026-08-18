import { readFileSync, readdirSync, statSync } from 'node:fs';

import type { ContentFileSource } from '../file-source.ts';
import { MAX_FILE_SIZE_BYTES } from '../limits.ts';
import { compareOrdinal, joinPath, toPosixPath } from '../paths.ts';
import { fileSizeCeilingMessage } from '../strict-json.ts';

/**
 * The filesystem behind a {@link ContentFileSource}: one of the two implementations of
 * the port, and the only one in this package that may name `node:*` at all.
 *
 * Everything above it — the loader, the digest, the scenario reader — stopped knowing
 * about directories in Task 12 so that the browser build could reach them
 * (`FULL_TYPESCRIPT_MIGRATION` §12.2). This file is where that knowledge went, and the
 * dependency-boundary rule `content-core-imports-only-simulation-and-zod` is what keeps
 * it from leaking back: a `node:fs` import anywhere else under `packages/content/src`
 * is a failed gate rather than a Vite build that breaks on the day somebody opens the
 * page.
 *
 * `node:path` is not imported here either, and that is not purity for its own sake.
 * Node accepts `/` on Windows as readily as on Linux, and the old code's
 * `toRelativePosixPath` existed only to undo what `node:path` had just done — split on
 * the platform separator and re-join on `/`, so that the digest would not depend on
 * where the tree was checked out. With paths built from `/` in the first place, the
 * whole class of Windows/POSIX disagreement has nowhere to arise.
 */

/**
 * A source rooted at `root`, which may be an absolute or a relative directory. Paths
 * handed to it and paths it answers with are relative to that root.
 */
export function nodeFileSource(root: string): ContentFileSource {
  const rootPath = normalizeRoot(root);
  const fullPath = (path: string): string => under(rootPath, path);

  return {
    list: (directory, extension) => {
      const found: string[] = [];
      walk(rootPath, toPosixPath(directory), extension, found);

      // Ordinal, never the filesystem's own enumeration order: that order differs
      // between platforms and filesystems, and it decides both what the digest hashes
      // first and which of two duplicate definitions a diagnostic calls "the second
      // one".
      return found.sort(compareOrdinal);
    },
    read: (path) => {
      // The ceiling is the content layer's rule and `readBounded` applies it to every
      // source. It is applied here as well, from the same constant and with the same
      // wording, because this source can see a file's length without reading it: an
      // oversized file costs a `stat` call rather than its own size in memory.
      const full = fullPath(path);
      const { size } = statSync(full);
      if (size > MAX_FILE_SIZE_BYTES) {
        throw new Error(fileSizeCeilingMessage(toPosixPath(path), size));
      }

      return readFileSync(full);
    },
    exists: (path) => isFile(fullPath(path)),
    // Root-relative, so a message names the file the way an author thinks about the
    // tree and never leaks the absolute path of the machine that produced it
    // (`TDD` §18).
    describe: (path) => toPosixPath(path)
  };
}

/** Whether `path` names a directory that exists — the one question a source cannot answer. */
export function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * The root as a `/`-separated prefix, kept whole.
 *
 * `paths.ts` is about paths *inside* a source, where a leading `/` means nothing and is
 * trimmed; a root is the one path in this package that may be absolute, so it is
 * normalized here rather than there. An empty root is the current directory — spelled
 * `.` rather than left empty, so that `'' + '/heroes'` cannot become an absolute path
 * naming the filesystem root.
 */
function normalizeRoot(root: string): string {
  const posix = root.replace(/\\/gu, '/').replace(/\/+$/u, '');

  return posix.length === 0 ? '.' : posix;
}

/** `base` with a source-relative path appended, or `base` itself for the source root. */
function under(base: string, path: string): string {
  const suffix = toPosixPath(path);

  return suffix.length === 0 ? base : `${base}/${suffix}`;
}

/**
 * Every file under `<root>/<directory>`, deepest included, as root-relative paths.
 *
 * A directory that is not there contributes nothing rather than throwing: a source is a
 * set of files, and "no files under `traits`" is what a caller asks about. The refusals
 * that used to be phrased as "this directory is missing" are the loader's, and it still
 * makes them — from an empty list.
 */
function walk(
  root: string,
  directory: string,
  extension: string | undefined,
  found: string[]
): void {
  let entries;
  try {
    entries = readdirSync(under(root, directory), { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const relativePath = joinPath(directory, entry.name);
    if (entry.isDirectory()) {
      walk(root, relativePath, extension, found);
      continue;
    }
    if (extension !== undefined && !entry.name.endsWith(extension)) {
      continue;
    }

    found.push(relativePath);
  }
}
