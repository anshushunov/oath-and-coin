import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

/**
 * The release gate, held to its own composition.
 *
 * Task 18's gate is three commands — `pnpm verify`, the runtime dependency
 * audit, and the .NET test run — and its whole value is that all three are in
 * one place. That is also its whole failure mode: a step deleted from a
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

interface Workflow {
  readonly jobs?: Readonly<Record<string, { readonly steps?: readonly { run?: string }[] }>>;
}

const workflow = parseYaml(
  readFileSync(join(repoRoot, '.github', 'workflows', 'typescript.yml'), 'utf8')
) as Workflow;

const rootManifest = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
  scripts?: Readonly<Record<string, string>>;
};

const JOB_NAME = 'release-gate';

const job = workflow.jobs?.[JOB_NAME];
const commands = (job?.steps ?? []).map((step) => step.run ?? '').join('\n');

describe('the release gate is one job with three verdicts', () => {
  it('exists in the TypeScript workflow', () => {
    expect(
      job,
      `.github/workflows/typescript.yml has no job named ${JOB_NAME}; the three gate commands are then run by nobody together`
    ).toBeDefined();
  });

  /**
   * The three commands the task's gate line names, each with what its absence
   * would cost. Spelled as the exact text the workflow runs, so that renaming a
   * script without touching the workflow fails here instead of in CI.
   */
  const REQUIRED_COMMANDS: readonly { command: string; verdict: string }[] = [
    {
      command: 'pnpm verify',
      verdict: 'the TypeScript stack typechecks, lints, tests, builds and renders'
    },
    {
      command: 'node scripts/audit-runtime-dependencies.mjs',
      verdict: 'nothing unreviewed reaches a player at runtime'
    },
    {
      command: 'dotnet test OathAndCoin.sln -c Release',
      verdict: 'the stack the migration has not cut over from is still green'
    }
  ];

  it('runs all three of them', () => {
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

  it('publishes what it measured even when it failed', () => {
    // A gate that only uploads its evidence on success cannot explain the run
    // worth explaining. The intermittent red Task 16.3 saw twice and could not
    // name is the reason this is asserted rather than left to review.
    const upload = (job?.steps ?? []).find(
      (step) => (step as { uses?: string }).uses?.startsWith('actions/upload-artifact') === true
    ) as { if?: string; with?: { path?: string } } | undefined;

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

describe('pnpm verify is the whole of the local gate', () => {
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
