import { computeContentVersion, loadContentSet } from '@oath-and-coin/content';
import { describe, expect, it } from 'vitest';

import {
  browserContentSource,
  browserLocaleCatalogue,
  openRepositoryRoot
} from './content-source.ts';

/**
 * The proof that the browser reads the same content the rest of the workspace does.
 *
 * `FULL_TYPESCRIPT_MIGRATION` §13.5 recorded the gap this closes in as many words:
 * the agreement between two content sources was proven on the Node source and on an
 * in-memory one, and `import.meta.glob` was a third that had never run. Until it did,
 * "the browser validates the shipped content with the same contracts" was a statement
 * about a code path nothing had executed.
 *
 * Every expectation below is against a value the frozen corpus recorded, never
 * against what another source in this same process answers. Two sources compared with
 * each other agree just as happily when both are wrong; a recorded constant cannot
 * move to meet a defect.
 */

/** The content version the corpus records for the shipped tree in all 54 entries. */
const SHIPPED_CONTENT_VERSION = '5d03734fd9c7abaa';

/**
 * The content version the corpus records for `screen_empty`'s own fixture root.
 *
 * A second anchor, and not a decorative one: that root's `contracts/` and `traits/`
 * are empty directories held in git by a `.gitkeep`, and a glob without
 * `exhaustive: true` silently skips dotfiles. This is the number that moves when it
 * does.
 */
const SCREEN_EMPTY_CONTENT_VERSION = '914b935df2b48720';

function requireRoot(root: string) {
  const source = openRepositoryRoot(root);
  expect(source, `the bundle must hold '${root}'`).not.toBeNull();

  // Narrowing for the compiler; the assertion above is what fails the test.
  if (source === null) {
    throw new Error(`No source at '${root}'.`);
  }

  return source;
}

describe('the shipped content tree, read out of the bundle', () => {
  it('answers the content version the frozen corpus recorded', () => {
    expect(computeContentVersion(requireRoot('content'))).toBe(SHIPPED_CONTENT_VERSION);
  });

  it('loads a content set carrying that same version', () => {
    // Through the loader as well as the digest: `contentVersion` is a field of
    // `ContentSet`, and a loader fed a source that dropped files would still let the
    // digest above agree with itself.
    expect(loadContentSet(requireRoot('content')).contentVersion).toBe(SHIPPED_CONTENT_VERSION);
  });

  it('holds every file as a path relative to the root it was asked for', () => {
    const paths = requireRoot('content').list('');

    // The glob keys arrive prefixed with `../../../`; a source handed one of those
    // refuses it rather than reading the wrong file, so this is what says the
    // stripping happened at all.
    expect(paths).toContain('heroes/bram.json');
    expect(paths).toContain('locale/ru.json');
    expect(paths.filter((path) => path.startsWith('.') || path.startsWith('/'))).toEqual([]);
  });

  it('keeps the files of a nested directory nested', () => {
    // A glob that flattened, or a source that lost a directory level, would still
    // produce a plausible digest — over a different set of paths. The digest hashes
    // the path beside the bytes, so the version above is what makes this specific,
    // and this is what says which shape it was computed over.
    expect(requireRoot('content').list('traits').length).toBeGreaterThan(0);
    expect(requireRoot('content').list('traits')).toEqual(
      requireRoot('content')
        .list('')
        .filter((path) => path.startsWith('traits/'))
    );
  });
});

describe("a scenario's own fixture content root", () => {
  it('answers the content version the corpus recorded for screen_empty', () => {
    expect(computeContentVersion(requireRoot('scenarios/fixtures/screen_empty'))).toBe(
      SCREEN_EMPTY_CONTENT_VERSION
    );
  });

  it('carries the files that hold its empty directories in git', () => {
    // Named explicitly rather than left to the digest above: a `.gitkeep` is exactly
    // the file a bundler's default glob drops, and "the version moved" is a much
    // harder message to act on than "the dotfiles are missing".
    expect(requireRoot('scenarios/fixtures/screen_empty').list('')).toEqual([
      'contracts/.gitkeep',
      'heroes/roster_only_hero.json',
      'traits/.gitkeep'
    ]);
  });
});

describe('a repository root the bundle does not hold', () => {
  it('is answered with null rather than with an empty source', () => {
    // The path `screen_error`'s manifest resolves to. A source over no files at all
    // would digest to the SHA-256 of nothing and give content that does not exist a
    // plausible version — the defect external review reproduced on the Node side
    // (§13.4).
    expect(openRepositoryRoot('artifacts/oracle-faults/fixtures/does-not-exist')).toBeNull();
  });

  it('does not answer a prefix match as containment', () => {
    // `content` starts with `conten`, and `scenarios/fixtures/screen_empty` starts
    // with `scenarios/fixtures/screen_empt`. A bare prefix test would open a root
    // nobody named and load one tree's heroes into another's campaign.
    expect(openRepositoryRoot('conten')).toBeNull();
    expect(openRepositoryRoot('scenarios/fixtures/screen_empt')).toBeNull();
  });
});

describe('the content source port the application is handed', () => {
  it('reads scenario files from the scenarios root', () => {
    const port = browserContentSource();

    expect(port.scenarios.exists('screen_normal.manifest.json')).toBe(true);
    expect(port.scenarios.exists('screen_normal.commands.json')).toBe(true);
  });

  it('does not ship the oracle output the parity tool reads', () => {
    // `*.canonical.json` is a recorded answer, not an input to a run. Excluding it is
    // what keeps the bundle from carrying 137 KB the game never reads.
    expect(browserContentSource().scenarios.exists('screen_normal.canonical.json')).toBe(false);
  });

  it('opens the content root a manifest names and refuses the one it cannot', () => {
    const port = browserContentSource();

    expect(port.openContentRoot('content')).not.toBeNull();
    expect(port.openContentRoot('scenarios/fixtures/decision_core')).not.toBeNull();
    expect(port.openContentRoot('artifacts/oracle-faults/fixtures/does-not-exist')).toBeNull();
  });
});

describe('the locale catalogue read out of the bundle', () => {
  it('resolves a key the screen shows', () => {
    expect(browserLocaleCatalogue('ru').get('screen.contract_offer.title')).toBeTypeOf('string');
  });

  it('refuses a locale that is not shipped', () => {
    // Loudly, rather than as an empty catalogue: every key on the screen would then
    // fail to resolve one at a time, which reads as a broken screen rather than as a
    // missing translation file.
    expect(() => browserLocaleCatalogue('definitely-not-a-locale')).toThrow();
  });
});
