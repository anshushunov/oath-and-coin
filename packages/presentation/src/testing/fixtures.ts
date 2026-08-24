import {
  Actions,
  ContractStatus,
  ReasonCodes,
  STARTING_TREASURY,
  SortedMap,
  SortedSet,
  compareContentIds,
  compareHeroIds,
  compareNumbers,
  createDecisionResult,
  heroId,
  initialOffer,
  parseContentId,
  type CausalTrace,
  type ContentId,
  type ContractState,
  type DecisionResult,
  type GameState,
  type HeldTrait,
  type HeroId,
  type HeroState,
  type OfferState,
  type TraceFactor
} from '@oath-and-coin/simulation';

import type { DecidedStep } from '../contract-offer-screen-model.ts';

/**
 * Fixtures for this package's tests.
 *
 * Its own, rather than the simulation's: those state a campaign the *rules* are about
 * — one hero, one contract, scales set to zero so a case names only the term it tests.
 * A screen is about a roster, a filter and an ordering, so the campaign here has
 * several heroes and two contracts. Reaching into another package's `src/testing`
 * would also mean importing past its public surface, which is the thing the boundary
 * rules exist to stop.
 *
 * Hand-built and tiny, never loaded from `content/`: this package cannot read a file,
 * and a test that posed its question by loading the shipped tree would be testing the
 * loader too.
 */

export const ids = {
  bram: parseContentId('core:bram'),
  doran: parseContentId('core:doran'),
  zara: parseContentId('core:zara'),
  caravan: parseContentId('core:escort_the_caravan'),
  crypt: parseContentId('core:cleanse_the_crypt'),
  loyal: parseContentId('core:loyal_to_the_merchant_guild'),
  squeamish: parseContentId('core:fears_undeath'),
  refusesTemples: parseContentId('core:will_not_strike_a_temple'),
  merchants: parseContentId('patron:merchant_guild'),
  undead: parseContentId('target:undead'),
  methodOpen: parseContentId('method:open'),
  methodDeception: parseContentId('method:deception')
} as const;

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

/** An `OfferState`, for tests overriding just the answers or terms they need. */
export function anOffer(overrides: Partial<OfferState> = {}): OfferState {
  return { ...initialOffer(), ...overrides };
}

export function aContract(overrides: Partial<ContractState> = {}): ContractState {
  return {
    id: ids.caravan,
    patronFee: 40,
    risk: 55,
    requiredCrew: 2,
    tags: SortedSet.from(compareContentIds, [ids.merchants]),
    status: ContractStatus.Offered,
    offer: anOffer(),
    moodOrdinals: SortedMap.empty<HeroId, bigint>(compareHeroIds),
    ...overrides
  };
}

export function aTrait(overrides: Partial<HeldTrait> = {}): HeldTrait {
  return {
    id: ids.loyal,
    tag: ids.merchants,
    isPrinciple: false,
    weight: 10,
    ...overrides
  };
}

export function aState(overrides: Partial<GameState> = {}): GameState {
  const hero = aHero();
  const contract = aContract();

  return {
    metadata: {
      // Literal, not imported: this package's fixtures do not read
      // `@oath-and-coin/content`. Kept in step by hand — currently 2 (`DEC-008`
      // Task 6 fix round).
      saveSchemaVersion: 2,
      rulesetVersion: 'm1-negotiation/1',
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

export function withHeroes(state: GameState, heroes: readonly HeroState[]): GameState {
  return {
    ...state,
    heroes: SortedMap.from(
      compareHeroIds,
      heroes.map((hero) => [hero.id, hero] as const)
    )
  };
}

export function withContracts(state: GameState, contracts: readonly ContractState[]): GameState {
  return {
    ...state,
    contracts: SortedMap.from(
      compareContentIds,
      contracts.map((contract) => [contract.id, contract] as const)
    )
  };
}

export function withTraitRules(state: GameState, traits: readonly HeldTrait[]): GameState {
  return {
    ...state,
    traitRules: SortedMap.from(
      compareContentIds,
      traits.map((trait) => [trait.id, trait] as const)
    )
  };
}

export function aFactor(overrides: Partial<TraceFactor> = {}): TraceFactor {
  return {
    reasonCode: ReasonCodes.PaymentAttractive,
    sourceEntity: ids.caravan,
    magnitude: 20,
    ...overrides
  };
}

/**
 * A scored decision. `selectedScore` defaults to a value consistent with the action, so
 * a case that is not about wavering does not have to state one.
 */
export function aDecision(overrides: Partial<DecisionResult> = {}): DecisionResult {
  const selectedAction = overrides.selectedAction ?? Actions.Accept;

  return createDecisionResult({
    selectedAction,
    consideredActions: [Actions.Accept, Actions.Decline],
    selectedScore: selectedAction === Actions.Accept ? 10 : -10,
    trace: {
      traceId: 0,
      positiveFactors: [],
      negativeFactors: [],
      blockedBy: [],
      tieBreak: null
    },
    ...overrides
  });
}

/** One step of a run, in the minimal shape the read model declares. */
export function aStep(overrides: Partial<DecidedStep> = {}): DecidedStep {
  return {
    command: { contract: ids.caravan },
    heroDefinition: ids.bram,
    decisions: [aDecision()],
    ...overrides
  };
}
