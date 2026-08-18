import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { fsFileName, fsParentPath, isAbsoluteFsPath, joinFsPath, normalizeFsPath } from './fs-path.ts';
import { nodeFileSource } from './file-source.ts';
import { loadAndRunScenario, loadLocaleCatalogue, loadScenarioManifest } from './index.ts';

/**
 * Paths that name a place, tested as strings.
 *
 * These cases exist because the machine that runs them cannot produce most of them.
 * The blocker external review found was a POSIX absolute root losing its leading slash:
 * fatal on the Ubuntu job that runs `pnpm test`, invisible on Windows, where
 * `C:/gamedev/oath-and-coin` has no leading slash to lose. A property that only one
 * platform can demonstrate has to be asserted about the string, or it is asserted
 * nowhere until CI says so.
 */

describe('normalizeFsPath keeps the root it was given', () => {
  it.each([
    ['/home/runner/work/oath-and-coin', '/home/runner/work/oath-and-coin'],
    ['/home/runner/work/oath-and-coin/', '/home/runner/work/oath-and-coin'],
    ['/', '/'],
    ['C:/gamedev/oath-and-coin', 'C:/gamedev/oath-and-coin'],
    ['C:\\gamedev\\oath-and-coin', 'C:/gamedev/oath-and-coin'],
    // A drive letter with no slash means "the current directory on that drive", which
    // is a different place from the drive's root.
    ['C:/', 'C:/'],
    ['//server/share', '//server/share'],
    ['//server/share/', '//server/share'],
    ['content', 'content'],
    ['content/', 'content'],
    // Empty is the current directory, spelled so that appending to it cannot produce
    // something absolute.
    ['', '.']
  ])('%s → %s', (given, expected) => {
    expect(normalizeFsPath(given)).toBe(expected);
  });
});

describe('isAbsoluteFsPath', () => {
  it.each([
    ['/home/runner', true],
    ['C:/gamedev', true],
    ['C:\\gamedev', true],
    ['//server/share', true],
    ['content', false],
    ['./content', false],
    ['', false]
  ])('%s → %s', (given, expected) => {
    expect(isAbsoluteFsPath(given)).toBe(expected);
  });
});

describe('joinFsPath', () => {
  it('keeps an absolute base absolute', () => {
    expect(joinFsPath('/home/runner/work/oath-and-coin', 'scenarios')).toBe(
      '/home/runner/work/oath-and-coin/scenarios'
    );
  });

  it('does not double the slash of a root', () => {
    expect(joinFsPath('/', 'content')).toBe('/content');
    expect(joinFsPath('C:/', 'content')).toBe('C:/content');
  });

  it('answers the base itself for the empty path', () => {
    expect(joinFsPath('/home/runner', '')).toBe('/home/runner');
  });
});

describe('fsParentPath and fsFileName', () => {
  it.each([
    ['/home/runner/content/locale/ru.json', '/home/runner/content/locale', 'ru.json'],
    ['C:/gamedev/scenarios/gate0.manifest.json', 'C:/gamedev/scenarios', 'gate0.manifest.json'],
    ['/ru.json', '/', 'ru.json'],
    ['C:/ru.json', 'C:/', 'ru.json'],
    ['ru.json', '.', 'ru.json'],
    ['content/locale/ru.json', 'content/locale', 'ru.json']
  ])('%s → (%s, %s)', (given, parent, name) => {
    expect(fsParentPath(given)).toBe(parent);
    expect(fsFileName(given)).toBe(name);
  });
});

/**
 * The repository root spelled without a drive letter.
 *
 * On Linux this is the root as it already is. On Windows it is drive-relative —
 * `/gamedev/oath-and-coin` resolves against the current drive, which is the drive the
 * repository is on — so the same expression names the same directory on both, and a
 * leading slash is present on both.
 *
 * That is what makes the cases below portable, and portability is the whole point: the
 * blocker external review found was a leading slash being trimmed, which no Windows path
 * has to lose. The unit cases above pin the helpers; these pin the call sites, which is
 * where the defect actually was.
 */
const posixRepoRoot = resolve(import.meta.dirname, '..', '..', '..', '..')
  .replace(/\\/gu, '/')
  .replace(/^[A-Za-z]:/u, '');

describe('the wrappers keep a POSIX-absolute path absolute', () => {
  it('when a locale catalogue is named by one', () => {
    const catalogue = loadLocaleCatalogue(`${posixRepoRoot}/content/locale/ru.json`);

    expect(catalogue.get('hero.core.bram.name')).toBe('Брам');
  });

  it('when a scenario manifest is named by one', () => {
    const manifest = loadScenarioManifest(`${posixRepoRoot}/scenarios/screen_normal.manifest.json`);

    expect(manifest.scenario).toBe('screen_normal');
  });

  it('when a whole run is rooted at one', () => {
    // The call site the blocker was in: `repositoryRoot` decides where the scenarios are
    // read from and what a relative content root resolves against.
    const result = loadAndRunScenario({
      repositoryRoot: posixRepoRoot,
      scenario: 'screen_normal',
      checkpoint: null,
      seed: 424242n
    });

    expect(result.kind).toBe('ran');
  });
});

describe('a source is confined to its own root', () => {
  // Rooted absolutely, not at `content` relative to the current directory. Vitest's
  // `--root` moves where tests are collected from and not where the process is: under
  // `pnpm --filter @oath-and-coin/content test` the working directory is the package,
  // and a relative root names a directory that is not there. Caught by that gate while
  // `pnpm test` from the repository root stayed green — the same shape as the blocker
  // above, a path that means two things depending on where it is read.
  const source = nodeFileSource(`${posixRepoRoot}/content`);

  it('refuses a path that climbs out of it', () => {
    // Reproduced by external review: this returned `true`, and `read` came back with
    // the repository's own `package.json`. A content tree is data a mod or a corrupted
    // download can author.
    expect(() => source.exists('../package.json')).toThrow(/navigates with/u);
    expect(() => source.read('../package.json')).toThrow(/navigates with/u);
    expect(() => source.list('..')).toThrow(/navigates with/u);
  });

  it('refuses an absolute path', () => {
    expect(() => source.exists('/etc/passwd')).toThrow(/is absolute/u);
    expect(() => source.exists('C:/Windows/win.ini')).toThrow(/is absolute/u);
  });

  it('still answers about a file it does hold', () => {
    // The other half: a guard that refused everything would pass every case above and
    // load no content at all.
    expect(source.exists('locale/ru.json')).toBe(true);
  });
});
