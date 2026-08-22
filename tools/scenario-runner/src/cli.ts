import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';

import { artifactHash, toCanonicalJson } from '@oath-and-coin/content';
import { loadAndRunScenario } from '@oath-and-coin/content/node';

/**
 * Headless scenario execution.
 *
 *   node tools/scenario-runner/src/cli.ts run --scenario gate0 [--checkpoint NAME]
 *                                            [--seed N] [--content DIR] [--output FILE]
 *
 * A plain `node` invocation over `.ts` sources, not a test pretending to be a script and
 * not a build step. `FULL_TYPESCRIPT_MIGRATION` §8.3 records why that works and what it
 * costs: Node executes TypeScript by stripping types, so imports must name the `.ts`
 * extension and no construct with a runtime effect may appear — which is what
 * `erasableSyntaxOnly` in the base tsconfig enforces for the whole workspace.
 *
 * Exit codes are the interface a pipeline reads: 0 the run completed, 2 the command line
 * itself was wrong. `parity` — replaying the frozen corpus byte for byte — lived here
 * until `ADR-013` retired that guarantee; what the corpus still proves (canonicalization,
 * file digests, RNG vectors) is asserted directly in `tests/oracle`, not through this CLI.
 */

const USAGE = [
  'usage:',
  '  scenario-runner run --scenario <id> [--checkpoint <name>] [--seed <n>]',
  '                      [--scenarios <dir>] [--content <dir>] [--output <file>]'
].join('\n');

const EXIT_OK = 0;
const EXIT_USAGE = 2;

/** Every option `run` accepts. An unknown one is a usage error, not a no-op. */
const KNOWN_OPTIONS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  run: ['--scenario', '--checkpoint', '--seed', '--scenarios', '--content', '--repo', '--output']
});

/**
 * Every path out of this function returns a code; none throws.
 *
 * External review found the gap by running the commands rather than by calling `main`:
 * `run --scenario` with no value threw out of the option parser and the process exited
 * **1**, the code that means "the corpus disagreed", and `run --scenario gate0 --bogus
 * value` exited **0** with the flag silently ignored. Both contradicted the contract
 * three lines up, and the tests could not see either, because they called `main` with
 * arrays that were already well-formed.
 */
export function main(argv: readonly string[]): number {
  const [command, ...rest] = argv;

  // Written as `if`s rather than a `switch`, and the linter is right to have asked.
  // `switch-exhaustiveness-check` is on for the whole workspace because the domain
  // unions must break their switches when a member is added; argv is not one of those —
  // it is `string | undefined` and no `default` can ever be dropped from it. A `switch`
  // here would have to carry a `case undefined` that exists only to satisfy a rule
  // whose whole point is elsewhere.
  if (command !== 'run') {
    console.error(command === undefined ? USAGE : `Unknown command '${command}'.\n${USAGE}`);
    return EXIT_USAGE;
  }

  let options: Options;
  try {
    options = parseOptions(rest, KNOWN_OPTIONS[command]!);
  } catch (cause) {
    console.error(messageOf(cause));
    return EXIT_USAGE;
  }

  try {
    return runCommand(options);
  } catch (cause) {
    // A malformed argument value — a `--seed` that is not a number — reaches this. It is
    // still the command line being wrong, so it is still 2. A genuine defect in the run
    // would surface here too; that is why the message is printed rather than swallowed.
    console.error(messageOf(cause));
    return EXIT_USAGE;
  }
}

function runCommand(options: Options): number {
  const scenario = options.get('--scenario');
  if (scenario === undefined) {
    console.error(`run needs --scenario.\n${USAGE}`);
    return EXIT_USAGE;
  }

  const repositoryRoot = resolve(options.get('--repo') ?? '.');
  const contentOverride = options.get('--content');

  const result = loadAndRunScenario({
    repositoryRoot,
    scenarioRoot: resolve(options.get('--scenarios') ?? join(repositoryRoot, 'scenarios')),
    scenario,
    checkpoint: options.get('--checkpoint') ?? null,
    // Absent unless the caller asked for one: the manifest decides otherwise. Defaulting
    // to `content/` here is what made `run --scenario screen_error` load the production
    // tree and exit 0 on a scenario whose whole purpose is to fail.
    ...(contentOverride === undefined ? {} : { contentRoot: resolve(contentOverride) }),
    seed: parseSeed(options.get('--seed') ?? '424242')
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

interface Options {
  get(name: string): string | undefined;
}

/**
 * `--name value` pairs, and nothing else. No short flags, no `--name=value`, no
 * clustering: a CLI with one spelling per option cannot have two spellings disagree,
 * and every caller of this one is a script or a pipeline rather than a person typing.
 *
 * An option outside `known` is refused rather than ignored. A silently dropped flag is
 * the failure where a pipeline runs the command it did not mean to and reports success:
 * a misspelled `--content` would have quietly read the production tree.
 */
function parseOptions(argv: readonly string[], known: readonly string[]): Options {
  const values = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]!;
    const value = argv[index + 1];

    if (!name.startsWith('--') || value === undefined) {
      throw new Error(`Malformed option near '${name}'.\n${USAGE}`);
    }

    if (!known.includes(name)) {
      throw new Error(`Unknown option '${name}'. Accepted here: ${known.join(', ')}.\n${USAGE}`);
    }

    if (values.has(name)) {
      throw new Error(`Option '${name}' given more than once.\n${USAGE}`);
    }

    values.set(name, value);
  }

  return { get: (name) => values.get(name) };
}

/**
 * A campaign seed, in the one spelling the C# runner accepted.
 *
 * `BigInt` is more permissive than `ulong.TryParse(..., NumberStyles.None)`: it takes
 * `0x7`, `+7`, leading whitespace and an empty string. External review reproduced the
 * first two — `--seed 0x7` ran seed 7 and reported success under a spelling the original
 * refuses. A CLI that accepts a spelling the thing it ports does not is a CLI whose
 * arguments mean something slightly different, which is the hardest kind of divergence
 * to notice.
 */
function parseSeed(text: string): bigint {
  if (!/^\d+$/u.test(text)) {
    throw new Error(
      `Seed '${text}' is not an unsigned decimal integer. The original parses seeds with ` +
        `NumberStyles.None — no sign, no radix prefix, no whitespace.\n${USAGE}`
    );
  }

  return BigInt(text);
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
