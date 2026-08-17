/**
 * The content package's public surface.
 *
 * Grown by the task that adds each part: Task 6 brings the contracts, the loader,
 * the digest and the locale catalogue; Task 8 brings the initial state the loader
 * builds; Task 10 brings scenarios and the determinism artifact.
 */

export {
  INCLINATION_WEIGHT_MAX,
  INCLINATION_WEIGHT_MIN,
  PAYMENT_MAX,
  PAYMENT_MIN,
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
  computeContentVersion,
  listFilesInOrdinalOrder,
  toRelativePosixPath,
  type ContentFile
} from './content-digest.ts';

export { loadLocaleCatalogue } from './locale.ts';

export {
  validateContentTree,
  validateContentTreeOrThrow,
  type ContentViolation
} from './validate.ts';
