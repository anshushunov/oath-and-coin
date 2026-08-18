import { compareOrdinal, isUnder, requireSourcePath } from './paths.ts';
import { encodeUtf8 } from './text-codec.ts';

/**
 * Where this package's files come from, stated as four questions instead of as a
 * directory on a disk.
 *
 * `ADR-010` §59 fixes the direction `content ← application ← apps/web`, which puts
 * this package inside the browser bundle. It could not go there while it imported
 * `node:fs`: Vite fails the build on that import, and the failure would have
 * arrived on the first line of the screen that has to show real content.
 *
 * The alternative that was rejected is worth naming, because it is the cheaper one
 * (`FULL_TYPESCRIPT_MIGRATION` §12.2). A build step could run the Node loader,
 * serialize the result and let the browser deserialize it. That creates a second
 * way to obtain a `ContentSet`, obliged to agree with the first, and makes
 * `content_version` a property of the serializer rather than of the content. Two
 * paths that must agree and nothing forcing them to is the defect class this
 * repository has already paid for once (§3.6).
 *
 * With a source, there is one loader. The browser validates the shipped files with
 * the same Zod contracts, hashes the same (path, bytes) pairs and therefore
 * computes the same `content_version` — which is a claim this package proves
 * rather than states, by digesting one tree through two sources and comparing.
 */
export interface ContentFileSource {
  /**
   * Every file under `directory`, as paths relative to the source root, in
   * ordinal order.
   *
   * `''` names the root and therefore lists everything, deepest included. The
   * paths are root-relative rather than directory-relative so that a caller
   * never has to put two of them back together — which is where the old code
   * needed `node:path`.
   *
   * @param extension When given, only files whose path ends with it.
   */
  list(directory: string, extension?: string): readonly string[];

  /** The bytes of one file. Throws when the source holds no such file. */
  read(path: string): Uint8Array;

  /** Whether the source holds a file at `path`. Never true for a directory. */
  exists(path: string): boolean;

  /**
   * How to name `path` in a diagnostic.
   *
   * A separate question from the path itself because the two answers differ: a
   * loader addresses `heroes/bram.json`, and a message about it must not leak the
   * absolute path of the machine that produced it (`TDD` §18). Asking the source
   * is what lets the same message read the same from a checkout, from a temporary
   * fixture and from a browser bundle.
   */
  describe(path: string): string;
}

/**
 * A source over files held in memory, keyed by root-relative path.
 *
 * Not a test double: this is the shape a browser source has, and `apps/web` builds
 * one from `import.meta.glob`. Keeping it here rather than in a testing entry is
 * deliberate — the digest agreement between two sources is a property of the
 * package, and proving it with a source that only tests can construct would prove
 * it about the tests.
 *
 * @param files Root-relative POSIX paths to bytes or UTF-8 text.
 * @param describePath How a diagnostic should name a file; by default the path
 * itself, which is already root-relative and therefore already safe to print.
 */
export function memoryFileSource(
  files: Readonly<Record<string, Uint8Array | string>>,
  describePath: (path: string) => string = (path) => path
): ContentFileSource {
  const held = new Map<string, Uint8Array>();

  for (const [path, contents] of Object.entries(files)) {
    held.set(
      requireSourcePath(path),
      typeof contents === 'string' ? encodeUtf8(contents) : contents
    );
  }

  // Sorted once, at construction: `list` is called per content directory and per
  // digest, and an order computed afresh each time is an order that can be got
  // wrong in one of those places.
  const paths = [...held.keys()].sort(compareOrdinal);

  return {
    list: (directory, extension) => {
      const scope = requireSourcePath(directory);

      return paths.filter(
        (path) => isUnder(path, scope) && (extension === undefined || path.endsWith(extension))
      );
    },
    read: (path) => {
      const inSource = requireSourcePath(path);
      const bytes = held.get(inSource);
      if (bytes === undefined) {
        throw new Error(`File '${describePath(inSource)}' is not in this source.`);
      }

      return bytes;
    },
    exists: (path) => held.has(requireSourcePath(path)),
    describe: (path) => describePath(requireSourcePath(path))
  };
}
