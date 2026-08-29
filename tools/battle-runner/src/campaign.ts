import type { ContentSet, ContractDefinition, HeroDefinition } from '@oath-and-coin/content';
import {
  CommitmentState,
  ContractStatus,
  DoctrineId,
  OfferPhase,
  SortedMap,
  SortedSet,
  compareContentIds,
  compareHeroIds,
  createContractState,
  heroId,
  type Cell,
  type ContractBattlePlan,
  type ContractState,
  type HeroId,
  type HeroState,
  type ResolutionInput
} from '@oath-and-coin/simulation';

import { formationOf, type FormationShape } from './formations.ts';

/**
 * A contract, a crew and a formation, assembled the way a campaign assembles them.
 *
 * **The real shapes, not a convenient subset.** Every measurement below asks its question of
 * `battleResolver` and `forecastReadiness`, which take a `ResolutionInput` — so the runner
 * builds one, through `createContractState`, and every invariant a campaign holds holds here
 * too. A runner that fed the resolver a hand-made object would be measuring a battle the
 * game cannot reach.
 */

export function heroIdOf(content: ContentSet, hero: HeroDefinition): HeroId {
  return heroId([...content.heroes.keys()].indexOf(hero.id));
}

/** A `HeroState` as the content loader builds one (`initial-state.ts`). */
export function asHeroState(content: ContentSet, hero: HeroDefinition): HeroState {
  return {
    id: heroIdOf(content, hero),
    definition: hero.id,
    displayNameKey: hero.displayNameKey,
    greed: hero.greed,
    caution: hero.caution,
    pride: hero.pride,
    trustInGuild: hero.trustInGuild,
    capability: hero.capability,
    combat: hero.combat,
    role: hero.role,
    wounds: 0,
    retreats: 0,
    traits: hero.traits,
    relationships: SortedMap.from(
      compareContentIds,
      hero.relationships.map((one) => [one.hero, one.weight] as const)
    ),
    believesGuildPromises: true,
    grievance: 0
  };
}

/** The contract as a campaign carries it: crewed, locked, with exactly these heroes. */
export function contractStateFor(
  content: ContentSet,
  definition: ContractDefinition,
  crew: readonly HeroDefinition[],
  plan: ContractBattlePlan | null = definition.battle
): ContractState {
  const ids = SortedSet.from(
    compareHeroIds,
    crew.map((hero) => heroIdOf(content, hero))
  );

  return createContractState({
    id: definition.id,
    patronFee: definition.patronFee,
    risk: definition.risk,
    requiredCrew: crew.length,
    needs: definition.needs,
    tags: SortedSet.from(compareContentIds, definition.tags),
    negotiableTags: SortedSet.from(compareContentIds, definition.negotiableTags),
    battle: plan,
    status: ContractStatus.Crewed,
    offer: {
      version: 1,
      keyHero: crew[0] === undefined ? null : heroIdOf(content, crew[0]),
      advance: 0,
      methodTag: null,
      promisedBonus: 0,
      phase: OfferPhase.Locked,
      invited: ids,
      respondedBy: ids,
      acceptedBy: ids,
      commitments: SortedMap.from(
        compareHeroIds,
        crew.map((hero) => [heroIdOf(content, hero), CommitmentState.Committed] as const)
      ),
      deployment: null
    },
    moodOrdinals: SortedMap.empty<HeroId, bigint>(compareHeroIds),
    resolution: null
  });
}

export interface CaseInput {
  readonly content: ContentSet;
  readonly definition: ContractDefinition;
  readonly crew: readonly HeroDefinition[];
  readonly shape: FormationShape;
  readonly doctrine?: DoctrineId;
  /** Overrides the contract's own plan — how a synthetic pattern is fought. */
  readonly plan?: ContractBattlePlan;
}

/** One case, as the two functions under measurement take it. */
export function inputFor(spec: CaseInput): ResolutionInput {
  const plan = spec.plan ?? spec.definition.battle;

  if (plan === null || plan === undefined) {
    throw new Error(
      `Contract '${spec.definition.id}' has no battle plan, so there is no battle to measure. ` +
        'The frozen set is built from contracts that go to a fight and from synthetic patterns ' +
        'given one explicitly.'
    );
  }

  const contract = contractStateFor(spec.content, spec.definition, spec.crew, plan);
  const placement: SortedMap<HeroId, Cell> = formationOf(
    spec.shape,
    spec.crew.map((hero) => ({ hero: heroIdOf(spec.content, hero), role: hero.role })),
    plan.wards.map((ward) => ward.cell)
  );

  return {
    contract,
    crew: spec.crew.map((hero) => ({
      hero: asHeroState(spec.content, hero),
      // Freely, on every case. A balance run measures the board and the crew; the mood is
      // the contract loop's own variable, and letting it vary here would mix two questions
      // in one number (`RESOLUTION_SPEC` §4.5).
      commitment: CommitmentState.Committed
    })),
    deployment: {
      plan,
      crew: {
        placement,
        doctrine: spec.doctrine ?? DoctrineId.HoldTheLine,
        retreatBelowPercent: 0
      },
      retreatSignalledAtRound: null
    }
  };
}

/** Every combination of exactly `size` heroes, in content-id order. */
export function crewsOf(
  pool: readonly HeroDefinition[],
  size: number
): readonly (readonly HeroDefinition[])[] {
  if (size === 0) {
    return [[]];
  }

  return pool.flatMap((hero, index) =>
    crewsOf(pool.slice(index + 1), size - 1).map((rest) => [hero, ...rest])
  );
}
