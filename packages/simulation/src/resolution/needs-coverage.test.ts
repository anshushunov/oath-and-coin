import { describe, expect, it } from 'vitest';

import { SortedMap } from '../collections/sorted-map.ts';
import type { HeroCapability } from '../domain/capability.ts';
import { NeedId, compareNeedIds } from '../domain/need-id.ts';
import { CoverageVerdict, type NeedCoverage } from '../domain/outcome.ts';
import { heroId } from '../ids/hero-id.ts';

import {
  COVERAGE_FLOOR_PERCENT,
  SURPLUS_CAP_PERCENT,
  coverNeeds,
  type CoverageParticipant
} from './needs-coverage.ts';

/**
 * `RESOLUTION_SPEC` §4.1–§4.3, held to exact numbers rather than to directions
 * (§10.2). Every table below states what the arithmetic must produce, not that it
 * moved the right way: "risk raises the requirement" is satisfied by a dozen wrong
 * formulas, and `required = 108 at risk 80` is satisfied by one.
 */

const needs = (entries: Readonly<Partial<Record<NeedId, number>>>): SortedMap<NeedId, number> =>
  SortedMap.from<NeedId, number>(
    compareNeedIds,
    Object.entries(entries).map(([need, weight]) => [need as NeedId, weight as number] as const)
  );

const capability = (
  grade: number,
  expertise: Readonly<Partial<Record<NeedId, number>>>
): HeroCapability => ({
  grade,
  expertise: SortedMap.from<NeedId, number>(
    compareNeedIds,
    Object.entries(expertise).map(([need, amount]) => [need as NeedId, amount as number] as const)
  )
});

/**
 * `count` participants who each contribute exactly `amount` to `frontline`.
 *
 * `grade: 100` so `expertise` *is* the contribution — `expertise × grade / 100` (§4.1) —
 * which keeps a halving table about halving instead of about two multiplications.
 */
const sameContributors = (count: number, amount: number): readonly CoverageParticipant[] =>
  Array.from({ length: count }, (_unused, index) => ({
    hero: heroId(index),
    capability: capability(100, { [NeedId.Frontline]: amount })
  }));

/** One participant contributing `amount` to `frontline`, and nothing to anything else. */
const one = (amount: number): readonly CoverageParticipant[] => sameContributors(1, amount);

const frontlineOf = (coverage: readonly NeedCoverage[]): NeedCoverage =>
  coverage.find((entry) => entry.need === NeedId.Frontline)!;

describe('what a hero brings to one need (§4.1)', () => {
  it.each([
    [100, 70, 70],
    [65, 70, 45], // 45.5 truncated toward zero
    [0, 70, 0],
    [70, 0, 0]
  ])('grade %i and expertise %i contribute %i', (grade, expertise, expected) => {
    const crew = [{ hero: heroId(0), capability: capability(grade, { frontline: expertise }) }];

    expect(frontlineOf(coverNeeds(needs({ frontline: 100 }), crew, { risk: 0 })).supplied).toBe(
      expected
    );
  });

  it('gives a hero the need is no business of exactly nothing, and no contributor row', () => {
    // A missing key and an explicit zero contribute the same (`RESOLUTION_SPEC` §2.2) —
    // and are different facts, which is why only one of them puts the hero on the need.
    const answerable = [{ hero: heroId(0), capability: capability(80, { frontline: 0 }) }];
    const notHisBusiness = [{ hero: heroId(0), capability: capability(80, { wilderness: 50 }) }];

    const withKey = frontlineOf(coverNeeds(needs({ frontline: 50 }), answerable, { risk: 0 }));
    const withoutKey = frontlineOf(
      coverNeeds(needs({ frontline: 50 }), notHisBusiness, { risk: 0 })
    );

    expect(withKey.supplied).toBe(0);
    expect(withoutKey.supplied).toBe(0);
    expect(withKey.contributors).toEqual([{ hero: heroId(0), amount: 0 }]);
    expect(withoutKey.contributors).toEqual([]);
  });
});

describe('the requirement risk raises (§4.2)', () => {
  it.each([
    [0, 60],
    [50, 90],
    [80, 108],
    [100, 120]
  ])('risk %i makes a weight of 60 a requirement of %i', (risk, expected) => {
    // Exact values, not "larger than before": risk *raises the bar* rather than being
    // subtracted from the margin, and a formula that subtracted would make every
    // dangerous contract unwinnable — the surplus ceiling of §4.3 could never catch up.
    expect(frontlineOf(coverNeeds(needs({ frontline: 60 }), one(0), { risk })).required).toBe(
      expected
    );
  });

  it('leaves the authored weight visible beside the raised requirement', () => {
    const covered = frontlineOf(coverNeeds(needs({ frontline: 60 }), one(0), { risk: 80 }));

    expect([covered.weight, covered.required]).toEqual([60, 108]);
  });
});

describe('what a crew supplies together (§4.3)', () => {
  it.each([
    [1, 40], // 40
    [2, 60], // 40 + 20
    [3, 70], // 40 + 20 + 10
    [4, 75] // 40 + 20 + 10 + 5
  ])('%i participants of 40 each supply %i', (count, expected) => {
    expect(
      frontlineOf(coverNeeds(needs({ frontline: 60 }), sameContributors(count, 40), { risk: 0 }))
        .supplied
    ).toBe(expected);
  });

  it('halves by position after sorting, so the strongest is never the one discounted', () => {
    const crew = [
      { hero: heroId(0), capability: capability(100, { frontline: 10 }) },
      { hero: heroId(1), capability: capability(100, { frontline: 80 }) }
    ];

    // 80 + 10/2 = 85, not 10 + 80/2 = 50. A implementation that halved in the order the
    // crew arrived would produce the second number, and the first crew member is the
    // weaker one here precisely so the two cannot agree.
    expect(frontlineOf(coverNeeds(needs({ frontline: 60 }), crew, { risk: 0 })).supplied).toBe(85);
  });

  it('breaks a tie by hero id, and records the contributors in that same order', () => {
    const crew = [
      { hero: heroId(3), capability: capability(100, { frontline: 40 }) },
      { hero: heroId(1), capability: capability(100, { frontline: 40 }) }
    ];

    expect(
      frontlineOf(coverNeeds(needs({ frontline: 60 }), crew, { risk: 0 })).contributors
    ).toEqual([
      { hero: heroId(1), amount: 40 },
      { hero: heroId(3), amount: 40 }
    ]);
  });
});

describe('the ceiling on a surplus (§4.3)', () => {
  it('caps what a doubled need can count for', () => {
    // Requirement 50 at risk 0; one hero brings 100 — twice what was asked. The ceiling
    // is `required × 120 / 100 = 60`, so ten of the fifty surplus points count and forty
    // do not.
    const covered = frontlineOf(coverNeeds(needs({ frontline: 50 }), one(100), { risk: 0 }));

    expect(covered.supplied).toBe(100);
    expect(covered.effective).toBe(60);
    expect(covered.effective).toBe((50 * SURPLUS_CAP_PERCENT) / 100);
  });

  it('does not let a surplus on one need pay for another', () => {
    // The whole reason the ceiling exists: without it, "close one need twice over and
    // forget the second" would be a winning answer to a two-need contract.
    const coverage = coverNeeds(needs({ frontline: 50, wilderness: 50 }), one(100), { risk: 0 });
    const wilderness = coverage.find((entry) => entry.need === NeedId.Wilderness)!;

    expect(frontlineOf(coverage).effective).toBeLessThanOrEqual(60);
    expect(wilderness.verdict).toBe(CoverageVerdict.Uncovered);
    expect(wilderness.effective).toBe(0);
  });

  it('leaves a supply below the ceiling exactly as it is', () => {
    expect(frontlineOf(coverNeeds(needs({ frontline: 50 }), one(30), { risk: 0 })).effective).toBe(
      30
    );
  });
});

describe('the three verdicts (§4.3)', () => {
  it.each([
    [80, 47, CoverageVerdict.Uncovered], // 47 × 100 = 4700 < 80 × 60 = 4800
    [80, 48, CoverageVerdict.Weak], // exactly the floor
    [80, 49, CoverageVerdict.Weak],
    [80, 79, CoverageVerdict.Weak],
    [80, 80, CoverageVerdict.Closed], // exactly the requirement
    [80, 81, CoverageVerdict.Closed]
  ])('a requirement of %i supplied %i is %s', (required, supplied, verdict) => {
    // Eighty, not a hundred: at a requirement of 100 the floor is 60 and `supplied >= 60`
    // reads the same as the percentage rule, so the two are indistinguishable and a
    // implementation that forgot to scale by the requirement would pass.
    expect(
      frontlineOf(coverNeeds(needs({ frontline: required }), one(supplied), { risk: 0 })).verdict
    ).toBe(verdict);
  });

  it('reads the verdict off what was supplied, not off what was allowed to count', () => {
    // `effective` is capped and `supplied` is not, so a rule reading the capped number
    // would call a need closed at exactly the ceiling and never above it. Here supply is
    // twice the requirement: capped or not, this is closed, and `supplied` is what says so.
    const covered = frontlineOf(coverNeeds(needs({ frontline: 50 }), one(100), { risk: 0 }));

    expect(covered.verdict).toBe(CoverageVerdict.Closed);
  });

  it('states the floor as a percentage of the requirement, whatever the requirement is', () => {
    expect(COVERAGE_FLOOR_PERCENT).toBe(60);
    expect(SURPLUS_CAP_PERCENT).toBe(120);
  });
});

describe('the shape a coverage answer has', () => {
  it('answers one row per need, in the vocabulary order', () => {
    const coverage = coverNeeds(
      needs({ wilderness: 20, frontline: 25, undead_knowledge: 30 }),
      one(0),
      { risk: 0 }
    );

    expect(coverage.map((entry) => entry.need)).toEqual([
      NeedId.Frontline,
      NeedId.UndeadKnowledge,
      NeedId.Wilderness
    ]);
  });

  it('does not depend on the order the crew arrived in', () => {
    const crew: readonly CoverageParticipant[] = [
      { hero: heroId(0), capability: capability(90, { frontline: 70, wilderness: 30 }) },
      { hero: heroId(1), capability: capability(60, { frontline: 55 }) },
      { hero: heroId(2), capability: capability(75, { wilderness: 80 }) }
    ];
    const contract = needs({ frontline: 40, wilderness: 42 });

    expect(coverNeeds(contract, [...crew].reverse(), { risk: 50 })).toEqual(
      coverNeeds(contract, crew, { risk: 50 })
    );
  });

  it('answers nothing for a contract that asks nothing, rather than throwing', () => {
    // Not a contract this loader would accept (`RESOLUTION_SPEC` §2.3 puts the floor at
    // two needs), and not this function's rule to enforce a second time.
    expect(
      coverNeeds(SortedMap.empty<NeedId, number>(compareNeedIds), one(50), { risk: 0 })
    ).toEqual([]);
  });

  it('answers every need for a crew of nobody', () => {
    const coverage = coverNeeds(needs({ frontline: 40, wilderness: 42 }), [], { risk: 0 });

    expect(coverage.map((entry) => entry.verdict)).toEqual([
      CoverageVerdict.Uncovered,
      CoverageVerdict.Uncovered
    ]);
    expect(coverage.map((entry) => entry.contributors)).toEqual([[], []]);
  });
});
