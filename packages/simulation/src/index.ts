/**
 * The simulation package's public surface.
 *
 * Everything else in this package is reachable only through here, which is what
 * lets the boundary rule mean something: `content-depends-only-on-simulation`
 * checks direction, and a single entry point is what keeps a consumer from
 * reaching past the contract into a file that happened to be convenient.
 *
 * Grown by the task that adds each part, not written ahead: Task 6 brings
 * identity, canonicalization and the trait scale; Tasks 7-9 bring the RNG, state,
 * the decision rule and the engine that applies commands to it.
 */

export {
  CONTENT_ID_PATTERN,
  compareContentIds,
  contentIdName,
  contentIdNamespace,
  parseContentId,
  tryParseContentId,
  type ContentId
} from './ids/content-id.ts';

export { HERO_ID_MAX, HERO_ID_MIN, compareHeroIds, heroId, type HeroId } from './ids/hero-id.ts';

export { compareNumbers, compareStrings, type Comparator } from './collections/comparator.ts';
export { deepEqual } from './collections/deep-equal.ts';
export { SortedMap } from './collections/sorted-map.ts';
export { SortedSet } from './collections/sorted-set.ts';

export {
  createDecisionResult,
  type CausalTrace,
  type DecisionResult,
  type TraceBlock,
  type TraceFactor
} from './decisions/causal-trace.ts';
export type { HeldTrait } from './decisions/held-trait.ts';
export { ACTIONS, Actions } from './decisions/actions.ts';
export {
  BLOCK_REASON_CODES,
  FACTOR_REASON_CODES,
  REASON_CODES,
  ReasonCodes,
  TIE_BREAK_REASON_CODES,
  type ReasonCode
} from './decisions/reason-codes.ts';
export type { DecisionContext } from './decisions/context.ts';
export {
  MOOD_MAX,
  MOOD_MIN,
  decide,
  drawMood,
  type HeroDecision
} from './decisions/contract-decision-rule.ts';
export { proposeContractToHero } from './engine.ts';
export { divideTowardZero, multiplyInt32, toInt32 } from './integer-division.ts';

export type {
  DomainEvent,
  HeroAcceptedContract,
  HeroDeclinedContract
} from './events/domain-event.ts';

export { ContractStatus, type ContractState } from './state/contract-state.ts';
export type { HeroState } from './state/hero-state.ts';
export {
  contractOf,
  heroOf,
  withEvent,
  type GameMetadata,
  type GameState
} from './state/game-state.ts';

export {
  RejectionCodes,
  fromDecisions,
  rejected,
  type CommandResult,
  type RejectionCode
} from './commands/command-result.ts';
export type { ProposeContractToHero } from './commands/propose-contract-to-hero.ts';

export {
  ARTIFACT_SAFE_TEXT_PATTERN,
  isArtifactSafeText,
  requireArtifactSafeText
} from './canonical/artifact-domain.ts';
export {
  canonicalBytes,
  canonicalSha256,
  canonicalize,
  type CanonicalValue
} from './canonical/canonical-json.ts';
export { freezeDeep } from './freeze.ts';
export { UINT64_MAX, isUint64, requireUint64 } from './uint64.ts';
export { Sha256, sha256Hex, toHex } from './canonical/sha256.ts';
export { utf8Bytes } from './canonical/utf8.ts';

export {
  MAX_UINT64,
  RNG_ALGORITHM_VERSION,
  acceptanceThreshold,
  draw,
  drawInt32,
  type Int32Draw
} from './random/deterministic-rng.ts';
export { RNG_STREAM_NAMES, RngStream } from './random/rng-stream.ts';

export { TRAIT_SCALE } from './decisions/trait-scale.ts';
