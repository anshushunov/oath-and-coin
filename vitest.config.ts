import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // One pattern over the whole tree rather than a list of projects that has
    // to be extended by hand. A package added in Tasks 6-12 is inside the
    // gate the moment it has a test file; a list would have let it be added
    // with tests that never run, and a suite that never runs is green.
    //
    // `.tsx` as well as `.ts`, and that is not symmetry for its own sake: the
    // React tests of Task 13 will be `.tsx` by nature, and with a `.ts`-only
    // pattern a failing `.test.tsx` is not collected at all — the run still
    // reports "12 passed" and the pipeline stays green over UI tests that
    // never executed. Found by external review, which put a deliberately
    // failing `.test.tsx` in the tree and watched the suite pass.
    include: ['{apps,packages,tests,tools}/**/*.test.{ts,tsx}'],

    // Node is the honest default: the simulation, content and application
    // packages must not touch the DOM at all (ADR-010), so a global jsdom
    // would hand them a `document` the real runtime never gives them. Tests
    // that need a DOM ask for it per file with `@vitest-environment jsdom`.
    environment: 'node',

    // The default reporter prints nothing about a run that collected no test
    // files, and "0 tests passed" is not a passing gate.
    passWithNoTests: false,

    // Every run leaves a machine-readable record of itself, and this is here
    // for one specific unsolved thing.
    //
    // Task 16.3 saw a red twice on a cold machine — `content` 1 failed of 207
    // at transform 49.2 s, then the whole workspace 1 failed of 866 at
    // transform 68.9 s — and **the message was not captured either time**. Nine
    // later runs, warm and cache-cleared alike, were green, so there is nothing
    // to reproduce and nothing to diagnose: an intermittent failure whose text
    // nobody has is indistinguishable from a slow test, a worker that died, and
    // a real defect that appears once a day.
    //
    // The tempting cure is `testTimeout`, and it is forbidden until the message
    // exists (AGENTS.md §8). If the cause is not a timeout, raising one hides a
    // live defect behind a green gate — which is the one outcome worse than the
    // flake.
    //
    // So: the *next* red writes itself down, wherever it happens. `json`
    // carries each failure's own message and stack; the console log the CI step
    // tees beside it carries what the json reporter cannot — a worker that
    // exited, an unhandled rejection outside any test, and the transform and
    // import timings that were the only thing the two observations had in
    // common. Both are uploaded by the release gate with `if: always()`.
    //
    // One fixed filename, deliberately. `pnpm verify` chains `test` and
    // `test:scenario` with `&&`, so the second only runs when the first passed:
    // the file that survives a failed run is always the failing one's.
    //
    // The price, stated because it is easy to misread: after a *green* chain the
    // file describes `test:scenario` alone — 149 tests on the first CI run, not
    // the 1151 of the full suite. It is a record of the last run, not a total,
    // and the job summary says so.
    reporters: ['default', 'json'],
    outputFile: { json: 'artifacts/vitest/results.json' }
  }
});
