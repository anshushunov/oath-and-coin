import {
  Actions,
  CombatRole,
  CommitmentState,
  ContractStatus,
  EQUIPMENT_GRADE_NONE,
  NeedId,
  OfferPhase,
  ReasonCodes,
  STARTING_TREASURY,
  SortedMap,
  SortedSet,
  compareContentIds,
  compareHeroIds,
  compareNeedIds,
  compareNumbers,
  createDecisionResult,
  gradeFrom,
  heroId,
  initialOffer,
  parseContentId,
  resolveContract,
  type CausalTrace,
  type ContentId,
  type ContractState,
  type DecisionResult,
  type GameState,
  type HeldTrait,
  type HeroCombatLayer,
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

/**
 * An unremarkable fighter: every attribute at the middle of its range, so the derived
 * `grade` is 50 and a test that cares about strength states what it cares about.
 */
const AVERAGE_COMBAT: HeroCombatLayer = Object.freeze({
  might: 50,
  guard: 50,
  aim: 50,
  focus: 50,
  care: 50
});

export function aHero(overrides: Partial<HeroState> = {}): HeroState {
  return {
    id: heroId(0),
    definition: ids.bram,
    displayNameKey: 'hero.core.bram.name',
    greed: 60,
    caution: 30,
    pride: 45,
    trustInGuild: 50,
    capability: {
      // Derived from `combat` below, never stated beside it (`DEC-016` §3). A fixture
      // that wrote its own grade would be the second truth the record exists to remove,
      // and it would be the one place in the workspace where the two could disagree.
      grade: gradeFrom(AVERAGE_COMBAT, EQUIPMENT_GRADE_NONE),
      expertise: SortedMap.from<NeedId, number>(compareNeedIds, [
        [NeedId.Frontline, 50],
        [NeedId.Wilderness, 50]
      ])
    },
    combat: AVERAGE_COMBAT,
    role: CombatRole.Vanguard,
    wounds: 0,
    retreats: 0,
    traits: [],
    relationships: SortedMap.empty<ContentId, number>(compareContentIds),
    believesGuildPromises: true,
    grievance: 0,
    ...overrides
  };
}

/**
 * An `OfferState`, for tests overriding just the answers or terms they need.
 *
 * Valid by default the same way the simulation package's own fixture is, and for the
 * same reason: `RESOLUTION_SPEC` §2.5 ties `invited` to `keyHero` and `commitments` to
 * `acceptedBy`, and a screen-model test naming a key hero is not asking about either.
 */
export function anOffer(overrides: Partial<OfferState> = {}): OfferState {
  const offer = { ...initialOffer(), ...overrides };

  const invited =
    overrides.invited ??
    (offer.keyHero === null
      ? offer.invited
      : SortedSet.from(compareHeroIds, [
          offer.keyHero,
          ...offer.respondedBy.values(),
          ...offer.acceptedBy.values()
        ]));

  const commitments =
    overrides.commitments ??
    SortedMap.from(
      compareHeroIds,
      offer.acceptedBy.values().map((hero) => [hero, CommitmentState.Committed] as const)
    );

  return { ...offer, invited, commitments };
}

export function aContract(overrides: Partial<ContractState> = {}): ContractState {
  return {
    id: ids.caravan,
    patronFee: 40,
    risk: 55,
    requiredCrew: 2,
    needs: SortedMap.from<NeedId, number>(compareNeedIds, [
      [NeedId.Frontline, 40],
      [NeedId.Wilderness, 42]
    ]),
    tags: SortedSet.from(compareContentIds, [ids.merchants]),
    status: ContractStatus.Offered,
    battle: null,
    offer: anOffer(),
    moodOrdinals: SortedMap.empty<HeroId, bigint>(compareHeroIds),
    resolution: null,
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
      rulesetVersion: 'm1-resolution/1',
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

/**
 * A hero who can do exactly what a case says he can, and nothing else.
 *
 * `expertise` is stated as a whole map rather than merged into the default, because the
 * distinction between "answerable at nought" and "not his business" is mechanical
 * (`RESOLUTION_SPEC` §2.2) and a default that quietly added `frontline` to every crew
 * member would make the second case unwritable.
 */
export function aCapableHero(options: {
  readonly id: number;
  readonly definition: ContentId;
  readonly grade: number;
  readonly expertise: readonly (readonly [NeedId, number])[];
}): HeroState {
  return aHero({
    id: heroId(options.id),
    definition: options.definition,
    displayNameKey: `hero.${String(options.definition).replace(':', '.')}.name`,
    capability: {
      grade: options.grade,
      expertise: SortedMap.from<NeedId, number>(compareNeedIds, options.expertise)
    }
  });
}

/** One member of a crew that has already gone out, with the answer he gave. */
export interface CrewMemberFixture {
  readonly hero: HeroState;
  readonly commitment: CommitmentState;
}

/**
 * A contract whose package is locked and whose seats are all filled — the one shape
 * `resolveContract` accepts (`RESOLUTION_SPEC` §3.2).
 *
 * The key hero is the first of the crew. `requiredCrew` follows the crew's own size, since
 * §3.2 refuses any other combination and a fixture that could state them apart would only
 * ever state them wrong.
 */
export function aCrewedContract(options: {
  readonly id: ContentId;
  readonly needs: readonly (readonly [NeedId, number])[];
  readonly risk: number;
  readonly crew: readonly CrewMemberFixture[];
  readonly patronFee?: number;
  readonly advance?: number;
  readonly promisedBonus?: number;
}): ContractState {
  const crewIds = options.crew.map((member) => member.hero.id);
  const keyHero = crewIds[0];

  if (keyHero === undefined) {
    throw new Error('A crewed contract needs at least one hero: nobody went out otherwise.');
  }

  return aContract({
    id: options.id,
    patronFee: options.patronFee ?? 40,
    risk: options.risk,
    requiredCrew: crewIds.length,
    needs: SortedMap.from<NeedId, number>(compareNeedIds, options.needs),
    status: ContractStatus.Crewed,
    offer: anOffer({
      version: 1,
      keyHero,
      advance: options.advance ?? 0,
      promisedBonus: options.promisedBonus ?? 0,
      phase: OfferPhase.Locked,
      invited: SortedSet.from(compareHeroIds, crewIds),
      respondedBy: SortedSet.from(compareHeroIds, crewIds),
      acceptedBy: SortedSet.from(compareHeroIds, crewIds),
      commitments: SortedMap.from(
        compareHeroIds,
        options.crew.map((member) => [member.hero.id, member.commitment] as const)
      )
    })
  });
}

/**
 * A campaign in which every contract given has already been resolved, in the order given.
 *
 * Resolved by the engine's own command rather than by a hand-written `ContractResolution`:
 * the debrief joins the stored result to the events in `history`, and a fixture that wrote
 * the result by hand would leave the history empty — the half of the screen this model
 * exists to build.
 */
export function aResolvedCampaign(options: {
  readonly heroes: readonly HeroState[];
  readonly contracts: readonly ContractState[];
  readonly treasury?: number;
}): GameState {
  let state = withContracts(
    withHeroes(aState({ treasury: options.treasury ?? STARTING_TREASURY }), options.heroes),
    options.contracts
  );

  options.contracts.forEach((contract, index) => {
    const result = resolveContract(state, {
      commandId: index + 1,
      contractId: contract.id,
      expectedStateVersion: state.metadata.stateVersion,
      retreatAtRound: null
    });

    if (!result.applied) {
      throw new Error(
        `The fixture's own resolveContract on '${contract.id}' was refused as ` +
          `'${String(result.rejectionCode)}'; a fixture that cannot resolve its own contract ` +
          'is measuring the refusal, not the screen.'
      );
    }

    state = result.state;
  });

  return state;
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
