import { z } from 'zod';

import type { ContentFileSource } from '../file-source.ts';
import { readFile, validateValue } from '../strict-json.ts';

/**
 * The contract a scenario states about itself before anyone runs it: which outcome it
 * is expected to produce, how to break the game when that outcome is an error, and the
 * named checkpoints a caller can stop it at.
 *
 * Ported from `OathAndCoin.Content.Scenarios.ScenarioManifest`, and the shape of the
 * port is the one Task 6 established for content files: a Zod contract describes the
 * file, and every cross-field rule the contract cannot express is a named check with
 * the diagnostic the C# version printed. The wording of those diagnostics is kept word
 * for word — a message an author has learned to read should not change spelling
 * because the language did.
 */

/**
 * Whether a scenario is expected to complete normally or to fail with a specific, named
 * error. Its own field rather than something inferred from the presence of a fault: a
 * caller running a scenario to a checkpoint needs to know in advance what to assert
 * about the outcome, not guess it from another field's shape.
 *
 * `loading` is the game's pre-content screen. A scenario declaring it is never actually
 * run — no content is read, no command applied — because that screen exists precisely
 * for the moment before an outcome could exist at all.
 */
export const ScenarioOutcomeKind = Object.freeze({
  Success: 'success',
  Error: 'error',
  Loading: 'loading'
});

export type ScenarioOutcomeKind = (typeof ScenarioOutcomeKind)[keyof typeof ScenarioOutcomeKind];

/**
 * Every value `expectedScreenState` may hold — the five lowercase spellings the
 * presentation layer builds a catalogue key from. Restated here rather than imported,
 * for the reason the C# comment gives and the boundary rule enforces: this package sits
 * below presentation, and the reverse reference would be circular.
 */
export const KNOWN_SCREEN_STATES: readonly string[] = Object.freeze([
  'loading',
  'empty',
  'error',
  'incomplete',
  'normal'
]);

/**
 * The manifest format this build reads. Mirrors the content schema version: a manifest
 * authored for a later format is refused rather than read under this version's
 * assumptions.
 */
export const SUPPORTED_MANIFEST_SCHEMA_VERSION = 1;

/**
 * How to break the game before running the scenario, and where. Both fields are free
 * text rather than a closed set: the format is read by harness tasks that may invent a
 * new fault, and a closed vocabulary here would have to be extended for each.
 */
export interface FaultInjection {
  readonly kind: string;
  readonly path: string;
}

/**
 * A named point in a scenario's command sequence: everything up to and including the
 * command whose id is {@link afterCommandId} has run. Named rather than addressed by a
 * raw command id so a scenario's commands can be edited without renumbering every
 * caller that stops at one of them.
 */
export interface Checkpoint {
  readonly name: string;
  readonly afterCommandId: number;
}

export interface ScenarioManifest {
  readonly schemaVersion: number;
  readonly scenario: string;
  readonly expectedOutcome: ScenarioOutcomeKind;
  readonly fault: FaultInjection | null;
  readonly expectedErrorCode: string | null;
  readonly checkpoints: readonly Checkpoint[];
  /**
   * A repository-relative directory to read content from instead of the production
   * tree, or `null` for that tree unchanged. Unlike {@link fault} — which simulates a
   * broken root — this points at a real, loadable content set: a fixture authored
   * differently on purpose, not one that has to be missing.
   */
  readonly contentRoot: string | null;
  readonly expectedScreenState: string | null;
}

const faultFileSchema = z.strictObject({
  kind: z.string(),
  path: z.string()
});

const checkpointFileSchema = z.strictObject({
  name: z.string(),
  after_command_id: z.int()
});

const manifestFileSchema = z.strictObject({
  schema_version: z.int(),
  scenario: z.string(),
  expected_outcome: z.string(),
  fault: faultFileSchema.optional(),
  expected_error_code: z.string().nullish(),
  content_root: z.string().nullish(),
  expected_screen_state: z.string().nullish(),
  checkpoints: z.array(checkpointFileSchema)
});

/**
 * Reads and validates one manifest.
 *
 * @throws if the file is missing, malformed, has an unknown property, declares an
 * unsupported schema version, names a scenario other than the one its own file name
 * names, repeats a checkpoint name, or states an outcome inconsistent with its own
 * fields.
 */
export function loadScenarioManifest(
  source: ContentFileSource,
  path: string
): ScenarioManifest {
  const displayPath = source.describe(path);

  // Named by the source rather than by an absolute path, which is what the message
  // used to carry. `TDD` §18 asks for exactly that — a diagnostic must not leak the
  // layout of the machine that produced it — and the file name is what a scenario
  // author addresses this file by anyway.
  if (!source.exists(path)) {
    throw new Error(`Scenario manifest '${displayPath}' does not exist.`);
  }

  // The schema version is read before the contract is applied, the same split the
  // content loader makes: a file authored for an earlier format legitimately lacks
  // fields this one requires, and reporting those instead of the version mismatch
  // buries the one diagnostic that explains them.
  const raw = readFile(source, path, z.looseObject({ schema_version: z.unknown() }));
  const declaredVersion = raw.schema_version;
  if (declaredVersion !== SUPPORTED_MANIFEST_SCHEMA_VERSION) {
    throw new Error(
      `Scenario manifest '${displayPath}' declares schema_version ${String(declaredVersion)}, but ` +
        `this build reads version ${SUPPORTED_MANIFEST_SCHEMA_VERSION}. Migrate the file, or run a ` +
        'build that understands its version — reading it under the wrong version would be a guess.'
    );
  }

  const file = validateValue(displayPath, raw, manifestFileSchema);

  // Every caller addresses a scenario by file name and composes
  // `<scenario>.manifest.json` from it, then uses that requested id downstream. So
  // nothing ever reads this field back, and a manifest naming a different scenario than
  // the file holding it would go unnoticed on both sides at once.
  const namedScenario = scenarioIdIn(displayPath);
  if (file.scenario !== namedScenario) {
    throw new Error(
      `Scenario manifest '${displayPath}' declares scenario '${file.scenario}', but its file name ` +
        `names '${namedScenario}'. The field is this scenario's stable id and callers reach it by ` +
        'file name — two spellings mean one of them is never read.'
    );
  }

  const expectedOutcome = parseOutcome(file.expected_outcome, displayPath);
  const fault = file.fault === undefined ? null : { kind: file.fault.kind, path: file.fault.path };
  const contentRoot = file.content_root ?? null;
  const expectedErrorCode = file.expected_error_code ?? null;
  const expectedScreenState = file.expected_screen_state ?? null;

  if (expectedOutcome === ScenarioOutcomeKind.Error && expectedErrorCode === null) {
    throw new Error(
      `Scenario manifest '${displayPath}' declares expected_outcome 'error' but no ` +
        'expected_error_code — a caller checking the outcome would have nothing to compare against.'
    );
  }

  if (expectedOutcome !== ScenarioOutcomeKind.Error && fault !== null) {
    throw new Error(
      `Scenario manifest '${displayPath}' declares a fault but expected_outcome ` +
        `'${file.expected_outcome}' — only an 'error' scenario breaks the game on purpose.`
    );
  }

  if (expectedOutcome === ScenarioOutcomeKind.Loading && contentRoot !== null) {
    throw new Error(
      `Scenario manifest '${displayPath}' declares a content_root but expected_outcome 'loading' — ` +
        'a loading screen is shown before any content is read, so there is nothing here to point a ' +
        'content root at.'
    );
  }

  if (fault !== null && contentRoot !== null) {
    throw new Error(
      `Scenario manifest '${displayPath}' declares both a fault and a content_root — ambiguous ` +
        'which one decides the content root a run reads from. An error scenario combining both ' +
        'would have its fault silently overruled and would stop reproducing the failure its own ' +
        'name promises; state exactly one.'
    );
  }

  if (expectedScreenState !== null && !KNOWN_SCREEN_STATES.includes(expectedScreenState)) {
    throw new Error(
      `Scenario manifest '${displayPath}' declares expected_screen_state ` +
        `'${expectedScreenState}'; expected one of: ${KNOWN_SCREEN_STATES.join(', ')}.`
    );
  }

  const checkpoints: Checkpoint[] = [];
  const seenNames = new Set<string>();
  for (const checkpoint of file.checkpoints) {
    if (seenNames.has(checkpoint.name)) {
      throw new Error(
        `Scenario manifest '${displayPath}' declares checkpoint '${checkpoint.name}' more than ` +
          'once — a caller resolving it by name would not know which one was meant.'
      );
    }

    seenNames.add(checkpoint.name);
    checkpoints.push({ name: checkpoint.name, afterCommandId: checkpoint.after_command_id });
  }

  return {
    schemaVersion: file.schema_version,
    scenario: file.scenario,
    expectedOutcome,
    fault,
    expectedErrorCode,
    checkpoints,
    contentRoot,
    expectedScreenState
  };
}

/**
 * The scenario a file name names: everything before its first dot, so
 * `gate0.manifest.json` names `gate0` rather than `gate0.manifest`. A name with no dot
 * is taken whole rather than treated as an error here — this feeds a comparison, and
 * its message is clearer than "not a manifest file name" would be.
 */
function scenarioIdIn(fileName: string): string {
  const dot = fileName.indexOf('.');
  return dot < 0 ? fileName : fileName.slice(0, dot);
}

function parseOutcome(value: string, displayPath: string): ScenarioOutcomeKind {
  switch (value) {
    case ScenarioOutcomeKind.Success:
    case ScenarioOutcomeKind.Error:
    case ScenarioOutcomeKind.Loading:
      return value;
    default:
      throw new Error(
        `Scenario manifest '${displayPath}' has expected_outcome '${value}'; expected 'success', ` +
          "'error' or 'loading'."
      );
  }
}
