import { z } from 'zod';

import {
  ContractStatus,
  HERO_ID_MAX,
  HERO_ID_MIN,
  SortedMap,
  SortedSet,
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
} from '../bounds.ts';
import {
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
 * particular side (payment, trust and mood-positive on the positive side; risk,
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
const MAX_APPLIED_COMMANDS = 4 * 24;

/** 64-битное значение десятичной строкой. */
const uint64 = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,19})$/u)
  .refine((s) => BigInt(s) <= UINT64_MAX, 'больше 2^64 − 1');

const contentId = z.string().regex(/^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$/u);

const heroIdSchema = z.int().min(HERO_ID_MIN).max(HERO_ID_MAX);

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
  displayNameKey: z.string(),
  greed: z.int().min(TRAIT_MIN).max(TRAIT_MAX),
  caution: z.int().min(TRAIT_MIN).max(TRAIT_MAX),
  pride: z.int().min(TRAIT_MIN).max(TRAIT_MAX),
  trustInGuild: z.int().min(TRAIT_MIN).max(TRAIT_MAX),
  traits: z.array(contentId).max(MAX_TRAITS_PER_HERO),
  relationships: relationshipsSchema
});

const contractStatusSchema = z.union([
  z.literal(ContractStatus.Offered),
  z.literal(ContractStatus.Crewed)
]);

const contractValueSchema = z.strictObject({
  id: contentId,
  payment: z.int().min(PAYMENT_MIN).max(PAYMENT_MAX),
  risk: z.int().min(RISK_MIN).max(RISK_MAX),
  requiredCrew: z.int().min(REQUIRED_CREW_MIN).max(REQUIRED_CREW_MAX),
  tags: z.array(contentId).max(MAX_TAGS_PER_CONTRACT),
  status: contractStatusSchema,
  respondedBy: z.array(heroIdSchema),
  acceptedBy: z.array(heroIdSchema)
});

const traitRuleValueSchema = z.strictObject({
  id: contentId,
  tag: contentId,
  isPrinciple: z.boolean(),
  weight: z.int().min(INCLINATION_WEIGHT_MIN).max(INCLINATION_WEIGHT_MAX)
});

const traceFactorSchema = z.strictObject({
  reasonCode: z.string(),
  sourceEntity: contentId,
  magnitude: z.int().min(0)
});

const traceBlockSchema = z.strictObject({
  reasonCode: z.string(),
  sourceEntity: contentId
});

const causalTraceValueSchema = z.strictObject({
  traceId: z.int().min(0),
  positiveFactors: z.array(traceFactorSchema).max(MAX_FACTORS_PER_TRACE_SIDE),
  negativeFactors: z.array(traceFactorSchema).max(MAX_FACTORS_PER_TRACE_SIDE),
  blockedBy: z.array(traceBlockSchema).max(MAX_BLOCKS_PER_TRACE),
  tieBreak: z.string().nullable()
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
    rulesetVersion: z.string(),
    contentVersion: z.string(),
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
  traces: entries(z.int().min(0), causalTraceValueSchema),
  history: z.array(domainEventSchema).max(MAX_APPLIED_COMMANDS)
});

type SnapshotShape = z.infer<typeof snapshotSchema>;
type RawHero = SnapshotShape['heroes'][number]['value'];
type RawContract = SnapshotShape['contracts'][number]['value'];
type RawTraitRule = SnapshotShape['traitRules'][number]['value'];
type RawTrace = SnapshotShape['traces'][number]['value'];
type RawFactor = RawTrace['positiveFactors'][number];
type RawBlock = RawTrace['blockedBy'][number];
type RawDomainEvent = SnapshotShape['history'][number];

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
          .map(([relationshipKey, weight]) => ({ key: relationshipKey, value: weight }))
      }
    })),
    contracts: state.contracts.entries().map(([key, value]) => ({
      key,
      value: {
        id: value.id,
        payment: value.payment,
        risk: value.risk,
        requiredCrew: value.requiredCrew,
        tags: value.tags.values(),
        status: value.status,
        respondedBy: value.respondedBy.values(),
        acceptedBy: value.acceptedBy.values()
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
    history: state.history
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
      relationships: buildRelationships(raw.relationships)
    }),
    'heroes'
  );

  const contracts = buildMap<ContentId, string, RawContract, ContractState>(
    compareContentIds,
    parsed.contracts,
    (rawKey) => parseContentId(rawKey),
    (raw) => parseContentId(raw.id),
    (raw) => ({
      id: parseContentId(raw.id),
      payment: raw.payment,
      risk: raw.risk,
      requiredCrew: raw.requiredCrew,
      tags: SortedSet.from(compareContentIds, raw.tags.map((tag) => parseContentId(tag))),
      status: raw.status,
      respondedBy: SortedSet.from(compareHeroIds, raw.respondedBy.map((id) => heroId(id))),
      acceptedBy: SortedSet.from(compareHeroIds, raw.acceptedBy.map((id) => heroId(id)))
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
    history: parsed.history.map((domainEvent) => toDomainEvent(domainEvent))
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

  return SortedMap.from(compare, pairs);
}

/**
 * A hero's relationships carry no separate identity to check against their key —
 * the value *is* the weight — so this is a plain map build, unlike
 * {@link buildMap}.
 */
function buildRelationships(
  raw: readonly { key: string; value: number }[]
): SortedMap<ContentId, number> {
  return SortedMap.from(
    compareContentIds,
    raw.map((entry) => [parseContentId(entry.key), entry.value] as const)
  );
}

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
