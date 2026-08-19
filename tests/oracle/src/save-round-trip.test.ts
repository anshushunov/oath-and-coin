import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { parseContentId, type ContentId } from '@oath-and-coin/simulation';
import {
  RULESET_VERSION,
  applyScenarioCommands,
  artifactHash,
  createInitialState,
  decodeSnapshot,
  encodeSnapshot,
  runScenario,
  type ContentSet,
  type ScenarioCommand,
  type ScenarioOutcome
} from '@oath-and-coin/content';
import { loadContentSet } from '@oath-and-coin/content/node';
import { readCorpusIndex } from '@oath-and-coin/scenario-runner';
import { describe, expect, it } from 'vitest';

/**
 * A run continues from a state that came back from a save — the half of the round trip
 * `snapshot-codec.test.ts` (Task 16.1) does not cover, because that file never runs a
 * scenario's own commands against a decoded state. The frozen corpus has no
 * "save at k, finish at m" pair recorded (§ "Что корпус содержит и чего не содержит" of
 * the brief): every one of its 27 scenarios has exactly one checkpoint. A command prefix
 * stands in for it here — replaying the first half, round-tripping through the codec,
 * then replaying the rest and comparing against a whole, uninterrupted run of the same
 * commands.
 */

const repoRoot = resolve(import.meta.dirname, '..', '..', '..');
const corpusRoot = join(repoRoot, 'migration', 'oracle', 'v1');

interface RawCommand {
  readonly command_id: number;
  readonly hero_index: number;
  readonly contract: string;
  readonly expected_state_version: number;
}

/** The corpus entry's own JSON shape, read back only for the fields this file needs. */
interface CorpusRecord {
  readonly scenario: string;
  readonly checkpoint: string;
  readonly seed: string;
  readonly canonical_sha256: string | null;
  readonly final_state: unknown;
  readonly inputs: {
    readonly content_root: string;
    readonly commands: readonly RawCommand[];
  };
}

/** Every entry the manifest indexes, read from disk. */
function allCorpusRecords(): readonly CorpusRecord[] {
  const { entries } = readCorpusIndex(corpusRoot);
  return entries.map(
    (entry) => JSON.parse(readFileSync(join(corpusRoot, entry.path), 'utf8')) as CorpusRecord
  );
}

/** The one entry for a scenario at a given seed. */
function corpusRecord(scenario: string, seed: bigint): CorpusRecord {
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
 * The content, commands and seed a corpus record was produced from — everything
 * {@link applyScenarioCommands} and {@link createInitialState} need, read from
 * `record.inputs` rather than re-derived, so this file measures the port against what
 * the corpus recorded running, not against a second guess at it.
 */
function inputsOf(record: CorpusRecord): {
  readonly content: ContentSet;
  readonly commands: readonly ScenarioCommand[];
  readonly seed: bigint;
} {
  const content = loadContentSet(join(repoRoot, record.inputs.content_root));
  const commands: readonly ScenarioCommand[] = record.inputs.commands.map((command) => ({
    commandId: command.command_id,
    heroIndex: command.hero_index,
    contract: parseContentId(command.contract) as ContentId,
    expectedStateVersion: command.expected_state_version
  }));

  return { content, commands, seed: BigInt(record.seed) };
}

/** Replays a corpus record's own inputs, whole, through the port. */
function runCorpusRecord(record: CorpusRecord): ScenarioOutcome {
  const { content, commands, seed } = inputsOf(record);
  return runScenario(content, commands, seed);
}

describe('continuing a run from a state that came back from a save', () => {
  it('продолжение с загруженного состояния даёт замороженное финальное состояние', () => {
    const record = corpusRecord('mixed_gate_then_decisions', 7n);
    const { content, commands, seed } = inputsOf(record);

    const k = Math.floor(commands.length / 2);
    expect(k).toBeGreaterThan(0);

    const prefix = applyScenarioCommands(
      createInitialState(content, seed, RULESET_VERSION),
      commands.slice(0, k)
    );

    const reloaded = decodeSnapshot(
      JSON.parse(JSON.stringify(encodeSnapshot(prefix.finalState)))
    );

    const continued = applyScenarioCommands(reloaded, commands.slice(k));
    const full = runScenario(content, commands, seed);

    // Хеш целого прогона сравнивать нельзя впрямую: шагов до k у продолжения нет,
    // поэтому `continued.steps` короче, чем `full.steps`, и сравнение хешей двух
    // целых `ScenarioOutcome` разошлось бы по числу шагов, а не по состоянию.
    // Здесь шаги берутся у полного прогона (`full`), а его собственное финальное
    // состояние подменяется финальным состоянием продолжения — совпадение хешей
    // тогда проверяет именно состояние, ту же каноническую форму, что записана
    // корпусом.
    expect(artifactHash({ ...full, finalState: continued.finalState })).toBe(artifactHash(full));
    expect(continued.finalState).toEqual(full.finalState);
  });

  it('круг через сохранение сохраняет хеш артефакта на записях, у которых есть состояние', () => {
    // 50, а не 54: у `screen_error` и `screen_loading` `final_state` и
    // `canonical_sha256` равны null — прогон до состояния там не доходит.
    // Число проверяется, чтобы молчаливое сжатие набора не выглядело успехом.
    const records = allCorpusRecords().filter((r) => r.final_state !== null);
    expect(records).toHaveLength(50);

    for (const record of records) {
      const outcome = runCorpusRecord(record);
      const reloaded = decodeSnapshot(JSON.parse(JSON.stringify(encodeSnapshot(outcome.finalState))));

      // Если кодек потерял поле, которое несёт артефакт, замороженное число
      // разойдётся. Это страж от расхождения двух проекций — вместо обещания,
      // что они не разойдутся.
      expect(artifactHash({ ...outcome, finalState: reloaded })).toBe(record.canonical_sha256);
      expect(reloaded).toEqual(outcome.finalState);
    }
  });
});
