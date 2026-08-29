import { join, resolve } from 'node:path';

import type { ContentSet, ContractDefinition, HeroDefinition } from '@oath-and-coin/content';
import { loadContentSet } from '@oath-and-coin/content/node';
import {
  COLUMNS,
  CommitmentState,
  ContractStatus,
  DoctrineId,
  OfferPhase,
  OutcomeGrade,
  ROWS,
  SortedMap,
  SortedSet,
  battleResolver,
  compareContentIds,
  compareHeroIds,
  createContractState,
  forecastReadiness,
  goesToBattle,
  heroId,
  severityOf,
  type Cell,
  type ContractState,
  type HeroId,
  type HeroState,
  type ResolutionInput
} from '@oath-and-coin/simulation';
import { describe, expect, it } from 'vitest';

/**
 * The claim `content-viability.test.ts` makes about the abstract resolver, made about the
 * battle: **every contract this game ships that goes to a fight can be won by a crew the
 * player can actually assemble, standing somewhere he can actually stand.**
 *
 * A contract nobody can complete is a content defect and not a hard fight, and it is the
 * one defect a player meets as "this game is broken" rather than as "I chose badly". It has
 * to be a gate rather than a thing somebody checked once by hand.
 *
 * Here rather than in `packages/simulation`, for the reason the sibling file gives: the
 * simulation cannot read a file (`ADR-002`) and the content package cannot import the
 * arithmetic without becoming the engine. `tests/oracle` is the one place that holds both.
 *
 * **The formations searched are the sensible ones, not all of them.** Nine cells and six
 * heroes is a search space this suite has no business walking; what it walks is every
 * assignment that keeps each hero in the row his own actions live in (`COMBAT_SPEC` §4.1),
 * which is the same restriction `DEC-011`'s own refuting check imposes on itself and for
 * the same reason — a formation that parks an archer in the front rank loses for a reason
 * that is not geometry.
 */

const repoRoot = resolve(import.meta.dirname, '..', '..', '..');
const content: ContentSet = loadContentSet(join(repoRoot, 'content'));

const heroIdOf = (hero: HeroDefinition): HeroId =>
  heroId([...content.heroes.keys()].indexOf(hero.id));

/** A `HeroState` as a campaign would build it from this definition (`initial-state.ts`). */
function asHeroState(hero: HeroDefinition): HeroState {
  return {
    id: heroIdOf(hero),
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

/** The contract as a campaign carries it, crewed and locked with exactly these heroes. */
function contractStateFor(
  definition: ContractDefinition,
  crew: readonly HeroDefinition[]
): ContractState {
  const ids = SortedSet.from(compareHeroIds, crew.map(heroIdOf));

  return createContractState({
    id: definition.id,
    patronFee: definition.patronFee,
    risk: definition.risk,
    requiredCrew: crew.length,
    needs: definition.needs,
    tags: SortedSet.from(compareContentIds, definition.tags),
    negotiableTags: SortedSet.from(compareContentIds, definition.negotiableTags),
    battle: definition.battle,
    status: ContractStatus.Crewed,
    offer: {
      version: 1,
      keyHero: crew[0] === undefined ? null : heroIdOf(crew[0]),
      advance: 0,
      methodTag: null,
      promisedBonus: 0,
      phase: OfferPhase.Locked,
      invited: ids,
      respondedBy: ids,
      acceptedBy: ids,
      commitments: SortedMap.from(
        compareHeroIds,
        crew.map((hero) => [heroIdOf(hero), CommitmentState.Committed] as const)
      ),
      deployment: null
    },
    moodOrdinals: SortedMap.empty<HeroId, bigint>(compareHeroIds),
    resolution: null
  });
}

/** Where each role belongs (`COMBAT_SPEC` §3.3) — a home, and here also a search bound. */
const HOME_ROWS: Readonly<Record<string, readonly (1 | 2 | 3)[]>> = Object.freeze({
  vanguard: [1],
  breaker: [1, 2],
  support: [2],
  rear: [3]
});

/**
 * Every formation that keeps each hero in a row his own actions live in, minus whatever
 * cells the contract's own wards occupy.
 *
 * Enumerated rather than sampled, because the answer this file gives is "there exists one",
 * and an existence claim proved by a sample is a claim about the sample.
 */
function formationsFor(
  definition: ContractDefinition,
  crew: readonly HeroDefinition[]
): readonly SortedMap<HeroId, Cell>[] {
  const taken = new Set(
    (definition.battle?.wards ?? []).map(
      (ward) => `${String(ward.cell.row)}:${String(ward.cell.column)}`
    )
  );

  const walk = (
    rest: readonly HeroDefinition[],
    used: ReadonlySet<string>,
    cells: readonly (readonly [HeroId, Cell])[]
  ): readonly SortedMap<HeroId, Cell>[] => {
    const [hero, ...remaining] = rest;

    if (hero === undefined) {
      return [SortedMap.from<HeroId, Cell>(compareHeroIds, cells)];
    }

    return (HOME_ROWS[hero.role] ?? ROWS).flatMap((row) =>
      COLUMNS.flatMap((column) => {
        const key = `${String(row)}:${String(column)}`;

        return used.has(key) || taken.has(key)
          ? []
          : walk(remaining, new Set([...used, key]), [...cells, [heroIdOf(hero), { row, column }]]);
      })
    );
  };

  return walk(crew, new Set(), []);
}

/** Every combination of exactly `size` heroes, in content-id order. */
function crewsOf(
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

const battleContracts = content.contracts
  .values()
  .filter((definition) => definition.battle !== null);

describe('every shipped contract that goes to a fight can be won', () => {
  it('ships at least one, or this whole file is green about nothing', () => {
    // The vacuous pass this file is most likely to become: `it.each` over an empty list
    // reports success and measures nothing (`AGENTS.md` §8).
    expect(battleContracts.length).toBeGreaterThan(0);
  });

  it.each(battleContracts.map((definition) => [definition.id, definition] as const))(
    '%s has a crew and a formation that comes back with the job done',
    (_id, definition) => {
      const pool = content.heroes.values();
      let best: { readonly grade: OutcomeGrade; readonly crew: string } | null = null;

      for (const crew of crewsOf(pool, definition.requiredCrew)) {
        const contract = contractStateFor(definition, crew);

        if (!goesToBattle(contract)) {
          throw new Error(`'${definition.id}' lost its battle plan on the way into state.`);
        }

        for (const placement of formationsFor(definition, crew)) {
          const input: ResolutionInput = {
            contract,
            crew: crew.map((hero) => ({
              hero: asHeroState(hero),
              commitment: CommitmentState.Committed
            })),
            deployment: {
              plan: definition.battle!,
              crew: { placement, doctrine: DoctrineId.HoldTheLine, retreatBelowPercent: 0 },
              retreatSignalledAtRound: null
            }
          };

          const grade = battleResolver(input).resolution.grade;

          if (best === null || severityOf(grade) < severityOf(best.grade)) {
            best = { grade, crew: crew.map((hero) => hero.id).join(', ') };
          }

          if (severityOf(grade) <= severityOf(OutcomeGrade.Costly)) {
            break;
          }
        }

        if (best !== null && severityOf(best.grade) <= severityOf(OutcomeGrade.Costly)) {
          break;
        }
      }

      // "Taken", not "clean": `RESOLUTION_SPEC` §5.3 pays a costly outcome in full, and a
      // contract every crew can walk through is a contract that decides nothing either.
      expect(
        best === null ? 'no crew at all' : `${best.grade} (${best.crew})`,
        `no crew and formation of the shipped roster brings '${definition.id}' back with the ` +
          'job done; a contract nobody can complete is a content defect, not a hard fight'
      ).toMatch(/^(clean|costly)/u);
    }
  );
});

describe('the forecast has something to say about every one of them', () => {
  it.each(battleContracts.map((definition) => [definition.id, definition] as const))(
    '%s: the plan is described before the crew is sent (§10.1)',
    (_id, definition) => {
      const crew = content.heroes.values().slice(0, definition.requiredCrew);
      const contract = contractStateFor(definition, crew);
      const [placement] = formationsFor(definition, crew);

      const forecast = forecastReadiness({
        contract,
        crew: crew.map((hero) => ({
          hero: asHeroState(hero),
          commitment: CommitmentState.Committed
        })),
        deployment: {
          plan: definition.battle!,
          crew: {
            placement: placement ?? SortedMap.empty<HeroId, Cell>(compareHeroIds),
            doctrine: DoctrineId.HoldTheLine,
            retreatBelowPercent: 0
          },
          retreatSignalledAtRound: null
        }
      });

      // One verdict per need, and a reason for at least one of them: a forecast with
      // nothing to say about a plan is a screen that prints an empty box before the one
      // decision this milestone is about.
      expect(forecast.objectives).toHaveLength(definition.needs.keys().length);
      expect(forecast.reasons.length).toBeGreaterThan(0);
    }
  );
});
