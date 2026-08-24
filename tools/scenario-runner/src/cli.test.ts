import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { main } from './cli.ts';

/**
 * The CLI's contract with a pipeline is its exit code, so that is what these check.
 */

const repoRoot = resolve(import.meta.dirname, '..', '..', '..');

let output = '';
let root = '';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'oac-cli-'));
  output = '';
  const capture = (...parts: unknown[]): void => {
    output += `${parts.map(String).join(' ')}\n`;
  };

  vi.spyOn(console, 'log').mockImplementation(capture);
  vi.spyOn(console, 'error').mockImplementation(capture);
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

describe('exit codes are the interface', () => {
  it('answers 2 for no command at all', () => {
    expect(main([])).toBe(2);
    expect(output).toContain('usage:');
  });

  it('answers 2 for a command it does not have', () => {
    expect(main(['verify'])).toBe(2);
    expect(output).toContain("Unknown command 'verify'");
  });

  it('answers 2 when run has no scenario', () => {
    expect(main(['run'])).toBe(2);
  });

  it('answers 2 when contrast has no --contrast', () => {
    expect(main(['contrast'])).toBe(2);
  });
});

describe('the process exit code, driven as a process', () => {
  // These spawn `node` rather than calling `main`, and that is the whole point of them.
  // External review found two defects the in-process cases could not see, because they
  // handed `main` arrays that were already well formed: a missing option value threw out
  // of the parser instead of exiting 2, and an unknown flag was silently ignored and
  // exited 0.
  const cli = join(import.meta.dirname, 'cli.ts');

  const exitCodeOf = (...args: readonly string[]): number =>
    spawnSync(process.execPath, [cli, ...args], { cwd: repoRoot, encoding: 'utf8' }).status ?? -1;

  it.each([
    [['run', '--scenario'], 'an option with no value'],
    [['run', '--scenario', 'gate0', '--bogus', 'value'], 'an option this command does not have'],
    [['run', '--scenario', 'gate0', '--seed', 'abc'], 'a seed that is not a number'],
    [['run', '--scenario', 'gate0', '--seed', '7', '--seed', '8'], 'the same option twice'],
    [['nonsense'], 'a command that does not exist']
  ])('answers 2 for %j — %s', (args) => {
    expect(exitCodeOf(...args)).toBe(2);
  });

  it('answers 0 for a run that worked', () => {
    expect(exitCodeOf('run', '--scenario', 'gate0', '--seed', '7')).toBe(0);
  });

  // The seed's spelling, held to the one the original accepts. `BigInt` takes all four
  // of the rejected forms below and would have run seed 7 under three of them; C# parses
  // seeds with `NumberStyles.None`, which allows digits and nothing else. This block
  // exists because the first attempt at the fix shipped without it and a mutant removing
  // the whole check came back green.
  it.each([
    ['0x7', 'a radix prefix'],
    ['+7', 'an explicit sign'],
    [' 7', 'leading whitespace'],
    ['7 ', 'trailing whitespace'],
    ['', 'nothing at all'],
    ['7.0', 'a decimal point'],
    ['1e3', 'exponent notation']
  ])('answers 2 for a seed written as %j — %s', (seed) => {
    expect(exitCodeOf('run', '--scenario', 'gate0', '--seed', seed)).toBe(2);
  });

  it('accepts leading zeros, which are digits and which the original takes', () => {
    expect(exitCodeOf('run', '--scenario', 'gate0', '--seed', '007')).toBe(0);
  });
});

describe('run', () => {
  it('reports the hash of the artifact it produced and writes it when asked', () => {
    const artifact = join(root, 'gate0.json');

    expect(
      main(['run', '--scenario', 'gate0', '--seed', '7', '--repo', repoRoot, '--output', artifact])
    ).toBe(0);

    const written = readFileSync(artifact, 'utf8');
    expect(output).toContain('canonical sha256:');
    expect(JSON.parse(written)).toMatchObject({ artifact_version: 4 });
  });

  it('treats a scenario that fails on purpose as data, not as a tool failure', () => {
    // `screen_error` exists to reach the failure branch. Exiting non-zero here would
    // make a green pipeline impossible for a repository that ships the scenario.
    expect(
      main([
        'run',
        '--scenario',
        'screen_error',
        '--repo',
        repoRoot,
        '--content',
        join(root, 'absent')
      ])
    ).toBe(0);
    expect(output).toContain('CONTENT_ROOT_NOT_FOUND');
  });

  it('reports the loading screen without running anything', () => {
    expect(main(['run', '--scenario', 'screen_loading', '--repo', repoRoot])).toBe(0);
    expect(output).toContain('before content is read');
  });
});

describe('contrast', () => {
  it('reports a shipped contrast that flips as it declares', () => {
    expect(main(['contrast', '--contrast', 'payment_raised', '--repo', repoRoot])).toBe(0);
    expect(output).toContain('flipped:  true');
  });

  it('answers 2 for a contrast name that names no file, the same as a malformed argument', () => {
    expect(main(['contrast', '--contrast', 'no_such_contrast', '--repo', repoRoot])).toBe(2);
  });
});
