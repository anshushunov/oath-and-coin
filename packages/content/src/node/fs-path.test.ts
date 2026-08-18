import { describe, expect, it } from 'vitest';

import { fsFileName, fsParentPath, isAbsoluteFsPath, joinFsPath, normalizeFsPath } from './fs-path.ts';
import { nodeFileSource } from './file-source.ts';

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

describe('a source is confined to its own root', () => {
  const source = nodeFileSource('content');

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
