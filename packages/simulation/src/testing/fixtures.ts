import { compareNumbers, compareStrings } from '../collections/comparator.ts';
import { SortedMap } from '../collections/sorted-map.ts';
import { SortedSet } from '../collections/sorted-set.ts';
import type { CausalTrace } from '../decisions/causal-trace.ts';
import type { DecisionContext } from '../decisions/context.ts';
import type { HeldTrait } from '../decisions/held-trait.ts';
import type { DomainEvent } from '../events/domain-event.ts';
import { compareContentIds, parseContentId, type ContentId } from '../ids/content-id.ts';
import { compareHeroIds, heroId, type HeroId } from '../ids/hero-id.ts';
import { STARTING_TREASURY } from '../negotiation/commitments.ts';
import { ContractStatus, type ContractState } from '../state/contract-state.ts';
import type { GameState } from '../state/game-state.ts';
import type { HeroState } from '../state/hero-state.ts';
import { initialOffer, type OfferState } from '../state/offer-state.ts';

/**
 * Fixtures for the tests in this package, in `src` rather than beside one test file
 * because the state tests and the engine tests need the same starting campaign — and a
 * second copy of it would drift from this one the first time a field was added.
 *
 * Deliberately hand-built and tiny, not loaded from `content/`: this package cannot
 * read a file, and a test that posed its question by loading the shipped tree would be
 * testing the loader too.
 */

export const ids = {
  bram: parseContentId('core:bram'),
  doran: parseContentId('core:doran'),
  zara: parseContentId('core:zara'),
  /** Two ordinary inclinations, named so that `loyal` sorts before `squeamish`. */
  loyal: parseContentId('core:loyal'),
  squeamish: parseContentId('core:squeamish'),
  crypt: parseContentId('core:cleanse_the_crypt'),
  temple: parseContentId('target:temple'),
  undead: parseContentId('target:undead'),
  refusesTemples: parseContentId('core:will_not_strike_a_temple'),
  hatesUndead: parseContentId('core:fears_undeath'),
  /** A negotiated-tag pair (`NEGOTIATION_SPEC` §2.4): a target and a chosen method. */
  cult: parseContentId('target:cult'),
  deception: parseContentId('method:deception'),
  /** The other half of a negotiated-tag pair — a method a `refusesDeception` principle
   * does not name, so choosing it stops that principle from gating the hero. */
  open: parseContentId('method:open'),
  /** A principle whose tag only ever arrives as a chosen method tag, never authored. */
  refusesDeception: parseContentId('core:refuses_deception'),
  /**
   * An ordinary inclination whose tag only ever arrives as a chosen method tag, never
   * authored — the non-principle counterpart to {@link refusesDeception}, for tests
   * distinguishing "the gate reads `effectiveTags`" from "inclinations do too". Sorts
   * before {@link loyal} and {@link squeamish}, so a context naming all three keeps
   * `DecisionContext.traits` in the strict id order the rule requires.
   */
  cultCurious: parseContentId('core:cult_curious')
};

/** A `SortedSet<HeroId>` built from raw ids, for tests posing questions about a crew. */
export function heroes(...rawIds: readonly number[]): SortedSet<HeroId> {
  return SortedSet.from(compareHeroIds, rawIds.map(heroId));
}

/** A `SortedSet<ContentId>` built from the ids given, for tests posing questions about tags. */
export function setOf(...contentIds: readonly ContentId[]): SortedSet<ContentId> {
  return SortedSet.from(compareContentIds, contentIds);
}

/**
 * Six distinct tags — `MAX_TAGS_PER_CONTRACT`'s own ceiling, already reached before a
 * negotiated method tag ever joins them. Unrelated to any other id in this file on
 * purpose: a test using this fixture is posing a question about the *count*, not
 * about what any one tag means.
 */
export function sixTags(): SortedSet<ContentId> {
  return SortedSet.from(
    compareContentIds,
    [
      'target:tag_a',
      'target:tag_b',
      'target:tag_c',
      'target:tag_d',
      'target:tag_e',
      'target:tag_f'
    ].map(parseContentId)
  );
}

/** An `OfferState`, for tests overriding just the terms or answers they need. */
export function anOffer(overrides: Partial<OfferState> = {}): OfferState {
  return { ...initialOffer(), ...overrides };
}

export function aHero(overrides: Partial<HeroState> = {}): HeroState {
  return {
    id: heroId(0),
    definition: ids.bram,
    displayNameKey: 'hero.core.bram.name',
    greed: 60,
    caution: 30,
    pride: 45,
    trustInGuild: 50,
    traits: [],
    relationships: SortedMap.empty<ContentId, number>(compareContentIds),
    believesGuildPromises: true,
    grievance: 0,
    ...overrides
  };
}

export function aContract(overrides: Partial<ContractState> = {}): ContractState {
  return {
    id: ids.crypt,
    patronFee: 70,
    risk: 80,
    requiredCrew: 1,
    tags: SortedSet.from(compareContentIds, [ids.undead]),
    negotiableTags: SortedSet.empty<ContentId>(compareContentIds),
    status: ContractStatus.Offered,
    offer: anOffer(),
    moodOrdinals: SortedMap.empty<HeroId, bigint>(compareHeroIds),
    ...overrides
  };
}

export function aTrait(overrides: Partial<HeldTrait> = {}): HeldTrait {
  return {
    id: ids.hatesUndead,
    tag: ids.undead,
    isPrinciple: false,
    weight: 10,
    ...overrides
  };
}

/**
 * A decision context whose scales are all zero, so a test states only the term it is
 * about and every other term contributes nothing. The default seed and ordinal are the
 * fixture campaign's, so `drawMood(7n, 0n)` is the mood every case here gets unless it
 * names another ordinal.
 */
export function aContext(overrides: Partial<DecisionContext> = {}): DecisionContext {
  return {
    hero: aHero({ greed: 0, caution: 0, pride: 0, trustInGuild: 0 }),
    contract: aContract({ patronFee: 0, risk: 0 }),
    traits: [],
    crew: SortedMap.empty<HeroId, ContentId>(compareHeroIds),
    campaignSeed: 7n,
    decisionOrdinal: 0n,
    traceId: 0,
    ...overrides
  };
}

export function aTrace(overrides: Partial<CausalTrace> = {}): CausalTrace {
  return {
    traceId: 0,
    positiveFactors: [],
    negativeFactors: [],
    blockedBy: [],
    tieBreak: null,
    ...overrides
  };
}

export function anAcceptance(overrides: Partial<DomainEvent> = {}): DomainEvent {
  return {
    kind: 'hero_accepted_contract',
    eventId: 0,
    logicalTime: 0,
    causalTraceId: 0,
    heroId: heroId(0),
    contractId: ids.crypt,
    ...overrides
  } as DomainEvent;
}

export function aState(overrides: Partial<GameState> = {}): GameState {
  const hero = aHero();
  const contract = aContract();

  return {
    metadata: {
      // Literal, not imported: `packages/simulation` cannot depend on
      // `packages/content` (`simulation-depends-on-nothing`), so this cannot read
      // `SAVE_SCHEMA_VERSION` symbolically the way `initial-state.test.ts` does.
      // Kept in step with it by hand — currently 2 (`DEC-008` Task 6 fix round).
      saveSchemaVersion: 2,
      rulesetVersion: 'm1-decision/1',
      contentVersion: '5d03734fd9c7abaa',
      campaignSeed: 7n,
      stateVersion: 0,
      logicalTime: 0,
      nextEventId: 0,
      nextTraceId: 0,
      nextDecisionOrdinal: 0n
    },
    heroes: SortedMap.from(compareHeroIds, [[hero.id, hero]]),
    contracts: SortedMap.from(compareContentIds, [[contract.id, contract]]),
    appliedCommandIds: SortedSet.empty<number>(compareNumbers),
    traitRules: SortedMap.empty<ContentId, HeldTrait>(compareContentIds),
    traces: SortedMap.empty<number, CausalTrace>(compareNumbers),
    history: [],
    treasury: STARTING_TREASURY,
    ...overrides
  };
}

/** A hero and a contract keyed the way a campaign keys them, for multi-hero fixtures. */
export function withHeroes(state: GameState, heroes: readonly HeroState[]): GameState {
  return {
    ...state,
    heroes: SortedMap.from(
      compareHeroIds,
      heroes.map((hero) => [hero.id, hero] as const)
    )
  };
}

export { compareContentIds, compareHeroIds, compareNumbers, compareStrings, heroId };
