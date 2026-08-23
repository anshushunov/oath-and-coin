import { z } from 'zod';

import {
  ARTIFACT_SAFE_TEXT_PATTERN,
  BLOCK_REASON_CODES,
  CONTENT_ID_PATTERN,
  ContractStatus,
  FACTOR_REASON_CODES,
  GRIEVANCE_MAX,
  HERO_ID_MAX,
  HERO_ID_MIN,
  OfferPhase,
  SortedMap,
  SortedSet,
  TIE_BREAK_REASON_CODES,
  UINT64_MAX,
  compareContentIds,
  compareHeroIds,
  compareNumbers,
  freezeDeep,
  heroId,
  parseContentId,
  type CausalTrace,
  type Comparator,
  type ContentId,
  type ContractState,
  type DomainEvent,
  type GameState,
  type HeldTrait,
  type HeroId,
  type HeroState,
  type TraceBlock,
  type TraceFactor
} from '@oath-and-coin/simulation';

import {
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
} from '../bounds.ts';
import {
  MAX_ARTIFACT_SAFE_TEXT_LENGTH,
  MAX_RELATIONSHIPS_PER_HERO,
  MAX_TAGS_PER_CONTRACT,
  MAX_TRAITS_PER_HERO
} from '../limits.ts';

import { SaveErrorCodes, SaveReadError, type SaveErrorCode } from './save-error-codes.ts';

/**
 * The campaign snapshot's own codec — the reversible half of `GameState` (`TDD`
 * §12). `determinism-artifact.ts`'s `describeState` looks like this and is not:
 * it writes `bigint` as a JSON number, which the frozen corpus's own test
 * (`canonical-json.test.ts`) records as lossy above 2^53, and it never reads its
 * own output back. This module writes every 64-bit value as a decimal string, and
 * both directions are exercised by the same test, because a save that cannot read
 * back what it wrote is not a save.
 */

/**
 * Every bound this codec adds beyond `bounds.ts` and `limits.ts` — for the parts
 * of `GameState` content does not shape at all. Each is a documented multiple of
 * what the current rules can actually produce, not a number picked by eye
 * (`TDD` §18, spec §2.4).
 */

/**
 * A single decision (`contract-decision-rule.ts`) can push a factor onto one side
 * — positive or negative — from at most: the fixed terms that ever land on one
 * particular side (patron fee, trust and mood-positive on the positive side; risk,
 * insult and mood-negative on the negative one — three per side), plus every
 * inclination landing on that side (at most `MAX_TRAITS_PER_HERO`) and every bond
 * landing on that side (at most `MAX_RELATIONSHIPS_PER_HERO`). That ceiling is
 * `3 + 4 + 5 = 12`. Doubled here so a future term added to the decision rule does
 * not force this constant to move in lockstep with it.
 */
const MAX_FACTORS_PER_TRACE_SIDE = 2 * (3 + MAX_TRAITS_PER_HERO + MAX_RELATIONSHIPS_PER_HERO);

/**
 * A block is produced by a principle trait whose tag the offered contract
 * carries (`contract-decision-rule.ts`), so a single decision can never produce
 * more blocks than the hero holds traits — `MAX_TRAITS_PER_HERO`. Doubled for the
 * same headroom reason as {@link MAX_FACTORS_PER_TRACE_SIDE}.
 */
const MAX_BLOCKS_PER_TRACE = 2 * MAX_TRAITS_PER_HERO;

/**
 * `engine.ts` records a command id in `appliedCommandIds`, and appends exactly
 * one event to `history`, only for a command that actually decided something —
 * and `ContractState.respondedBy` refuses a hero a second decision on the same
 * contract, ever. So across a campaign's whole life, the number of applied
 * commands (and therefore of history events) cannot exceed
 * `heroes × contracts`. Today's content (`content/heroes`, `content/contracts`)
 * has 6 heroes and 4 contracts — an achievable ceiling of 24. This constant is a
 * multiple of that (`4×`), not the achievable number itself, so it does not have
 * to move every time content grows, while a save claiming an impossible campaign
 * length is still refused rather than allocated.
 */
export const MAX_APPLIED_COMMANDS = 4 * 24;

/**
 * `respondedBy` and `acceptedBy` are both subsets of the campaign's own hero
 * roster (`ContractState`'s own doc: "heroes who have already responded" /
 * "accepted and joined the crew"), so neither can ever hold more entries than
 * there are heroes. Today's content (`content/heroes`) has 6. Multiplied the
 * same way {@link MAX_APPLIED_COMMANDS} is, for the same reason: a bound that
 * moved every time a hero was added would defeat the point of being a ceiling
 * rather than a mirror of content.
 *
 * Both ceilings are exported, and only so that
 * `content-fits-the-save-ceilings.test.ts` can hold the *shipped tree* to them. They
 * are derived from today's content volume, so content growing past them is the one way
 * a legitimate campaign would start producing saves this build refuses — the same class
 * of hole external review of Task 16 found on {@link MAX_ARTIFACT_SAFE_TEXT_LENGTH},
 * closed the same way: by a check that reddens in CI rather than at a player's save
 * button.
 */
export const MAX_HEROES_PER_CONTRACT = 4 * 6;

/** 64-битное значение десятичной строкой. */
const uint64 = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,19})$/u)
  .refine((s) => BigInt(s) <= UINT64_MAX, 'больше 2^64 − 1');

const contentId = z.string().regex(new RegExp(CONTENT_ID_PATTERN));

const heroIdSchema = z.int().min(HERO_ID_MIN).max(HERO_ID_MAX);

/**
 * The fields this ceiling covers are the ones that reach a canonical determinism
 * artifact without going through a content contract on the way in: a hero's
 * `displayNameKey` (validated once, at content-load time, then carried unchanged for
 * the rest of the campaign), the campaign's own `rulesetVersion`/`contentVersion`
 * (strings a *tool* supplied — `createInitialState`'s own checks look at them once, at
 * construction, not again on every read), and a trace's `reasonCode`/`tieBreak` (drawn
 * from the engine's closed `ReasonCodes` vocabulary). None of these is re-validated by
 * anything between where it was first checked and where this codec reads a save back
 * from an untrusted file — which is exactly the boundary `artifact-domain.ts`'s own
 * comment describes as needing its own gate, not a trust in whatever produced the
 * bytes.
 *
 * The number itself lives in `limits.ts` and is applied by `schemas.ts` too, so that
 * this reader cannot refuse what that loader accepts; see that constant's own comment
 * for the measured hole that moved it there.
 *
 * A regex, not `.refine(isArtifactSafeText)`: a regex failure carries Zod's own
 * `invalid_format` issue code, which {@link classify} already treats as
 * `Malformed` — a wrong character set is a shape problem, not a value out of
 * range. A `refine` would report `custom`, the same code {@link uint64}'s own
 * bound check uses, and conflate "this text has a Cyrillic letter in it" with
 * "this number is bigger than 2^64 − 1" under one `OutOfBounds` verdict.
 */
const artifactSafeText = z
  .string()
  .max(MAX_ARTIFACT_SAFE_TEXT_LENGTH)
  .regex(new RegExp(ARTIFACT_SAFE_TEXT_PATTERN));

/**
 * Карта пишется парами, а не списком значений.
 *
 * Проекция артефакта пишет `values()` и выводит ключ из `id` внутри значения.
 * Совпадение ключа и `id` не принуждено ничем: состояние, у которого они
 * разошлись, при таком чтении молча перекнопилось бы. Здесь ключ записан, а его
 * равенство `id` — отдельная проверка с отдельным отказом.
 */
const entries = <K extends z.ZodTypeAny, V extends z.ZodTypeAny>(key: K, value: V) =>
  z.array(z.object({ key, value })).max(4096);

const relationshipsSchema = entries(
  contentId,
  z.int().min(RELATIONSHIP_WEIGHT_MIN).max(RELATIONSHIP_WEIGHT_MAX)
).max(MAX_RELATIONSHIPS_PER_HERO);

const heroValueSchema = z.strictObject({
  id: heroIdSchema,
  definition: contentId,
  displayNameKey: artifactSafeText,
  greed: z.int().min(TRAIT_MIN).max(TRAIT_MAX),
  caution: z.int().min(TRAIT_MIN).max(TRAIT_MAX),
  pride: z.int().min(TRAIT_MIN).max(TRAIT_MAX),
  trustInGuild: z.int().min(TRAIT_MIN).max(TRAIT_MAX),
  traits: z.array(contentId).max(MAX_TRAITS_PER_HERO),
  relationships: relationshipsSchema,
  // `NEGOTIATION_SPEC` §2.2. `grievance` is bounded by `GRIEVANCE_MAX` itself, the way
  // every other field above is bounded by the true ceiling `decide()`/`settleContract`
  // can produce, not left as an unbounded int the way a campaign counter is.
  believesGuildPromises: z.boolean(),
  grievance: z.int().min(0).max(GRIEVANCE_MAX)
});

const contractStatusSchema = z.union([
  z.literal(ContractStatus.Offered),
  z.literal(ContractStatus.Crewed)
]);

const offerPhaseSchema = z.union([
  z.literal(OfferPhase.Draft),
  z.literal(OfferPhase.Locked),
  z.literal(OfferPhase.Settled)
]);

/**
 * `ContractState.offer`'s own shape (`NEGOTIATION_SPEC` §2.1), nested exactly where
 * `respondedBy`/`acceptedBy` used to sit flat on the contract — Task 6 moved the
 * fields, this codec follows them to their new address. `advance`/`promisedBonus`
 * bound by the patron-fee *range* rather than by the specific contract's own
 * `patronFee`: the tighter, per-contract relationship (`0 ≤ advance ≤ patronFee`) is
 * not a shape this schema can state without cross-referencing a sibling field.
 *
 * **This schema bounds shape only, and — unlike `contractStatusSchema`'s sibling
 * fields — the domain invariants above that shape are not enforced anywhere in this
 * module.** `createContractState` (`NEGOTIATION_SPEC` §2.1) was routed in here once,
 * in review, and reverted: `engine.ts`'s current `proposeContractToHero` predates the
 * offer protocol and never sets `offer.keyHero`, so a save this build's own engine
 * genuinely produces already violates the draft invariant the moment one hero has
 * answered — wiring the check in here made a real engine-produced save refuse to
 * decode. See `decodeSnapshot`'s contract builder, a few dozen lines down, for the
 * full account and the task this now waits on. `advance > patronFee`, `settled` on
 * an uncrewed contract, `acceptedBy.size > requiredCrew` and the rest of §2.1
 * therefore currently read back from a save unchecked.
 */
const offerValueSchema = z.strictObject({
  version: z.int().min(1),
  keyHero: heroIdSchema.nullable(),
  advance: z.int().min(PATRON_FEE_MIN).max(PATRON_FEE_MAX),
  methodTag: contentId.nullable(),
  promisedBonus: z.int().min(PATRON_FEE_MIN).max(PATRON_FEE_MAX),
  phase: offerPhaseSchema,
  respondedBy: z.array(heroIdSchema).max(MAX_HEROES_PER_CONTRACT),
  acceptedBy: z.array(heroIdSchema).max(MAX_HEROES_PER_CONTRACT)
});

const contractValueSchema = z.strictObject({
  id: contentId,
  patronFee: z.int().min(PATRON_FEE_MIN).max(PATRON_FEE_MAX),
  risk: z.int().min(RISK_MIN).max(RISK_MAX),
  requiredCrew: z.int().min(REQUIRED_CREW_MIN).max(REQUIRED_CREW_MAX),
  tags: z.array(contentId).max(MAX_TAGS_PER_CONTRACT),
  status: contractStatusSchema,
  offer: offerValueSchema,
  moodOrdinals: entries(heroIdSchema, uint64).max(MAX_HEROES_PER_CONTRACT)
});

const traitRuleValueSchema = z.strictObject({
  id: contentId,
  tag: contentId,
  isPrinciple: z.boolean(),
  weight: z.int().min(INCLINATION_WEIGHT_MIN).max(INCLINATION_WEIGHT_MAX)
});

/**
 * Largest magnitude a single trace factor can carry (`contract-decision-rule.ts`'s
 * `decide`). Every term divides by `TRAIT_SCALE` before it reaches a factor, and
 * `TRAIT_MAX` equals `TRAIT_SCALE` (`bounds.ts`), so a term whose *other* operand
 * is a content bound never exceeds that bound: `patronFeePull` is capped by
 * `PATRON_FEE_MAX`, `riskAversion` by `RISK_MAX`, and `insult` — `(risk − patronFee) *
 * pride / TRAIT_SCALE` — by `RISK_MAX` too, since `patronFee ≥ PATRON_FEE_MIN = 0`. An
 * inclination is capped by `INCLINATION_WEIGHT_MAX` (30), trust by `TRAIT_MAX`
 * divided by the rule's own trust divisor (100 / 10 = 10), a bond by
 * `RELATIONSHIP_WEIGHT_MAX` (20), and mood by the rule's own `MOOD_MAX` (5). The
 * largest of these is `PATRON_FEE_MAX` — and `RISK_MAX`, the same number — 100.
 *
 * This is not merely a shape ceiling. `restoreDecidedSteps`
 * (`packages/application/src/save/restore-steps.ts`) recomputes a decision's
 * score as a plain `+`/`-` sum of factor magnitudes, while the engine that
 * produced the real score wraps every partial sum through `toInt32`. Neither
 * `bounds.ts` nor `limits.ts` alone stops a save from claiming a magnitude
 * `decide()` could never produce — those bound a hero's or a contract's *fields*,
 * not the arithmetic derived from them. Left unbounded, a tampered save could
 * carry a magnitude large enough that a plain sum disagrees with what `toInt32`
 * would have wrapped it to, handing the restored screen a score the engine can
 * never produce. Bounding every factor at the true ceiling keeps the sum of up to
 * `MAX_FACTORS_PER_TRACE_SIDE` of them nowhere near where a plain sum and a
 * wrapped one could ever part ways.
 */
const MAX_FACTOR_MAGNITUDE = PATRON_FEE_MAX;

/**
 * The three reason-code fields, each closed on the set of codes the engine can actually
 * put in that position (`reason-codes.ts`: `FACTOR_REASON_CODES`, `BLOCK_REASON_CODES`,
 * `TIE_BREAK_REASON_CODES`).
 *
 * All three read `artifactSafeText` before segment 5's external review, which is a shape
 * and a length and not a vocabulary — so a code of the right *form* that named nothing was
 * accepted. Measured on this build: a save carrying
 * `hero.decision.unknown_but_well_shaped` as a positive factor, honestly re-signed, passed
 * `readSave`, `restoreDecidedSteps` and the screen model, and died in the strict text
 * catalogue, where a missing key is a defect of the build rather than a refusal of the
 * file. A reason code *is* a localization key (`vocabulary.test.ts`), the engine's
 * dictionary is closed, and this is the boundary where an untrusted file is held to it.
 *
 * Deliberately not `artifactSafeText` *and* the enum: every member of these sets is
 * already held to `isArtifactSafeText` by `vocabulary.test.ts`, so the length and the
 * character class are properties of the set itself, and restating them here would be a
 * second guard on a value that can only be one of eleven literals.
 *
 * A `z.enum` rather than a `.refine`: an unrecognized member of a closed set reports
 * `invalid_value`, which {@link classify} treats as `Malformed` — the same verdict the
 * character-class regex gets, and the right one. A code that names nothing is a shape
 * problem, not a value out of range; `custom` would have filed it under `OutOfBounds`
 * beside "this magnitude is bigger than `decide()` can produce".
 */
const factorReasonCode = z.enum(FACTOR_REASON_CODES);
const blockReasonCode = z.enum(BLOCK_REASON_CODES);
const tieBreakReasonCode = z.enum(TIE_BREAK_REASON_CODES);

const traceFactorSchema = z.strictObject({
  reasonCode: factorReasonCode,
  sourceEntity: contentId,
  magnitude: z.int().min(0).max(MAX_FACTOR_MAGNITUDE)
});

const traceBlockSchema = z.strictObject({
  reasonCode: blockReasonCode,
  sourceEntity: contentId
});

const causalTraceValueSchema = z.strictObject({
  traceId: z.int().min(0),
  positiveFactors: z.array(traceFactorSchema).max(MAX_FACTORS_PER_TRACE_SIDE),
  negativeFactors: z.array(traceFactorSchema).max(MAX_FACTORS_PER_TRACE_SIDE),
  blockedBy: z.array(traceBlockSchema).max(MAX_BLOCKS_PER_TRACE),
  tieBreak: tieBreakReasonCode.nullable()
});

const domainEventSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('hero_accepted_contract'),
    eventId: z.int().min(0),
    logicalTime: z.int().min(0),
    causalTraceId: z.int().min(0).nullable(),
    heroId: heroIdSchema,
    contractId: contentId
  }),
  z.strictObject({
    kind: z.literal('hero_declined_contract'),
    eventId: z.int().min(0),
    logicalTime: z.int().min(0),
    causalTraceId: z.int().min(0).nullable(),
    heroId: heroIdSchema,
    contractId: contentId
  })
]);

const snapshotSchema = z.strictObject({
  metadata: z.strictObject({
    saveSchemaVersion: z.int().min(0),
    rulesetVersion: artifactSafeText,
    contentVersion: artifactSafeText,
    campaignSeed: uint64,
    stateVersion: z.int().min(0),
    logicalTime: z.int().min(0),
    nextEventId: z.int().min(0),
    nextTraceId: z.int().min(0),
    nextDecisionOrdinal: uint64
  }),
  heroes: entries(heroIdSchema, heroValueSchema),
  contracts: entries(contentId, contractValueSchema),
  appliedCommandIds: z.array(z.int().min(0)).max(MAX_APPLIED_COMMANDS),
  traitRules: entries(contentId, traitRuleValueSchema),
  // A trace is stored at most once per applied command: `withEvent` only ever
  // adds a *new* trace id, never overwrites an existing one (`game-state.ts`).
  // So `traces.size` can never exceed `appliedCommandIds.size`, which is
  // already bounded by `MAX_APPLIED_COMMANDS` — reusing that ceiling here
  // states the fact instead of leaving `traces` under `entries()`'s own
  // generic 4096, a cap 40x looser than what this map can actually hold.
  traces: entries(z.int().min(0), causalTraceValueSchema).max(MAX_APPLIED_COMMANDS),
  history: z.array(domainEventSchema).max(MAX_APPLIED_COMMANDS),
  // `NEGOTIATION_SPEC` §2.3 — never negative, and otherwise unbounded above the same
  // way `stateVersion`/`nextEventId`/`logicalTime` are: it is a campaign counter, not
  // a value content shapes, so there is no true ceiling to state here.
  treasury: z.int().min(0)
});

type SnapshotShape = z.infer<typeof snapshotSchema>;
type RawHero = SnapshotShape['heroes'][number]['value'];
type RawContract = SnapshotShape['contracts'][number]['value'];
type RawTraitRule = SnapshotShape['traitRules'][number]['value'];
type RawTrace = SnapshotShape['traces'][number]['value'];
type RawFactor = RawTrace['positiveFactors'][number];
type RawBlock = RawTrace['blockedBy'][number];
type RawDomainEvent = SnapshotShape['history'][number];

/**
 * The snapshot {@link encodeSnapshot} produced, put through the reader's own contract
 * before anybody writes it to a file. @throws {@link SaveReadError} — the same three
 * codes {@link decodeSnapshot} throws, for the same three reasons.
 *
 * External review of Task 16 found the asymmetry this closes: the write path called
 * `encodeSnapshot` and nothing else, so "this build can read back what it writes" was a
 * property of two schemas agreeing rather than a property anything checked. It is a
 * re-*decode*, not a second schema: whatever `decodeSnapshot` would refuse is what this
 * refuses, because it is literally that function. The cost is decoding one campaign's
 * worth of state per save — the largest canonical snapshot in the frozen corpus is
 * about 11 KB — and the thing bought is that a producer cannot emit a file the reader
 * rejects, whatever future field or ceiling one side grows without the other.
 */
export function requireReadableSnapshot(encoded: unknown): void {
  decodeSnapshot(encoded);
}

/** The campaign snapshot's JSON shape, ready for `JSON.stringify`. */
export function encodeSnapshot(state: GameState): unknown {
  return {
    metadata: {
      saveSchemaVersion: state.metadata.saveSchemaVersion,
      rulesetVersion: state.metadata.rulesetVersion,
      contentVersion: state.metadata.contentVersion,
      // 64-bit values are written as decimal strings, never as a JSON number —
      // `String`, not `Number`. A mutant to that effect is what step 2's test
      // catches: a number above 2^53 loses precision the moment `JSON.stringify`
      // writes it, and no `JSON.parse` can recover what was already lost.
      campaignSeed: String(state.metadata.campaignSeed),
      stateVersion: state.metadata.stateVersion,
      logicalTime: state.metadata.logicalTime,
      nextEventId: state.metadata.nextEventId,
      nextTraceId: state.metadata.nextTraceId,
      nextDecisionOrdinal: String(state.metadata.nextDecisionOrdinal)
    },
    heroes: state.heroes.entries().map(([key, value]) => ({
      key,
      value: {
        id: value.id,
        definition: value.definition,
        displayNameKey: value.displayNameKey,
        greed: value.greed,
        caution: value.caution,
        pride: value.pride,
        trustInGuild: value.trustInGuild,
        traits: value.traits,
        relationships: value.relationships
          .entries()
          .map(([relationshipKey, weight]) => ({ key: relationshipKey, value: weight })),
        believesGuildPromises: value.believesGuildPromises,
        grievance: value.grievance
      }
    })),
    contracts: state.contracts.entries().map(([key, value]) => ({
      key,
      value: {
        id: value.id,
        patronFee: value.patronFee,
        risk: value.risk,
        requiredCrew: value.requiredCrew,
        tags: value.tags.values(),
        status: value.status,
        offer: {
          version: value.offer.version,
          keyHero: value.offer.keyHero,
          advance: value.offer.advance,
          methodTag: value.offer.methodTag,
          promisedBonus: value.offer.promisedBonus,
          phase: value.offer.phase,
          respondedBy: value.offer.respondedBy.values(),
          acceptedBy: value.offer.acceptedBy.values()
        },
        moodOrdinals: value.moodOrdinals
          .entries()
          .map(([heroKey, ordinal]) => ({ key: heroKey, value: String(ordinal) }))
      }
    })),
    appliedCommandIds: state.appliedCommandIds.values(),
    traitRules: state.traitRules.entries().map(([key, value]) => ({
      key,
      value: {
        id: value.id,
        tag: value.tag,
        isPrinciple: value.isPrinciple,
        weight: value.weight
      }
    })),
    traces: state.traces.entries().map(([key, value]) => ({
      key,
      value: {
        traceId: value.traceId,
        positiveFactors: value.positiveFactors,
        negativeFactors: value.negativeFactors,
        blockedBy: value.blockedBy,
        tieBreak: value.tieBreak
      }
    })),
    history: state.history,
    treasury: state.treasury
  };
}

/**
 * Reads a campaign snapshot back. @throws {@link SaveReadError} — `Malformed`
 * when `value` does not match the contract's shape, `OutOfBounds` when a value or
 * a list is outside `bounds.ts`, `limits.ts` or this module's own ceilings, and
 * `Inconsistent` when a map's key does not equal the identity carried inside its
 * value (`id`, or for `traces`, `traceId`).
 */
export function decodeSnapshot(value: unknown): GameState {
  const parsed = parseSnapshot(value);

  const heroes = buildMap<HeroId, number, RawHero, HeroState>(
    compareHeroIds,
    parsed.heroes,
    (rawKey) => heroId(rawKey),
    (raw) => heroId(raw.id),
    (raw) => ({
      id: heroId(raw.id),
      definition: parseContentId(raw.definition),
      displayNameKey: raw.displayNameKey,
      greed: raw.greed,
      caution: raw.caution,
      pride: raw.pride,
      trustInGuild: raw.trustInGuild,
      traits: raw.traits.map((trait) => parseContentId(trait)),
      relationships: buildRelationships(raw.relationships),
      // `HeroState.believesGuildPromises`/`grievance` (`NEGOTIATION_SPEC` §2.2) —
      // persisted the same way every other hero field is: no command changes either
      // yet, but the save format does not get to assume that stays true, the same
      // reason `moodOrdinals` (below, on a contract) is a real schema field and not a
      // hard-coded default despite nothing writing to it yet either.
      believesGuildPromises: raw.believesGuildPromises,
      grievance: raw.grievance
    }),
    'heroes'
  );

  const contracts = buildMap<ContentId, string, RawContract, ContractState>(
    compareContentIds,
    parsed.contracts,
    (rawKey) => parseContentId(rawKey),
    (raw) => parseContentId(raw.id),
    // NOT routed through `createContractState` — tried, and reverted. See
    // `createContractState`'s own doc (`offer-state.ts`) and the comment a few dozen
    // lines below this one (where the wrapper that would have done it once stood) for
    // why: today's `engine.ts` (`proposeContractToHero`, pre-`DEC-008` offer protocol)
    // records a response without ever setting `offer.keyHero`, so *every* save this
    // build's own engine can currently produce, the moment one hero has answered,
    // already violates "phase = 'draft' ⇒ respondedBy ⊆ {keyHero}". Measured
    // directly: wiring this in made `envelope.test.ts`'s own guard-over-guards case —
    // "accepts the campaign the engine actually produced" — refuse a save built from
    // a real engine run. That is not a shape this codec can close; it needs
    // `engine.ts`'s negotiation-protocol rework (Task 11) to stop producing states
    // that violate the invariant in the first place. Left as a plain literal, exactly
    // as before this task.
    (raw) => ({
      id: parseContentId(raw.id),
      patronFee: raw.patronFee,
      risk: raw.risk,
      requiredCrew: raw.requiredCrew,
      tags: SortedSet.from(compareContentIds, raw.tags.map((tag) => parseContentId(tag))),
      status: raw.status,
      offer: {
        version: raw.offer.version,
        keyHero: raw.offer.keyHero === null ? null : heroId(raw.offer.keyHero),
        advance: raw.offer.advance,
        methodTag: raw.offer.methodTag === null ? null : parseContentId(raw.offer.methodTag),
        promisedBonus: raw.offer.promisedBonus,
        phase: raw.offer.phase,
        respondedBy: SortedSet.from(compareHeroIds, raw.offer.respondedBy.map((id) => heroId(id))),
        acceptedBy: SortedSet.from(compareHeroIds, raw.offer.acceptedBy.map((id) => heroId(id)))
      },
      moodOrdinals: buildMoodOrdinals(raw.moodOrdinals)
    }),
    'contracts'
  );

  const traitRules = buildMap<ContentId, string, RawTraitRule, HeldTrait>(
    compareContentIds,
    parsed.traitRules,
    (rawKey) => parseContentId(rawKey),
    (raw) => parseContentId(raw.id),
    (raw) => ({
      id: parseContentId(raw.id),
      tag: parseContentId(raw.tag),
      isPrinciple: raw.isPrinciple,
      weight: raw.weight
    }),
    'traitRules'
  );

  const traces = buildMap<number, number, RawTrace, CausalTrace>(
    compareNumbers,
    parsed.traces,
    (rawKey) => rawKey,
    (raw) => raw.traceId,
    (raw) => ({
      traceId: raw.traceId,
      positiveFactors: raw.positiveFactors.map((factor) => toTraceFactor(factor)),
      negativeFactors: raw.negativeFactors.map((factor) => toTraceFactor(factor)),
      blockedBy: raw.blockedBy.map((block) => toTraceBlock(block)),
      tieBreak: raw.tieBreak
    }),
    'traces'
  );

  const state: GameState = {
    metadata: {
      saveSchemaVersion: parsed.metadata.saveSchemaVersion,
      rulesetVersion: parsed.metadata.rulesetVersion,
      contentVersion: parsed.metadata.contentVersion,
      campaignSeed: BigInt(parsed.metadata.campaignSeed),
      stateVersion: parsed.metadata.stateVersion,
      logicalTime: parsed.metadata.logicalTime,
      nextEventId: parsed.metadata.nextEventId,
      nextTraceId: parsed.metadata.nextTraceId,
      nextDecisionOrdinal: BigInt(parsed.metadata.nextDecisionOrdinal)
    },
    heroes,
    contracts,
    appliedCommandIds: SortedSet.from(compareNumbers, parsed.appliedCommandIds),
    traitRules,
    traces,
    history: parsed.history.map((domainEvent) => toDomainEvent(domainEvent)),
    // `GameState.treasury` (`NEGOTIATION_SPEC` §2.3) — persisted, same as
    // `believesGuildPromises`/`grievance` above.
    treasury: parsed.treasury
  };

  return freezeDeep(state);
}

function parseSnapshot(value: unknown): SnapshotShape {
  const result = snapshotSchema.safeParse(value);

  if (result.success) {
    return result.data;
  }

  throw new SaveReadError(classify(result.error), formatZodError(result.error));
}

/**
 * `too_big`/`too_small` come from every `.max()`/`.min()` this schema states
 * against `bounds.ts`, `limits.ts` or this module's own ceilings; `custom` comes
 * from {@link uint64}'s own `refine`, the one other bound check this schema
 * makes. Anything else — a wrong type, an unrecognized key, a string that does
 * not match a pattern — is a shape the value does not have, not a value out of
 * range.
 */
function classify(error: z.ZodError): SaveErrorCode {
  const allBoundsViolations = error.issues.every(
    (issue) => issue.code === 'too_big' || issue.code === 'too_small' || issue.code === 'custom'
  );

  return allBoundsViolations ? SaveErrorCodes.OutOfBounds : SaveErrorCodes.Malformed;
}

function formatZodError(error: z.ZodError): string {
  return `snapshot does not match the save contract: ${error.issues
    .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    .join('; ')}`;
}

/**
 * Builds a `SortedMap` from `{ key, value }` pairs, refusing a pair whose `key`
 * — branded through `toKey`, the same way {@link idOf} brands the identity read
 * from `value` — does not equal that identity. This is the check
 * {@link entries}'s own comment promises. `SortedMap.from` never sees an
 * inconsistent key: it only ever receives `(idOf(value), toDomain(value))`, both
 * derived from the same `value`, so it cannot itself observe the mismatch this
 * function exists to catch.
 */
function buildMap<K, RawKey, Raw, V>(
  compare: Comparator<K>,
  rawEntries: readonly { key: RawKey; value: Raw }[],
  toKey: (rawKey: RawKey) => K,
  idOf: (raw: Raw) => K,
  toDomain: (raw: Raw) => V,
  mapName: string
): SortedMap<K, V> {
  const pairs = rawEntries.map((entry) => {
    const key = toKey(entry.key);
    const id = idOf(entry.value);

    if (compare(key, id) !== 0) {
      throw new SaveReadError(
        SaveErrorCodes.Inconsistent,
        `${mapName} entry key ${String(key)} does not match its value's identity ${String(id)}.`
      );
    }

    return [id, toDomain(entry.value)] as const;
  });

  return fromEntriesOrInconsistent(compare, pairs);
}

/**
 * A hero's relationships carry no separate identity to check against their key —
 * the value *is* the weight — so this is a plain map build, unlike
 * {@link buildMap}.
 */
function buildRelationships(
  raw: readonly { key: string; value: number }[]
): SortedMap<ContentId, number> {
  return fromEntriesOrInconsistent(
    compareContentIds,
    raw.map((entry) => [parseContentId(entry.key), entry.value] as const)
  );
}

/**
 * `ContractState.moodOrdinals`, the same plain-map shape as
 * {@link buildRelationships} — a hero id key with no separate identity inside the
 * value to check it against — except the value is a decision ordinal, written as a
 * decimal string like every other 64-bit value this codec carries.
 */
function buildMoodOrdinals(
  raw: readonly { key: number; value: string }[]
): SortedMap<HeroId, bigint> {
  return fromEntriesOrInconsistent(
    compareHeroIds,
    raw.map((entry) => [heroId(entry.key), BigInt(entry.value)] as const)
  );
}

/**
 * `SortedMap.from` itself throws only for one reason — a repeated key, by its
 * own doc comment — and a plain `Error` from it would break `decodeSnapshot`'s
 * own `@throws {@link SaveReadError}` promise. Every pair reaching this function
 * from {@link buildMap} already passed the key-equals-identity check there, so a
 * throw here means two *different* entries agree on the same key (and, since
 * each passed that check, on the same identity) — still a save that cannot be
 * trusted to mean what its keys claim, so it is still `Inconsistent`.
 */
function fromEntriesOrInconsistent<K, V>(
  compare: Comparator<K>,
  pairs: readonly (readonly [K, V])[]
): SortedMap<K, V> {
  try {
    return SortedMap.from(compare, pairs);
  } catch (error) {
    throw new SaveReadError(
      SaveErrorCodes.Inconsistent,
      error instanceof Error ? error.message : String(error)
    );
  }
}

// A `requireConsistentContract` function stood here — a `createContractState`
// wrapper mirroring `fromEntriesOrInconsistent` above, rethrowing as
// `SaveReadError(SaveErrorCodes.Inconsistent, ...)` the same way. It was wired into
// `decodeSnapshot`'s contract builder and reverted; see that call site's own comment
// for the measurement and `createContractState`'s doc (`offer-state.ts`) for the
// task this waits on. Not resurrected as dead code here: deleting the function
// along with the wiring does not lose the reason, which is recorded at both of
// those places instead.

function toTraceFactor(factor: RawFactor): TraceFactor {
  return {
    reasonCode: factor.reasonCode,
    sourceEntity: parseContentId(factor.sourceEntity),
    magnitude: factor.magnitude
  };
}

function toTraceBlock(block: RawBlock): TraceBlock {
  return {
    reasonCode: block.reasonCode,
    sourceEntity: parseContentId(block.sourceEntity)
  };
}

function toDomainEvent(domainEvent: RawDomainEvent): DomainEvent {
  return {
    kind: domainEvent.kind,
    eventId: domainEvent.eventId,
    logicalTime: domainEvent.logicalTime,
    causalTraceId: domainEvent.causalTraceId,
    heroId: heroId(domainEvent.heroId),
    contractId: parseContentId(domainEvent.contractId)
  };
}
