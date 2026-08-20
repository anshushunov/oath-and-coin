import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, posix, relative, resolve, sep } from 'node:path';

import ts from 'typescript';
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
  readonly optionalDependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly engines?: Readonly<Record<string, string>>;
  readonly packageManager?: string;
}

/**
 * Every section a dependency can be declared in — all four, not the two that
 * happen to be in use today.
 *
 * External review found the pin, single-version and storefront checks reading
 * only `dependencies` and `devDependencies`. An SDK or a native runtime added
 * as an `optionalDependency` — which is the ordinary way to ship something
 * that "degrades when absent", exactly how a storefront SDK would arrive —
 * walked past all three of them and left the suite green.
 */
const DEPENDENCY_SECTIONS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies'
] as const;

/** Every declared dependency of a manifest, whichever section it sits in. */
function* declaredDependencies(
  manifest: PackageManifest
): Generator<{ section: string; name: string; range: string }> {
  for (const section of DEPENDENCY_SECTIONS) {
    for (const [name, range] of Object.entries(manifest[section] ?? {})) {
      yield { section, name, range };
    }
  }
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

  it("every .ts and .tsx file of every member is inside that member's own include", () => {
    // The other half of the check above, and until Task 18 it was missing. A
    // member can be listed in the root solution — so `tsc --build` opens its
    // project — and still leave most of its own tree unchecked, because what
    // `tsc` compiles is the project's `include`, not its directory. Both
    // `tests/architecture` (`["src", "*.test.ts"]`) and `tests/locale`
    // (`["*.test.ts"]`) match only the top level: a test added in a
    // subdirectory of either is collected by vitest, runs, and is never
    // typechecked by anything. Named as a repo-level hole during Task 16.2 and
    // carried here.
    //
    // The membership question is answered by the compiler rather than by a
    // glob matcher written here. tsconfig's `include` has its own semantics —
    // a bare `src` means the directory recursively, `*.test.ts` does not cross
    // a directory boundary, `**/*` does, and `exclude` and `files` interact
    // with all of it — and a second implementation of those rules in this file
    // would be a check on this file's opinion, not on what `pnpm typecheck`
    // does. `parseJsonConfigFileContent` returns the exact file list `tsc`
    // would compile.
    const skipped = new Set([
      'node_modules',
      'dist',
      'build',
      'artifacts',
      'playwright-report',
      'test-results'
    ]);

    function sourceFiles(directory: string, found: string[] = []): string[] {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (!skipped.has(entry.name)) {
            sourceFiles(join(directory, entry.name), found);
          }
          continue;
        }
        // Declaration files are excluded on purpose: an ambient `.d.ts` is
        // pulled in by reference rather than by `include`, so requiring one to
        // be listed would fail on a file that is in fact checked.
        if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
          found.push(join(directory, entry.name));
        }
      }
      return found;
    }

    const escaped: string[] = [];

    for (const member of members) {
      const directory = join(repoRoot, ...member.directory.split('/'));
      const configPath = join(directory, 'tsconfig.json');

      const { config, error } = ts.readConfigFile(configPath, ts.sys.readFile);
      expect(error, `${member.directory}/tsconfig.json could not be read`).toBeUndefined();

      const parsed = ts.parseJsonConfigFileContent(config, ts.sys, directory);
      // Windows hands the same file back under more than one spelling — drive
      // letter case above all — so the comparison is made on a normalised
      // form rather than on whatever each side happened to produce.
      const compiled = new Set(parsed.fileNames.map((file) => resolve(file).toLowerCase()));

      for (const file of sourceFiles(directory)) {
        if (!compiled.has(resolve(file).toLowerCase())) {
          escaped.push(relative(repoRoot, file).split(sep).join(posix.sep));
        }
      }
    }

    expect(
      escaped.sort(),
      'these files are in a member that `tsc --build` opens, and in no project it compiles'
    ).toEqual([]);
  });

  it('every member is inside the dependency-boundary gate', () => {
    // `depcruise` walks the directories named on its command line and nothing
    // else. `packages/**` cannot be on that list until it exists — the tool
    // exits with "Can't open 'packages' for reading" — so the list is
    // maintained by hand, and this is what stops a member from being added
    // beside the gate instead of inside it.
    const command = rootManifest.scripts?.['lint:deps'] ?? '';
    const roots = command
      .split(/\s+/)
      .filter((token) => /^[a-z][a-z0-9-]*$/.test(token))
      // The command's own words, not paths.
      .filter((token) => token !== 'depcruise');

    for (const member of members) {
      const covered = roots.some(
        (root) => member.directory === root || member.directory.startsWith(`${root}/`)
      );
      expect(covered, `${member.directory} is not covered by lint:deps (${command})`).toBe(true);
    }
  });

  it('nothing that ships imports a package its member does not depend on at runtime', () => {
    // The second statement of `not-to-dev-dep` (`.dependency-cruiser.cjs`), and
    // it covers the two cases that rule is blind to rather than replacing it.
    // Both rule and check are load-bearing; `REQUIRED_RULES` above names the
    // pairing so that neither is deleted as a duplicate of the other.
    //
    // **The rule works.** An earlier version of this comment said it could never
    // fire under pnpm's layout, and external review refuted that by measurement:
    // `import { JSDOM } from 'jsdom'` in `apps/web/src/rendered-texts.ts` gives
    //
    //   error not-to-dev-dep: apps/web/src/rendered-texts.ts →
    //     node_modules/.pnpm/jsdom@30.0.1…/node_modules/jsdom/lib/api.js
    //
    // because `jsdom` is a devDependency of `apps/web` itself, and the edge is
    // classified `["npm-dev","import"]`. The wrong diagnosis is recorded here on
    // purpose: it was about to send the next reader to delete a live rule.
    //
    // **What it is actually blind to**, measured the same way, one edge at a time
    // from `depcruise --output-type json`:
    //
    //   jsdom          (devDependency of apps/web)   ["npm-dev","import"]     caught
    //   vitest/config  (devDependency of the ROOT)   ["npm-no-pkg","import"]  missed
    //   vite           (devDependency of apps/web)   no edge in the graph at all
    //
    // dependency-cruiser classifies an edge against the manifest of the member
    // it starts in. A package that member declares is `npm-dev` and is refused;
    // a package declared only by the root workspace manifest is in no manifest
    // it consults, so it is `npm-no-pkg` — not a section it checks — and passes.
    // The `vite` case is worse than a misclassification: the edge does not enter
    // the graph, `no-unresolvable` says nothing either, and `206 modules, 681
    // dependencies` is reported with and without the import.
    //
    // A member's own manifest answers all three, which is why the property is
    // restated here rather than repaired there. (`preserveSymlinks: true` was
    // tried and is not the repair: it makes `packages/content` importing
    // `packages/simulation` resolve as
    // `packages/content/node_modules/@oath-and-coin/simulation/…` and reports
    // eleven real modules as violations.)
    //
    // Deliberately not a list of forbidden package names — that is the shape
    // this repository has had to repair three times. Every bare specifier must
    // be *permitted*, and the permission is the member's own `dependencies`.
    const shipping = /^(apps|packages|tools)\//;
    const testFile = /\.(test|spec)\.tsx?$/;
    // The same files `.dependency-cruiser.cjs` excludes, and for its reason:
    // build configuration is not shipped, and it imports the bundler by
    // definition.
    const buildConfig = /(^|\/)(vite\.[^/]*|(vitest|playwright)\.[^/]*config)\.ts$/;

    /** `@scope/name/deep/path` -> `@scope/name`; `name/deep` -> `name`. */
    function packageOf(specifier: string): string {
      const parts = specifier.split('/');
      return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? specifier);
    }

    /**
     * The specifiers this file imports for types only, and never for a value.
     *
     * "Never" is what makes it safe to subtract: one `import type { A } from 'x'`
     * beside one `import { b } from 'x'` leaves `x` present at runtime, so the
     * package counts as a value import and stays under the rule. Both the
     * declaration form (`import type … from`) and the per-specifier form
     * (`import { type A } from`) are type-only; a declaration with no clause at
     * all — `import 'x'` for its side effects — is emphatically a value import.
     */
    function typeOnlySpecifiers(text: string, file: string): ReadonlySet<string> {
      const source = ts.createSourceFile(
        file,
        text,
        ts.ScriptTarget.Latest,
        // Parent pointers are not needed and cost time on every file in the tree.
        false,
        file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
      );

      const seen = new Map<string, boolean>();

      const record = (specifier: string, typeOnly: boolean): void => {
        seen.set(specifier, (seen.get(specifier) ?? true) && typeOnly);
      };

      for (const statement of source.statements) {
        if (ts.isImportDeclaration(statement)) {
          if (!ts.isStringLiteral(statement.moduleSpecifier)) {
            continue;
          }
          const clause = statement.importClause;
          const typeOnly =
            clause !== undefined &&
            (clause.isTypeOnly ||
              (clause.name === undefined &&
                clause.namedBindings !== undefined &&
                ts.isNamedImports(clause.namedBindings) &&
                clause.namedBindings.elements.every((element) => element.isTypeOnly)));
          record(statement.moduleSpecifier.text, typeOnly);
          continue;
        }
        if (
          ts.isExportDeclaration(statement) &&
          statement.moduleSpecifier !== undefined &&
          ts.isStringLiteral(statement.moduleSpecifier)
        ) {
          record(statement.moduleSpecifier.text, statement.isTypeOnly);
        }
      }

      return new Set([...seen].filter(([, typeOnly]) => typeOnly).map(([specifier]) => specifier));
    }

    const skipped = new Set(['node_modules', 'dist', 'build', 'artifacts']);

    function sourceFiles(directory: string, found: string[] = []): string[] {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (!skipped.has(entry.name)) {
            sourceFiles(join(directory, entry.name), found);
          }
          continue;
        }
        if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
          found.push(join(directory, entry.name));
        }
      }
      return found;
    }

    const violations: string[] = [];

    for (const member of members) {
      if (!shipping.test(member.directory)) {
        continue;
      }

      const runtime = new Set(Object.keys(member.manifest.dependencies ?? {}));
      const directory = join(repoRoot, ...member.directory.split('/'));

      for (const file of sourceFiles(directory)) {
        const relativePath = relative(repoRoot, file).split(sep).join(posix.sep);
        if (testFile.test(relativePath) || buildConfig.test(relativePath)) {
          continue;
        }

        // TypeScript's own scanner rather than a regular expression over the
        // text: it sees `import`, `import type`, `export … from`, `require`
        // and dynamic `import()` alike, and it does not see any of them inside
        // a comment or a string literal.
        const text = readTextFile(file);
        const scanned = ts.preProcessFile(text, true, true);
        // `dependencyTypesNot: ['type-only']`, which `not-to-dev-dep` has and
        // the first version of this check silently dropped — a behaviour change
        // nobody decided, found in review. A type-only import is erased by the
        // compiler and cannot be present at runtime, so it is not what either
        // statement of this property is about. `preProcessFile` does not
        // distinguish the two, so they are collected separately and subtracted.
        const erased = typeOnlySpecifiers(text, file);

        for (const { fileName: specifier } of scanned.importedFiles) {
          if (specifier.startsWith('.') || specifier.startsWith('node:')) {
            continue;
          }
          if (erased.has(specifier)) {
            continue;
          }
          const name = packageOf(specifier);
          // Electron is the one honest exception and it is the same one
          // `.dependency-cruiser.cjs` writes down: the host imports it, the
          // runtime provides it, and it is never installed beside the packaged
          // application — which is precisely why it is a devDependency.
          if (name === 'electron') {
            continue;
          }
          if (!runtime.has(name)) {
            violations.push(`${relativePath} imports ${name}, which ${member.directory} does not`);
          }
        }
      }
    }

    expect(
      [...new Set(violations)].sort(),
      'shipping code may import only what its own manifest lists under `dependencies`'
    ).toEqual([]);
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

describe('the boundary rules that must exist', () => {
  /**
   * A `dependency-cruiser` rule is only load-bearing while it is in the file, and
   * deleting one leaves the gate reporting `0 violations` over a graph that has stopped
   * being checked. External review named this in Task 12: every mutant the segment ran
   * distorted what a rule measured, and none removed a rule outright, so "0 violations"
   * proved nothing about the rules being there.
   *
   * The list is the direction `ADR-010` fixes, one entry per rule that states a piece of
   * it. Adding a rule does not require touching this list; removing or renaming one
   * does, which is the whole point — it becomes a deliberate edit rather than a
   * disappearance nothing reports.
   */
  const REQUIRED_RULES = [
    'no-circular',
    'no-orphans',
    'no-unresolvable',
    'renderer-must-not-import-the-host',
    'host-must-not-import-the-renderer',
    'simulation-depends-on-nothing',
    'content-core-imports-only-simulation-and-zod',
    'content-browser-entry-reaches-no-node-builtin',
    'content-node-adapter-imports-only-its-package-and-node',
    'presentation-depends-only-on-simulation',
    'application-imports-only-the-three-layers-below-it',
    'desktop-host-imports-only-its-own-package-node-and-electron',
    // Paired with "nothing that ships imports a package its member does not
    // depend on at runtime" below, and neither is a duplicate of the other:
    // the rule catches a devDependency the member itself declares, the check
    // catches one declared only by the root and one whose edge dependency-cruiser
    // never puts in the graph. Measured, both directions — see that test's
    // comment. Deleting either as redundant loses half the property.
    'not-to-dev-dep'
  ] as const;

  const configuration = createRequire(import.meta.url)(
    join(repoRoot, '.dependency-cruiser.cjs')
  ) as { forbidden?: readonly { name?: string; severity?: string }[] };

  const declared = configuration.forbidden ?? [];

  it('are all declared', () => {
    const names = declared.map((rule) => rule.name);

    for (const required of REQUIRED_RULES) {
      expect(names, `${required} is no longer declared in .dependency-cruiser.cjs`).toContain(
        required
      );
    }
  });

  it('are all errors, not warnings', () => {
    // A rule downgraded to `warn` keeps the gate green while announcing the violation,
    // and a warning that appears often enough is a rule that has stopped mattering.
    for (const rule of declared) {
      expect(rule.severity, `${rule.name ?? '(unnamed)'} must be an error`).toBe('error');
    }
  });
});

describe('the checks that have nowhere else to live', () => {
  /**
   * A test file is a gate too, and deleting one is invisible: the suite simply collects
   * fewer files and passes. That is tolerable for a test whose property is asserted
   * elsewhere as well, and not tolerable for the few that are the only statement of
   * something.
   *
   * Short on purpose. This is not an index of the suite — it is the list of files whose
   * absence would leave a stated property with nothing behind it, and each entry says
   * which property.
   */
  const REQUIRED_CHECKS: readonly { path: string; property: string }[] = [
    {
      path: 'packages/content/src/source-agreement.test.ts',
      property:
        'the shipped tree digests to the same content_version through the Node source and through an in-memory one'
    },
    {
      path: 'packages/content/src/file-size-ceiling.test.ts',
      property: 'both guards on MAX_FILE_SIZE_BYTES are reached and word their refusal identically'
    },
    {
      path: 'tests/locale/catalogue.test.ts',
      property:
        'the two shipped catalogues answer every key the presentation and application layers can produce, each in exactly one of them, and content/locale/ru.json has not grown — which needs both sides of a boundary neither side may cross (ADR-012)'
    }
  ];

  it('are still in the tree', () => {
    for (const check of REQUIRED_CHECKS) {
      expect(
        existsSync(join(repoRoot, ...check.path.split('/'))),
        `${check.path} is gone, and with it the only check that ${check.property}`
      ).toBe(true);
    }
  });
});

describe('dependency pins', () => {
  const exactVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

  it('every dependency of every member is pinned to an exact version', () => {
    const loose: string[] = [];

    for (const member of [{ directory: '.', manifest: rootManifest }, ...members]) {
      for (const { section, name, range } of declaredDependencies(member.manifest)) {
        // Workspace-internal links are versionless by construction; pinning
        // them would mean bumping a number in two files on every change.
        if (range.startsWith('workspace:')) {
          continue;
        }
        if (!exactVersion.test(range)) {
          loose.push(`${member.directory} (${section}): ${name}@${range}`);
        }
      }
    }

    expect(loose, 'ADR-010 §123: direct dependencies are pinned exactly').toEqual([]);
  });

  it('a dependency has one version across the whole workspace', () => {
    const versions = new Map<string, Map<string, string[]>>();

    for (const member of [{ directory: '.', manifest: rootManifest }, ...members]) {
      for (const { name, range } of declaredDependencies(member.manifest)) {
        if (range.startsWith('workspace:')) {
          continue;
        }
        const byVersion = versions.get(name) ?? new Map<string, string[]>();
        byVersion.set(range, [...(byVersion.get(range) ?? []), member.directory]);
        versions.set(name, byVersion);
      }
    }

    // Two members on two versions of the same tool is how a workspace ends up
    // with tests passing under one TypeScript and CI failing under another.
    const disagreements = [...versions]
      .filter(([, byVersion]) => byVersion.size > 1)
      .map(([dependency, byVersion]) => `${dependency}: ${JSON.stringify([...byVersion])}`);

    expect(disagreements).toEqual([]);
  });

  it('no storefront SDK is a dependency of anything', () => {
    // ADR-011: storefront delivery is outside the migration's scope, and its
    // verification asks for exactly this — "в дереве нет ни одной зависимости
    // от `steamworks.js` или другого SDK площадки". Stated as a test because
    // the way such a dependency arrives is somebody adding it to make one
    // feature work, not somebody deciding to release on a storefront.
    const storefrontish = /steam|galaxy-sdk|epic|eos-sdk|itch/i;
    const found: string[] = [];

    for (const member of [{ directory: '.', manifest: rootManifest }, ...members]) {
      for (const { section, name } of declaredDependencies(member.manifest)) {
        if (storefrontish.test(name)) {
          found.push(`${member.directory} (${section}): ${name}`);
        }
      }
    }

    expect(found, 'a storefront SDK needs a decision, not an install').toEqual([]);
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
