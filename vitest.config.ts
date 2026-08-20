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
    // The tempting cure is `testTimeout`, and it was forbidden until the message
    // existed (AGENTS.md §8). If the cause is not a timeout, raising one hides a
    // live defect behind a green gate — which is the one outcome worse than the
    // flake.
    //
    // The message now exists (below) and the cause **is** the timeout: the two
    // full-corpus tests run at 2.0–4.3 s against a 5000 ms default even on green
    // runs — one green run measured 4339 ms, 661 ms of margin — and cross it when
    // transform and import go slow. Still not raised here, and deliberately: the
    // ruling that parked this was taken above this task, the evidence that
    // discharges it is three days newer than the ruling, and a branch that cannot
    // be pushed cannot show the new setting behaving on a cold runner. The
    // measurement is handed up with a recommendation instead of a setting nobody
    // watched work.
    //
    // So: the *next* red writes itself down, wherever it happens. `json`
    // carries each failure's own message and stack; the console log the CI step
    // tees beside it carries what the json reporter cannot — a worker that
    // exited, an unhandled rejection outside any test, and the transform and
    // import timings that were the only thing the two observations had in
    // common.
    //
    // **It caught it, and neither half would have been enough.** The red
    // appeared during Task 18's own review round and both files were kept:
    //
    //   tests/oracle/parity.test.ts  … reproduces all 54 …          duration 5101 ms
    //   tools/scenario-runner/src/cli.test.ts … 54 of 54 …          duration 9094 ms
    //   Duration 22.79s (transform 73.42s, import 116.57s, tests 66.76s)
    //   console: "Error: Test timed out in 5000ms."
    //
    // In the json report the `failureMessages` of a timed-out test is the literal
    // string `STACK_TRACE_ERROR` and nothing else — the reporter does not carry
    // that text. What names the cause there is `duration`, sitting just past the
    // 5000 ms default. The sentence itself only exists in the teed console log.
    // So: read `duration` in the json, read the message in the log, and do not
    // expect either to be sufficient on its own.
    //
    // Both are uploaded by the release gate with `if: always()`, and the
    // `checks` job uploads this file on its own — `pnpm test` runs there too, on
    // every push, which is where a cold red is most likely to appear first.
    //
    // One fixed filename, and what that is and is not worth:
    //
    // - Inside `pnpm verify` it is exactly right. The chain runs `test` and then
    //   `test:scenario` joined by `&&`, so the second starts only if the first
    //   passed, and the file left behind by a failed chain is the failing run's.
    // - Between separate invocations it is not. An ad-hoc `vitest run <file>`
    //   after a failed `pnpm test` overwrites the report of the run worth
    //   keeping, and nothing warns. On CI that cannot happen — each job runs one
    //   chain and uploads before anything else runs — but on a workstation the
    //   first thing an investigator does is re-run a subset, and that is the
    //   moment the evidence is lost. Copy the file before narrowing the run.
    // - After a *green* chain it describes `test:scenario` alone — 149 tests on
    //   the first CI run, not the 1151 of the full suite. A record of the last
    //   run, not a total, and the job summary says so.
    reporters: ['default', 'json'],
    outputFile: { json: 'artifacts/vitest/results.json' }
  }
});
