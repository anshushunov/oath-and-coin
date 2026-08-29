import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { computeContentDigest, computeContentVersion } from './content-digest.ts';
import { loadContentSet } from './content-set.ts';
import { memoryFileSource, type ContentFileSource } from './file-source.ts';
import { nodeFileSource } from './node/file-source.ts';
import {
  computeContentDigest as digestOfDirectory,
  computeContentVersion as versionOfDirectory
} from './node/index.ts';

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
 * Was the content version the corpus recorded for the shipped tree in all 54 entries,
 * until `DEC-008` Task 3 renamed the contract's fee field, and Task 4 raised the schema
 * version and authored `negotiable_tags`, each moving the shipped tree's bytes on
 * purpose. Task 8 moved it a third time, authoring the two `hero.decision.*`
 * localization keys its new decision factors need in `content/locale/ru.json`, and a
 * fourth, in review of that same task, rewording one of those two keys' Russian text to
 * match its neighbours' grammatical form. Task 15's own review moved it a fifth time,
 * authoring `tag.method.open`: Task 4's `negotiable_tags` on two contracts had gone
 * half-translated since it was authored — `tag.method.deception` already existed from
 * its use as a plain `tags` entry elsewhere, `tag.method.open` did not — and it stayed
 * invisible until the read-model's `OfferLine.methodOptionKeys` (`NEGOTIATION_SPEC`
 * §5.1) started resolving both alternatives, not only the chosen one. Task 18 moved it
 * a sixth time, authoring `core:works_in_the_open` and its localization key:
 * `tag.method.open` was translated but nothing reacted to it, so choosing it could only
 * ever close a gate, never attract anyone (`NEGOTIATION_SPEC` §10.5). The same task
 * moved it a seventh time: its own `EveryContractCanBeCrewedBySomePackage` check found
 * `core:collect_the_debt` unreachable by any package on its first run — five of six
 * shipped heroes carry a principle matching one of its three authored tags — fixed by
 * `required_crew: 2 → 1` rather than by touching the tags or any hero. The
 * contract-resolution engine's Task 2 moved it an eighth time: `schema_version: 5` on
 * every file, `capability` on every hero, `needs` on every contract (`RESOLUTION_SPEC`
 * §2.2, §2.3). What this constant still buys is what both sources have to answer — not
 * merely each other — just no longer corpus parity.
 *
 * The same hash is pinned a second time, in `tests/locale/catalogue.test.ts` as
 * `FROZEN_CONTENT_VERSION`, where it states a different claim: that nothing has been
 * added to `content/` since `ADR-012` moved interface text out of it. Two literals on
 * purpose — neither file may own the other's claim — and Task 19 retires **both** when
 * the corpus stops being the oracle.
 */
const RECORDED_CONTENT_VERSION = 'd630e880dca41631';

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

describe('the two sources answer the same way about a path outside them', () => {
  // The port has two implementations, and an implementation that answered differently
  // would make "the browser reads the same content" a claim about whichever one was
  // measured. External review found exactly this divergence: the Node source read
  // `../package.json` and the in-memory source said it held no such file.
  const cases = ['../package.json', '/etc/passwd', 'heroes/../../package.json'];

  it.each(cases)('both refuse %s', (path) => {
    const fromDisk = nodeFileSource(shippedContent);
    const inMemory = memoryFileSource({ 'heroes/a.json': '{}' });

    expect(() => fromDisk.exists(path)).toThrow();
    expect(() => inMemory.exists(path)).toThrow();
  });
});

describe('a content root that is not there', () => {
  it('is refused by the digest wrappers rather than digested as nothing', () => {
    // Reproduced by external review: this answered `e3b0c442…b855`, the SHA-256 of an
    // empty input, so content that does not exist was given a plausible version. Before
    // the split the missing directory threw out of `readdirSync`.
    expect(() => digestOfDirectory('artifacts/definitely-missing-content-root')).toThrow(
      /does not exist/u
    );
    expect(() => versionOfDirectory('artifacts/definitely-missing-content-root')).toThrow(
      /does not exist/u
    );
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
