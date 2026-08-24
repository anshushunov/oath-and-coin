import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { toCanonicalJson } from '@oath-and-coin/content';
import { loadAndRunScenario } from '@oath-and-coin/content/node';
import { describe, expect, it } from 'vitest';

/**
 * The comparison `ADR-013` §4 promised and nothing in this repository performed.
 *
 * Measured, not guessed (`DEC-008` Task 20's own brief): after the field rename in
 * Task 3, and again after the artifact's shape moved, the whole suite stayed green
 * with every `scenarios/*.canonical.json` stale. The reason is structural, not an
 * oversight anyone made once — `tests/oracle/src/corpus.ts` and
 * `save-round-trip.test.ts` used to replay the *frozen migration corpus* against this
 * port, and `restored-read-model.test.ts` (`ADR-013`'s second retirement) compares two
 * code paths of *this build* against each other, never against a file on disk. No test
 * anywhere read a `.canonical.json` and asked "does a fresh run still say this."
 *
 * This file is that comparison, and it is deliberately mechanical: read every snapshot
 * that ships, re-run its scenario at the CLI's own default seed (424242 — `cli.ts`'s
 * `parseSeed(options.get('--seed') ?? '424242')`) and the checkpoint the manifest
 * itself defaults to (the last one declared — `--checkpoint` omitted, exactly how
 * `tools/scenario-runner/src/cli.ts run --scenario X --output Y` was invoked to record
 * every file this test reads), and demand the same canonical text, byte for byte.
 *
 * **Why this had to exist *before* Task 20 re-recorded a single snapshot.** A snapshot
 * nothing compares is not evidence the run still matches the file — it is a JSON file
 * that happens to sit next to a scenario. Re-recording under that condition would have
 * been writing the same 24 dead bytes over again with new content, which is exactly
 * the failure `ADR-013`'s reversal clause on this document is aimed at.
 */

const repoRoot = resolve(import.meta.dirname, '..', '..', '..');
const scenarioRoot = join(repoRoot, 'scenarios');

/** The CLI's own default — see the file header. Every snapshot below was recorded here. */
const RECORDING_SEED = 424242n;

/**
 * Every scenario that ships a canonical snapshot, read off the directory rather than
 * listed by hand — the same reason `restored-read-model.test.ts`'s own `SCENARIOS`
 * constant is built this way: a snapshot silently dropped from the repository must
 * shrink this list, not vanish from it unnoticed.
 */
const SNAPSHOT_SCENARIOS: readonly string[] = readdirSync(scenarioRoot)
  .filter((name) => name.endsWith('.canonical.json'))
  .map((name) => name.slice(0, name.indexOf('.')))
  .sort();

describe('a canonical snapshot against a fresh run at the CLI default', () => {
  it('ships exactly the snapshots DEC-008 Task 20 accounted for', () => {
    // Named as a number for the same reason every other corpus-size assertion in this
    // slice is: 24 inherited from before this task, 14 named individually by
    // `NEGOTIATION_SPEC` §10.3, and `grey_zone_flip` — one of the 24 — is not an
    // addition, only a rewrite (`DEC-008` Task 8's parked obligation, closed here).
    expect(SNAPSHOT_SCENARIOS).toHaveLength(38);
  });

  it.each(SNAPSHOT_SCENARIOS)('%s reproduces the file this build already ships', (scenario) => {
    const recorded = readFileSync(join(scenarioRoot, `${scenario}.canonical.json`), 'utf8');

    const result = loadAndRunScenario({
      repositoryRoot: repoRoot,
      scenario,
      checkpoint: null,
      seed: RECORDING_SEED
    });

    if (result.kind !== 'ran') {
      throw new Error(
        `'${scenario}' ships a canonical snapshot but does not reach 'ran' at the recording ` +
          `seed (kind: '${result.kind}') — a snapshot with nothing behind it to compare.`
      );
    }

    // `cli.ts`'s own `run` writes `${canonical}\n` — the trailing newline is part of
    // what was recorded, so it is part of what this test demands back.
    expect(`${toCanonicalJson(result.outcome)}\n`).toBe(recorded);
  });
});
