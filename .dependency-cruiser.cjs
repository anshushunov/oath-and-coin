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
      // No exemption for test files, and the one that was briefly here is gone
      // because it was never needed. It was added on the assumption that a test
      // importing `vitest` would violate this rule; measured, it does not —
      // dependency-cruiser does not report `vitest` as a dependency of any test
      // file in this workspace, while it does report `node:fs` and `node:path`.
      // So the rule is absolute again and now also bites inside a `*.test.ts`,
      // which is strictly what ADR-010 asks for.
      //
      // The residual blind spot is worth naming rather than relying on: since
      // `vitest` is invisible here, this gate cannot be assumed to see every npm
      // import. What ADR-010 bans and this rule provably cannot see — the clock,
      // global randomness and a dynamic import with a computed specifier — is
      // covered by scoped ESLint rules instead (`eslint.config.js`), each with
      // its own mutant.
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
      name: 'content-core-imports-only-simulation-and-zod',
      severity: 'error',
      comment:
        'ADR-010 direction simulation ← content, and ADR-010 §59 direction content ← application ← apps/web: the content package is inside the browser bundle, so the half of it outside `src/node/` may not name a Node built-in. Vite fails the build on `node:fs`, and that failure would arrive on the first line of the screen that shows real content rather than on a gate.',
      // Written as one negation — everything whose resolved path is outside the
      // three allowed roots — rather than as a list of forbidden neighbours. The
      // list version is the defect external review found twice
      // (`simulation-depends-on-nothing` in segment 2 §5.6,
      // `presentation-depends-only-on-simulation` in segment 4 §11.2): it named
      // the sibling packages, so `import { readFileSync } from "node:fs"` passed
      // the only authoritative boundary check with `0 violations`. This rule was
      // the third copy of that shape and §12.6 addressed Task 12 to fix it; a rule
      // that enumerates what is banned misses whatever is invented next.
      //
      // `zod` is in the allowed set because the contracts are Zod contracts and the
      // browser validates content with them — which is the whole reason the loader
      // moved rather than being replaced by a build-time snapshot (§12.2).
      //
      // Test files are outside this rule's `from`, and that exemption is not "tests
      // are trusted". A test is not reachable from the package's browser entry, so
      // it cannot put anything into a bundle; what is reachable from that entry is
      // stated as its own rule below, and that one has no exemption at all. The
      // fixtures here build content trees on a real disk on purpose (§12.2: "тестовый
      // член вправе оставаться node-овым").
      from: {
        path: '^packages/content/src/',
        pathNot: '^packages/content/src/node/|[.]test[.]ts$'
      },
      to: {
        pathNot: '^packages/simulation/|^packages/content/src/(?!node/)|/node_modules/zod/'
      }
    },
    {
      name: 'content-browser-entry-reaches-no-node-builtin',
      severity: 'error',
      comment:
        'What `apps/web` actually bundles is whatever is reachable from `@oath-and-coin/content`, and that graph must hold no Node built-in. Stated over reachability rather than over one directory because that is the property: the rule above can be satisfied by a file that imports another file that imports `node:fs`, and this one cannot.',
      from: { path: '^packages/content/src/index[.]ts$' },
      // Everything reachable from the browser entry has to be a file in this
      // workspace or a package installed beside it. A Node built-in resolves to a
      // bare `fs` or `path`, which is neither.
      to: { pathNot: '^(apps|packages|tests|tools|scripts)/|/node_modules/', reachable: true }
    },
    {
      name: 'content-node-adapter-imports-only-its-package-and-node',
      severity: 'error',
      comment:
        'The other half of the split: `packages/content/src/node/` is the one place in this package allowed to name `node:*`, and it is allowed nothing else beyond its own package, the simulation and zod. It exists to answer "where do the bytes come from" and nothing more — an adapter that reached into `apps` or `tools` would have made the layering circular.',
      from: { path: '^packages/content/src/node/' },
      to: {
        pathNot: '^packages/simulation/|^packages/content/src/|/node_modules/zod/',
        dependencyTypesNot: ['core']
      }
    },
    {
      name: 'presentation-depends-only-on-simulation',
      severity: 'error',
      comment:
        'ADR-010 direction: simulation ← presentation. The layer projects a decision onto a screen; it opens no file, reads no clock and pulls in no npm package, so the only imports it may resolve are inside itself and inside the simulation.',
      // Written as one negation — everything whose resolved path is outside the two
      // allowed roots — rather than as a list of forbidden neighbours. The list
      // version is exactly the defect external review found in
      // `simulation-depends-on-nothing` in segment 2 (§5.6): it named the sibling
      // packages, so `import { readFileSync } from "node:fs"` passed the only
      // authoritative boundary check with `0 violations`. This rule was written in the
      // list shape anyway when the package arrived in Task 11, and the second external
      // review reproduced the same hole in it. A rule that enumerates what is banned
      // misses whatever is invented next.
      //
      // The residual blind spot named on `simulation-depends-on-nothing` applies here
      // too: dependency-cruiser does not report `vitest` as a dependency of a test
      // file in this workspace, so this gate cannot be assumed to see every npm
      // import. It provably does see `node:*` and cross-package imports, which is what
      // the two mutants recorded in the journal exercise.
      from: { path: '^packages/presentation/' },
      to: { pathNot: '^packages/(presentation|simulation)/' }
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
      // Without this the resolver ignores every `exports` map and falls back to
      // `main`, so `@oath-and-coin/content` resolves and `@oath-and-coin/content/node`
      // — the entry Task 12 added for the filesystem half of the loader — comes back
      // as `no-unresolvable`. Node itself resolves both; the gate has to see what Node
      // sees, or it reports a broken import where there is none and teaches everyone
      // to ignore the rule.
      exportsFields: ['exports'],
      mainFields: ['module', 'main', 'types']
    },
    reporterOptions: {
      text: { highlightFocused: true }
    }
  }
};
