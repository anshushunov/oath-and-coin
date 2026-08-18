import {
  computeContentDigest as digestOfSource,
  computeContentVersion as versionOfSource
} from '../content-digest.ts';
import { loadContentSet as loadContentSetFrom, type ContentSet } from '../content-set.ts';
import type { ContentFileSource } from '../file-source.ts';
import { loadLocaleCatalogue as loadLocaleCatalogueFrom } from '../locale.ts';
import { fileName, parentPath, toPosixPath } from '../paths.ts';
import {
  loadAndRunScenario as loadAndRunScenarioFrom,
  type ScenarioRunRequest,
  type ScenarioRunResult
} from '../scenarios/load-sequence.ts';
import {
  loadScenarioCommands as loadScenarioCommandsFrom,
  type ScenarioCommand
} from '../scenarios/scenario-commands.ts';
import {
  loadScenarioManifest as loadScenarioManifestFrom,
  type ScenarioManifest
} from '../scenarios/scenario-manifest.ts';
import {
  validateContentTree as validateContentTreeFrom,
  validateContentTreeOrThrow as validateContentTreeOrThrowFrom,
  type ContentViolation
} from '../validate.ts';

import { isDirectory, nodeFileSource } from './file-source.ts';

/**
 * `@oath-and-coin/content/node` — the same loaders, addressed by directory.
 *
 * Two entry points rather than one because there are two runtimes and only one of them
 * has a filesystem. `@oath-and-coin/content` is what a browser bundle imports and names
 * no `node:*` module anywhere in its graph; everything here does, and nothing outside
 * this directory may.
 *
 * These are wrappers, not a second implementation. Each one builds a
 * {@link ContentFileSource} over a directory and hands it to the very function the
 * browser calls, so there is one loader, one digest and one set of diagnostics. That is
 * the point of the split: the alternative considered and rejected in
 * `FULL_TYPESCRIPT_MIGRATION` §12.2 — serialize the content at build time and let the
 * browser read the artifact — would have produced a second way to obtain a `ContentSet`,
 * obliged to agree with the first and with nothing forcing it to.
 *
 * The names are the ones callers already used, because these *are* the functions those
 * callers were calling; only the import specifier moved. Handing one of them a source by
 * mistake, or handing the core function a directory, is a type error rather than a
 * runtime surprise.
 */

export { nodeFileSource } from './file-source.ts';

/** SHA-256 over every file under `contentRoot` (`computeContentDigest`). */
export function computeContentDigest(contentRoot: string): string {
  return digestOfSource(nodeFileSource(contentRoot));
}

/** The first sixteen hex characters of the digest of the tree at `contentRoot`. */
export function computeContentVersion(contentRoot: string): string {
  return versionOfSource(nodeFileSource(contentRoot));
}

/**
 * Reads `heroes/`, `contracts/` and `traits/` under `contentRoot`.
 *
 * The root's own existence is checked here rather than inside the loader, and this is
 * the one diagnostic in the package that names the path it was given as it was given:
 * a caller who pointed at the wrong directory needs to be told which directory that
 * was, and only this side of the split knows.
 */
export function loadContentSet(contentRoot: string): ContentSet {
  return loadContentSetFrom(requireDirectory(contentRoot));
}

/** Validation stage 1 over every `*.json` under `contentRoot`. */
export function validateContentTree(contentRoot: string): readonly ContentViolation[] {
  return validateContentTreeFrom(requireDirectory(contentRoot));
}

/** As {@link validateContentTree}, throwing on the first violation. */
export function validateContentTreeOrThrow(contentRoot: string): void {
  validateContentTreeOrThrowFrom(requireDirectory(contentRoot));
}

/** One locale catalogue, named by its path. */
export function loadLocaleCatalogue(path: string) {
  return loadLocaleCatalogueFrom(nodeFileSource(parentPath(path)), fileName(path));
}

/** One scenario manifest, named by its path. */
export function loadScenarioManifest(path: string): ScenarioManifest {
  return loadScenarioManifestFrom(nodeFileSource(parentPath(path)), fileName(path));
}

/** One scenario command list, named by its path. */
export function loadScenarioCommands(path: string): readonly ScenarioCommand[] {
  return loadScenarioCommandsFrom(nodeFileSource(parentPath(path)), fileName(path));
}

/**
 * The load sequence, addressed the way every caller with a disk addresses it: a
 * repository root, and paths resolved against it.
 */
export interface ScenarioRunRequestFromDisk {
  /** The repository root a relative content root is resolved against. */
  readonly repositoryRoot: string;
  /**
   * Directory holding `<scenario>.manifest.json` and `<scenario>.commands.json`.
   * Defaults to `<repositoryRoot>/scenarios`.
   */
  readonly scenarioRoot?: string;
  readonly scenario: string;
  /** The checkpoint to stop at, or `null` for the manifest's last one. */
  readonly checkpoint: string | null;
  /** An explicit content root, absolute or repository-relative, overriding the manifest's. */
  readonly contentRoot?: string;
  readonly seed: bigint;
}

export function loadAndRunScenario(request: ScenarioRunRequestFromDisk): ScenarioRunResult {
  const repositoryRoot = toPosixPath(request.repositoryRoot);
  const scenarioRoot =
    request.scenarioRoot === undefined
      ? `${repositoryRoot}/scenarios`
      : request.scenarioRoot.replace(/\\/gu, '/');

  // The absent root is a result, not an accident: `CONTENT_ROOT_NOT_FOUND` is one of the
  // five stable error codes, and `screen_error` is a shipped scenario whose whole purpose
  // is to reach it.
  const openContentRoot = (path: string): ContentFileSource | null => {
    const full = isAbsolutePath(path) ? path : `${repositoryRoot}/${path}`;

    return isDirectory(full) ? nodeFileSource(full) : null;
  };

  const fromSources: ScenarioRunRequest = {
    scenarios: nodeFileSource(scenarioRoot),
    openContentRoot,
    scenario: request.scenario,
    checkpoint: request.checkpoint,
    ...(request.contentRoot === undefined ? {} : { contentRoot: request.contentRoot }),
    seed: request.seed
  };

  return loadAndRunScenarioFrom(fromSources);
}

function requireDirectory(contentRoot: string): ContentFileSource {
  if (!isDirectory(contentRoot)) {
    throw new Error(`Content root '${contentRoot}' does not exist.`);
  }

  return nodeFileSource(contentRoot);
}

/**
 * Whether a path names a place rather than something inside a source: a POSIX absolute
 * path, a Windows drive-qualified one, or a UNC share.
 *
 * Written out rather than taken from `node:path` for the reason the whole package no
 * longer imports it — one regular expression is cheaper than the platform-dependent
 * behaviour that came with it, and this is the only question about a path that this side
 * of the split still asks.
 */
function isAbsolutePath(path: string): boolean {
  return /^([A-Za-z]:)?[\\/]/u.test(path);
}
