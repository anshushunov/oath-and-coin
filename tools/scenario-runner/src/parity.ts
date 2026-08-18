import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { canonicalSha256, sha256Hex, type CanonicalValue } from '@oath-and-coin/simulation';
import {
  artifactHash,
  runScenario,
  toCanonicalBytes,
  type ScenarioRunResult
} from '@oath-and-coin/content';
import { loadAndRunScenario, loadScenarioManifest } from '@oath-and-coin/content/node';
import {
  describeReadModel,
  readModelHash,
  type ContractOfferScreenModel
} from '@oath-and-coin/presentation';
import { screenFor } from '@oath-and-coin/application';

/**
 * Replays the frozen C# corpus against this port.
 *
 * **Bytes first, hash second, and each buys something the other does not.** Every entry
 * carries both `canonical_base64` and `canonical_sha256`. Once the two are known to
 * agree — which is checked here first, and was not before external review pointed out
 * that the claim below assumed it — a divergence in the *run* is caught by either, and
 * what the bytes add is the answer to *where*: the structures are walked and the first
 * disagreeing JSON path is named. What the bytes also add, and the hash cannot, is
 * catching an entry that disagrees with itself.
 *
 * Byte parity subsumes a good deal on its own — the seed, the ruleset version, the
 * content version, every step, every trace and the whole final state are inside those
 * bytes. Three things are outside them and are therefore checked separately: how much
 * randomness each individual step spent (the artifact records only the final ordinal),
 * the error code of an entry that never produced an artifact at all, and the identity
 * the manifest indexes the entry under.
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

  failures.push(...compareIdentity(entry, reference));
  failures.push(...compareInternalConsistency(entry));

  // No `contentRoot` override: today's manifest decides, and the root it decides on is
  // then compared with the one the corpus recorded. Passing the recorded value in would
  // have made the run agree with the corpus about the one input the corpus is supposed
  // to be checking.
  const result = loadAndRunScenario({
    repositoryRoot,
    scenario: entry.scenario,
    checkpoint: entry.checkpoint,
    seed
  });

  failures.push(...compareManifest(entry, repositoryRoot));
  failures.push(...compareOutcomeKind(entry, result));
  failures.push(...compareReadModel(entry, result));

  if (result.kind === 'ran' && result.contentRoot !== entry.inputs.content_root) {
    failures.push(
      `the manifest sends this run to '${result.contentRoot}', the corpus recorded ` +
        `'${entry.inputs.content_root}'`
    );
  }

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
  readonly inputs: {
    readonly content_root: string;
    readonly content_version: string | null;
    readonly manifest: RecordedManifest;
  };
  readonly outcome: {
    readonly kind: string;
    readonly error_code: string | null;
    readonly screen_state: string;
  };
  /**
   * The screen the C# factory built, with its own SHA-256 alongside it. Every key of
   * the projection plus `sha256` — which is *not* part of what was hashed.
   */
  readonly read_model: Record<string, unknown> & { readonly sha256: string };
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

/**
 * The index and the file must be talking about the same entry.
 *
 * Until external review reproduced it, nothing tied the two together: the file was
 * located by the manifest's `path` and then run from *its own* `scenario`, `checkpoint`
 * and `seed`, while the verdict was labelled from the manifest's. Handing this function
 * a reference whose checkpoint had been changed produced `matched: true` under the wrong
 * name — a report signed with an identity it had not verified. The seed is part of an
 * entry's identity (`FULL_TYPESCRIPT_MIGRATION` §3.1), so it is part of what has to
 * agree, and the path is checked as well: the corpus addresses an entry by
 * `scenarios/<scenario>/<checkpoint>/seed-<seed>.json`, and a manifest naming a file
 * somewhere else has stopped describing the corpus it indexes.
 *
 * The bytes of each file are covered elsewhere and are not re-checked here: the manifest
 * carries a SHA-256 per file and `tests/oracle/canonical.test.ts` recomputes all 57 with
 * this repository's own implementation (§7.3).
 */
function compareIdentity(entry: OracleEntry, reference: EntryReference): readonly string[] {
  const failures: string[] = [];

  if (entry.scenario !== reference.scenario) {
    failures.push(
      `the manifest indexes this file as scenario '${reference.scenario}', the file says ` +
        `'${entry.scenario}'`
    );
  }

  if (entry.checkpoint !== reference.checkpoint) {
    failures.push(
      `the manifest indexes this file as checkpoint '${reference.checkpoint}', the file says ` +
        `'${entry.checkpoint}'`
    );
  }

  if (entry.seed !== reference.seed) {
    failures.push(
      `the manifest indexes this file at seed ${reference.seed}, the file says ${entry.seed}`
    );
  }

  const expectedPath = `scenarios/${entry.scenario}/${entry.checkpoint}/seed-${entry.seed}.json`;
  if (reference.path.replace(/\\/gu, '/') !== expectedPath) {
    failures.push(`the manifest indexes this entry at '${reference.path}', not '${expectedPath}'`);
  }

  return failures;
}

/**
 * The corpus entry has to agree with itself before it can be an oracle for anything.
 *
 * `canonical_base64` and `canonical_sha256` are two statements about the same artifact.
 * Comparing a run against both without first checking that they agree lets an
 * internally inconsistent entry decide which of the two the port is measured on — and
 * `FULL_TYPESCRIPT_MIGRATION` §9.5 draws a line between what the hash buys and what the
 * bytes buy that only holds once these two are known to be consistent. Found by external
 * review, which pointed out that the claim was unconditional and the code did not make
 * it so.
 */
function compareInternalConsistency(entry: OracleEntry): readonly string[] {
  if (entry.canonical_base64 === null || entry.canonical_sha256 === null) {
    return entry.canonical_base64 === entry.canonical_sha256
      ? []
      : ['the corpus entry records one of canonical_base64 and canonical_sha256 without the other'];
  }

  const recomputed = sha256Hex(Buffer.from(entry.canonical_base64, 'base64'));
  return recomputed === entry.canonical_sha256
    ? []
    : [
        `the corpus entry disagrees with itself: sha256 of its own canonical_base64 is ` +
          `${recomputed}, but it records ${entry.canonical_sha256}`
      ];
}

/** The manifest exactly as the exporter recorded it, field for field. */
interface RecordedManifest {
  readonly schema_version: number;
  readonly scenario: string;
  readonly expected_outcome: string;
  readonly expected_error_code: string | null;
  readonly expected_screen_state: string | null;
  readonly content_root: string | null;
  readonly fault: { readonly kind: string; readonly path: string } | null;
  readonly checkpoints: readonly { readonly name: string; readonly after_command_id: number }[];
}

/**
 * Today's manifest against the one the corpus froze.
 *
 * This is the hole external review found, and it was the biggest one in the segment:
 * parity ran a scenario from the *corpus entry's* recorded inputs, so the manifest files
 * in `scenarios/` were never read by the gate at all. Changing `screen_error`'s
 * `expected_error_code` to a different valid code left `54/54 reproduced` untouched —
 * a scenario had quietly stopped meaning what it used to mean and the one gate that
 * exists to notice said nothing.
 *
 * The whole declarative half of a manifest is compared, not a chosen subset: the outcome
 * it expects, the error code, the screen state, the content root, the fault and the
 * checkpoints. Those are exactly the fields byte parity cannot reach — a scenario that
 * produces no artifact has no bytes to differ, and `expected_outcome` never enters an
 * artifact even when one exists.
 */
function compareManifest(entry: OracleEntry, repositoryRoot: string): readonly string[] {
  let current: RecordedManifest;
  try {
    const manifest = loadScenarioManifest(
      join(repositoryRoot, 'scenarios', `${entry.scenario}.manifest.json`)
    );

    current = {
      schema_version: manifest.schemaVersion,
      scenario: manifest.scenario,
      expected_outcome: manifest.expectedOutcome,
      expected_error_code: manifest.expectedErrorCode,
      expected_screen_state: manifest.expectedScreenState,
      content_root: manifest.contentRoot,
      fault: manifest.fault,
      checkpoints: manifest.checkpoints.map((checkpoint) => ({
        name: checkpoint.name,
        after_command_id: checkpoint.afterCommandId
      }))
    };
  } catch (cause) {
    return [`the scenario's manifest no longer loads: ${messageOf(cause)}`];
  }

  const difference = firstDifference(current, entry.inputs.manifest, '$.manifest');
  return difference === null
    ? []
    : [`the manifest has changed since the corpus was frozen: ${difference}`];
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
 * The screen the corpus recorded, against the screen this port builds.
 *
 * This is the last zone the frozen corpus covered and parity did not. Until Task 11
 * there was no read model in the new stack at all, so "54/54 reproduced" meant "by
 * everything the domain and content layers produce" (`FULL_TYPESCRIPT_MIGRATION` §10.5)
 * — the screen was outside it.
 *
 * Three separate comparisons, and each buys something the others do not.
 *
 * 1. **The entry against itself.** `read_model.sha256` is a statement about the object
 *    it sits inside. If the two disagree, the entry cannot be an oracle for either, and
 *    a port measured only against the hash would be measured against a number with
 *    nothing behind it. The same discipline `compareInternalConsistency` applies to the
 *    artifact, applied here for the reason §3.6 recorded: a test that compares hash to
 *    hash agrees with the exporter in everything the exporter got wrong.
 * 2. **This port's hash against the recorded one.** One number, computed from the
 *    canonical projection with this repository's own SHA-256.
 * 3. **The projections themselves, field for field.** A hash says *that* two screens
 *    differ. Only the structures say *where* — and "where" is the whole difference
 *    between a failing gate someone can act on and one they have to re-derive.
 *
 * Runs for every entry, including the ones that produced no artifact: `screen_loading`
 * and `screen_error` have a recorded screen precisely because a failed run still has to
 * show a player something.
 */
function compareReadModel(entry: OracleEntry, result: ScenarioRunResult): readonly string[] {
  const failures: string[] = [];

  // An entry with no recorded screen is not "an entry that happens to match"; it is an
  // entry this comparison cannot be run against. Reported rather than thrown: the first
  // version destructured `entry.read_model` directly, and external review pointed out
  // that a corpus missing the field would abort the whole parity run with a TypeError
  // naming neither the entry nor the field.
  if (typeof entry.read_model !== 'object' || entry.read_model === null) {
    return ['the corpus entry records no read_model, so the screen cannot be compared at all'];
  }

  if (typeof entry.outcome.screen_state !== 'string') {
    failures.push('the corpus entry records no outcome.screen_state');
  }

  const { sha256: recordedHash, ...recorded } = entry.read_model;

  if (typeof recordedHash !== 'string') {
    return [...failures, 'the corpus entry records a read_model with no sha256 beside it'];
  }

  // The corpus hashed the projection *without* the hash it stores beside it. Recomputed
  // here from the recorded object rather than trusted, so an entry that disagrees with
  // itself is named as such instead of quietly deciding which half the port is measured
  // against.
  const recomputed = canonicalSha256(recorded as CanonicalValue);
  if (recomputed !== recordedHash) {
    failures.push(
      `the corpus entry's read_model disagrees with itself: canonicalizing it without its own ` +
        `sha256 gives ${recomputed}, but it records ${recordedHash}`
    );
  }

  let model: ContractOfferScreenModel;
  try {
    model = screenFor(result);
  } catch (cause) {
    return [...failures, `building the screen for this entry threw: ${messageOf(cause)}`];
  }

  const screenState = model.state.toLowerCase();
  if (screenState !== entry.outcome.screen_state) {
    failures.push(`screen state is '${screenState}', corpus has '${entry.outcome.screen_state}'`);
  }

  const actualHash = readModelHash(model);
  if (actualHash !== recordedHash) {
    failures.push(`read_model sha256 differs: got ${actualHash}, corpus has ${recordedHash}`);
  }

  const difference = firstDifference(describeReadModel(model), recorded, '$.read_model');
  if (difference !== null) {
    failures.push(`read model differs: ${difference}`);
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

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}
