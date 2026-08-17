import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { main } from './cli.ts';
import { firstDifference } from './parity.ts';

/**
 * The CLI's contract with a pipeline is its exit code, so that is what these check.
 *
 * The one case worth the most is the precondition: a parity run that cannot reach the
 * corpus must not exit 0 with "0 mismatches". That is the same shape of defect the
 * migration journal records twice already — a check that was green because it looked at
 * nothing (`git diff` blind to untracked files, §3.6 and §4.6).
 */

const repoRoot = resolve(import.meta.dirname, '..', '..', '..');
const corpusRoot = join(repoRoot, 'migration', 'oracle', 'v1');

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

  it('answers 2 when parity has no oracle', () => {
    expect(main(['parity'])).toBe(2);
  });

  it('answers 2, not 0, when the corpus is not where it was pointed', () => {
    // The failure this command must never produce: "0 mismatches" over a directory that
    // was misspelled.
    expect(main(['parity', '--oracle', join(root, 'absent'), '--repo', repoRoot])).toBe(2);
    expect(output).toContain('could not read the corpus');
    expect(output).not.toContain('reproduced');
  });

  it('answers 0 and reports 54 of 54 against the frozen corpus', () => {
    expect(main(['parity', '--oracle', corpusRoot, '--repo', repoRoot])).toBe(0);
    expect(output).toContain('54/54 reproduced');
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
    expect(JSON.parse(written)).toMatchObject({ artifact_version: 3 });
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

describe('the report says where two runs parted, not only that they did', () => {
  it('names the first differing path, depth-first in key order', () => {
    expect(firstDifference({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 3 } }, '$')).toBe(
      '$.b.c: 2 where the corpus has 3'
    );
  });

  it('names a key one side has and the other does not', () => {
    expect(firstDifference({ a: 1 }, { a: 1, b: 2 }, '$')).toBe(
      '$.b: absent here, present in the corpus'
    );
    expect(firstDifference({ a: 1, b: 2 }, { a: 1 }, '$')).toBe(
      '$.b: present here, absent from the corpus'
    );
  });

  it('names the array whose length changed rather than walking into it', () => {
    expect(firstDifference([1, 2], [1], '$.steps')).toContain('array of 2');
  });

  it('is silent when the two agree', () => {
    expect(firstDifference({ a: [1, { b: null }] }, { a: [1, { b: null }] }, '$')).toBeNull();
  });
});
