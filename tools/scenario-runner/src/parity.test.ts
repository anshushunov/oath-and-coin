import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readCorpusIndex, verifyEntry, type EntryReference } from './parity.ts';

/**
 * The parity checker, checked.
 *
 * `AGENTS.md` §8: a gate that has never gone red is not a gate. The 54 green entries in
 * `tests/oracle` say the port agrees with the corpus; they say nothing about whether a
 * disagreement would be noticed. So this suite builds a one-entry corpus from a real
 * frozen entry, doctors exactly one field of it at a time, and requires the checker to
 * report each — including the two facts that are *not* inside the canonical bytes and
 * would otherwise be checked by nothing at all.
 */

const repoRoot = resolve(import.meta.dirname, '..', '..', '..');
const corpusRoot = join(repoRoot, 'migration', 'oracle', 'v1');

/** A scenario with more than one command, so a per-step draw can be doctored in isolation. */
const SOURCE_SCENARIO = 'gate0';

let root = '';
let reference: EntryReference;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'oac-parity-'));

  const { entries } = readCorpusIndex(corpusRoot);
  const source = entries.find(
    (entry) => entry.scenario === SOURCE_SCENARIO && entry.seed === '424242'
  );

  if (source === undefined) {
    throw new Error(`The frozen corpus has no ${SOURCE_SCENARIO} entry at seed 424242.`);
  }

  reference = source;
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Writes a one-entry corpus whose entry is the frozen one, passed through `doctor`. */
function corpusWith(doctor: (entry: Record<string, unknown>) => void): string {
  const entry = JSON.parse(readFileSync(join(corpusRoot, reference.path), 'utf8')) as Record<
    string,
    unknown
  >;
  doctor(entry);

  const target = join(root, reference.path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(entry), 'utf8');

  return root;
}

function failuresFor(doctor: (entry: Record<string, unknown>) => void): readonly string[] {
  return verifyEntry(repoRoot, corpusWith(doctor), reference).failures;
}

describe('the frozen entry, untouched, still reproduces', () => {
  it('so every case below differs from this one by exactly one field', () => {
    expect(failuresFor(() => undefined)).toEqual([]);
  });
});

describe('a doctored entry is reported, and the report says where', () => {
  it('notices canonical bytes that changed, and names the first differing path', () => {
    const failures = failuresFor((entry) => {
      const text = Buffer.from(entry.canonical_base64 as string, 'base64').toString('utf8');
      const parsed = JSON.parse(text) as { final_state: { metadata: { logical_time: number } } };
      parsed.final_state.metadata.logical_time = 99;
      entry.canonical_base64 = Buffer.from(JSON.stringify(parsed), 'utf8').toString('base64');
    });

    expect(failures.some((failure) => failure.startsWith('canonical bytes differ'))).toBe(true);
    expect(
      failures.some((failure) => failure.includes('$.final_state.metadata.logical_time'))
    ).toBe(true);
  });

  it('notices a hash that no longer covers those bytes', () => {
    const failures = failuresFor((entry) => {
      entry.canonical_sha256 = 'f'.repeat(64);
    });

    expect(failures.some((failure) => failure.startsWith('canonical sha256 differs'))).toBe(true);
  });

  it('notices a content version that drifted', () => {
    const failures = failuresFor((entry) => {
      (entry.inputs as Record<string, unknown>).content_version = 'deadbeefdeadbeef';
    });

    expect(failures.some((failure) => failure.startsWith('content_version is'))).toBe(true);
  });

  it('notices an error code the run did not produce', () => {
    const failures = failuresFor((entry) => {
      (entry.outcome as Record<string, unknown>).error_code = 'CONTENT_INVALID';
    });

    expect(failures.some((failure) => failure.startsWith('error code is'))).toBe(true);
  });

  it('notices an outcome kind the run did not land on', () => {
    const failures = failuresFor((entry) => {
      (entry.outcome as Record<string, unknown>).kind = 'error';
    });

    expect(failures.some((failure) => failure.startsWith('outcome kind is'))).toBe(true);
  });

  it('notices a per-step draw count, which the canonical bytes do not carry', () => {
    // The reason `draws` is compared at all. The artifact records only the final
    // ordinal, so a run that spent an ordinal on a step that should have spent none and
    // none on a step that should have spent one lands on the same total and the same
    // bytes.
    const failures = failuresFor((entry) => {
      const draws = entry.draws as { per_step: { consumed: string }[] };
      draws.per_step[0]!.consumed = '4';
    });

    expect(failures.some((failure) => failure.includes('draws.per_step[0].consumed'))).toBe(true);
  });

  it('notices a final ordinal that drifted', () => {
    const failures = failuresFor((entry) => {
      (entry.draws as Record<string, unknown>).next_decision_ordinal_final = '99';
    });

    expect(
      failures.some((failure) => failure.startsWith('draws.next_decision_ordinal_final is'))
    ).toBe(true);
  });

  it('notices an entry that recorded bytes where the port produced none', () => {
    const failures = failuresFor((entry) => {
      (entry.inputs as Record<string, unknown>).content_root = 'no/such/content';
    });

    expect(failures.some((failure) => failure.includes('before producing an artifact'))).toBe(true);
  });

  it('reports every disagreement, not only the first', () => {
    const failures = failuresFor((entry) => {
      entry.canonical_sha256 = 'f'.repeat(64);
      (entry.inputs as Record<string, unknown>).content_version = 'deadbeefdeadbeef';
    });

    expect(failures.length).toBeGreaterThan(1);
  });
});
