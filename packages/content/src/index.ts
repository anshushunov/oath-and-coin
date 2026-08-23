/**
 * The content package's public surface — the half of it a browser can reach.
 *
 * Grown by the task that adds each part: Task 6 brings the contracts, the loader,
 * the digest and the locale catalogue; Task 8 brings the initial state the loader
 * builds; Task 10 brings scenarios and the determinism artifact; Task 12 replaces
 * every directory argument with a {@link ContentFileSource}, so that `apps/web` can
 * import this file at all (`ADR-010` §59, `FULL_TYPESCRIPT_MIGRATION` §12.2).
 *
 * Nothing reachable from here names a `node:*` module, and the boundary rule
 * `content-core-imports-only-simulation-and-zod` is what keeps that true rather
 * than the intention to keep it true. Callers with a filesystem want
 * `@oath-and-coin/content/node`, which holds the same loaders addressed by
 * directory.
 */

export {
  INCLINATION_WEIGHT_MAX,
  INCLINATION_WEIGHT_MIN,
  PATRON_FEE_MAX,
  PATRON_FEE_MIN,
  RELATIONSHIP_WEIGHT_MAX,
  RELATIONSHIP_WEIGHT_MIN,
  REQUIRED_CREW_MAX,
  REQUIRED_CREW_MIN,
  RISK_MAX,
  RISK_MIN,
  TRAIT_MAX,
  TRAIT_MIN
} from './bounds.ts';

export {
  MAX_ARTIFACT_SAFE_TEXT_LENGTH,
  MAX_FILE_SIZE_BYTES,
  MAX_JSON_DEPTH,
  MAX_RELATIONSHIPS_PER_HERO,
  MAX_TAGS_PER_CONTRACT,
  MAX_TRAITS_PER_HERO
} from './limits.ts';

export {
  SAVE_SCHEMA_VERSION,
  SUPPORTED_CONTENT_SCHEMA_VERSION,
  SUPPORTED_LOCALE_SCHEMA_VERSION
} from './versions.ts';

export {
  CONTENT_DIRECTORIES,
  SCHEMA_FILE_NAMES,
  contractFileSchema,
  heroFileSchema,
  localeFileSchema,
  relationshipFileSchema,
  traitFileSchema,
  type ContentDirectory,
  type ContractFile,
  type HeroFile,
  type LocaleFile,
  type TraitFile
} from './schemas.ts';

export {
  loadContentSet,
  type ContentSet,
  type ContractDefinition,
  type HeroDefinition,
  type HeroRelationship,
  type TraitDefinition,
  type TraitKind
} from './content-set.ts';

export {
  CONTENT_VERSION_LENGTH,
  computeContentDigest,
  computeContentVersion
} from './content-digest.ts';

export { memoryFileSource, type ContentFileSource } from './file-source.ts';

export { decodeUtf8OrThrow, encodeUtf8 } from './text-codec.ts';

export { fileName, isUnder, joinPath, parentPath, toPosixPath } from './paths.ts';

export { createInitialState } from './initial-state.ts';

export { loadLocaleCatalogue } from './locale.ts';

export {
  validateContentTree,
  validateContentTreeOrThrow,
  type ContentViolation
} from './validate.ts';

export { ERROR_CODES, ErrorCodes, type ErrorCode } from './error-codes.ts';

export {
  KNOWN_SCREEN_STATES,
  SUPPORTED_MANIFEST_SCHEMA_VERSION,
  ScenarioOutcomeKind,
  loadScenarioManifest,
  type Checkpoint,
  type FaultInjection,
  type ScenarioManifest
} from './scenarios/scenario-manifest.ts';
export {
  ScenarioCommandKind,
  loadScenarioCommands,
  type ComposeOfferScenarioCommand,
  type LockOfferScenarioCommand,
  type PollCrewScenarioCommand,
  type ProposeContractScenarioCommand,
  type ScenarioCommand
} from './scenarios/scenario-commands.ts';
export { commandsUpTo, resolveCheckpoint } from './scenarios/checkpoint-resolver.ts';
export { resolveContentRoot } from './scenarios/content-root.ts';
export {
  RULESET_VERSION,
  applyScenarioCommands,
  runScenario,
  type ScenarioOutcome,
  type StepDecision,
  type StepOutcome
} from './scenarios/scenario-runner.ts';
export {
  ARTIFACT_VERSION,
  artifactHash,
  renderDecision,
  renderTrace,
  toCanonicalBytes,
  toCanonicalJson
} from './scenarios/determinism-artifact.ts';
export {
  loadAndRunScenario,
  type FailedResult,
  type LoadingResult,
  type RanResult,
  type ScenarioRunRequest,
  type ScenarioRunResult
} from './scenarios/load-sequence.ts';

export {
  SAVE_ERROR_CODES,
  SaveErrorCodes,
  SaveReadError,
  type SaveErrorCode
} from './save/save-error-codes.ts';
export {
  MAX_APPLIED_COMMANDS,
  MAX_HEROES_PER_CONTRACT,
  decodeSnapshot,
  encodeSnapshot,
  requireReadableSnapshot
} from './save/snapshot-codec.ts';

export {
  UI_TEXT_ROOT,
  UI_TEXT_SCHEMA_VERSION,
  loadUiTextCatalogue,
  uiTextCatalogueFile,
  uiTextFileSchema,
  type UiTextFile
} from './ui-text/ui-text-catalogue.ts';
