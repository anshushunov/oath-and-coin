import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  runScenario,
  type ContentSet,
  type ScenarioCommand,
  type ScenarioOutcome
} from '@oath-and-coin/content';
import { loadContentSet } from '@oath-and-coin/content/node';
import { parseContentId, type ContentId } from '@oath-and-coin/simulation';
import { readCorpusIndex } from '@oath-and-coin/scenario-runner';

/**
 * The frozen corpus, read once and in one shape.
 *
 * The comparisons live in the test files; what lives here is only "what an entry is and
 * how a run is reproduced from it". Two files needed both — the round trip through the
 * codec and the read model rebuilt from a restored state — and two hand-written
 * statements of the same JSON shape would drift the first time a field was read.
 *
 * The *comparison* is deliberately not here: `tools/scenario-runner` owns that, and
 * `parity.test.ts` says why a second copy of it would only ever agree with itself.
 */

const repoRoot = resolve(import.meta.dirname, '..', '..', '..');

// Not exported: `parity.test.ts`, `rng.test.ts` and `canonical.test.ts` each still
// declare their own, and moving those three onto this one is not this task's change.
// An export nobody imports reads as a contract that already has consumers.
const corpusRoot = join(repoRoot, 'migration', 'oracle', 'v1');

interface RawCommand {
  readonly command_id: number;
  readonly hero_index: number;
  readonly contract: string;
  readonly expected_state_version: number;
}

/** The corpus entry's own JSON shape, read back only for the fields these tests need. */
export interface CorpusRecord {
  readonly scenario: string;
  readonly checkpoint: string;
  readonly seed: string;
  readonly canonical_sha256: string | null;
  readonly final_state: unknown;
  /**
   * The screen the C# original drew at this checkpoint, with the hash it took over it.
   * There is no `focused_contract` field and there cannot be one — the corpus is frozen —
   * so the contract a screen was focused on is read from the screen itself.
   */
  readonly read_model: {
    readonly sha256: string;
    readonly contract: { readonly definition: string } | null;
  };
  readonly inputs: {
    readonly content_root: string;
    readonly commands: readonly RawCommand[];
  };
}

/** Every entry the manifest indexes, read from disk. */
export function allCorpusRecords(): readonly CorpusRecord[] {
  const { entries } = readCorpusIndex(corpusRoot);
  return entries.map(
    (entry) => JSON.parse(readFileSync(join(corpusRoot, entry.path), 'utf8')) as CorpusRecord
  );
}

/** The one entry for a scenario at a given seed. */
export function corpusRecord(scenario: string, seed: bigint): CorpusRecord {
  const seedText = String(seed);
  const record = allCorpusRecords().find(
    (candidate) => candidate.scenario === scenario && candidate.seed === seedText
  );

  if (record === undefined) {
    throw new Error(`no corpus entry for scenario '${scenario}' at seed ${seedText}`);
  }

  return record;
}

/**
 * The content, commands and seed a corpus record was produced from — everything a replay
 * needs, read from `record.inputs` rather than re-derived, so a test measures the port
 * against what the corpus recorded running and not against a second guess at it.
 */
export function inputsOf(record: CorpusRecord): {
  readonly content: ContentSet;
  readonly commands: readonly ScenarioCommand[];
  readonly seed: bigint;
} {
  const content = loadContentSet(join(repoRoot, record.inputs.content_root));
  const commands: readonly ScenarioCommand[] = record.inputs.commands.map((command) => ({
    commandId: command.command_id,
    heroIndex: command.hero_index,
    contract: parseContentId(command.contract),
    expectedStateVersion: command.expected_state_version
  }));

  return { content, commands, seed: BigInt(record.seed) };
}

/** Replays a corpus record's own inputs, whole, through the port. */
export function runCorpusRecord(record: CorpusRecord): ScenarioOutcome {
  const { content, commands, seed } = inputsOf(record);
  return runScenario(content, commands, seed);
}

/**
 * The contract the recorded screen was focused on, or `undefined` for a screen that
 * offered nothing.
 *
 * Read off `read_model.contract` because the corpus has no field naming it directly and
 * never will. That is not a weaker source: the recorded read model *is* the screen the
 * original drew, so the contract on it is the contract it was focused on, by definition.
 */
export function focusedContractOf(record: CorpusRecord): ContentId | undefined {
  return record.read_model.contract === null
    ? undefined
    : parseContentId(record.read_model.contract.definition);
}
