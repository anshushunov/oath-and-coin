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

/**
 * The outcome vocabulary (`RESOLUTION_SPEC` §2.1, §2.7). Exported here rather than left
 * inside the package because `packages/content` validates a hero's `capability` and a
 * contract's `needs` against it — the same road `CONTENT_ID_PATTERN` already travels.
 */
export { NEED_IDS, NeedId, compareNeedIds } from './domain/need-id.ts';
export { CommitmentState } from './domain/commitment.ts';
export type { HeroCapability } from './domain/capability.ts';
export {
  ConsequenceKind,
  CoverageVerdict,
  DeficitKind,
  OutcomeGrade,
  OutcomeIntentKind,
  type ContractResolution,
  type Deficit,
  type HeroConsequence,
  type HeroContribution,
  type NeedCoverage,
  type OutcomeIntent,
  type ResolutionDraft
} from './domain/outcome.ts';
export {
  OUTCOME_REASON_CODES,
  OutcomeReasonCodes,
  type OutcomeReasonCode
} from './domain/outcome-reason-codes.ts';

/**
 * The coverage arithmetic (`RESOLUTION_SPEC` §4.1–§4.3). Exported because the shipped
 * content's own viability — every contract reachable, and a crew that fits beating a
 * crew that is merely strong — is a claim about *content*, and the only place a check
 * can hold content and this arithmetic at once is `tests/oracle` (`ADR-002`: this
 * package cannot read a file).
 */
export {
  COVERAGE_FLOOR_PERCENT,
  SURPLUS_CAP_PERCENT,
  coverNeeds,
  type CoverageContext,
  type CoverageParticipant
} from './resolution/needs-coverage.ts';

/**
 * The rest of the outcome arithmetic (`RESOLUTION_SPEC` §4.4–§4.8, §5.1, §5.3).
 *
 * Exported for the same reason as the coverage above, plus one more: `settleContract`'s
 * own payout reads `termsOf(grade)`, and the balancing questions these answer — "is any
 * shipped contract impossible to fail gently", "does a fragile crew ever dominate" — are
 * claims about content that only `tests/oracle` can hold both halves of.
 */
export { MOTIVE_LIMIT_PERCENT, motiveOf, percentOf, reduceMargin } from './resolution/margin.ts';
export {
  COSTLY_PERCENT,
  FAILED_PERCENT,
  PARTIAL_FEE_PERCENT,
  gradeFromIntents,
  severityOf,
  termsOf,
  type GradeInput,
  type OutcomeTerms
} from './resolution/outcome-grade.ts';
export {
  coverageIntentsFor,
  falteredEarlyIntentsFor,
  objectiveIntentsFor,
  worstCoveredNeed,
  type CrewMember,
  type IntentInput
} from './resolution/outcome-intent.ts';
export {
  DOMINANCE_MARGIN_PERCENT,
  rankDeficits,
  type DeficitInput,
  type RankedDeficits
} from './resolution/deficits.ts';
export {
  GRUDGE_MAGNITUDE,
  TRUST_LOST_MAGNITUDE,
  WOUND_MAGNITUDE,
  consequencesFor,
  type ConsequenceInput
} from './resolution/consequences.ts';

/**
 * The resolver itself (`RESOLUTION_SPEC` §2.1, §4, §5) — a contract and the crew that went
 * out on it, answered as the events to raise and the result to store.
 *
 * `ResolutionInput` and `ContractResolver` are declared beside it rather than with the
 * rest of the outcome vocabulary because both name `ContractState` and `HeroState`
 * (§2.7); this is the export that makes them reachable, and the one `tests/oracle` needs
 * to run the shipped roster against the shipped contracts.
 */
export {
  draftResolution,
  type ContractResolver,
  type ResolutionInput
} from './resolution/contract-resolver.ts';

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
export {
  composeOffer,
  lockOffer,
  pollCrew,
  proposeContractToHero,
  resolveContract,
  settleContract
} from './engine.ts';
export { divideTowardZero, multiplyInt32, toInt32 } from './integer-division.ts';

export {
  GRIEVANCE_MAX,
  GRIEVANCE_VICTIM,
  WITNESS_SHARE,
  grievanceForBrokenPromise
} from './negotiation/grievance.ts';
export {
  STARTING_TREASURY,
  canCover,
  commitmentOf,
  reservedCommitments
} from './negotiation/commitments.ts';

export {
  heroNamedBy,
  isAnswerToAnOffer,
  type ContractResolved,
  type ContractSettled,
  type ContractSettledPromiseBroken,
  type ContractSettledPromiseKept,
  type DomainEvent,
  type HeroAcceptedContract,
  type HeroDeclinedContract,
  type HeroFalteredEarly,
  type HeroSufferedConsequence,
  type NeedCovered,
  type NeedShort,
  type ObjectiveLost,
  type ObjectiveTaken,
  type OfferLocked,
  type OfferRevised
} from './events/domain-event.ts';

export { ContractStatus, type ContractState } from './state/contract-state.ts';
export {
  MAX_TAGS_PER_CONTRACT,
  OfferPhase,
  createContractState,
  effectiveTags,
  initialOffer,
  type OfferState
} from './state/offer-state.ts';
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
  fromEvent,
  fromEvents,
  rejected,
  type CommandResult,
  type RejectionCode
} from './commands/command-result.ts';
export type { ComposeOffer } from './commands/compose-offer.ts';
export type { LockOffer } from './commands/lock-offer.ts';
export type { PollCrew } from './commands/poll-crew.ts';
export type { ProposeContractToHero } from './commands/propose-contract-to-hero.ts';
export type { ResolveContract } from './commands/resolve-contract.ts';
export type { SettleContract } from './commands/settle-contract.ts';

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
