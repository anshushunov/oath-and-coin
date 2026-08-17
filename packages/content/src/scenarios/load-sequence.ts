import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { loadContentSet, type ContentSet } from '../content-set.ts';
import { ErrorCodes, type ErrorCode } from '../error-codes.ts';
import { validateContentTreeOrThrow } from '../validate.ts';

import { commandsUpTo, resolveCheckpoint } from './checkpoint-resolver.ts';
import { loadScenarioCommands, type ScenarioCommand } from './scenario-commands.ts';
import {
  loadScenarioManifest,
  ScenarioOutcomeKind,
  type Checkpoint,
  type ScenarioManifest
} from './scenario-manifest.ts';
import { runScenario, type ScenarioOutcome } from './scenario-runner.ts';

/**
 * The game's own load sequence, as a production function.
 *
 * In C# this lived inside `game/app/Main.cs` as a private `LoadModel`, and
 * `FULL_TYPESCRIPT_MIGRATION` §3.6 records the consequence and the decision: neither
 * the oracle exporter nor any test observed it, so changing the stage order there would
 * redden nothing — and extracting it *in C#* was rejected, because it would have meant
 * refactoring a Godot host that is deleted at cutover. The debt was addressed to this
 * task instead, and this is where it is paid. The order below is a public, tested
 * function, and each of the five stable error codes is reachable from a fixture.
 *
 * **The order is the guarantee, not a convenience.** A scenario's own files are read
 * first, because a broken scenario is not a content problem and reporting it as one
 * sends an author to the wrong tree. The checkpoint resolves next, against a manifest
 * and a command list that are already known good. Only then is content touched, and
 * within that: the directory's existence (checked directly rather than inferred from
 * the loader's message), then schema validation (stage 1, `TDD` §11.2), then the loader
 * itself. Swapping the last two would report a mistyped field as whatever the loader
 * happens to say about the same file, which is the diagnostic an author cannot act on.
 *
 * **One argument the C# version had is gone.** `LoadModel` took a `schemaRoot` and ran
 * `ContentSchemas.Load(schemaRoot).ValidateOrThrow(contentRoot)`; here stage 1 is the
 * Zod contracts themselves, which are code rather than files on disk, so there is no
 * root to point at. The hand-written JSON Schemas still exist for the .NET side and are
 * held to the contracts by `pnpm schema:check` until cutover.
 */

export interface ScenarioRunRequest {
  /** Directory holding `<scenario>.manifest.json` and `<scenario>.commands.json`. */
  readonly scenarioRoot: string;
  readonly scenario: string;
  /** The checkpoint to stop at, or `null` for the manifest's last one. */
  readonly checkpoint: string | null;
  readonly contentRoot: string;
  readonly seed: bigint;
}

/** The scenario was read, but its manifest says the game never gets as far as content. */
export interface LoadingResult {
  readonly kind: 'loading';
  readonly manifest: ScenarioManifest;
  readonly checkpoint: Checkpoint;
}

/** The sequence stopped at a named stage. `errorCode` is the whole of what a screen shows. */
export interface FailedResult {
  readonly kind: 'failed';
  readonly errorCode: ErrorCode;
  /**
   * The underlying message. Machine-dependent — it can hold an absolute path — so it is
   * for a human reading a console, never for a comparison: the frozen corpus records
   * that `read_model` deliberately carries no `error_detail` for exactly this reason.
   */
  readonly errorDetail: string;
}

/** The scenario ran. */
export interface RanResult {
  readonly kind: 'ran';
  readonly manifest: ScenarioManifest;
  readonly checkpoint: Checkpoint;
  readonly commands: readonly ScenarioCommand[];
  readonly content: ContentSet;
  readonly outcome: ScenarioOutcome;
}

export type ScenarioRunResult = LoadingResult | FailedResult | RanResult;

export function loadAndRunScenario(request: ScenarioRunRequest): ScenarioRunResult {
  const manifestPath = join(request.scenarioRoot, `${request.scenario}.manifest.json`);
  const commandsPath = join(request.scenarioRoot, `${request.scenario}.commands.json`);

  let manifest: ScenarioManifest;
  let commands: readonly ScenarioCommand[];
  try {
    manifest = loadScenarioManifest(manifestPath);

    // A scenario that fails before any command runs has no command file at all, and
    // neither does one shown before any content is read. The resolver still refuses a
    // checkpoint naming a command id, so a command file that has genuinely gone missing
    // is caught there rather than assumed away.
    commands = existsSync(commandsPath) ? loadScenarioCommands(commandsPath) : [];
  } catch (cause) {
    return { kind: 'failed', errorCode: ErrorCodes.ScenarioInvalid, errorDetail: messageOf(cause) };
  }

  let checkpoint: Checkpoint;
  try {
    checkpoint = resolveCheckpoint(manifest, commands, request.checkpoint);
  } catch (cause) {
    return {
      kind: 'failed',
      errorCode: ErrorCodes.CheckpointUnknown,
      errorDetail: messageOf(cause)
    };
  }

  if (manifest.expectedOutcome === ScenarioOutcomeKind.Loading) {
    return { kind: 'loading', manifest, checkpoint };
  }

  const contentRoot = resolve(request.contentRoot);
  if (!isDirectory(contentRoot)) {
    return {
      kind: 'failed',
      errorCode: ErrorCodes.ContentRootNotFound,
      errorDetail: `Content root '${contentRoot}' does not exist.`
    };
  }

  try {
    validateContentTreeOrThrow(contentRoot);
  } catch (cause) {
    return { kind: 'failed', errorCode: ErrorCodes.SchemaInvalid, errorDetail: messageOf(cause) };
  }

  let content: ContentSet;
  try {
    content = loadContentSet(contentRoot);
  } catch (cause) {
    return { kind: 'failed', errorCode: ErrorCodes.ContentInvalid, errorDetail: messageOf(cause) };
  }

  const replayed = commandsUpTo(commands, checkpoint);

  return {
    kind: 'ran',
    manifest,
    checkpoint,
    commands: replayed,
    content,
    outcome: runScenario(content, replayed, request.seed)
  };
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
