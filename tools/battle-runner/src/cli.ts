import { join, resolve } from 'node:path';
import process from 'node:process';

import { loadContentSet } from '@oath-and-coin/content/node';

import { measureAll, type Measurement } from './metrics.ts';
import { Thresholds } from './thresholds.ts';

/**
 * Headless batch battles and the balance report (`COMBAT_SPEC` §12.5).
 *
 *   node tools/battle-runner/src/cli.ts report --set core [--content DIR]
 *
 * A plain `node` invocation over `.ts` sources, like `tools/scenario-runner` beside it and
 * for the same reason (`FULL_TYPESCRIPT_MIGRATION` §8.3).
 *
 * **The exit code is the gate.** §12.5 says so, and it is a direct finding of external review
 * of the spec: a report that prints a violated threshold and exits zero is a report, not a
 * gate. `0` every measurement inside its corridor, `1` at least one outside, `2` the command
 * line itself was wrong.
 *
 * **The thresholds are a file and no flag moves them** (`thresholds.ts`). A corridor a run can
 * be told to relax is a corridor the run agrees with by construction.
 */

const USAGE = ['usage:', '  battle-runner report --set core [--content <dir>] [--repo <dir>]'].join(
  '\n'
);

const EXIT_OK = 0;
const EXIT_THRESHOLD = 1;
const EXIT_USAGE = 2;

/** Every option this command accepts. An unknown one is a usage error, not a no-op. */
const KNOWN_OPTIONS: readonly string[] = ['--set', '--content', '--repo'];

/** The sets this build can report on. `core` is the frozen one `MVP_PLAN` §6.4 names. */
const KNOWN_SETS: readonly string[] = ['core'];

export function main(argv: readonly string[]): number {
  const [command, ...rest] = argv;

  if (command !== 'report') {
    console.error(command === undefined ? USAGE : `Unknown command '${command}'.\n${USAGE}`);
    return EXIT_USAGE;
  }

  let options: ReadonlyMap<string, string>;
  try {
    options = parseOptions(rest);
  } catch (cause) {
    console.error(cause instanceof Error ? cause.message : String(cause));
    return EXIT_USAGE;
  }

  const set = options.get('--set');
  if (set === undefined || !KNOWN_SETS.includes(set)) {
    console.error(`report needs --set, one of: ${KNOWN_SETS.join(', ')}.\n${USAGE}`);
    return EXIT_USAGE;
  }

  const repositoryRoot = resolve(options.get('--repo') ?? '.');
  const content = loadContentSet(
    resolve(options.get('--content') ?? join(repositoryRoot, 'content'))
  );

  const measurements = measureAll(content);

  for (const line of render(measurements, set, content.contentVersion)) {
    console.log(line);
  }

  // `open` is not a failure and not a pass: the corridor stands, the number is outside it,
  // and the owner decided to live with that (`thresholds.ts`). Only `fail` moves the exit
  // code, and the report above says which is which in as many words.
  return measurements.some((one) => one.status === 'fail') ? EXIT_THRESHOLD : EXIT_OK;
}

/**
 * The report, as lines.
 *
 * Its own function so the shape is testable without a process, and so the numbers a PR
 * quotes come out of the same code that decides the exit — a report and a verdict computed
 * separately are two things that can disagree (`AGENTS.md` §11).
 */
export function render(
  measurements: readonly Measurement[],
  set: string,
  contentVersion: string
): readonly string[] {
  const failed = measurements.filter((one) => one.status === 'fail');
  const open = measurements.filter((one) => one.status === 'open');

  return [
    `battle-runner report --set ${set}`,
    `content_version: ${contentVersion}`,
    '',
    ...measurements.map(
      (one) =>
        `${label(one)} ${one.id.padEnd(34)} ` +
        `${format(one)}  (${one.threshold}, over ${String(one.cases)} case(s))` +
        (one.note === undefined ? '' : `\n     ${one.note}`)
    ),
    '',
    failed.length === 0
      ? 'every threshold this run gates on held'
      : `${String(failed.length)} threshold(s) outside the corridor declared before balancing: ` +
        failed.map((one) => one.id).join(', '),
    ...open.map(
      (one) => `open by decision, not gated: ${one.id} — ${Thresholds.openByDecision[one.id] ?? ''}`
    )
  ];
}

function label(measurement: Measurement): string {
  switch (measurement.status) {
    case 'ok':
      return 'ok  ';
    case 'fail':
      return 'FAIL';
    case 'open':
      return 'OPEN';
  }
}

function format(measurement: Measurement): string {
  switch (measurement.unit) {
    case 'percent':
      return `${String(measurement.value)}%`;
    case 'rounds':
      return `${String(measurement.value)} rounds`;
    case 'count':
      return String(measurement.value);
  }
}

/**
 * `--name value` pairs and nothing else, with an unknown option refused rather than ignored.
 *
 * The same parser shape `tools/scenario-runner` uses, and the same reason: a silently
 * dropped flag is how a pipeline runs the command it did not mean to and reports success.
 */
function parseOptions(argv: readonly string[]): ReadonlyMap<string, string> {
  const values = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]!;
    const value = argv[index + 1];

    if (!name.startsWith('--') || value === undefined) {
      throw new Error(`Malformed option near '${name}'.\n${USAGE}`);
    }

    if (!KNOWN_OPTIONS.includes(name)) {
      throw new Error(
        `Unknown option '${name}'. Accepted here: ${KNOWN_OPTIONS.join(', ')}.\n${USAGE}\n` +
          'Thresholds are not among them and never will be: COMBAT_SPEC §12.5 keeps them in a ' +
          'file, because a corridor a run can be told to relax is one it agrees with by ' +
          'construction.'
      );
    }

    if (values.has(name)) {
      throw new Error(`Option '${name}' given more than once.\n${USAGE}`);
    }

    values.set(name, value);
  }

  return values;
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2)));
}
