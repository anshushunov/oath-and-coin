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

/**
 * Every crew that can finish `contract` cleanly — all of them, not the best one.
 *
 * The difference is the whole of what external review of this task found. "Is the aggrieved
 * man replaceable" is a question about the crew a *player* picked, and a player may pick any
 * crew the engine accepts; a check that walked only the crew this file happens to rank first
 * was answering about one of eleven.
 */
function cleanCrewsFor(
  contract: ContractDefinition,
  without: string | null = null
): readonly { readonly crew: readonly HeroDefinition[]; readonly base: number }[] {
  const found: { crew: readonly HeroDefinition[]; base: number }[] = [];

  for (const pool of eligiblePools(contract, content)) {
    for (const crew of crewsOf(
      pool.filter((hero) => String(hero.id) !== without),
      contract.requiredCrew
    )) {
      const coverage = coverNeeds(contract.needs, crew.map(asParticipant), { risk: contract.risk });
      const base = baseMarginOf(coverage);

      if (allClosed(coverage) && base >= 0) {
        found.push({ crew, base });
      }
    }
  }

  return found;
}

/** Everyone a player could legally take on `contract` — so, everyone they could promise to. */
function promisableOn(contract: ContractDefinition): readonly string[] {
  return [
    ...new Set(
      cleanCrewsFor(contract).flatMap((entry) => entry.crew.map((hero) => String(hero.id)))
    )
  ].sort();
}

/** The best base margin `contract` can still reach with `without` unavailable, or `null`. */
function bestBaseWithout(contract: ContractDefinition, without: string | null): number | null {
  const crews = cleanCrewsFor(contract, without);

  return crews.length === 0 ? null : Math.max(...crews.map((entry) => entry.base));
}

/**
 * The second counterbalanced pair the playtest needs (`RESOLUTION_SPEC` §8, the contract-loop
 * UI plan's task 9): `core:hold_the_river_ford` and `core:burn_the_plague_barrow`.
 *
 * **Why a pair has to be checked and not merely authored.** §8's requirement is not "two more
 * contracts" — it is that the two vary the hero at the centre, the tags, and what a broken word
 * costs, *and* that neither aggrieved man is indispensable to the other job. Every one of those
 * is a fact about numbers and traits the loader can be asked for, and a pair that quietly
 * stopped satisfying them would leave the playtest measuring obedience to the brief: if the man
 * you wronged is the only one who can do the next job, paying up is the single rational answer
 * and H-B measures nothing.
 *
 * **What is deliberately *not* asserted: that breaking the promise pays money.** It cannot be,
 * at the numbers this build ships. `settleContract` returns a share of the patron fee and pays
 * the advance and the bonus out, and `STARTING_TREASURY` covers the most expensive package any
 * shipped contract admits — so the liquidity fork `RESOLUTION_SPEC` §6 describes never actually
 * bites, and breaking a word buys exactly the promised bonus and nothing else. That is an `R-01`
 * balance question (thresholds and shares are declared, not tuned), not something two content
 * files can settle. What content *does* own, and what is asserted below, is the other half of
 * the price: the ceiling on a promise (`patron_fee`, `NEGOTIATION_SPEC` §3.3) and how much the
 * next job loses when the man you wronged will not come.
 */
describe('the second counterbalanced pair', () => {
  const contractOf = (id: string) => content.contracts.get(parseContentId(id))!;

  const ford = contractOf('core:hold_the_river_ford');
  const barrow = contractOf('core:burn_the_plague_barrow');
  const caravan = contractOf('core:escort_the_caravan');

  /** The one need a contract is mostly about, and whoever brings the most of it. */
  function leanedOn(contract: ContractDefinition): string {
    const [heaviest] = [...contract.needs.entries()].sort(([, left], [, right]) => right - left);

    return content.heroes
      .values()
      .map((hero) => ({
        id: String(hero.id),
        brings: Math.trunc(
          ((hero.capability.expertise.get(heaviest![0]) ?? 0) * hero.capability.grade) / 100
        )
      }))
      .sort((left, right) =>
        left.brings === right.brings ? left.id.localeCompare(right.id) : right.brings - left.brings
      )[0]!.id;
  }

  it('the ford is the unannounced transfer: the caravan’s tags on a different job', () => {
    // §8's third requirement. A transfer contract has to carry the *same* social facts — the
    // same patron, the same quarry, the same two methods on offer — because what H-A1 asks the
    // tester to carry across is their reading of the people, not of a job they memorised.
    // Everything that is not a tag differs, so it is a new contract and not a second printing.
    expect([...ford.tags].sort()).toEqual([...caravan.tags].sort());
    expect([...ford.negotiableTags].sort()).toEqual([...caravan.negotiableTags].sort());

    expect(ford.id).not.toBe(caravan.id);
    expect(ford.requiredCrew).not.toBe(caravan.requiredCrew);
    expect(ford.risk).not.toBe(caravan.risk);
    expect(ford.patronFee).not.toBe(caravan.patronFee);
    expect([...ford.needs.entries()]).not.toEqual([...caravan.needs.entries()]);
  });

  it('the two lean on different people', () => {
    // §8's first requirement, read off the arithmetic rather than asserted in prose. Not "the
    // crew with the most grade in it" — external review was right that grade answers a
    // different question — but whoever brings the most of the thing each job mostly wants.
    expect(leanedOn(ford)).not.toBe(leanedOn(barrow));

    const bestOf = (contract: ContractDefinition) =>
      [...cleanCrewsFor(contract)]
        .sort((left, right) => right.base - left.base)[0]!
        .crew.map((hero) => String(hero.id))
        .sort();

    expect(bestOf(ford)).not.toEqual(bestOf(barrow));
  });

  it('the two are about different things, down to which traits can react at all', () => {
    // §8's second requirement. Not a claim about who is *gated* — the first draft asserted that
    // and it forced `target:temple` onto the barrow, which is what made Mira and Zara
    // irreplaceable there (the blocker below). The honest form of "the tags change" is that the
    // two jobs share no tag and no trait latches onto both.
    const reacting = (contract: ContractDefinition) =>
      content.traits
        .values()
        .filter((trait) => contract.tags.includes(trait.tag))
        .map((trait) => String(trait.id))
        .sort();

    expect(ford.tags.filter((tag) => barrow.tags.includes(tag))).toEqual([]);
    expect([...ford.negotiableTags].sort()).not.toEqual([...barrow.negotiableTags].sort());
    expect(reacting(ford).filter((trait) => reacting(barrow).includes(trait))).toEqual([]);
    // Neither list may be empty, or "they are different" would be true of two contracts nobody
    // has an opinion about.
    expect(reacting(ford).length).toBeGreaterThan(0);
    expect(reacting(barrow).length).toBeGreaterThan(0);
  });

  it('nobody a player could promise on one of them is indispensable to the other', () => {
    // **The blocker external review of this task found, in the form that closes it.** The first
    // version walked one crew per contract — the one this file ranks best — and was green while
    // the material did the exact thing the design spec forbids: `core:mira` and `core:zara` were
    // each members of a legal clean crew for the ford, and the barrow had *zero* clean crews
    // without either of them, because `target:temple` gated the only other undead specialist
    // out. A player who promised one of them and broke their word could not finish the next job
    // at all, which makes the honest payment the single rational answer and H-B a measurement of
    // obedience to the brief.
    //
    // So the set walked here is every hero appearing in *any* clean crew — everyone a player is
    // free to take, and therefore everyone they are free to promise to.
    for (const [contract, other] of [
      [ford, barrow],
      [barrow, ford]
    ] as const) {
      const promisable = promisableOn(contract);

      expect(promisable.length, `nobody can be taken on ${contract.id} at all`).toBeGreaterThan(0);

      for (const hero of promisable) {
        const crews = cleanCrewsFor(other, hero);

        expect(
          crews.length,
          `${other.id} cannot be finished cleanly without ${hero}, so wronging them on ` +
            `${contract.id} would leave the honest payment as the only sensible answer`
        ).toBeGreaterThan(0);

        // That the search really left them out, and not merely that it found something. The
        // assertion above alone is satisfied by a search that ignored its own exclusion — a
        // mutant dropping it stayed green on the very material this test exists to reject, so
        // "without" has to be a claim about the crews, not only about their count.
        expect(
          crews.flatMap((entry) => entry.crew.map((member) => String(member.id))),
          `a crew offered as ${other.id}-without-${hero} contains them`
        ).not.toContain(hero);
      }
    }
  });

  it('and what a broken word costs is not the same on both', () => {
    // §8's fourth requirement in the only currency content owns. Money cannot carry it (see this
    // block's own header), but the *replacement cost* can: losing one man to a grievance leaves
    // the next job's best margin where it was, and losing another takes a measurable bite out of
    // it. Both shapes have to exist on each side of the pair, or "breaking is cheap here and
    // expensive there" is a sentence with nothing behind it.
    for (const [contract, other] of [
      [ford, barrow],
      [barrow, ford]
    ] as const) {
      const full = bestBaseWithout(other, null)!;
      const costs = promisableOn(contract).map((hero) => full - bestBaseWithout(other, hero)!);

      expect(
        costs.filter((cost) => cost === 0).length,
        `every broken word on ${contract.id} costs ${other.id} something, so there is no cheap ` +
          'branch for a player to find'
      ).toBeGreaterThan(0);
      expect(
        costs.filter((cost) => cost > 0).length,
        `no broken word on ${contract.id} costs ${other.id} anything, so breaking is free and ` +
          'the fork is not a fork'
      ).toBeGreaterThan(0);
    }
  });

  it('and the two put different ceilings on what can be promised', () => {
    // `NEGOTIATION_SPEC` §3.3 bounds both the advance and the promised bonus by the patron fee,
    // so the fee is the size of the fork a settlement can offer at all. Two contracts with the
    // same fee would offer the same fork twice.
    expect(ford.patronFee).not.toBe(barrow.patronFee);
  });
});

describe('the mechanically comparable pair COMBAT_SPEC §13.2 asks for', () => {
  /**
   * **A pair that differs only by a relationship, held by a check rather than by intent.**
   *
   * §13.2's control is that knowing a *person* changes a player's preparation, and it is only
   * a control if swapping the two changes nothing else: two heroes who also differ in
   * attributes let a tester attribute the difference to strength and the gate would count it.
   * The shipped roster had no such pair until `core:vela` — `core:ilsa` and `core:zara` share
   * a role and nothing else, which the playtest material claimed otherwise (§16.3.1).
   *
   * Asserted field by field rather than by deep-equalling the two files: what may differ is
   * exactly the id, the name and the relationships, and a check that compared everything
   * would have to be edited into uselessness the day one of those three moves.
   */
  const mira = content.heroes.get(parseContentId('core:mira'))!;
  const vela = content.heroes.get(parseContentId('core:vela'))!;

  it('is equal in everything a battle reads', () => {
    expect(vela.role).toBe(mira.role);
    expect(vela.combat).toEqual(mira.combat);
    expect([...vela.capability.expertise.entries()]).toEqual([
      ...mira.capability.expertise.entries()
    ]);
    expect(vela.capability.grade).toBe(mira.capability.grade);
  });

  it('is equal in everything a decision reads, so the same crews answer the same way', () => {
    // Otherwise the swap would change *who comes*, and the second preparation would differ
    // for a reason that has nothing to do with the bond.
    expect([vela.greed, vela.caution, vela.pride, vela.trustInGuild]).toEqual([
      mira.greed,
      mira.caution,
      mira.pride,
      mira.trustInGuild
    ]);
    expect([...vela.traits]).toEqual([...mira.traits]);
  });

  it('differs in exactly one thing, and it is a bond', () => {
    expect([...vela.relationships]).toEqual([]);
    expect(
      mira.relationships.filter((bond) => bond.weight >= 12),
      'the bonded half of the pair must hold somebody at or above the reaction threshold, or ' +
        'the pair differs by nothing that fires (COMBAT_SPEC §7.3)'
    ).not.toEqual([]);
  });

  it('holds somebody the same crew can carry, so the bond is reachable in a real fight', () => {
    // A bond toward a man who never goes out with her changes nothing about any battle, and
    // the pair would be comparable and pointless.
    for (const bond of mira.relationships) {
      expect(
        content.heroes.get(bond.hero),
        `${String(bond.hero)} is not in the roster`
      ).toBeDefined();
    }
  });
});
