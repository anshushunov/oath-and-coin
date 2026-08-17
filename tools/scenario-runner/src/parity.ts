import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  artifactHash,
  loadAndRunScenario,
  runScenario,
  toCanonicalBytes,
  type ScenarioRunResult
} from '@oath-and-coin/content';

/**
 * Replays the frozen C# corpus against this port.
 *
 * **Bytes first, hash second, and that order is the point.** Every entry carries both
 * `canonical_base64` and `canonical_sha256`. A matching hash over different bytes is not
 * a thing that happens, so the hash is not what makes the comparison sound — it is a
 * second, independent signal, computed by a different route (this repository's own
 * SHA-256 over the same text). What the hash cannot do is say *where* two runs parted:
 * a report built on hashes alone answers "no" and stops. So the bytes are compared, and
 * when they differ the structures are walked to name the first JSON path that disagrees.
 *
 * Byte parity subsumes a good deal on its own — the seed, the ruleset version, the
 * content version, every step, every trace and the whole final state are inside those
 * bytes. Two things are outside them and are therefore checked separately: how much
 * randomness each individual step spent (the artifact records only the final ordinal),
 * and the error code of an entry that never produced an artifact at all.
 */

export interface EntryReference {
  readonly scenario: string;
  readonly checkpoint: string;
  readonly seed: string;
  readonly path: string;
}

export interface EntryVerdict {
  readonly scenario: string;
  readonly checkpoint: string;
  readonly seed: string;
  readonly matched: boolean;
  /** Empty when matched. Each entry names what disagreed and, where possible, where. */
  readonly failures: readonly string[];
}

export interface ParityReport {
  readonly oracleRoot: string;
  readonly sourceCommit: string;
  readonly scenarios: number;
  readonly checkpoints: number;
  readonly entries: number;
  readonly matched: number;
  readonly seeds: readonly string[];
  readonly verdicts: readonly EntryVerdict[];
}

interface CorpusManifest {
  readonly source_commit: string;
  readonly seeds: readonly string[];
  readonly scenarios: readonly {
    readonly scenario: string;
    readonly checkpoints: readonly {
      readonly checkpoint: string;
      readonly entries: readonly { readonly path: string; readonly seed: string }[];
    }[];
  }[];
}

/** Every entry the corpus manifest declares, in the order it declares them. */
export function readCorpusIndex(oracleRoot: string): {
  readonly manifest: CorpusManifest;
  readonly entries: readonly EntryReference[];
} {
  const manifest = readJson<CorpusManifest>(join(oracleRoot, 'manifest.json'));
  const entries: EntryReference[] = [];

  for (const scenario of manifest.scenarios) {
    for (const checkpoint of scenario.checkpoints) {
      for (const entry of checkpoint.entries) {
        entries.push({
          scenario: scenario.scenario,
          checkpoint: checkpoint.checkpoint,
          seed: entry.seed,
          path: entry.path
        });
      }
    }
  }

  return { manifest, entries };
}

/**
 * Replays one corpus entry and reports every way it disagreed.
 *
 * Every check runs; the first failure does not stop the rest. An entry that diverged in
 * two places should say so — a report that names one and stops turns one debugging
 * session into two.
 */
export function verifyEntry(
  repositoryRoot: string,
  oracleRoot: string,
  reference: EntryReference
): EntryVerdict {
  const entry = readJson<OracleEntry>(join(oracleRoot, reference.path));
  const failures: string[] = [];
  const seed = BigInt(entry.seed);

  const result = loadAndRunScenario({
    scenarioRoot: join(repositoryRoot, 'scenarios'),
    scenario: entry.scenario,
    checkpoint: entry.checkpoint,
    contentRoot: join(repositoryRoot, entry.inputs.content_root),
    seed
  });

  failures.push(...compareOutcomeKind(entry, result));

  if (result.kind !== 'ran') {
    // An entry that produced no artifact must not quietly "match" one that did.
    if (entry.canonical_base64 !== null) {
      failures.push(
        `the corpus recorded canonical bytes for this entry, but the port stopped at ` +
          `'${result.kind}' before producing an artifact`
      );
    }

    return verdict(reference, failures);
  }

  if (entry.canonical_base64 === null) {
    failures.push('the port produced an artifact where the corpus recorded none');
    return verdict(reference, failures);
  }

  const bytes = toCanonicalBytes(result.outcome);
  const actualBase64 = Buffer.from(bytes).toString('base64');

  if (actualBase64 !== entry.canonical_base64) {
    const expectedText = Buffer.from(entry.canonical_base64, 'base64').toString('utf8');
    const actualText = new TextDecoder().decode(bytes);
    failures.push(`canonical bytes differ: ${describeTextDifference(actualText, expectedText)}`);
    failures.push(
      `first structural difference: ${
        firstDifference(safeParse(actualText), safeParse(expectedText), '$') ??
        'none — the structures agree, so the difference is in the encoding itself'
      }`
    );
  }

  const actualHash = artifactHash(result.outcome);
  if (actualHash !== entry.canonical_sha256) {
    failures.push(
      `canonical sha256 differs: got ${actualHash}, corpus has ${entry.canonical_sha256}`
    );
  }

  // The seed the run was actually given, read back out of the only place a run can
  // report it. A port that ignored the seed handed to it would otherwise agree with
  // every entry recorded at the seed it happened to hard-code.
  if (result.outcome.finalState.metadata.campaignSeed !== seed) {
    failures.push(
      `final_state.metadata.campaign_seed is ` +
        `${String(result.outcome.finalState.metadata.campaignSeed)}, but this entry was run under ` +
        `${entry.seed}`
    );
  }

  if (result.outcome.finalState.metadata.contentVersion !== entry.inputs.content_version) {
    failures.push(
      `content_version is ${result.outcome.finalState.metadata.contentVersion}, corpus has ` +
        entry.inputs.content_version
    );
  }

  failures.push(...compareDraws(entry, result, seed));

  return verdict(reference, failures);
}

/** Every entry in the corpus, replayed. */
export function runParity(repositoryRoot: string, oracleRoot: string): ParityReport {
  const { manifest, entries } = readCorpusIndex(oracleRoot);
  const verdicts = entries.map((reference) => verifyEntry(repositoryRoot, oracleRoot, reference));

  return {
    oracleRoot,
    sourceCommit: manifest.source_commit,
    scenarios: manifest.scenarios.length,
    checkpoints: manifest.scenarios.reduce(
      (total, scenario) => total + scenario.checkpoints.length,
      0
    ),
    entries: entries.length,
    matched: verdicts.filter((verdictOf) => verdictOf.matched).length,
    seeds: manifest.seeds,
    verdicts
  };
}

interface OracleEntry {
  readonly scenario: string;
  readonly checkpoint: string;
  readonly seed: string;
  readonly canonical_base64: string | null;
  readonly canonical_sha256: string | null;
  readonly inputs: { readonly content_root: string; readonly content_version: string | null };
  readonly outcome: { readonly kind: string; readonly error_code: string | null };
  readonly draws: {
    readonly next_decision_ordinal_initial: string;
    readonly next_decision_ordinal_final: string;
    readonly total_consumed: string;
    readonly per_step: readonly {
      readonly command_id: number;
      readonly ordinal_before: string;
      readonly ordinal_after: string;
      readonly consumed: string;
    }[];
  };
}

function compareOutcomeKind(entry: OracleEntry, result: ScenarioRunResult): readonly string[] {
  const failures: string[] = [];

  const actualErrorCode = result.kind === 'failed' ? result.errorCode : null;
  if (actualErrorCode !== entry.outcome.error_code) {
    failures.push(
      `error code is ${actualErrorCode ?? 'null'}, corpus has ${entry.outcome.error_code ?? 'null'}`
    );
  }

  // The corpus records the manifest's *declared* outcome, and the exporter refused to
  // write an entry whose run did not land on it. So agreeing with the recorded kind is
  // agreeing with what the scenario claims about itself, not with a second copy of the
  // run.
  const actualKind =
    result.kind === 'loading' ? 'loading' : result.kind === 'failed' ? 'error' : 'success';
  if (actualKind !== entry.outcome.kind) {
    failures.push(`outcome kind is ${actualKind}, corpus has ${entry.outcome.kind}`);
  }

  return failures;
}

/**
 * How much randomness each step spent — derived, as the exporter derived it, by
 * replaying prefixes of the same command list and reading the ordinal off each
 * resulting state. Never by counting draws a second time: a second implementation of
 * the count would agree with itself and prove nothing about the rule.
 *
 * This is the one behavioural fact byte parity does not carry. The artifact records the
 * final ordinal, so a run that spent one ordinal on a step that should have spent none
 * and none on a step that should have spent one lands on the same total.
 */
function compareDraws(
  entry: OracleEntry,
  result: Extract<ScenarioRunResult, { kind: 'ran' }>,
  seed: bigint
): readonly string[] {
  const failures: string[] = [];
  const commands = result.commands;

  const ordinals: bigint[] = [];
  for (let prefix = 0; prefix <= commands.length; prefix++) {
    ordinals.push(
      prefix === commands.length
        ? result.outcome.finalState.metadata.nextDecisionOrdinal
        : runScenario(result.content, commands.slice(0, prefix), seed).finalState.metadata
            .nextDecisionOrdinal
    );
  }

  if (String(ordinals[0]) !== entry.draws.next_decision_ordinal_initial) {
    failures.push(
      `draws.next_decision_ordinal_initial is ${String(ordinals[0])}, corpus has ` +
        entry.draws.next_decision_ordinal_initial
    );
  }

  const finalOrdinal = ordinals[ordinals.length - 1]!;
  if (String(finalOrdinal) !== entry.draws.next_decision_ordinal_final) {
    failures.push(
      `draws.next_decision_ordinal_final is ${String(finalOrdinal)}, corpus has ` +
        entry.draws.next_decision_ordinal_final
    );
  }

  if (commands.length !== entry.draws.per_step.length) {
    failures.push(
      `draws.per_step has ${String(commands.length)} steps, corpus has ` +
        String(entry.draws.per_step.length)
    );
    return failures;
  }

  for (let index = 0; index < commands.length; index++) {
    const expected = entry.draws.per_step[index]!;
    const before = ordinals[index]!;
    const after = ordinals[index + 1]!;
    const consumed = after - before;

    if (commands[index]!.commandId !== expected.command_id) {
      failures.push(
        `draws.per_step[${String(index)}].command_id is ${String(commands[index]!.commandId)}, ` +
          `corpus has ${String(expected.command_id)}`
      );
    }

    if (String(consumed) !== expected.consumed) {
      failures.push(
        `draws.per_step[${String(index)}].consumed is ${String(consumed)}, corpus has ` +
          expected.consumed
      );
    }
  }

  return failures;
}

/**
 * The first JSON path at which two parsed artifacts disagree, or `null` when they do
 * not. Depth-first in key order, so the path it names is the leftmost difference rather
 * than whichever one a comparison happened to reach first.
 */
export function firstDifference(actual: unknown, expected: unknown, path: string): string | null {
  if (Array.isArray(actual) && Array.isArray(expected)) {
    if (actual.length !== expected.length) {
      return `${path}: array of ${String(actual.length)} where the corpus has ${String(expected.length)}`;
    }

    for (let index = 0; index < actual.length; index++) {
      const difference = firstDifference(
        actual[index],
        expected[index],
        `${path}[${String(index)}]`
      );
      if (difference !== null) {
        return difference;
      }
    }

    return null;
  }

  if (isPlainObject(actual) && isPlainObject(expected)) {
    const keys = [...new Set([...Object.keys(actual), ...Object.keys(expected)])].sort();
    for (const key of keys) {
      if (!(key in actual)) {
        return `${path}.${key}: absent here, present in the corpus`;
      }

      if (!(key in expected)) {
        return `${path}.${key}: present here, absent from the corpus`;
      }

      const difference = firstDifference(actual[key], expected[key], `${path}.${key}`);
      if (difference !== null) {
        return difference;
      }
    }

    return null;
  }

  if (!Object.is(actual, expected)) {
    return `${path}: ${JSON.stringify(actual)} where the corpus has ${JSON.stringify(expected)}`;
  }

  return null;
}

function describeTextDifference(actual: string, expected: string): string {
  const shared = Math.min(actual.length, expected.length);
  let index = 0;
  while (index < shared && actual[index] === expected[index]) {
    index++;
  }

  return (
    `${String(actual.length)} bytes here against ${String(expected.length)} in the corpus, ` +
    `first difference at offset ${String(index)}`
  );
}

function verdict(reference: EntryReference, failures: readonly string[]): EntryVerdict {
  return {
    scenario: reference.scenario,
    checkpoint: reference.checkpoint,
    seed: reference.seed,
    matched: failures.length === 0,
    failures
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}
