import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';

import { artifactHash, loadAndRunScenario, toCanonicalJson } from '@oath-and-coin/content';

import { runParity } from './parity.ts';

/**
 * Headless scenario execution and oracle parity.
 *
 *   node tools/scenario-runner/src/cli.ts run --scenario gate0 [--checkpoint NAME]
 *                                            [--seed N] [--content DIR] [--output FILE]
 *   node tools/scenario-runner/src/cli.ts parity --oracle migration/oracle/v1 [--output FILE]
 *
 * A plain `node` invocation over `.ts` sources, not a test pretending to be a script and
 * not a build step. `FULL_TYPESCRIPT_MIGRATION` §8.3 records why that works and what it
 * costs: Node executes TypeScript by stripping types, so imports must name the `.ts`
 * extension and no construct with a runtime effect may appear — which is what
 * `erasableSyntaxOnly` in the base tsconfig enforces for the whole workspace.
 *
 * Exit codes are the interface a pipeline reads: 0 agreement, 1 disagreement, 2 the
 * command line itself was wrong. A parity run that could not find the corpus must not
 * exit 0 with "0 mismatches".
 */

const USAGE = [
  'usage:',
  '  scenario-runner run --scenario <id> [--checkpoint <name>] [--seed <n>]',
  '                      [--scenarios <dir>] [--content <dir>] [--output <file>]',
  '  scenario-runner parity --oracle <dir> [--repo <dir>] [--output <file>]'
].join('\n');

const EXIT_OK = 0;
const EXIT_MISMATCH = 1;
const EXIT_USAGE = 2;

export function main(argv: readonly string[]): number {
  const [command, ...rest] = argv;

  // Written as `if`s rather than a `switch`, and the linter is right to have asked.
  // `switch-exhaustiveness-check` is on for the whole workspace because the domain
  // unions must break their switches when a member is added; argv is not one of those —
  // it is `string | undefined` and no `default` can ever be dropped from it. A `switch`
  // here would have to carry a `case undefined` that exists only to satisfy a rule
  // whose whole point is elsewhere.
  if (command === 'run') {
    return runCommand(parseOptions(rest));
  }

  if (command === 'parity') {
    return parityCommand(parseOptions(rest));
  }

  console.error(command === undefined ? USAGE : `Unknown command '${command}'.\n${USAGE}`);
  return EXIT_USAGE;
}

function runCommand(options: Options): number {
  const scenario = options.get('--scenario');
  if (scenario === undefined) {
    console.error(`run needs --scenario.\n${USAGE}`);
    return EXIT_USAGE;
  }

  const repositoryRoot = resolve(options.get('--repo') ?? '.');
  const result = loadAndRunScenario({
    scenarioRoot: resolve(options.get('--scenarios') ?? join(repositoryRoot, 'scenarios')),
    scenario,
    checkpoint: options.get('--checkpoint') ?? null,
    contentRoot: resolve(options.get('--content') ?? join(repositoryRoot, 'content')),
    seed: BigInt(options.get('--seed') ?? '424242')
  });

  switch (result.kind) {
    case 'failed':
      // Not an exception and not exit 2: a scenario that fails on purpose is data, and
      // `screen_error` is a scenario whose whole point is to reach this line.
      console.log(`${result.errorCode}: ${result.errorDetail}`);
      return EXIT_OK;

    case 'loading':
      console.log(
        `loading: scenario '${result.manifest.scenario}' is shown before content is read`
      );
      return EXIT_OK;

    case 'ran': {
      const canonical = toCanonicalJson(result.outcome);
      const output = options.get('--output');
      if (output !== undefined) {
        writeTo(resolve(output), `${canonical}\n`);
      }

      console.log(`scenario:        ${result.manifest.scenario}`);
      console.log(`checkpoint:      ${result.checkpoint.name}`);
      console.log(`content version: ${result.outcome.finalState.metadata.contentVersion}`);
      console.log(`steps:           ${String(result.outcome.steps.length)}`);
      console.log(`canonical sha256: ${artifactHash(result.outcome)}`);
      return EXIT_OK;
    }
  }
}

function parityCommand(options: Options): number {
  const oracle = options.get('--oracle');
  if (oracle === undefined) {
    console.error(`parity needs --oracle.\n${USAGE}`);
    return EXIT_USAGE;
  }

  const repositoryRoot = resolve(options.get('--repo') ?? '.');

  let report;
  try {
    report = runParity(repositoryRoot, resolve(oracle));
  } catch (cause) {
    // Reaching the corpus is a precondition, not a result. Reporting "0 mismatches"
    // because the directory was misspelled is the one failure this command must never
    // produce.
    console.error(`parity could not read the corpus: ${messageOf(cause)}`);
    return EXIT_USAGE;
  }

  const output = options.get('--output');
  if (output !== undefined) {
    writeTo(resolve(output), `${JSON.stringify(report, null, 2)}\n`);
  }

  console.log(`oracle:      ${report.oracleRoot}`);
  console.log(`baseline:    ${report.sourceCommit}`);
  console.log(`scenarios:   ${String(report.scenarios)}`);
  console.log(`checkpoints: ${String(report.checkpoints)}`);
  console.log(`seeds:       ${report.seeds.join(', ')}`);
  console.log(`entries:     ${String(report.matched)}/${String(report.entries)} reproduced`);

  for (const verdict of report.verdicts) {
    if (verdict.matched) {
      continue;
    }

    console.error(`\n${verdict.scenario}/${verdict.checkpoint}/seed-${verdict.seed}`);
    for (const failure of verdict.failures) {
      console.error(`  ${failure}`);
    }
  }

  return report.matched === report.entries ? EXIT_OK : EXIT_MISMATCH;
}

interface Options {
  get(name: string): string | undefined;
}

/**
 * `--name value` pairs, and nothing else. No short flags, no `--name=value`, no
 * clustering: a CLI with one spelling per option cannot have two spellings disagree,
 * and every caller of this one is a script or a pipeline rather than a person typing.
 */
function parseOptions(argv: readonly string[]): Options {
  const values = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]!;
    const value = argv[index + 1];
    if (!name.startsWith('--') || value === undefined) {
      throw new Error(`Malformed option near '${name}'.\n${USAGE}`);
    }

    values.set(name, value);
  }

  return { get: (name) => values.get(name) };
}

function writeTo(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

// `import.meta.main` rather than an unconditional call, so the tests can drive `main`
// without the module exiting the process out from under them.
if (import.meta.main) {
  process.exit(main(process.argv.slice(2)));
}
