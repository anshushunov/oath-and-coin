import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { readCorpusIndex, runParity, verifyEntry } from '@oath-and-coin/scenario-runner';
import { describe, expect, it } from 'vitest';

/**
 * The evidence the whole migration is measured on: every entry of the frozen C# corpus,
 * replayed by this port, compared **byte for byte**.
 *
 * Until this file existed, `FULL_TYPESCRIPT_MIGRATION` §8.6 could only say that the
 * content digest, the initial state, the RNG vectors and the canonical writer agreed —
 * and that no entry of the corpus had been reproduced whole. Four agreements that each
 * cover a slice of the behaviour are not the same claim as one that covers a run end to
 * end, and the difference is exactly where a port goes wrong: in the composition.
 *
 * The comparison lives in `tools/scenario-runner` rather than here, because the CLI and
 * this suite must not be two implementations of "the same" check. A second copy would
 * agree with itself.
 */

const repoRoot = resolve(import.meta.dirname, '..', '..');
const corpusRoot = join(repoRoot, 'migration', 'oracle', 'v1');

const { manifest, entries } = readCorpusIndex(corpusRoot);

describe('the corpus is the one that was frozen', () => {
  it('is 27 scenarios, 27 checkpoints and 54 entries on two seeds', () => {
    // Stated as numbers because an index that silently shrank would make every check
    // below pass over whatever was left. The seed is part of an entry's identity: a
    // port ignoring the seed handed to it reproduces one of the two perfectly.
    expect(manifest.scenarios).toHaveLength(27);
    expect(manifest.scenarios.flatMap((scenario) => scenario.checkpoints)).toHaveLength(27);
    expect(entries).toHaveLength(54);
    expect(manifest.seeds).toEqual(['7', '424242']);
  });

  it('was exported from the migration baseline commit', () => {
    expect(manifest.source_commit).toBe('12565862b1e88e0524f95def18c023571ec4269f');
  });
});

describe('every frozen entry reproduces', () => {
  it.each(
    entries.map((entry) => [`${entry.scenario}/${entry.checkpoint}/seed-${entry.seed}`, entry])
  )('%s', (_name, entry) => {
    const verdict = verifyEntry(repoRoot, corpusRoot, entry);

    // The failures are the message on purpose: a byte mismatch reports the first
    // offset and the first JSON path that disagrees, which is the difference between
    // "parity failed" and knowing where.
    expect(verdict.failures).toEqual([]);
    expect(verdict.matched).toBe(true);
  });

  it('reproduces all 54 in one report, with nothing skipped', () => {
    // The per-entry cases above would all pass over an empty list. This one asserts the
    // count the report itself arrived at.
    const report = runParity(repoRoot, corpusRoot);

    expect(report.entries).toBe(54);
    expect(report.matched).toBe(54);
    expect(report.verdicts.filter((verdict) => !verdict.matched)).toEqual([]);
  });
});

describe('screen_incomplete still stops short of the full run', () => {
  it('disagrees with the committed canonical artifact, which is what it is for', () => {
    // The one scenario whose checkpoint deliberately stops after the first of six
    // commands. A checkpoint that quietly began covering everything would make this
    // entry agree with the full artifact — and every other check here would stay green,
    // because the corpus entry would have been regenerated to match.
    const entry = entries.find((candidate) => candidate.scenario === 'screen_incomplete');
    expect(entry).toBeDefined();

    const frozen = JSON.parse(readFileSync(join(corpusRoot, entry!.path), 'utf8')) as {
      steps: readonly unknown[];
      canonical_sha256: string;
    };

    const committed = JSON.parse(
      readFileSync(join(repoRoot, 'scenarios', 'screen_incomplete.canonical.json'), 'utf8')
    ) as Record<string, unknown>;

    expect(frozen.steps).toHaveLength(1);
    expect((committed.steps as readonly unknown[]).length).toBeGreaterThan(1);
  });
});
