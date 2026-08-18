import { loadContentSet, type ContentSet } from '../content-set.ts';
import { ErrorCodes, type ErrorCode } from '../error-codes.ts';
import type { ContentFileSource } from '../file-source.ts';
import { validateContentTreeOrThrow } from '../validate.ts';

import { commandsUpTo, resolveCheckpoint } from './checkpoint-resolver.ts';
import { resolveContentRoot } from './content-root.ts';
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
 * within that: whether the content root can be opened at all, then schema validation
 * (stage 1, `TDD` §11.2), then the loader itself. Swapping the last two would report a
 * mistyped field as whatever the loader happens to say about the same file, which is the
 * diagnostic an author cannot act on.
 *
 * **One argument the C# version had is gone.** `LoadModel` took a `schemaRoot` and ran
 * `ContentSchemas.Load(schemaRoot).ValidateOrThrow(contentRoot)`; here stage 1 is the
 * Zod contracts themselves, which are code rather than files on disk, so there is no
 * root to point at. The hand-written JSON Schemas still exist for the .NET side and are
 * held to the contracts by `pnpm schema:check` until cutover.
 *
 * **Two arguments the TypeScript version had are gone too, and for the same reason the
 * package as a whole stopped taking directories** (`FULL_TYPESCRIPT_MIGRATION` §12.2).
 * `repositoryRoot` and `scenarioRoot` were places on a disk; a browser has neither. What
 * is left is what the sequence actually needs: a source holding the scenario's own files,
 * and a way to open the content root the manifest decides on. `@oath-and-coin/content/node`
 * keeps the directory-shaped call for every caller that does have a disk.
 */

export interface ScenarioRunRequest {
  /** The scenario's own files — `<scenario>.manifest.json` and `<scenario>.commands.json`. */
  readonly scenarios: ContentFileSource;
  /**
   * Opens the content root at a repository-relative path, or answers `null` when
   * there is no such root.
   *
   * `null` rather than a throw because an absent content root is one of the five
   * stable error codes this sequence reports, not an accident: `screen_error` is a
   * shipped scenario whose entire purpose is to reach `CONTENT_ROOT_NOT_FOUND`.
   */
  readonly openContentRoot: (repositoryRelativePath: string) => ContentFileSource | null;
  readonly scenario: string;
  /** The checkpoint to stop at, or `null` for the manifest's last one. */
  readonly checkpoint: string | null;
  /**
   * An explicit content root, overriding the one the manifest decides.
   *
   * Optional, and that is the fix for a defect external review reproduced: this used to
   * be required, so every caller had to know a scenario's content root before reading
   * the scenario — and the two callers that did not, the CLI and the parity checker,
   * silently ran `screen_error` and `screen_empty` against the production tree.
   * `content_root` and `fault` were parsed by the manifest loader and consumed by
   * nothing. When this is absent the manifest decides, which is what it is for.
   */
  readonly contentRoot?: string;
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
   * The underlying message. For a human reading a console, never for a comparison: the
   * frozen corpus records that `read_model` deliberately carries no `error_detail` for
   * exactly that reason.
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
  /** Which content root the run actually read, in the repository-relative recorded form. */
  readonly contentRoot: string;
}

export type ScenarioRunResult = LoadingResult | FailedResult | RanResult;

export function loadAndRunScenario(request: ScenarioRunRequest): ScenarioRunResult {
  const manifestPath = `${request.scenario}.manifest.json`;
  const commandsPath = `${request.scenario}.commands.json`;

  let manifest: ScenarioManifest;
  let commands: readonly ScenarioCommand[];
  try {
    manifest = loadScenarioManifest(request.scenarios, manifestPath);

    // A scenario that fails before any command runs has no command file at all, and
    // neither does one shown before any content is read. The resolver still refuses a
    // checkpoint naming a command id, so a command file that has genuinely gone missing
    // is caught there rather than assumed away.
    commands = request.scenarios.exists(commandsPath)
      ? loadScenarioCommands(request.scenarios, commandsPath)
      : [];
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

  // The manifest decides, unless the caller overrode it. Resolving here rather than in
  // each caller is what makes `content_root` and `fault` mean something: a scenario that
  // declares a broken root reproduces its own failure without anyone having to know that
  // it should.
  let contentRoot: string;
  try {
    contentRoot =
      request.contentRoot === undefined
        ? resolveContentRoot(manifest)
        : request.contentRoot.replace(/\\/gu, '/');
  } catch (cause) {
    // An unreproducible fault kind is a fact about the scenario file, so it is reported
    // the way every other unreadable scenario is.
    return { kind: 'failed', errorCode: ErrorCodes.ScenarioInvalid, errorDetail: messageOf(cause) };
  }

  const content = request.openContentRoot(contentRoot);
  if (content === null) {
    return {
      kind: 'failed',
      errorCode: ErrorCodes.ContentRootNotFound,
      errorDetail: `Content root '${contentRoot}' does not exist.`
    };
  }

  try {
    validateContentTreeOrThrow(content);
  } catch (cause) {
    return { kind: 'failed', errorCode: ErrorCodes.SchemaInvalid, errorDetail: messageOf(cause) };
  }

  let contentSet: ContentSet;
  try {
    contentSet = loadContentSet(content);
  } catch (cause) {
    return { kind: 'failed', errorCode: ErrorCodes.ContentInvalid, errorDetail: messageOf(cause) };
  }

  const replayed = commandsUpTo(commands, checkpoint);

  return {
    kind: 'ran',
    manifest,
    checkpoint,
    commands: replayed,
    content: contentSet,
    outcome: runScenario(contentSet, replayed, request.seed),
    contentRoot
  };
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
