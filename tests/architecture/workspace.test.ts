import { readFileSync, readdirSync } from 'node:fs';
import { join, posix, relative, resolve, sep } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

/**
 * Checks about the workspace itself, not about any code in it.
 *
 * Each one guards a failure that is invisible in a diff and expensive later: a
 * package that escaped the typecheck gate, a version that drifted between two
 * members, a caret that turned a pinned dependency into "whatever the registry
 * served that day". ADR-010 §123 asks for exact direct versions and a frozen
 * lockfile; this file is where that stops being prose.
 */

const repoRoot = resolve(import.meta.dirname, '..', '..');

interface PackageManifest {
  readonly name?: string;
  readonly private?: boolean;
  readonly type?: string;
  readonly scripts?: Readonly<Record<string, string>>;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly engines?: Readonly<Record<string, string>>;
  readonly packageManager?: string;
}

interface Member {
  /** Workspace-relative directory, POSIX separators — as pnpm-workspace.yaml spells it. */
  readonly directory: string;
  readonly manifest: PackageManifest;
}

function readJson(path: string): PackageManifest {
  return JSON.parse(readFileSync(path, 'utf8')) as PackageManifest;
}

function readTextFile(path: string): string {
  return readFileSync(path, 'utf8');
}

const rootManifest = readJson(join(repoRoot, 'package.json'));

const declaredMemberDirectories: readonly string[] = (() => {
  const workspace = parseYaml(readTextFile(join(repoRoot, 'pnpm-workspace.yaml'))) as {
    packages?: readonly string[];
  };
  const declared = workspace.packages ?? [];
  // Globs would need matching logic here and would let a member be listed
  // without existing. Every entry is an exact directory, and this is where
  // that convention is enforced rather than assumed.
  for (const entry of declared) {
    expect(entry, 'workspace members are listed as exact directories, not globs').not.toContain(
      '*'
    );
  }
  return declared;
})();

const members: readonly Member[] = declaredMemberDirectories.map((directory) => ({
  directory,
  manifest: readJson(join(repoRoot, ...directory.split('/'), 'package.json'))
}));

/**
 * Every package.json in the tree, excluding the root and anything under a
 * directory that is not source: dependencies, build output, and the .NET
 * side's own bin/obj.
 */
function findPackageManifests(directory: string, found: string[] = []): string[] {
  const skipped = new Set([
    'node_modules',
    '.git',
    'bin',
    'obj',
    'dist',
    'artifacts',
    '.godot',
    'playwright-report',
    'test-results'
  ]);

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!skipped.has(entry.name)) {
        findPackageManifests(join(directory, entry.name), found);
      }
      continue;
    }
    if (entry.name === 'package.json') {
      found.push(join(directory, entry.name));
    }
  }

  return found;
}

describe('workspace membership', () => {
  it('every declared member exists and names itself', () => {
    for (const member of members) {
      expect(member.manifest.name, `${member.directory} must declare a package name`).toBeTypeOf(
        'string'
      );
    }
  });

  it('every package on disk is a declared member', () => {
    const onDisk = findPackageManifests(repoRoot)
      .map((path) => relative(repoRoot, path).split(sep).slice(0, -1).join(posix.sep))
      .filter((directory) => directory !== '');

    // A package.json outside the workspace is not merely untidy: pnpm never
    // installs it, `pnpm -r typecheck` never reaches it and `vitest run` never
    // collects it, so every gate in this repository is green on a directory
    // nobody checks. It has to be either a member or not a package.
    expect([...onDisk].sort()).toEqual([...declaredMemberDirectories].sort());
  });
});

describe('gate coverage', () => {
  it('every member is referenced by the typecheck solution', () => {
    // `tsc --build tsconfig.json` checks exactly the projects listed in the
    // root solution file. A member missing from it is installed, bundled and
    // tested like any other, and never typechecked — the gate stays green
    // because it never looked.
    const solution = JSON.parse(
      readTextFile(join(repoRoot, 'tsconfig.json'))
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('//'))
        .join('\n')
    ) as { references?: readonly { path: string }[] };

    const referenced = (solution.references ?? []).map((reference) => reference.path);

    expect([...referenced].sort()).toEqual([...declaredMemberDirectories].sort());
  });

  it('every member extends the shared compiler options', () => {
    for (const member of members) {
      const tsconfig = JSON.parse(
        // The tsconfig files here carry comments, which JSON.parse rejects.
        // Stripping whole-line comments is enough for files this repository
        // writes and keeps a JSON5 dependency out of the workspace.
        readTextFile(join(repoRoot, ...member.directory.split('/'), 'tsconfig.json'))
          .split('\n')
          .filter((line) => !line.trimStart().startsWith('//'))
          .join('\n')
      ) as { extends?: string };

      const expected = `${member.directory
        .split('/')
        .map(() => '..')
        .join('/')}/tsconfig.base.json`;

      expect(tsconfig.extends, `${member.directory} must extend the base tsconfig`).toBe(expected);
    }
  });
});

describe('dependency pins', () => {
  const exactVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

  it('every dependency of every member is pinned to an exact version', () => {
    const loose: string[] = [];

    for (const member of [{ directory: '.', manifest: rootManifest }, ...members]) {
      for (const field of ['dependencies', 'devDependencies'] as const) {
        for (const [dependency, range] of Object.entries(member.manifest[field] ?? {})) {
          // Workspace-internal links are versionless by construction; pinning
          // them would mean bumping a number in two files on every change.
          if (range.startsWith('workspace:')) {
            continue;
          }
          if (!exactVersion.test(range)) {
            loose.push(`${member.directory}: ${dependency}@${range}`);
          }
        }
      }
    }

    expect(loose, 'ADR-010 §123: direct dependencies are pinned exactly').toEqual([]);
  });

  it('a dependency has one version across the whole workspace', () => {
    const versions = new Map<string, Map<string, string[]>>();

    for (const member of [{ directory: '.', manifest: rootManifest }, ...members]) {
      for (const field of ['dependencies', 'devDependencies'] as const) {
        for (const [dependency, range] of Object.entries(member.manifest[field] ?? {})) {
          if (range.startsWith('workspace:')) {
            continue;
          }
          const byVersion = versions.get(dependency) ?? new Map<string, string[]>();
          byVersion.set(range, [...(byVersion.get(range) ?? []), member.directory]);
          versions.set(dependency, byVersion);
        }
      }
    }

    // Two members on two versions of the same tool is how a workspace ends up
    // with tests passing under one TypeScript and CI failing under another.
    const disagreements = [...versions]
      .filter(([, byVersion]) => byVersion.size > 1)
      .map(([dependency, byVersion]) => `${dependency}: ${JSON.stringify([...byVersion])}`);

    expect(disagreements).toEqual([]);
  });

  it('TypeScript is the compiler ADR-010 pins for the migration', () => {
    // ADR-010: "TypeScript 6.0.3 остаётся каноническим компилятором на всё
    // время миграции. TypeScript 7 не используется". Moving off it is a
    // decision with a record behind it, so it has to break a test rather than
    // ride in on a dependency bump.
    const declared = [
      rootManifest.devDependencies?.typescript,
      ...members.map((member) => member.manifest.devDependencies?.typescript)
    ].filter((version): version is string => version !== undefined);

    expect(declared.length).toBeGreaterThan(0);
    for (const version of declared) {
      expect(version).toBe('6.0.3');
    }
  });
});

describe('toolchain pins', () => {
  it('the package manager is pinned with an integrity hash', () => {
    // Corepack verifies the hash before running pnpm. Without it the version
    // is pinned and the bytes are not, which is the half of the supply-chain
    // promise that matters when a registry account is compromised.
    // Corepack's own spelling of the digest: hex, not the base64 the registry
    // reports as `dist.integrity`. It rejects the base64 form outright with
    // "expected a semver version", which reads as a malformed version rather
    // than as a wrongly encoded hash.
    expect(rootManifest.packageManager).toMatch(/^pnpm@\d+\.\d+\.\d+\+sha512\.[0-9a-f]{128}$/);
  });

  it('engines and packageManager name the same pnpm', () => {
    // Two fields, two enforcers: corepack reads `packageManager` and installs
    // that version, `engines.pnpm` makes pnpm itself refuse to run under any
    // other. Left to drift they deadlock — corepack installs the version the
    // project then rejects, and the error reads as an unsupported environment
    // rather than as one file disagreeing with another. Observed here while
    // moving from 11.9.0 to 11.22.0.
    const fromPackageManager = /^pnpm@(\d+\.\d+\.\d+)\+/.exec(rootManifest.packageManager ?? '');

    expect(fromPackageManager?.[1]).toBe(rootManifest.engines?.pnpm);
  });

  it('the Node version in .nvmrc is the lower bound of the supported range', () => {
    const pinned = readTextFile(join(repoRoot, '.nvmrc')).trim();
    const range = rootManifest.engines?.node;

    // Two files state the Node version — .nvmrc for developers and CI, engines
    // for the installer — and nothing but this test keeps them from drifting
    // into disagreement.
    expect(range).toBe(`>=${pinned} <25.0.0`);
  });
});
