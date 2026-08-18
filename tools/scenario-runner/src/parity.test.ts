import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { sha256Hex } from '@oath-and-coin/simulation';

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
/** A scenario that produces no artifact at all — its fault is a missing content root. */
let errorReference: EntryReference;

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

  const errorSource = entries.find((entry) => entry.scenario === 'screen_error');
  if (errorSource === undefined) {
    throw new Error('The frozen corpus has no screen_error entry.');
  }

  errorReference = errorSource;
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Writes a one-entry corpus from `source`, passed through `doctor`. */
function corpusFor(
  source: EntryReference,
  doctor: (entry: Record<string, unknown>) => void
): string {
  const entry = JSON.parse(readFileSync(join(corpusRoot, source.path), 'utf8')) as Record<
    string,
    unknown
  >;
  doctor(entry);

  const target = join(root, source.path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(entry), 'utf8');

  return root;
}

/** The same, for the entry every case defaults to. */
function corpusWith(doctor: (entry: Record<string, unknown>) => void): string {
  return corpusFor(reference, doctor);
}

function failuresFor(doctor: (entry: Record<string, unknown>) => void): readonly string[] {
  return verifyEntry(repoRoot, corpusWith(doctor), reference).failures;
}

describe('the frozen entry, untouched, still reproduces', () => {
  it('so every case below differs from this one by exactly one field', () => {
    expect(failuresFor(() => undefined)).toEqual([]);
  });
});

describe('the index and the file must be talking about the same entry', () => {
  // External review reproduced this: `verifyEntry` located the file by the manifest's
  // path and then ran the file's own scenario, checkpoint and seed, never comparing the
  // two. Handing it a reference with a different checkpoint returned `matched: true`
  // under the wrong name — a verdict signed with an identity nothing had verified.
  it.each([
    ['scenario', { scenario: 'not_the_entry_scenario' }],
    ['checkpoint', { checkpoint: 'not-the-entry-checkpoint' }],
    ['seed', { seed: '999' }]
  ])('refuses a reference whose %s the file does not confirm', (field, override) => {
    const verdict = verifyEntry(
      repoRoot,
      corpusWith(() => undefined),
      {
        ...reference,
        ...override
      }
    );

    expect(verdict.matched).toBe(false);
    expect(verdict.failures.some((failure) => failure.includes(field))).toBe(true);
  });

  it('refuses an entry filed away from the path its own identity names', () => {
    // The corpus addresses an entry by `scenarios/<scenario>/<checkpoint>/seed-<seed>`.
    // A manifest that indexes the same content somewhere else has stopped describing the
    // corpus it indexes, and the seed is part of that address (§3.1).
    const movedPath = reference.path.replace('seed-', 'seedx-');
    const target = join(root, movedPath);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, readFileSync(join(corpusRoot, reference.path), 'utf8'), 'utf8');

    const verdict = verifyEntry(repoRoot, root, { ...reference, path: movedPath });

    expect(verdict.matched).toBe(false);
    expect(verdict.failures.some((failure) => failure.includes('not '))).toBe(true);
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

  it('notices a content root the manifest no longer sends the run to', () => {
    // The run is driven by today's manifest, not by the recorded input, so a corpus that
    // remembers a different root is a disagreement rather than an instruction.
    const failures = failuresFor((entry) => {
      (entry.inputs as Record<string, unknown>).content_root = 'no/such/content';
    });

    expect(failures.some((failure) => failure.includes('sends this run to'))).toBe(true);
  });

  it('notices an entry that recorded bytes where the port produced none', () => {
    // `screen_error` produces no artifact by design. Giving its entry bytes must not let
    // it quietly match a run that never made any.
    const verdict = verifyEntry(
      repoRoot,
      corpusFor(errorReference, (entry) => {
        entry.canonical_base64 = 'e30=';
        entry.canonical_sha256 = sha256Hex(Buffer.from('{}', 'utf8'));
      }),
      errorReference
    );

    expect(
      verdict.failures.some((failure) => failure.includes('before producing an artifact'))
    ).toBe(true);
  });

  it('notices an entry that recorded no bytes where the port produced some', () => {
    const failures = failuresFor((entry) => {
      entry.canonical_base64 = null;
      entry.canonical_sha256 = null;
    });

    expect(
      failures.some((failure) => failure.includes('produced an artifact where the corpus'))
    ).toBe(true);
  });

  it('notices a manifest that has changed since the corpus was frozen', () => {
    // The blocker of the second review round: parity ran from the corpus's own recorded
    // inputs, so the scenario files were never read by the gate. Changing
    // `screen_error`'s expected_error_code to another valid code left 54/54 untouched.
    const failures = failuresFor((entry) => {
      const manifest = (entry.inputs as Record<string, unknown>).manifest as Record<
        string,
        unknown
      >;
      manifest.expected_screen_state = 'normal';
    });

    expect(
      failures.some((failure) => failure.includes('manifest has changed since the corpus'))
    ).toBe(true);
  });

  it('marks the entry unmatched, which is the field the exit code is built on', () => {
    // A mutant setting `matched: true` unconditionally came back green: every case above
    // asserts on `failures`, and the CLI reports `54/54` from a count of `matched`. So
    // the derived field gets its own check here, and the exit code gets one in
    // `cli.test.ts` — otherwise a pipeline could pass over a corpus that did not.
    const verdict = verifyEntry(
      repoRoot,
      corpusWith((entry) => {
        entry.canonical_sha256 = 'f'.repeat(64);
      }),
      reference
    );

    expect(verdict.matched).toBe(false);
    expect(verdict.failures.length).toBeGreaterThan(0);
  });

  it('notices an entry that disagrees with itself', () => {
    // The two recorded fields are two statements about one artifact, and §9.5 draws a
    // line between what each buys — a line that only holds once they are known to agree.
    // Until external review pointed it out, nothing checked that: an entry whose hash did
    // not cover its own bytes let the corpus decide which of the two the port was
    // measured against.
    const failures = failuresFor((entry) => {
      const text = Buffer.from(entry.canonical_base64 as string, 'base64').toString('utf8');
      entry.canonical_base64 = Buffer.from(`${text} `, 'utf8').toString('base64');
    });

    expect(failures.some((failure) => failure.includes('disagrees with itself'))).toBe(true);
  });

  it('notices a screen whose projection no longer matches, and names the field', () => {
    // The read-model comparison arrived in Task 11 with no negative case of its own, and
    // external review named the mutant that exposed it: delete the `compareReadModel`
    // call and every entry still reports 54/54 while this suite stays green. `AGENTS.md`
    // §8 asks for exactly the opposite of that on a new check.
    const failures = failuresFor((entry) => {
      const readModel = entry.read_model as Record<string, unknown>;
      readModel.title_key = 'screen.contract_offer.other_title';
    });

    expect(failures.some((failure) => failure.includes('$.read_model.title_key'))).toBe(true);
  });

  it('notices a recorded screen hash that no longer covers the screen beside it', () => {
    // Only the hash is doctored, so the projections still agree field for field. What
    // has to be reported is the entry disagreeing with itself — otherwise the corpus
    // decides which of its two statements the port is measured against, which is the
    // hole §9.5 already closed for the artifact and this check reopened for the screen.
    const failures = failuresFor((entry) => {
      (entry.read_model as Record<string, unknown>).sha256 = 'f'.repeat(64);
    });

    expect(failures.some((failure) => failure.includes('read_model disagrees with itself'))).toBe(
      true
    );
    expect(failures.some((failure) => failure.includes('read_model sha256 differs'))).toBe(true);
  });

  it('notices a screen state the run did not land on', () => {
    // Outside the canonical bytes entirely, like the error code and the per-step draws:
    // an artifact records what the run computed, never which of the five shapes the
    // screen took.
    const failures = failuresFor((entry) => {
      (entry.outcome as Record<string, unknown>).screen_state = 'empty';
    });

    expect(failures.some((failure) => failure.includes('screen state is'))).toBe(true);
  });

  it('reports an entry with no recorded screen instead of dying on it', () => {
    // A corpus missing the field is a corpus this comparison cannot run against, and it
    // has to say so. Before external review the first line of the comparison destructured
    // the field, so this input aborted the whole parity run with a TypeError naming
    // neither the entry nor the field.
    const failures = failuresFor((entry) => {
      delete entry.read_model;
    });

    expect(failures.some((failure) => failure.includes('records no read_model'))).toBe(true);
  });

  it('compares the screen of an entry that never produced an artifact', () => {
    // `screen_error` stops before any artifact exists, and it still has a screen to show
    // a player. The comparison therefore runs before the early return for such entries —
    // if it ran after, the two states with the most to say about failure would be the
    // two nothing checked.
    const failures = verifyEntry(
      repoRoot,
      corpusFor(errorReference, (entry) => {
        (entry.read_model as Record<string, unknown>).error_code = 'SCHEMA_INVALID';
      }),
      errorReference
    ).failures;

    expect(failures.some((failure) => failure.includes('$.read_model.error_code'))).toBe(true);
  });

  it('reports every disagreement, not only the first', () => {
    const failures = failuresFor((entry) => {
      entry.canonical_sha256 = 'f'.repeat(64);
      (entry.inputs as Record<string, unknown>).content_version = 'deadbeefdeadbeef';
    });

    expect(failures.length).toBeGreaterThan(1);
  });
});
