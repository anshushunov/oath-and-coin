/**
 * Path arithmetic for a source of files, done on strings rather than on a
 * filesystem.
 *
 * `node:path` used to be imported by six modules here, and every one of them
 * needed it for the same three operations: put two segments together, take the
 * directory off a path, take the name off a path. None of the three needs a
 * filesystem, and two of them behaved differently depending on which one this
 * process happened to be running on — which is why `toRelativePosixPath` existed
 * at all, splitting on `sep` and re-joining on `/` to undo what `relative` had
 * just done.
 *
 * So the separator here is `/` and there is no other. A path names a file inside
 * a {@link import('./file-source.ts').ContentFileSource}, always relative to that
 * source's own root, and the class of Windows/POSIX disagreements the old code
 * repaired after the fact cannot arise: nothing in this package ever produces a
 * backslash.
 *
 * Deliberately not a re-implementation of `node:path`. There is no `resolve`, no
 * `..` handling and no notion of an absolute path in the core — a source root is
 * where paths start, and a path that tries to climb out of it is naming something
 * the source does not hold.
 */

/** A path as this package spells it: `/` separators, no leading or trailing slash. */
export function toPosixPath(path: string): string {
  return trimSlashes(path.replace(/\\/gu, '/'));
}

/**
 * `path` as a path inside a source, or a refusal.
 *
 * A source holds a set of files and every one of them is named relative to that
 * source's own root. Three spellings say otherwise and all three are refused rather
 * than normalized away:
 *
 * - an **absolute** path names a place on a machine, which a source has no notion of;
 * - a `..` **segment** names something outside the source. External review reproduced
 *   what its absence cost: `nodeFileSource('content').read('../package.json')` returned
 *   the repository's own manifest, while `memoryFileSource` answered that it held no
 *   such file. Two implementations of one port disagreeing about what the port means is
 *   the defect the port exists to rule out, and a content tree is data a mod or a
 *   corrupted download can author;
 * - a `.` segment or a NUL byte name nothing at all, and the loaders never produce
 *   either — so accepting them would only ever admit a caller's mistake.
 *
 * Refused, not answered `false`: a path that leaves the source is a caller's error, and
 * the load sequence already turns a throw from the scenario stage into
 * `SCENARIO_INVALID`, which is the diagnostic that names it.
 */
export function requireSourcePath(path: string): string {
  const slashed = path.replace(/\\/gu, '/');

  if (slashed.includes('\0')) {
    throw new Error(`Path '${path}' holds a NUL byte, so it names no file.`);
  }

  if (/^([A-Za-z]:)?\//u.test(slashed)) {
    throw new Error(
      `Path '${path}' is absolute. A source is addressed by paths relative to its own root, ` +
        'because a source need not be a directory on a disk at all.'
    );
  }

  const trimmed = trimSlashes(slashed);
  if (trimmed.split('/').some((segment) => segment === '..' || segment === '.')) {
    throw new Error(
      `Path '${path}' navigates with '.' or '..'. A source holds the files under its own root ` +
        'and nothing else; a path that climbs out of it would read whatever happened to be beside ' +
        'the content.'
    );
  }

  return trimmed;
}

/**
 * Segments joined with `/`, skipping the empty ones.
 *
 * The empty segment is what makes the root addressable: `joinPath('', 'heroes')`
 * is `heroes`, so a caller listing the whole source and a caller listing one
 * directory under it write the same expression.
 */
export function joinPath(...segments: readonly string[]): string {
  return segments
    .map((segment) => toPosixPath(segment))
    .filter((segment) => segment.length > 0)
    .join('/');
}

/** Everything before the last `/`, or `''` for a path with none. */
export function parentPath(path: string): string {
  const posix = toPosixPath(path);
  const slash = posix.lastIndexOf('/');

  return slash < 0 ? '' : posix.slice(0, slash);
}

/** Everything after the last `/`, or the whole path when there is none. */
export function fileName(path: string): string {
  const posix = toPosixPath(path);

  return posix.slice(posix.lastIndexOf('/') + 1);
}

/**
 * Whether `path` names something inside `directory`, with `''` meaning the source
 * root and therefore holding everything.
 *
 * The trailing slash is what makes this a containment test rather than a prefix
 * test: `heroes-retired/a.json` starts with `heroes` and is not inside it.
 */
export function isUnder(path: string, directory: string): boolean {
  const scope = toPosixPath(directory);

  return scope.length === 0 || toPosixPath(path).startsWith(`${scope}/`);
}

/**
 * Ordinal, never a locale-aware or filesystem-dependent order.
 *
 * The digest hashes files in this order and diagnostics name "the second
 * definition" by it, so a tree checked out on another machine would otherwise
 * hash differently and blame a different file.
 */
export function compareOrdinal(left: string, right: string): number {
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
}

function trimSlashes(path: string): string {
  let start = 0;
  let end = path.length;

  while (start < end && path[start] === '/') {
    start++;
  }
  while (end > start && path[end - 1] === '/') {
    end--;
  }

  return path.slice(start, end);
}
