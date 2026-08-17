import { compareNumbers, compareStrings } from '../collections/comparator.ts';
import { SortedMap } from '../collections/sorted-map.ts';
import { SortedSet } from '../collections/sorted-set.ts';
import type { CausalTrace } from '../decisions/causal-trace.ts';
import type { HeldTrait } from '../decisions/held-trait.ts';
import type { DomainEvent } from '../events/domain-event.ts';
import { compareContentIds, parseContentId, type ContentId } from '../ids/content-id.ts';
import { compareHeroIds, heroId, type HeroId } from '../ids/hero-id.ts';
import { ContractStatus, type ContractState } from '../state/contract-state.ts';
import type { GameState } from '../state/game-state.ts';
import type { HeroState } from '../state/hero-state.ts';

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
  zara: parseContentId('core:zara'),
  crypt: parseContentId('core:cleanse_the_crypt'),
  temple: parseContentId('target:temple'),
  undead: parseContentId('target:undead'),
  refusesTemples: parseContentId('core:will_not_strike_a_temple'),
  hatesUndead: parseContentId('core:fears_undeath')
};

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
    ...overrides
  };
}

export function aContract(overrides: Partial<ContractState> = {}): ContractState {
  return {
    id: ids.crypt,
    payment: 70,
    risk: 80,
    requiredCrew: 1,
    tags: SortedSet.from(compareContentIds, [ids.undead]),
    status: ContractStatus.Offered,
    respondedBy: SortedSet.empty<HeroId>(compareHeroIds),
    acceptedBy: SortedSet.empty<HeroId>(compareHeroIds),
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
      saveSchemaVersion: 1,
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
