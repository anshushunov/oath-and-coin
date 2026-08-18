/**
 * Paths that name a place on a disk, as opposed to paths that name a file inside a
 * source.
 *
 * The two are different kinds and the first version of this split treated them as one,
 * which was the defect external review found and called a blocker. `paths.ts` is about
 * source-relative paths: there a leading `/` means nothing, so it is trimmed. A
 * filesystem path is the one place in this package where a leading `/` means
 * everything — it is the difference between `/home/runner/work/oath-and-coin` and a
 * directory of that name under whatever the process happened to be started in.
 *
 * The bug was invisible on Windows and fatal on Linux. `C:/gamedev/oath-and-coin` has
 * no leading slash to lose, so the local gates stayed green at 54/54 while
 * `/home/runner/work/...` would have become `home/runner/work/...` on the Ubuntu CI
 * job that runs `pnpm test`. Hence this file, and hence its own tests: the property is
 * about a shape of string this machine cannot produce.
 *
 * Still no `node:path`. What is needed is four string operations, and `node:path`'s
 * platform-dependent behaviour is what the package spent Task 12 removing.
 */

/**
 * A filesystem path with `/` separators and no trailing slash, except where the
 * trailing slash *is* the path.
 *
 * The three roots that must survive: POSIX `/`, a Windows drive root `C:/` — `C:`
 * alone means "the current directory on drive C", which is a different place — and a
 * UNC share `//server/share`. An empty path is `.`, so that appending to it cannot
 * produce something absolute.
 */
export function normalizeFsPath(path: string): string {
  const slashed = path.replace(/\\/gu, '/');
  if (slashed.length === 0) {
    return '.';
  }

  const withoutTrailing = slashed.replace(/\/+$/u, '');
  if (withoutTrailing.length === 0) {
    return '/';
  }

  return /^[A-Za-z]:$/u.test(withoutTrailing) ? `${withoutTrailing}/` : withoutTrailing;
}

/** Whether `path` names a place rather than something relative to the current directory. */
export function isAbsoluteFsPath(path: string): boolean {
  return /^([A-Za-z]:)?[\\/]/u.test(path);
}

/** `base` with a source-relative path appended, or `base` itself for the empty one. */
export function joinFsPath(base: string, relativePath: string): string {
  const normalizedBase = normalizeFsPath(base);
  const suffix = relativePath.replace(/\\/gu, '/').replace(/^\/+|\/+$/gu, '');

  if (suffix.length === 0) {
    return normalizedBase;
  }

  return normalizedBase.endsWith('/')
    ? `${normalizedBase}${suffix}`
    : `${normalizedBase}/${suffix}`;
}

/** The directory holding `path`, keeping whatever root it started from. */
export function fsParentPath(path: string): string {
  const normalized = normalizeFsPath(path);
  const slash = normalized.lastIndexOf('/');

  if (slash < 0) {
    return '.';
  }
  if (slash === 0) {
    return '/';
  }

  const parent = normalized.slice(0, slash);

  // `C:/a.json` has its parent at the drive root, which keeps its slash for the same
  // reason `normalizeFsPath` gives it one.
  return /^[A-Za-z]:$/u.test(parent) ? `${parent}/` : parent;
}

/** The last segment of `path`. */
export function fsFileName(path: string): string {
  const normalized = normalizeFsPath(path);

  return normalized.slice(normalized.lastIndexOf('/') + 1);
}
