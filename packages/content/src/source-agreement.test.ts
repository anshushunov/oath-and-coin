import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { computeContentDigest, computeContentVersion } from './content-digest.ts';
import { loadContentSet } from './content-set.ts';
import { memoryFileSource, type ContentFileSource } from './file-source.ts';
import { nodeFileSource } from './node/file-source.ts';

/**
 * One tree, two sources, one `content_version`.
 *
 * This is the check Task 12 exists to buy. The package was split so that the browser
 * could read the shipped content through the same loader Node reads it through
 * (`FULL_TYPESCRIPT_MIGRATION` §12.2); the split is only worth anything if the two
 * paths produce the same number, because `content_version` is what a replay, a bug
 * report and all 54 corpus entries are pinned to. Two sources that disagreed would mean
 * a saved game recorded in the browser could not be reproduced by the CLI, and nothing
 * else in the workspace would notice.
 *
 * The rejected alternative is what makes this necessary rather than decorative. A build
 * step could have serialized the loaded content for the browser to read back; then
 * `content_version` would have been a property of the serializer, and this test would
 * have had nothing to compare.
 *
 * The in-memory side is built by a walk written here, not by asking `nodeFileSource` to
 * list the tree. Enumerating both sides with the same code would make a defect in that
 * enumeration invisible: a `list` that skipped nested directories would produce a
 * shorter file set on both sides and two identical, wrong digests.
 */

const repoRoot = resolve(import.meta.dirname, '..', '..', '..');
const shippedContent = join(repoRoot, 'content');

/**
 * The corpus records this as the content version of the shipped tree in all 54 entries,
 * so it is what both sources have to answer — not merely each other.
 */
const RECORDED_CONTENT_VERSION = '5d03734fd9c7abaa';

/** Every file under `directory`, root-relative and POSIX, by this test's own walk. */
function everyFileUnder(directory: string, prefix = ''): readonly string[] {
  const found: string[] = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relativePath = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      found.push(...everyFileUnder(join(directory, entry.name), relativePath));
      continue;
    }
    found.push(relativePath);
  }

  return found;
}

function memorySourceOf(
  directory: string,
  order: (paths: readonly string[]) => readonly string[] = (paths) => paths
): ContentFileSource {
  const files: Record<string, Uint8Array> = {};
  for (const path of order(everyFileUnder(directory))) {
    files[path] = readFileSync(join(directory, ...path.split('/')));
  }

  return memoryFileSource(files);
}

describe('the shipped tree read through two sources', () => {
  const fromDisk = nodeFileSource(shippedContent);
  const inMemory = memorySourceOf(shippedContent);

  it('lists the same files, in the same order', () => {
    // The digest agreement below could also hold because both sources are wrong in the
    // same way. This is the assertion that says which files were covered at all.
    expect(fromDisk.list('')).toEqual(inMemory.list(''));
    expect(fromDisk.list('').length).toBeGreaterThan(0);
  });

  it('digests to the same value', () => {
    expect(computeContentDigest(inMemory)).toBe(computeContentDigest(fromDisk));
  });

  it('answers the content version the frozen corpus recorded', () => {
    expect(computeContentVersion(fromDisk)).toBe(RECORDED_CONTENT_VERSION);
    expect(computeContentVersion(inMemory)).toBe(RECORDED_CONTENT_VERSION);
  });

  it('loads a content set carrying that same version', () => {
    // Through the loader rather than the digest alone: `contentVersion` is a field of
    // `ContentSet`, and a loader that computed it over something other than the files it
    // read would still let the two digests above agree.
    expect(loadContentSet(inMemory).contentVersion).toBe(RECORDED_CONTENT_VERSION);
    expect(loadContentSet(fromDisk).contentVersion).toBe(RECORDED_CONTENT_VERSION);
  });

  it('does not depend on the order the files arrived in', () => {
    // A browser source is built from `import.meta.glob`, whose key order is the
    // bundler's business and not the tree's. Ordinal ordering inside the digest is what
    // makes that irrelevant, and this is the case that proves it on the real tree rather
    // than on a two-file fixture.
    const reversed = memorySourceOf(shippedContent, (paths) => [...paths].reverse());

    expect(computeContentVersion(reversed)).toBe(RECORDED_CONTENT_VERSION);
  });

  it('reads the same bytes back for every file', () => {
    // The digest would also agree if both sources returned nothing for the same file, so
    // the bytes are compared directly as well.
    for (const path of inMemory.list('')) {
      expect(fromDisk.read(path), path).toEqual(inMemory.read(path));
    }
  });

  it('names a file the same way in a diagnostic, whichever source holds it', () => {
    // The message an author reads must not depend on where the game is running, and
    // `describe` is the only thing that decides it.
    for (const path of inMemory.list('')) {
      expect(fromDisk.describe(path)).toBe(inMemory.describe(path));
    }
  });
});

describe('a directory a source does not hold', () => {
  it('lists nothing rather than throwing', () => {
    // `loadContentSet` reports a missing `traits/` by finding no files under it, so a
    // source that threw here would turn that diagnostic into a stack trace.
    expect(nodeFileSource(shippedContent).list('nowhere')).toEqual([]);
    expect(memoryFileSource({ 'heroes/a.json': '{}' }).list('nowhere')).toEqual([]);
  });

  it('does not answer a prefix match as containment', () => {
    // `heroes-retired/a.json` starts with `heroes` and is not inside it. A source that
    // used a bare prefix test would load a retired hero into the campaign.
    const source = memoryFileSource({ 'heroes/a.json': '{}', 'heroes-retired/b.json': '{}' });

    expect(source.list('heroes')).toEqual(['heroes/a.json']);
  });
});
