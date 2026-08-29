import { compareNumbers, compareStrings } from '../collections/comparator.ts';
import { SortedMap } from '../collections/sorted-map.ts';
import { SortedSet } from '../collections/sorted-set.ts';
import type { CausalTrace } from '../decisions/causal-trace.ts';
import type { DecisionContext } from '../decisions/context.ts';
import type { HeldTrait } from '../decisions/held-trait.ts';
import { EQUIPMENT_GRADE_NONE, gradeFrom } from '../combat/grade.ts';
import { CommitmentState } from '../domain/commitment.ts';
import type { HeroCombatLayer } from '../domain/combat-attributes.ts';
import { CombatRole } from '../domain/combat-role.ts';
import { NeedId } from '../domain/need-id.ts';
import { compareNeedIds } from '../domain/need-id.ts';
import type { DomainEvent } from '../events/domain-event.ts';
import { compareContentIds, parseContentId, type ContentId } from '../ids/content-id.ts';
import { compareHeroIds, heroId, type HeroId } from '../ids/hero-id.ts';
import { STARTING_TREASURY } from '../negotiation/commitments.ts';
import { draftResolution } from '../resolution/contract-resolver.ts';
import { ContractStatus, type ContractState } from '../state/contract-state.ts';
import type { GameState } from '../state/game-state.ts';
import type { HeroState } from '../state/hero-state.ts';
import { createContractState, initialOffer, type OfferState } from '../state/offer-state.ts';

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

/**
 * An `OfferState`, for tests overriding just the terms or answers they need.
 *
 * **Valid by default, and that is what the two derived fields below are for.** Once
 * `RESOLUTION_SPEC` §2.5 tied `invited` to `keyHero` and `commitments` to `acceptedBy`,
 * every existing fixture that named a key hero — dozens of them, none of which is about
 * a crew — would have had to name a crew too, or fail a constructor for a reason its
 * test is not asking about. So an offer that names a key hero and no `invited` invites
 * exactly the heroes it has already asked, and one that names acceptances and no
 * `commitments` records a plain `Committed` for each.
 *
 * A test *about* either field passes it explicitly, which is what every violation case
 * in `offer-state.test.ts` does — the defaults cannot mask a broken invariant, because
 * naming the field is how you ask about it.
 */
export function anOffer(overrides: Partial<OfferState> = {}): OfferState {
  const offer = { ...initialOffer(), ...overrides };

  if (offer.keyHero !== null && overrides.invited === undefined) {
    const invited = [offer.keyHero, ...offer.respondedBy.values(), ...offer.acceptedBy.values()];
    return { ...offer, ...defaultCommitments(overrides, SortedSet.from(compareHeroIds, invited)) };
  }

  return { ...offer, ...defaultCommitments(overrides, offer.invited) };
}

function defaultCommitments(
  overrides: Partial<OfferState>,
  invited: SortedSet<HeroId>
): Pick<OfferState, 'invited'> | Pick<OfferState, 'invited' | 'commitments'> {
  if (overrides.commitments !== undefined) {
    return { invited };
  }

  const acceptedBy = overrides.acceptedBy ?? SortedSet.empty<HeroId>(compareHeroIds);
  return {
    invited,
    commitments: SortedMap.from(
      compareHeroIds,
      acceptedBy.values().map((hero) => [hero, CommitmentState.Committed] as const)
    )
  };
}

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
    needs: SortedMap.from<NeedId, number>(compareNeedIds, [
      [NeedId.Frontline, 30],
      [NeedId.UndeadKnowledge, 35]
    ]),
    tags: SortedSet.from(compareContentIds, [ids.undead]),
    negotiableTags: SortedSet.empty<ContentId>(compareContentIds),
    status: ContractStatus.Offered,
    offer: anOffer(),
    moodOrdinals: SortedMap.empty<HeroId, bigint>(compareHeroIds),
    resolution: null,
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
      //
      // **Deliberately not kept in step with it, and this is the note that says so.**
      // The previous comment promised it was, and it had already drifted two bumps
      // behind by the time anyone looked (`SAVE_SCHEMA_VERSION` is 4). Nothing in this
      // package reads the number — it is state, carried and compared, never interpreted
      // — so a hand-updated copy of it buys nothing and lies as soon as it is forgotten.
      // The place the two are genuinely checked against each other is
      // `initial-state.test.ts`, on the side of the boundary that can import the real one.
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

/**
 * The same contract, carrying the resolution its own crew would actually have produced
 * (`RESOLUTION_SPEC` §2.5).
 *
 * Exists because `phase === Settled ⇒ resolution !== null` arrived with `resolveContract`:
 * every fixture that settles a contract now needs one to settle against, and a hand-built
 * `ContractResolution` in each of them would be several stated outcomes that no crew ever
 * reached — and that `contributions.keys() === acceptedBy` would reject one by one.
 *
 * Runs the real resolver on the real crew, so what a settlement fixture is handed is an
 * outcome this build can produce. `commitments` supplies each member's own state, which
 * the §2.5 invariant guarantees is there for everyone who accepted.
 */
export function resolved(contract: ContractState, heroes: readonly HeroState[]): ContractState {
  const byId = new Map(heroes.map((hero) => [hero.id, hero] as const));
  const draft = draftResolution({
    contract,
    crew: contract.offer.acceptedBy.values().map((id) => {
      const hero = byId.get(id);
      const commitment = contract.offer.commitments.get(id);
      if (hero === undefined || commitment === undefined) {
        throw new Error(
          `resolved() was given a contract whose acceptedBy names hero#${String(id)}, but ` +
            `${hero === undefined ? 'no such hero was passed' : 'no commitment is recorded'}.`
        );
      }

      return { hero, commitment };
    })
  });

  return createContractState({ ...contract, resolution: draft.resolution });
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
