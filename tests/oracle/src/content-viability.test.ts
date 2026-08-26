import { join, resolve } from 'node:path';

import {
  CoverageVerdict,
  coverNeeds,
  parseContentId,
  type CoverageParticipant,
  type NeedCoverage
} from '@oath-and-coin/simulation';
import type { ContentSet, ContractDefinition, HeroDefinition } from '@oath-and-coin/content';
import { loadContentSet } from '@oath-and-coin/content/node';
import { describe, expect, it } from 'vitest';

/**
 * The two claims `RESOLUTION_SPEC` §9 makes about *content* rather than about code, and
 * the debt the content task shipped with: both were arrived at by hand, with a
 * throwaway script, because `coverNeeds` did not exist yet. It does now, so they are a
 * gate.
 *
 * Here rather than in `packages/simulation`, and here rather than in
 * `packages/content`: the first cannot read a file (`ADR-002`) and the second cannot
 * import the arithmetic without becoming the engine. `tests/oracle` is the one place
 * that holds both, which is the same reason the scenario checks live here.
 *
 * **What is asserted, and why it is stronger than "Clean or Costly".** The grade itself
 * needs the margin and the motivation multiplier, which are a later module. This file
 * asserts the two facts that *imply* a Clean grade under the whole range of motivation,
 * and it can do that because of an inequality the spec's own formula gives for free:
 *
 * > `margin = base + divideTowardZero(abs(base) × clamp(motive, −20, 20), 100)`
 *
 * With `base >= 0`, every legal `motive` leaves `margin >= base − base × 20 / 100 >= 0`.
 * So "every need closed, and a base margin of at least zero" is Clean for a crew of any
 * temper — including one that resents the guild to a hero. A check written against the
 * grade would be weaker: it would hold for one motivation and say nothing about the rest.
 */

const repoRoot = resolve(import.meta.dirname, '..', '..', '..');
const content = loadContentSet(join(repoRoot, 'content'));

/** §4.5's `base`: what the coverage rows alone contribute to the margin. */
function baseMarginOf(coverage: readonly NeedCoverage[]): number {
  return coverage.reduce((total, entry) => total + entry.effective - entry.required, 0);
}

const allClosed = (coverage: readonly NeedCoverage[]): boolean =>
  coverage.every((entry) => entry.verdict === CoverageVerdict.Closed);

const asParticipant = (hero: HeroDefinition): CoverageParticipant => ({
  // A `HeroId` is assigned by the loader from content-id order (`initial-state.ts`), and
  // nothing here needs the campaign's own numbering: ids are read only to break ties, and
  // content-id order is the same order. Cast rather than fabricated, so a tie breaks the
  // way it would in a real campaign.
  hero: [...content.heroes.keys()].indexOf(hero.id) as never,
  capability: hero.capability
});

/** Every combination of exactly `size` heroes out of `pool`, in content-id order. */
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

/**
 * The heroes a contract can actually be crewed from, under some admissible package.
 *
 * A package is the authored tags alone, or those tags plus exactly one negotiable tag —
 * the player chooses one, never both and never neither once a set exists. A hero whose
 * *principle* names a tag in the package is gated out before any number is weighed
 * (`HERO_DECISION_SPEC` §2.2), so a crew that cannot exist under any package is not a
 * hard contract, it is an unreachable one.
 */
function eligiblePools(contract: ContractDefinition, set: ContentSet): readonly HeroDefinition[][] {
  const packages =
    contract.negotiableTags.length === 0
      ? [contract.tags]
      : contract.negotiableTags.map((tag) => [...contract.tags, tag]);

  return packages.map((tags) =>
    set.heroes.values().filter((hero) =>
      hero.traits.every((traitId) => {
        const trait = set.traits.get(traitId);
        return trait === undefined || trait.kind !== 'principle' || !tags.includes(trait.tag);
      })
    )
  );
}

/** The best crew this contract can be given, and what its coverage says about it. */
function bestCrewFor(contract: ContractDefinition) {
  let best: {
    readonly crew: readonly HeroDefinition[];
    readonly coverage: readonly NeedCoverage[];
    readonly base: number;
  } | null = null;

  for (const pool of eligiblePools(contract, content)) {
    for (const crew of crewsOf(pool, contract.requiredCrew)) {
      const coverage = coverNeeds(contract.needs, crew.map(asParticipant), {
        risk: contract.risk
      });
      const base = baseMarginOf(coverage);
      const better =
        best === null ||
        (allClosed(coverage) && !allClosed(best.coverage)) ||
        (allClosed(coverage) === allClosed(best.coverage) && base > best.base);

      if (better) {
        best = { crew, coverage, base };
      }
    }
  }

  return best;
}

describe('every contract the game ships can be finished cleanly', () => {
  it.each(content.contracts.values().map((contract) => [contract.id, contract] as const))(
    '%s has a crew that closes every need with a margin to spare',
    (_id, contract) => {
      const best = bestCrewFor(contract);

      expect(best, 'no crew of the right size exists at all').not.toBeNull();
      expect(
        allClosed(best!.coverage),
        `best crew ${best!.crew.map((hero) => hero.id).join(', ')} leaves ` +
          best!.coverage
            .filter((entry) => entry.verdict !== CoverageVerdict.Closed)
            .map((entry) => `${entry.need} at ${String(entry.supplied)}/${String(entry.required)}`)
            .join(', ')
      ).toBe(true);
      // At least zero, so the Clean grade survives a crew that resents the guild to a
      // hero — see this file's own header for the inequality that makes that follow.
      expect(best!.base, 'base margin').toBeGreaterThanOrEqual(0);
    }
  );
});

describe('the strongest crew is not the right crew', () => {
  // The opposing case `MVP_PLAN` §3.2 calls the point of the whole coverage model: if a
  // higher total `grade` always won, the player would have one decision to make and it
  // would be arithmetic. Named heroes and a named contract, not a search — a search
  // would keep passing by finding some other pair after somebody edited these numbers,
  // which is the failure this test exists to catch.
  const escort = content.contracts.get(parseContentId('core:escort_the_caravan'))!;
  const heroOf = (id: string) => content.heroes.get(parseContentId(id))!;

  const strong = ['core:zara', 'core:ilsa', 'core:bram', 'core:doran'].map(heroOf);
  const fitting = ['core:bram', 'core:doran', 'core:kestrel', 'core:mira'].map(heroOf);

  const totalGrade = (crew: readonly HeroDefinition[]) =>
    crew.reduce((sum, hero) => sum + hero.capability.grade, 0);

  const coverageFor = (crew: readonly HeroDefinition[]) =>
    coverNeeds(escort.needs, crew.map(asParticipant), { risk: escort.risk });

  it('the strong crew really is the stronger one, by a clear margin', () => {
    // Stated first, because every claim below is empty without it: the two crews are
    // both four heroes, and the one that loses is the one with more `grade` in it.
    expect(totalGrade(strong)).toBeGreaterThan(totalGrade(fitting));
    expect(strong).toHaveLength(escort.requiredCrew);
    expect(fitting).toHaveLength(escort.requiredCrew);
  });

  it('and it loses, because it leaves a need to nobody', () => {
    const coverage = coverageFor(strong);
    const wilderness = coverage.find((entry) => entry.need === 'wilderness')!;

    expect(wilderness.verdict).toBe(CoverageVerdict.Uncovered);
    expect(baseMarginOf(coverage)).toBeLessThan(0);
  });

  it('while the weaker crew closes both needs and comes out ahead', () => {
    const coverage = coverageFor(fitting);

    expect(allClosed(coverage)).toBe(true);
    expect(baseMarginOf(coverage)).toBeGreaterThanOrEqual(0);
  });

  it('so the weaker crew beats the stronger one on the only number that decides', () => {
    expect(baseMarginOf(coverageFor(fitting))).toBeGreaterThan(baseMarginOf(coverageFor(strong)));
  });
});
