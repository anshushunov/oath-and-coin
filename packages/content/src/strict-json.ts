import type { ZodType } from 'zod';

import type { ContentFileSource } from './file-source.ts';
import { scanJson } from './json-scan.ts';
import { MAX_FILE_SIZE_BYTES } from './limits.ts';

/**
 * The one reader every data file in this package goes through, and the one place
 * its strictness is configured. Content and scenarios are both external data: they
 * can be hand-edited, modded or corrupted, and a reader that is lenient in one
 * place and strict in another teaches authors a rule that is only sometimes true.
 *
 * What the C# original configured on `JsonSerializerOptions`, and where each of
 * those rejections lives now:
 *
 * | C# setting | here |
 * |---|---|
 * | `PropertyNamingPolicy = SnakeCaseLower` | the Zod contracts name `snake_case` fields directly; there is no second, camelCase spelling to map from |
 * | `PropertyNameCaseInsensitive = false` | Zod matches keys exactly |
 * | `AllowTrailingCommas = false` | `JSON.parse` refuses them |
 * | `ReadCommentHandling = Disallow` | `JSON.parse` refuses them |
 * | `UnmappedMemberHandling = Disallow` | every contract is a `z.strictObject` |
 * | `NumberHandling = Strict` | `z.int()` refuses a number written as a string |
 * | `MaxDepth` | `scanJson`, because `JSON.parse` takes no options |
 *
 * Every one of them is a rejection rather than a convenience. A reader that
 * accepts `Greed` for `greed`, tolerates a trailing comma, ignores a misspelled
 * property or reads comments turns an author's mistake into a value silently
 * defaulted to zero.
 */

/**
 * How an oversized file is reported, stated once because it is enforced twice.
 *
 * The rule belongs to this layer and holds for every source, so {@link readBounded}
 * applies it to whatever bytes it is handed. A source that can see a file's length
 * without reading it — the Node one can, from `stat` — applies the same ceiling
 * earlier, so an oversized file still costs a `stat` call rather than its own size
 * in memory. Two guards, one constant and one wording: an author sees the same
 * message whichever of them refuses the file, and neither can be relaxed without
 * the other going quiet about the same number.
 */
export function fileSizeCeilingMessage(displayPath: string, size: number): string {
  return `File '${displayPath}' is ${size} bytes, over the ${MAX_FILE_SIZE_BYTES}-byte limit.`;
}

/** Reads a file's bytes from `source`, refusing anything over {@link MAX_FILE_SIZE_BYTES}. */
export function readBounded(source: ContentFileSource, path: string): Uint8Array {
  const bytes = source.read(path);
  if (bytes.length > MAX_FILE_SIZE_BYTES) {
    throw new Error(fileSizeCeilingMessage(source.describe(path), bytes.length));
  }

  return bytes;
}

/**
 * Reads one file as an untyped JSON value, under the size and depth ceilings and
 * with a repeated object key refused.
 *
 * How the file is named in diagnostics is the source's answer, not the caller's:
 * a repository-relative path where there is one, so an error message does not leak
 * an absolute path from the machine that produced it (`TDD` §18). That used to be
 * a `displayPath` argument every caller had to remember to pass correctly beside
 * the real path; a source that describes its own files cannot be handed the two
 * out of step.
 */
export function parseJsonFile(source: ContentFileSource, path: string): unknown {
  const displayPath = source.describe(path);
  const text = new TextDecoder('utf-8', { fatal: true }).decode(readBounded(source, path));

  // Structure first, value second — the order the C# reader enforced, and the
  // only order in which a depth ceiling guards anything.
  scanJson(displayPath, text);

  try {
    return JSON.parse(text) as unknown;
  } catch (cause) {
    throw new Error(`File '${displayPath}' is not valid JSON: ${messageOf(cause)}`, { cause });
  }
}

/**
 * Reads one file and validates it against `schema`, reporting failures with the
 * file and the JSON path inside it — the two things an author needs and a bare
 * parser error does not give on its own.
 *
 * Every violation is reported, not only the first. The C# reader stopped at one
 * because an exception carries one path; there is no such constraint here, and an
 * author fixing files one error per run is the slowest possible way to learn what
 * is wrong.
 */
export function readFile<T>(source: ContentFileSource, path: string, schema: ZodType<T>): T {
  return validateValue(source.describe(path), parseJsonFile(source, path), schema);
}

/**
 * Validates an already-parsed value against `schema`.
 *
 * Separate from {@link readFile} because the content loader has to look at
 * `schema_version` before it applies a contract: a file authored for an earlier
 * version legitimately lacks fields this version requires, and reporting those
 * missing fields instead of the version mismatch buries the one diagnostic that
 * explains them.
 */
export function validateValue<T>(displayPath: string, value: unknown, schema: ZodType<T>): T {
  const parsed = schema.safeParse(value);

  if (!parsed.success) {
    const violations = parsed.error.issues
      .map((issue) => `  at '${jsonPathOf(issue.path)}': ${issue.message}`)
      .join('\n');

    throw new Error(`File '${displayPath}' does not satisfy its contract:\n${violations}`);
  }

  return parsed.data;
}

/** A Zod issue path as a JSON path, so `['relationships', 0, 'weight']` reads as `$.relationships[0].weight`. */
export function jsonPathOf(path: readonly PropertyKey[]): string {
  let rendered = '$';
  for (const segment of path) {
    rendered += typeof segment === 'number' ? `[${segment}]` : `.${String(segment)}`;
  }

  return rendered;
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
