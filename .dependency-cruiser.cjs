'use strict';

/**
 * The authoritative check on dependency direction (ADR-010 §63: "dependency-
 * cruiser — единственная авторитетная механическая проверка направления
 * зависимостей и отсутствия циклов. Второй boundary-линтер не вводится").
 *
 * The direction the record fixes:
 *
 *   simulation ← content ← application ← apps/web
 *   simulation ← presentation ← application
 *   apps/desktop talks to the application only through DesktopApi
 *
 * Some of the packages named there do not exist yet — they arrive with Tasks
 * 6-12. Their rules are written now anyway, and that is a deliberate choice
 * with a cost: a rule over a directory with no files in it cannot go red, so
 * until those packages exist these entries are documentation that happens to
 * be executable. They are here so the boundary is in place on the day the
 * first file lands, rather than being invented by whoever writes it.
 *
 * The rules that do have code under them today — no cycles, the two apps not
 * importing each other, no reaching into a package's internals — are proven by
 * mutants recorded in the migration journal.
 */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment:
        'A cycle makes "which of these two modules is the contract" unanswerable, and it is the failure that turns a small refactor into a rewrite.',
      from: {},
      to: { circular: true }
    },
    {
      name: 'no-orphans',
      severity: 'error',
      comment:
        'A module nothing imports is either dead or was meant to be wired up and was not. Config files and type declarations are exempt because nothing imports those by design.',
      from: {
        orphan: true,
        pathNot: [
          '[.]d[.]ts$',
          '(^|/)[.][^/]+[.](cjs|mjs|js|ts)$',
          '(^|/)(vite|vitest|playwright)[.][^/]*config[.]ts$',
          '(^|/)tests/(e2e|desktop)/',
          '(^|/)apps/web/src/main[.]tsx$',
          '(^|/)apps/desktop/src/(main|preload)[.]ts$'
        ]
      },
      to: {}
    },
    {
      name: 'no-unresolvable',
      severity: 'error',
      comment:
        'An import the resolver cannot follow is a runtime failure that typechecking can miss when a path is only reachable at runtime.',
      from: {},
      to: { couldNotResolve: true }
    },
    {
      name: 'renderer-must-not-import-the-host',
      severity: 'error',
      comment:
        'ADR-010: the browser build is the game and must run unchanged in a plain Chromium. An import from apps/web into apps/desktop pulls Electron into the browser bundle, and the failure appears only when the page is opened outside Electron.',
      from: { path: '^apps/web/' },
      to: { path: '^apps/desktop/' }
    },
    {
      name: 'host-must-not-import-the-renderer',
      severity: 'error',
      comment:
        'The host loads the renderer as a file, not as a module. Importing it would put React and the DOM into the main process, where neither exists.',
      from: { path: '^apps/desktop/' },
      to: { path: '^apps/web/' }
    },
    {
      name: 'simulation-depends-on-nothing',
      severity: 'error',
      comment:
        'ADR-010: the simulation must not know about the DOM, React, PixiJS, Electron, the filesystem, the clock or global randomness. It is a pure library, so it imports nothing outside itself — not another workspace package, not an npm package, not a Node built-in.',
      from: { path: '^packages/simulation/' },
      // Everything whose resolved path is not inside the package. Written as
      // one negation rather than as a list of forbidden layers, because the
      // list version was the whole defect external review found: it named the
      // sibling packages and said "no runtime package" in its comment, so
      // `import { readFileSync } from "node:fs"` inside the pure core passed
      // the only authoritative boundary check with `0 violations`. A rule that
      // enumerates what is banned is a rule that misses whatever is invented
      // next; this one enumerates the single thing that is allowed.
      to: { pathNot: '^packages/simulation/' }
    },
    {
      name: 'content-depends-only-on-simulation',
      severity: 'error',
      comment: 'ADR-010 direction: simulation ← content.',
      from: { path: '^packages/content/' },
      to: { path: '^(packages/(presentation|application)|apps|tools)/' }
    },
    {
      name: 'presentation-depends-only-on-simulation',
      severity: 'error',
      comment: 'ADR-010 direction: simulation ← presentation.',
      from: { path: '^packages/presentation/' },
      to: { path: '^(packages/(content|application)|apps|tools)/' }
    },
    {
      name: 'application-does-not-depend-on-apps',
      severity: 'error',
      comment:
        'The application layer is consumed by apps/web; an import the other way makes the layer a part of the UI it was extracted from.',
      from: { path: '^packages/application/' },
      to: { path: '^(apps|tools)/' }
    },
    {
      name: 'not-to-dev-dep',
      severity: 'error',
      comment:
        'Shipping code importing a devDependency works locally and fails in the packaged build, where devDependencies are not there.',
      from: { path: '^(apps|packages|tools)/', pathNot: '[.](test|spec)[.]tsx?$' },
      to: {
        dependencyTypes: ['npm-dev'],
        dependencyTypesNot: ['type-only'],
        // Electron is the one honest exception: the main process imports it,
        // and the runtime provides it — it is never installed beside the
        // packaged application, which is exactly why it is a devDependency.
        pathNot: '(^|/)node_modules/electron/'
      }
    }
  ],

  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: {
      path: [
        '(^|/)(dist|artifacts)/',
        // Build configuration, excluded rather than exempted from one rule.
        // dependency-cruiser's resolver cannot follow Vite's ESM-only
        // `exports` map — `import { defineConfig } from "vite"` comes back
        // unresolvable while every application import in the same tree
        // resolves — so keeping these files in scope would mean either a
        // permanently red gate or a `no-unresolvable` rule downgraded to a
        // warning, and a warning is a rule that has stopped mattering. These
        // files are typechecked by `tsc --build` like everything else.
        '(^|/)vite[.][^/]*[.]ts$',
        '(^|/)(vitest|playwright)[.][^/]*config[.]ts$'
      ].join('|')
    },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      // Without the extensions the resolver treats every `.tsx` import as
      // unresolvable and `no-unresolvable` reports the whole application.
      extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'],
      // Vite and its plugins are ESM-only and describe themselves through
      // `exports`. Without the conditions the resolver looks for a `main` that
      // is not there and reports the build configs as importing packages that
      // do not exist — a false failure that would teach everyone to ignore
      // this rule.
      conditionNames: ['import', 'require', 'node', 'types', 'default'],
      mainFields: ['module', 'main', 'types']
    },
    reporterOptions: {
      text: { highlightFocused: true }
    }
  }
};
