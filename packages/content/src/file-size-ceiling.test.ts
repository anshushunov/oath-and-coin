import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { memoryFileSource } from './file-source.ts';
import { MAX_FILE_SIZE_BYTES } from './limits.ts';
import { nodeFileSource } from './node/file-source.ts';
import { parseJsonFile, readBounded } from './strict-json.ts';

/**
 * The size ceiling, from both ends of the split.
 *
 * It was stated in one place and checked by nothing before Task 12 — `limits.ts`
 * described the rule and no test reached it. The split made that worth fixing rather
 * than carrying, because the ceiling is now enforced twice: `readBounded` applies it to
 * whatever bytes a source hands over, and the Node source applies it from the same
 * constant before reading, since it can see a file's length for free.
 *
 * Two guards are a place two numbers can drift apart, so what is pinned here is that
 * they do not: the same limit, the same wording, and both of them reached.
 */

const temporaryRoots: string[] = [];

afterEach(() => {
  while (temporaryRoots.length > 0) {
    rmSync(temporaryRoots.pop()!, { recursive: true, force: true });
  }
});

/** Valid JSON, so that a refusal here is the size and never the parse. */
const oversized = `{"filler":"${'x'.repeat(MAX_FILE_SIZE_BYTES)}"}`;
const withinLimit = '{"filler":"x"}';

describe('a file over the ceiling', () => {
  it('is refused by the reader, whatever source held it', () => {
    const source = memoryFileSource({ 'heroes/huge.json': oversized });

    expect(() => parseJsonFile(source, 'heroes/huge.json')).toThrow(
      new RegExp(`over the ${String(MAX_FILE_SIZE_BYTES)}-byte limit`)
    );
  });

  it('is refused by the Node source before its bytes are read', () => {
    // The early guard is the reason `limits.ts` can claim an oversized file costs a
    // `stat` call rather than its own size in memory. Reached through the source
    // directly, not through the reader, so that this fails when the early guard goes
    // and the reader's own check is left standing.
    const root = mkdtempSync(join(tmpdir(), 'oac-ceiling-'));
    temporaryRoots.push(root);
    writeFileSync(join(root, 'huge.json'), oversized, 'utf8');

    expect(() => nodeFileSource(root).read('huge.json')).toThrow(
      new RegExp(`^File 'huge.json' is \\d+ bytes, over the ${String(MAX_FILE_SIZE_BYTES)}-byte limit\\.$`)
    );
  });

  it('is named the same way by both, which is what makes one constant enough', () => {
    const root = mkdtempSync(join(tmpdir(), 'oac-ceiling-'));
    temporaryRoots.push(root);
    writeFileSync(join(root, 'huge.json'), oversized, 'utf8');

    const fromNode = messageOfThrow(() => nodeFileSource(root).read('huge.json'));
    const fromReader = messageOfThrow(() =>
      readBounded(memoryFileSource({ 'huge.json': oversized }), 'huge.json')
    );

    expect(fromReader).toBe(fromNode);
  });
});

describe('a file within the ceiling', () => {
  it('is read by both', () => {
    const root = mkdtempSync(join(tmpdir(), 'oac-ceiling-'));
    temporaryRoots.push(root);
    writeFileSync(join(root, 'small.json'), withinLimit, 'utf8');

    // The other half of a limit: a guard that refused everything would pass every test
    // above and load no content at all.
    expect(parseJsonFile(nodeFileSource(root), 'small.json')).toEqual({ filler: 'x' });
    expect(parseJsonFile(memoryFileSource({ 'small.json': withinLimit }), 'small.json')).toEqual({
      filler: 'x'
    });
  });
});

function messageOfThrow(act: () => unknown): string {
  try {
    act();
  } catch (cause) {
    return cause instanceof Error ? cause.message : String(cause);
  }

  return 'nothing was thrown';
}
