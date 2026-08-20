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
    // The message now exists (below) and the cause **is** the timeout, so the
    // condition the ruling attached to it is discharged and `testTimeout` is set.
    // What follows is the derivation, because a number without one does not live
    // in this repository.
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
    outputFile: { json: 'artifacts/vitest/results.json' },

    // 30 seconds, and here is where the number comes from.
    //
    // What is being covered: the heaviest tests in this suite replay the frozen
    // corpus — 54 records, 27 checkpoints — and they do real work rather than
    // waiting on anything. Measured cost of the heaviest one:
    //
    //   warm, quiet machine     593–1299 ms   (Task 16.3, nine runs)
    //   green but loaded        2011–4339 ms  (Task 18, three runs)
    //   over the 5000 ms limit  5055–9094 ms  (Task 18, three runs, six tests)
    //
    // The multiplier, not guessed: the same machine's `transform` phase moved
    // between 3.13 s on a warm run and 73.42 s on the run that failed, a factor
    // of about 20. Applied to the heaviest warm measurement — 1.3 s × 20 ≈ 26 s —
    // and rounded up to 30 s. It is also 3.3× the worst duration ever observed
    // here (9094 ms), so the envelope has room without being open-ended.
    //
    // Why the default was wrong rather than the tests being slow: at 5000 ms the
    // margin on a *green* run was measured at 661 ms. A limit a passing run
    // clears by 13 % is not a liveness guard, it is a coin toss, and it produced
    // exactly the symptom — one test of 866, twice, message lost.
    //
    // What it costs, stated plainly: a test that genuinely hangs is now reported
    // after 30 s instead of 5. That is the whole price, it is paid only on
    // failure, and it buys a gate whose red means something.
    //
    // What this does NOT do — and it is the reason the setting was forbidden
    // until the message existed — is make anything green that was failing for
    // another reason. An assertion that fails still fails at the moment it fails;
    // a test that hangs past 30 s still goes red, with the same sentence and a
    // bigger number. Both were run as mutants after this was committed.
    //
    // `hookTimeout` is deliberately NOT raised alongside it. The default is
    // 10000 ms and the same 20× argument would apply to a slow `beforeAll` — but
    // no hook has ever been observed timing out here, and a second number chosen
    // by analogy rather than by measurement is the invented threshold this
    // repository refuses elsewhere. It waits for its own observation.
    testTimeout: 30_000
  }
});
