import { resolve } from 'node:path';

import {
  SAVE_ERROR_CODES,
  computeContentVersion,
  loadContentSet,
  resolveContentRoot
} from '@oath-and-coin/content';
import { loadUiTextCatalogue } from '@oath-and-coin/content/node';
import { errorKey } from '@oath-and-coin/presentation';
import { describe, expect, it } from 'vitest';

import {
  browserContentSource,
  browserLocaleCatalogue,
  browserUiTextCatalogue,
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

/**
 * The content version this repository computes for the shipped tree.
 *
 * Was the corpus's own value for the shipped tree in all 54 entries, until `DEC-008`
 * Task 3 renamed the contract's fee field and moved the shipped tree's bytes on
 * purpose — pinned here from now on as a drift guard, not as corpus parity.
 */
const SHIPPED_CONTENT_VERSION = '96aff403339c2a29';

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

describe('a root spelled in a way a filesystem would read differently', () => {
  // This source matches a repository-relative path literally; a filesystem resolves
  // `..`, reads `.` and understands an absolute path. Every string where those two
  // readings differ therefore has to be refused before either is asked, or one
  // manifest produces a loaded content set on the desktop and `CONTENT_ROOT_NOT_FOUND`
  // in the browser — the divergence external review of this task found.
  //
  // The pairing is asserted rather than assumed: each case is both something this
  // source answers `null` for and something the content layer refuses outright. A
  // repair that relaxed the refusal upstream would fail here, in the package that
  // would silently start disagreeing.
  const cases = [
    'scenarios/fixtures/decision_core/../screen_empty',
    '../content',
    './content',
    '/etc',
    'C:/content',
    ''
  ];

  it.each(cases)('is refused upstream and unreachable here: %s', (contentRoot) => {
    expect(openRepositoryRoot(contentRoot)).toBeNull();
    expect(() =>
      resolveContentRoot({
        schemaVersion: 1,
        scenario: 'a_scenario',
        expectedOutcome: 'success',
        fault: null,
        expectedErrorCode: null,
        checkpoints: [{ name: 'final', afterCommandId: 0 }],
        contentRoot,
        expectedScreenState: null
      })
    ).toThrow();
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

  it('drops exactly the top-level oracle outputs and nothing else', () => {
    // The exclusion is the one place this source can lose a file on purpose, so what
    // it loses is stated against the tree rather than against the pattern that wrote
    // it. Enumerated by a second glob with no exclusion at all — the same device
    // `source-agreement.test.ts` uses when it walks the tree itself instead of asking
    // the source under test what the tree contains.
    //
    // Written recursively, the exclusion would also drop a content file inside
    // `scenarios/fixtures/` whose name happened to end in `.canonical.json`. Nothing
    // forbids one, the node source would hash it, and the two `content_version`s would
    // part company on one fixture root with every digest test above still green.
    const everyScenarioFile = Object.keys(
      import.meta.glob('../../../scenarios/**/*', {
        query: '?raw',
        import: 'default',
        eager: true,
        exhaustive: true
      })
    ).map((key) => key.replace('../../../scenarios/', ''));

    const held = new Set(requireRoot('scenarios').list(''));
    const dropped = everyScenarioFile.filter((path) => !held.has(path)).sort();

    expect(dropped.length).toBeGreaterThan(0);
    expect(dropped.filter((path) => !/^[^/]+[.]canonical[.]json$/u.test(path))).toEqual([]);
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

describe('the interface text catalogue read out of the bundle', () => {
  /**
   * `ADR-012` put this catalogue outside `content/` so that a new player-facing string
   * would stop moving `content_version`. The cost of that move is a second tree the
   * bundle has to be told about: `content/**` and `scenarios/**` were the whole glob,
   * and a catalogue nobody added to it is a file the browser does not have.
   *
   * Wired and proven now rather than when the save screen needs it. Review of this task
   * named why: with no consumer yet, a missing glob entry fails in the browser at
   * runtime while `pnpm test`, `pnpm lint:deps` and `pnpm scenario:parity` all stay
   * green — "measured is not enforced", and a paragraph in an ADR is not a mechanism.
   */
  it('answers a key for every save refusal the application can report', () => {
    // Against the engine's own closed list, never against what another source in this
    // process answers — the rule this file states at the top.
    const catalogue = browserUiTextCatalogue('ru');
    const missing = SAVE_ERROR_CODES.map(errorKey).filter(
      (key) => catalogue.get(key) === undefined
    );

    expect(missing, `keys the bundle does not hold: ${missing.join(', ')}`).toEqual([]);
  });

  it('answers exactly what the Node loader answers for the same file', () => {
    // The `source-agreement.test.ts` form, for the second tree: two implementations of
    // one port over one file, compared key for key. A glob that dropped the file, or
    // stripped its prefix wrongly, or handed the bundler's module object through as the
    // bytes would part company here rather than on the first screen that resolves a key.
    const fromBundle = browserUiTextCatalogue('ru');
    const fromDisk = loadUiTextCatalogue(
      resolve(import.meta.dirname, '..', '..', '..', 'ui-text', 'ru.json')
    );

    expect([...fromBundle.entries()].sort()).toEqual([...fromDisk.entries()].sort());
    expect(fromBundle.size).toBeGreaterThan(0);
  });

  it('refuses a locale that is not shipped', () => {
    expect(() => browserUiTextCatalogue('definitely-not-a-locale')).toThrow();
  });
});
