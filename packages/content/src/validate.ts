import type { ContentFileSource } from './file-source.ts';
import { CONTENT_DIRECTORIES, type ContentDirectory } from './schemas.ts';
import { jsonPathOf, parseJsonFile } from './strict-json.ts';

/**
 * Validation stage 1 from `TDD` §11.2 — schema/type validation — over a whole
 * content tree, reporting every violation instead of stopping at the first.
 *
 * Deliberately separate from {@link import('./content-set.ts').loadContentSet}
 * rather than folded into it, and the split is the C# one for the C# reason: the
 * loader must enforce its invariants unconditionally, since nothing forces a caller
 * to validate first, while validation must be able to report every problem in a tree
 * at once. Merging the two would cost one of those two properties — an author fixing
 * files one exception per run is the slowest possible way to learn what is wrong.
 */

/** One thing that failed validation: which file, where inside it, and why. */
export interface ContentViolation {
  readonly relativePath: string;
  readonly instanceLocation: string;
  readonly message: string;
}

/**
 * Validates every `*.json` file `source` holds, returning all violations in
 * ordinal path order. An empty result means every file was matched to a contract
 * and satisfied it.
 */
export function validateContentTree(source: ContentFileSource): readonly ContentViolation[] {
  const violations: ContentViolation[] = [];

  for (const path of source.list('', '.json')) {
    const relativePath = source.describe(path);
    const directory = path.split('/')[0] ?? '';
    const schema = CONTENT_DIRECTORIES[directory as ContentDirectory];

    // A file in a directory no contract is registered for is itself a violation,
    // not a file to skip: silently ignoring unknown content is how a validation
    // stage reports success over data it never looked at.
    if (schema === undefined) {
      violations.push({
        relativePath,
        instanceLocation: '$',
        message: `No contract is registered for content directory '${directory}'.`
      });
      continue;
    }

    let value: unknown;
    try {
      // Through the same reader the loader uses, so validation reads external data
      // under the same size and depth ceilings and refuses a repeated key the same
      // way (`TDD` §18). Reading it here straight from the source would leave the
      // laxest path into the program unbounded, which is the only path an oversized
      // or deeply nested file needs.
      value = parseJsonFile(source, path);
    } catch (cause) {
      violations.push({
        relativePath,
        instanceLocation: '$',
        message: cause instanceof Error ? cause.message : String(cause)
      });
      continue;
    }

    const parsed = schema.safeParse(value);
    if (parsed.success) {
      continue;
    }

    for (const issue of parsed.error.issues) {
      violations.push({
        relativePath,
        instanceLocation: jsonPathOf(issue.path),
        message: `${issue.code}: ${issue.message}`
      });
    }
  }

  return violations;
}

/**
 * Throws on the first violation, for callers that want a hard stop rather than a
 * report — the CLI runner's data-error exit path.
 */
export function validateContentTreeOrThrow(source: ContentFileSource): void {
  const violations = validateContentTree(source);
  if (violations.length === 0) {
    return;
  }

  const rendered = violations
    .map((violation) => `  ${violation.relativePath} ${violation.instanceLocation}: ${violation.message}`)
    .join('\n');

  throw new Error(`Content does not satisfy its contracts:\n${rendered}`);
}
