import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

/**
 * The release gate, held to its own composition.
 *
 * Task 18's gate was three commands — `pnpm verify`, the runtime dependency
 * audit, and the .NET test run; Task 19 deleted the stack the third one tested,
 * so it is two. Its whole value is that both are in one place. That is also its
 * whole failure mode: a step deleted from a
 * workflow leaves the job green over what remains, and the diff that removed it
 * is a diff nobody reads twice. `AGENTS.md` §8 names this exactly — "иначе в
 * pipeline попадает стадия, которая никогда не краснела" — and the same
 * argument already produced `REQUIRED_RULES` and `REQUIRED_CHECKS` in
 * `workspace.test.ts`. This is the third instance of that shape and the reason
 * is unchanged: a disappearance nothing reports.
 *
 * Two properties, and the second is not decoration:
 *
 * 1. Every command the gate is composed of is run by the job, and `pnpm verify`
 *    still names every stage it is supposed to chain.
 * 2. The packaged desktop gate is **not** in that job. Measured in Task 18: of
 *    four concurrent `pnpm test:desktop` runs on one workstation exactly one
 *    passed, because its read-only launch takes the machine's real user data
 *    directory and Electron's single-instance lock is per directory. Putting it
 *    beside anything that can run at the same time buys a red that reads as a
 *    defect in the packaged build. Keeping the two apart is a decision, so it
 *    is stated where undoing it fails rather than in a comment.
 */

const repoRoot = resolve(import.meta.dirname, '..', '..');

interface Step {
  readonly name?: string;
  readonly id?: string;
  readonly run?: string;
  readonly uses?: string;
  readonly shell?: string;
  readonly if?: string;
  readonly with?: {
    readonly path?: string;
    readonly name?: string;
    readonly 'if-no-files-found'?: string;
  };
}

interface Workflow {
  readonly jobs?: Readonly<Record<string, { readonly steps?: readonly Step[] }>>;
}

const workflow = parseYaml(
  readFileSync(join(repoRoot, '.github', 'workflows', 'typescript.yml'), 'utf8')
) as Workflow;

const rootManifest = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
  scripts?: Readonly<Record<string, string>>;
};

/**
 * The commands the gate before a merge is composed of, each with what its absence
 * would cost. Spelled as the exact text the workflow runs, so that renaming a script
 * without touching the workflow fails here instead of in CI.
 *
 * Declared at the top rather than inside the first `describe` that needed it, because
 * two of them ask about this list now: the `release-gate` job has to run all of them,
 * and the root manifest's note beside `verify` has to name all of them. `verify` was
 * described as "the whole of the local gate" in both places, which told the next person
 * to run one command out of three before merging.
 *
 * It was three until cutover. `dotnet test OathAndCoin.sln -c Release` is gone with the
 * stack it tested (Task 19), and it is named here rather than silently dropped: a list
 * that shrinks is exactly the disappearance this file exists to notice, so the shrink
 * has to be a decision somebody wrote down.
 */
const REQUIRED_COMMANDS: readonly { command: string; verdict: string }[] = [
  {
    command: 'pnpm verify',
    verdict: 'the TypeScript stack typechecks, lints, tests, builds and renders'
  },
  {
    command: 'node scripts/audit-runtime-dependencies.mjs',
    verdict: 'nothing unreviewed reaches a player at runtime'
  }
];

/**
 * What the gate must **not** run, and why each entry is here.
 *
 * The list above says what a shrinking gate loses; this one says what a growing one
 * must never regain. `dotnet test` is on it because the tree it tested no longer
 * exists: a workflow that still invoked it would fail on every push with a message
 * about a missing solution file, and the repository would learn about the cutover from
 * a red pipeline rather than from this file.
 */
const FORBIDDEN_COMMANDS: readonly { command: string; reason: string }[] = [
  {
    command: 'dotnet',
    reason: 'the Godot/.NET tree was deleted at cutover (Task 19); there is nothing to test'
  }
];

const JOB_NAME = 'release-gate';

const job = workflow.jobs?.[JOB_NAME];
const commands = (job?.steps ?? []).map((step) => step.run ?? '').join('\n');

describe('the release gate is one job with independent verdicts', () => {
  it('exists in the TypeScript workflow', () => {
    expect(
      job,
      `.github/workflows/typescript.yml has no job named ${JOB_NAME}; the three gate commands are then run by nobody together`
    ).toBeDefined();
  });

  it('runs every one of them', () => {
    for (const { command, verdict } of REQUIRED_COMMANDS) {
      // Bounded on both sides rather than as a bare substring. A step runs
      // `pnpm verify 2>&1 | tee …`, so an exact match is impossible, but an
      // unbounded `toContain` would also accept a hypothetical `pnpm verify:fast`
      // — the same mistake this file made about `pnpm test` and `pnpm test:scenario`
      // and that review measured (see the stage list below).
      const word = new RegExp(
        `(^|\\s)${command.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}(\\s|$)`,
        'mu'
      );
      expect(
        commands,
        `${JOB_NAME} no longer runs \`${command}\`, so nothing answers whether ${verdict}`
      ).toMatch(word);
    }
  });

  it.each(FORBIDDEN_COMMANDS)('does not run `$command`', ({ command, reason }) => {
    expect(commands, `${JOB_NAME} runs \`${command}\`, and ${reason}`).not.toContain(command);
  });

  it('does not run the packaged desktop gate beside them', () => {
    // Not tidiness. `pnpm test:desktop` launches the shipped application
    // against the machine's own user data directory for its read-only check,
    // which makes it a singleton on that machine: four concurrent runs, one
    // pass, three deaths on `electron.launch`. It has its own job on its own
    // runner and that is where it stays.
    expect(
      commands,
      `${JOB_NAME} runs the packaged desktop gate; it is a machine-wide singleton and belongs to the packaged-desktop job`
    ).not.toContain('test:desktop');
  });

  /**
   * The verdicts, held to being independent of each other.
   *
   * The job's own comment has always called them independent — "different verdicts",
   * "merging them into one shell line would report both as the first one that
   * failed" — and external review of segment 5 measured that the mechanism did
   * exactly what the comment forbade. GitHub runs steps fail-fast unless a step says
   * otherwise, so a red `pnpm verify` skipped the audit and the .NET run and the job
   * reported one verdict out of three. The check above sees that the commands are
   * *present*, which is a different claim and was the only one anybody was making.
   *
   * **`verify` joined this list last.** Two earlier editions of this comment excluded
   * it, and both were wrong. The first said "it is first, so nothing before it can have
   * failed" — wrong on the facts: six steps run before it. The second said the only thing
   * that could silence it was setup, which was true and left the mechanism unstated:
   * `Install the browser` carried neither an id nor a condition, so a failed download
   * silently carried off the `verify` verdict through the very fail-fast default this
   * block exists to remove. Right behaviour, no mechanism — the same gap the finding
   * itself was about, one step to the left.
   *
   * Each verdict names the *setup* it needs and nothing else, and the asymmetry is the
   * content rather than an accident: `verify` ends in `pnpm test:e2e` and legitimately
   * cannot answer without a browser, while `audit` opens none and must still answer on a
   * run where the download failed. {@link SETUP_A_VERDICT_NEEDS} states which is which,
   * and the second half of the check below is what stops the browser guard being copied
   * onto both "for symmetry", which would silence a verdict that had no reason to be
   * silenced.
   */
  const INDEPENDENT_VERDICTS = ['verify', 'audit'] as const;

  /**
   * The setup steps each verdict may depend on. A verdict must be guarded on every step
   * listed for it and on no other, because both directions are failures: an unnamed
   * dependency is a skip nobody decided, and an extra one is a verdict that stops being
   * taken for a reason that never applied to it.
   */
  const SETUP_A_VERDICT_NEEDS: Readonly<Record<string, readonly string[]>> = {
    verify: ['install', 'browser'],
    audit: ['install']
  };

  const EVERY_SETUP_STEP = ['install', 'browser'] as const;

  it.each(EVERY_SETUP_STEP)('gives the `%s` setup step an id to be depended on', (id) => {
    // A dependency that cannot be named cannot be stated, and an unnamed setup step is
    // exactly how `verify` came to be skipped by a mechanism nobody had written down.
    expect(
      (job?.steps ?? []).find((candidate) => candidate.id === id),
      `${JOB_NAME} has no step with id \`${id}\`, so no verdict can declare whether it needs it`
    ).toBeDefined();
  });

  it.each(INDEPENDENT_VERDICTS)('takes the `%s` verdict even after an earlier one failed', (id) => {
    const step = (job?.steps ?? []).find((candidate) => candidate.id === id);
    const condition = (step?.if ?? '').replace(/\s/gu, '');

    expect(step, `${JOB_NAME} has no step with id \`${id}\``).toBeDefined();

    // Without one of these, the step inherits GitHub's default — run only if
    // every previous step succeeded — and the verdict is not taken at all on the
    // run where the other two disagreed.
    expect(
      condition,
      `\`${id}\` runs under GitHub's fail-fast default, so a failed verdict before it means this one is never taken`
    ).toMatch(/!cancelled\(\)|always\(\)/u);

    // And it must not be conditional on another *verdict*. A reference to
    // `steps.verify.outcome` would restore the fail-fast the line above just removed,
    // in a form that reads as a deliberate dependency rather than as a default.
    for (const other of INDEPENDENT_VERDICTS.filter((name) => name !== id)) {
      expect(
        condition,
        `\`${id}\` is conditional on the \`${other}\` verdict, so the two are one verdict reported twice`
      ).not.toContain(`steps.${other}.`);
    }
  });

  it.each(INDEPENDENT_VERDICTS)('guards `%s` on the setup it needs, and on no other', (id) => {
    const step = (job?.steps ?? []).find((candidate) => candidate.id === id);
    const condition = (step?.if ?? '').replace(/\s/gu, '');
    const needed = SETUP_A_VERDICT_NEEDS[id] ?? [];

    for (const setup of needed) {
      expect(
        condition,
        `\`${id}\` does not say it needs the \`${setup}\` step, so a failure there skips this verdict by GitHub's default rather than by a decision`
      ).toContain(`steps.${setup}.`);
    }

    // The other direction, and it is the one worth a check. `audit` opens no browser,
    // so a failed download must not stop it from answering — that is what "independent
    // verdicts" buys on the run where Playwright's CDN is down. Copying `verify`'s
    // browser guard onto both "for symmetry" would take a verdict away for a reason
    // that never applied to it.
    for (const setup of EVERY_SETUP_STEP.filter((name) => !needed.includes(name))) {
      expect(
        condition,
        `\`${id}\` is conditional on the \`${setup}\` step, which it does not need; a failure there would silence a verdict that could still have answered`
      ).not.toContain(`steps.${setup}.`);
    }
  });

  it('publishes what it measured even when it failed', () => {
    // A gate that only uploads its evidence on success cannot explain the run
    // worth explaining. The intermittent red Task 16.3 saw twice and could not
    // name is the reason this is asserted rather than left to review.
    const upload = (job?.steps ?? []).find(
      (step) => step.uses?.startsWith('actions/upload-artifact') === true
    );

    expect(upload, `${JOB_NAME} uploads nothing`).toBeDefined();
    expect(upload?.if, 'the upload must not be conditional on the gate having passed').toContain(
      'always()'
    );
    for (const directory of ['artifacts/release-gate/', 'artifacts/vitest/']) {
      expect(
        upload?.with?.path ?? '',
        `${directory} is where the first unexplained red writes itself down`
      ).toContain(directory);
    }
  });
});

/**
 * The capture of an unexplained red, in every job that runs the suite.
 *
 * This exists because the mechanism was deleted and nothing noticed. Review
 * removed the `checks` upload step outright and the suite reported `26 passed`:
 * a mechanism whose whole purpose is to stop "a disappearance nothing reports"
 * was itself a disappearance nothing reported. The `release-gate` upload had an
 * assertion; its twin did not.
 *
 * Both halves are required of both jobs, and neither is sufficient alone:
 *
 * - the **json report** carries `duration` and a stack whose frames include the
 *   test's own file and line, but a timed-out test's `failureMessages` is
 *   `Error: STACK_TRACE_ERROR` plus that stack — the sentence is not in it, and
 *   for a timed-out *hook* the report carries nothing at all (`message: ""`,
 *   `failureMessages: []`, `duration: undefined`, the test merely `skipped`);
 * - the **teed console log** carries the sentence — "Test timed out in 30000ms",
 *   "Hook timed out in 10000ms" — and the transform/import timings that were the
 *   only thing the two lost observations of Task 16.3 had in common.
 */
describe('every job that runs the suite keeps the evidence of a red one', () => {
  const CAPTURE = [
    { job: 'checks', command: 'pnpm test', log: 'artifacts/checks/' },
    { job: 'release-gate', command: 'pnpm verify', log: 'artifacts/release-gate/' }
  ] as const;

  for (const { job: jobName, command, log } of CAPTURE) {
    const steps = workflow.jobs?.[jobName]?.steps ?? [];

    it(`${jobName} duplicates the console output of \`${command}\` into ${log}`, () => {
      const teeing = steps.find(
        (step) =>
          step.run !== undefined && step.run.includes(command) && step.run.includes(`tee ${log}`)
      );

      expect(
        teeing,
        `${jobName} runs \`${command}\` without teeing it into ${log}; a hook timeout there would be a red whose message exists nowhere`
      ).toBeDefined();

      // Without this the step runs under GitHub's default `bash -e {0}`, which
      // has no `pipefail`: the pipeline would report `tee`'s exit code and the
      // step would pass over a failing suite. A capture that silences the gate
      // it captures is worse than no capture.
      expect(
        teeing?.shell,
        `the teeing step in ${jobName} must declare \`shell: bash\` or the pipe swallows the exit code`
      ).toBe('bash');
    });

    it(`${jobName} uploads both halves unconditionally`, () => {
      const upload = steps.find(
        (step) =>
          step.uses?.startsWith('actions/upload-artifact') === true &&
          (step.with?.path ?? '').includes('artifacts/vitest/')
      );

      expect(
        upload,
        `${jobName} has no upload carrying artifacts/vitest/; the report of a failed run goes nowhere`
      ).toBeDefined();

      // A bare `always()`. Every other upload in this workflow is guarded on some
      // earlier step's outcome, and that is precisely how the `checks` job came to
      // drop this evidence: a red `pnpm test` never reaches `pnpm test:e2e`, so
      // `steps.e2e.outcome` is `skipped` and every upload gated on it is skipped
      // with it — on the one run worth keeping.
      expect(
        upload?.if?.replace(/\s/gu, ''),
        `the upload in ${jobName} must not depend on an earlier step's outcome`
      ).toBe('always()');

      for (const directory of ['artifacts/vitest/', log]) {
        expect(
          upload?.with?.path ?? '',
          `${directory} is half of the diagnosis and ${jobName} does not publish it`
        ).toContain(directory);
      }
    });
  }
});

/**
 * The packaged build's obligatory artifact, and the two ways it could disappear.
 *
 * External review of segment 5 measured a chain of three: the suite writes
 * `gate-report.json` and then asserts an object it still holds in memory, so deleting
 * the write left Playwright green; the step that summarises the report answered a
 * missing file with `::warning::` and `exit 0`; and the evidence upload's
 * `if-no-files-found: error` was satisfied by the two *other* directories in its path.
 * The one file this job exists to produce could vanish through all three without a red.
 *
 * And the reverse hole, in the same job: when `pnpm package:desktop` fails, the gate is
 * skipped by GitHub's default, `steps.gate.outcome` is `skipped`, and both summaries and
 * the evidence upload are guarded on that outcome and skipped with it. A packaging flake
 * — the exact class this job exists to catch — left nothing behind at all.
 *
 * The suite's own half of the fix is in `tests/desktop/packaged-host.spec.ts`, which now
 * reads its report back off the disk. This is the workflow's half.
 */
describe('the packaged desktop job cannot lose what it was run to produce', () => {
  const PACKAGED_JOB = 'packaged-desktop';
  const steps = workflow.jobs?.[PACKAGED_JOB]?.steps ?? [];
  const stepWithId = (id: string): Step | undefined =>
    steps.find((candidate) => candidate.id === id);

  it('keeps the output of a failed packaging step', () => {
    const packaging = stepWithId('package');

    expect(
      packaging?.run,
      'the packaging step does not tee its output; when it fails, every step below is skipped and nothing is published'
    ).toContain('tee artifacts/desktop-package/');

    // GitHub's default shell on a Windows runner is PowerShell, and its `bash` is
    // `bash -eo pipefail`. Without the declaration the pipe reports tee's exit code
    // and a failed packaging passes this step — a capture that silences what it captures.
    expect(packaging?.shell, 'the packaging step must declare `shell: bash`').toBe('bash');

    const upload = steps.find(
      (step) =>
        step.uses?.startsWith('actions/upload-artifact') === true &&
        (step.with?.path ?? '').includes('artifacts/desktop-package/')
    );

    expect(upload, 'the packaging log is teed into a file nobody uploads').toBeDefined();
    // Bare, and it is the only upload in this job that may be: every other one is
    // guarded on the gate's outcome, which is `skipped` on exactly the run this
    // artifact exists for.
    expect(
      upload?.if?.replace(/\s/gu, ''),
      'the packaging log must be published even when packaging is what failed'
    ).toBe('always()');
  });

  it('fails when a green gate produced no report', () => {
    const summary = steps.find((step) => (step.run ?? '').includes('gate-report.json'));

    expect(summary, 'no step reads gate-report.json').toBeDefined();
    expect(
      summary?.run ?? '',
      'a missing report after a passing gate is answered with a notice; the artifact this job exists to produce can then be deleted in silence'
    ).toMatch(/::error::/u);
    // Not merely present: the error branch has to end the step. A `::error::`
    // annotation with `exit 0` under it is a red line in a log and a green job.
    expect(summary?.run ?? '', 'the error branch does not fail the step').toMatch(
      /::error::[\s\S]*\n\s*exit 1/u
    );
  });

  it('publishes the report on its own, where `error` can mean what it says', () => {
    const upload = steps.find(
      (step) =>
        step.uses?.startsWith('actions/upload-artifact') === true &&
        (step.with?.path ?? '').trim() === 'artifacts/electron-spike/gate-report.json'
    );

    expect(
      upload,
      'no upload names gate-report.json alone; `if-no-files-found: error` over a multi-path upload passes as long as any one path matched, and the other two are written by every run'
    ).toBeDefined();
    expect(
      upload?.with?.['if-no-files-found'],
      'the dedicated upload must fail when the file it names is absent'
    ).toBe('error');
  });
});

describe('pnpm verify is the TypeScript and browser gate, not the whole of it', () => {
  // The name is the finding. `pnpm verify` was called "the whole of the local gate"
  // here and in the root manifest, and it is not: the gate before a merge is this one
  // and `node scripts/audit-runtime-dependencies.mjs`, which is what the `release-gate`
  // job above runs and what REQUIRED_COMMANDS lists. A test title is the sentence the
  // next person reads before a merge, and that one told them to run one of three.

  /**
   * Every stage `pnpm verify` chains. Adding one does not require touching this
   * list; removing one does, which is the point — a stage dropped from the
   * chain makes the command faster and greener, and nothing else notices.
   */
  const REQUIRED_STAGES = [
    'typecheck',
    'lint',
    'lint:deps',
    'format:check',
    'schema:check',
    'test',
    'test:scenario',
    'scenario:parity',
    'build',
    'test:e2e'
  ] as const;

  const verify = rootManifest.scripts?.verify ?? '';

  /**
   * The chain, taken apart into the stages it actually runs.
   *
   * The first version of this check asked `verify.toContain('pnpm ' + stage)`,
   * and review measured what that is worth: `pnpm lint` is a substring of
   * `pnpm lint:deps` and `pnpm test` is a substring of `pnpm test:scenario`, so
   * deleting `pnpm test` — the stage carrying 1151 of the gate's tests — from
   * the chain left this file reporting `6 passed (6)`. A check written against
   * exactly that failure could not see it. Two of ten stages could vanish in
   * silence.
   *
   * Splitting on `&&` and trimming is enough because that is the whole grammar
   * of this script; anything richer would be a shell to parse, and a `verify`
   * that needed one would be the defect.
   */
  const stages = verify
    .split('&&')
    .map((stage) => stage.trim())
    .filter((stage) => stage !== '');

  it('chains every stage it is composed of', () => {
    for (const stage of REQUIRED_STAGES) {
      expect(stages, `pnpm verify no longer runs \`pnpm ${stage}\``).toContain(`pnpm ${stage}`);
    }
  });

  it('runs each of them exactly once', () => {
    // A stage duplicated by a bad merge doubles the slowest gate in the
    // repository and reads as a slow runner rather than as a diff.
    const duplicated = stages.filter((stage, index) => stages.indexOf(stage) !== index);

    expect([...new Set(duplicated)], 'pnpm verify repeats a stage').toEqual([]);
  });

  it('says beside itself that it is one of the gate’s commands, and names the others', () => {
    // The note in the manifest is the only thing a reader typing `pnpm verify`
    // locally sees, and it read "The release gate as one command". Held to naming
    // the other two rather than left as prose, for the reason every list in this
    // file is: a sentence that stops being true costs nothing to leave in place.
    const note = rootManifest.scripts?.['//verify'] ?? '';

    expect(note, 'package.json carries no note beside `verify`').not.toBe('');

    for (const { command } of REQUIRED_COMMANDS) {
      expect(
        note,
        `the note beside \`verify\` does not name \`${command}\`, so a reader is told one command out of three is the gate`
      ).toContain(command);
    }
  });

  it('leaves the two commands that need a desktop out of it', () => {
    // Stated here as well as in the workflow, because the two go wrong
    // independently: someone folding `test:desktop` into `verify` would break
    // every contributor without a packaged build, and the workflow check above
    // would still pass.
    //
    // Substring on the whole script, deliberately, and the asymmetry with the
    // parsed list above is the point: for what must be PRESENT an exact stage is
    // stricter, and for what must be ABSENT a substring is stricter — it also
    // catches `pnpm test:desktop --grep x`, which no exact match would.
    for (const stage of ['package:desktop', 'test:desktop']) {
      expect(
        verify,
        `pnpm verify runs \`pnpm ${stage}\`, which needs an Electron binary and a Windows host`
      ).not.toContain(stage);
    }
  });
});
