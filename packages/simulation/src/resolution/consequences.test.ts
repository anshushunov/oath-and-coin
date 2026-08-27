import { describe, expect, it } from 'vitest';

import { NeedId } from '../domain/need-id.ts';
import {
  ConsequenceKind,
  CoverageVerdict,
  OutcomeGrade,
  OutcomeIntentKind,
  type NeedCoverage,
  type OutcomeIntent
} from '../domain/outcome.ts';
import { OutcomeReasonCodes } from '../domain/outcome-reason-codes.ts';
import { heroId } from '../ids/hero-id.ts';

import {
  GRUDGE_MAGNITUDE,
  TRUST_LOST_MAGNITUDE,
  WOUND_MAGNITUDE,
  consequencesFor
} from './consequences.ts';
import { termsOf } from './outcome-grade.ts';

/**
 * `RESOLUTION_SPEC` §5.1 and §5.2 — how many people an outcome costs, which kinds, and
 * who exactly.
 *
 * Hand-built coverage rows rather than a resolved contract: these rules read `supplied`,
 * `required` and who was answerable, and stating those directly is what lets a case pose
 * "two heroes on the same need, one four times the other" without also having to arrange
 * a grade for it.
 *
 * **Hero 7 is deliberately the larger and hero 3 the smaller, wherever a case is not
 * about a tie.** External review of this task found every fixture here putting the
 * expected hero at both the extreme of the quantity *and* the lower id — so a rule that
 * ignored the amounts entirely and always answered the lowest id passed the lot. Ids are
 * now opposed to the quantity, and the input order is opposed to both.
 */

interface RowSpec {
  readonly required: number;
  readonly supplied: number;
  readonly verdict: CoverageVerdict;
  /**
   * Everyone answerable for this need (§2.2) with both of §4.3's numbers — what he
   * brought and how much of it counted. `counted` is stated rather than derived here
   * (the halving is `coverNeeds`' business, not this file's) and these rules do not read
   * it; it is written truthfully anyway, because a fixture that says something false
   * about the arithmetic is a fixture a later reader will believe.
   */
  readonly held: readonly (readonly [number, number, number])[];
}

const row = (need: NeedId, spec: RowSpec): NeedCoverage => ({
  need,
  weight: spec.required,
  required: spec.required,
  supplied: spec.supplied,
  effective: spec.supplied,
  verdict: spec.verdict,
  contributors: spec.held.map(([id, amount, counted]) => ({ hero: heroId(id), amount, counted }))
});

const gaveWay = (hero: number, need: NeedId): OutcomeIntent => ({
  kind: OutcomeIntentKind.FalteredEarly,
  hero: heroId(hero),
  need,
  marginDelta: 0,
  reason: OutcomeReasonCodes.FalteredEarly,
  gap: null,
  consequence: null,
  magnitude: 0
});

/**
 * One closed need and one that was not, with two heroes of unequal weight on the second.
 *
 * The larger of the two carries the higher id and is listed second, so "the biggest
 * contributor", "the lowest id" and "the first one listed" name three different people.
 */
const twoNeeds: readonly NeedCoverage[] = [
  row(NeedId.Frontline, {
    required: 60,
    supplied: 100,
    verdict: CoverageVerdict.Closed,
    held: [[7, 100, 100]]
  }),
  row(NeedId.Wilderness, {
    required: 200,
    supplied: 90,
    verdict: CoverageVerdict.Uncovered,
    held: [
      [3, 20, 10],
      [7, 80, 80]
    ]
  })
];

const anInput = (overrides: Partial<Parameters<typeof consequencesFor>[0]> = {}) =>
  consequencesFor({
    grade: OutcomeGrade.Failed,
    coverage: twoNeeds,
    faltered: [],
    // Neither of the two on the wilderness need, so the key hero's own consequence can
    // never be mistaken for the wound's.
    keyHero: heroId(5),
    ...overrides
  });

describe('how many an outcome costs (§5.1)', () => {
  it.each(Object.values(OutcomeGrade))('%s produces exactly what its terms declare', (grade) => {
    // The count is `termsOf`'s to state, so this reads it there rather than restating the
    // table: two independent copies of "how many" is one place for them to disagree.
    expect(anInput({ grade })).toHaveLength(termsOf(grade).maxConsequences);
  });

  it('costs a clean outcome nobody', () => {
    expect(anInput({ grade: OutcomeGrade.Clean })).toEqual([]);
  });

  it.each([OutcomeGrade.Costly, OutcomeGrade.Failed])(
    '%s wounds one person when nobody gave way',
    (grade) => {
      expect(anInput({ grade }).map((consequence) => consequence.kind)).toEqual([
        ConsequenceKind.Wound
      ]);
    }
  );

  it.each([OutcomeGrade.Costly, OutcomeGrade.Failed])(
    '%s answers with a grudge instead, once somebody did give way',
    (grade) => {
      // Edition 1.0 put `Wound` first at a limit of one record, which made `Grudge`
      // unreachable at these two grades entirely (§5.1).
      expect(
        anInput({ grade, faltered: [gaveWay(3, NeedId.Wilderness)] }).map(
          (consequence) => consequence.kind
        )
      ).toEqual([ConsequenceKind.Grudge]);
    }
  );

  it('costs a catastrophe a wound and the guild’s standing, in that order', () => {
    expect(
      anInput({ grade: OutcomeGrade.Disaster }).map((consequence) => consequence.kind)
    ).toEqual([ConsequenceKind.Wound, ConsequenceKind.TrustLost]);
  });

  it('costs a catastrophe a wound and a grudge, once somebody gave way', () => {
    expect(
      anInput({
        grade: OutcomeGrade.Disaster,
        faltered: [gaveWay(3, NeedId.Wilderness)]
      }).map((consequence) => consequence.kind)
    ).toEqual([ConsequenceKind.Wound, ConsequenceKind.Grudge]);
  });

  it('states each magnitude once, as §5.1 sets them', () => {
    expect([WOUND_MAGNITUDE, GRUDGE_MAGNITUDE, TRUST_LOST_MAGNITUDE]).toEqual([1, 1, 1]);
  });
});

describe('who is wounded (§5.2)', () => {
  it('names the one who was on the point, not the weakest beside him', () => {
    // Both are answerable for the need that came out worst; the wound goes to the one who
    // carried the most of it — hero 7, who is also the *higher* id and listed *second*,
    // so neither of those can be what produced the answer. "Whoever brought least" would
    // be the shape §5.2 refuses by name: in an additive model the weakest member still
    // improved the result, and an obligatory culprit after every imperfect outcome
    // teaches scapegoating (§6.3).
    const [wound] = anInput();

    expect(wound).toEqual({
      hero: heroId(7),
      kind: ConsequenceKind.Wound,
      reason: OutcomeReasonCodes.WoundOnThePoint,
      magnitude: WOUND_MAGNITUDE
    });
  });

  it('measures “worst covered” as a share, not as a shortfall in points', () => {
    // 20 short of 200 is nine-tenths answered; 10 short of 20 is half answered. The second
    // is the worse failure although the smaller number, and a rule reading absolute
    // shortfalls would point the wound at the first (§4.8).
    const [wound] = consequencesFor({
      grade: OutcomeGrade.Failed,
      coverage: [
        row(NeedId.Frontline, {
          required: 200,
          supplied: 180,
          verdict: CoverageVerdict.Weak,
          held: [[7, 180, 180]]
        }),
        row(NeedId.Wilderness, {
          required: 20,
          supplied: 10,
          verdict: CoverageVerdict.Weak,
          held: [[3, 10, 10]]
        })
      ],
      faltered: [],
      keyHero: heroId(5)
    });

    expect(wound?.hero).toBe(heroId(3));
  });

  it('counts a hero answerable at nought as having held the need', () => {
    // §2.2's distinction, reached through §5.2: `expertise.has(need)` means the need was
    // his business even at an expertise of nought, and an absent key means it never was.
    // The wilderness need here is held by exactly one man who brought nothing — so it is
    // a held need, it is the worst covered of the two, and he is the one who was on its
    // point. A rule reading "somebody brought something" instead would pass it over and
    // wound hero 7, whose need closed.
    const [wound] = consequencesFor({
      grade: OutcomeGrade.Failed,
      coverage: [
        row(NeedId.Frontline, {
          required: 100,
          supplied: 100,
          verdict: CoverageVerdict.Closed,
          held: [[7, 100, 100]]
        }),
        row(NeedId.Wilderness, {
          required: 100,
          supplied: 0,
          verdict: CoverageVerdict.Uncovered,
          held: [[3, 0, 0]]
        })
      ],
      faltered: [],
      keyHero: heroId(5)
    });

    expect(wound?.hero).toBe(heroId(3));
  });

  it('skips a need nobody in the crew answered for, and wounds the held one instead', () => {
    // Owner's decision, 2026-08-27. The unanswered need is covered at nought and is
    // therefore the worst of all — and has nobody to wound, while §5.1 declares exactly one
    // record. Taking it literally left an outcome with no consequence at all; the rule now
    // passes over it and names whoever held the worst of the needs somebody did answer for.
    //
    // Distinct from the case above, and the pair is the point: there, one man held the
    // need at nought; here, nobody holds it at all.
    const [wound] = consequencesFor({
      grade: OutcomeGrade.Costly,
      coverage: [
        row(NeedId.Frontline, {
          required: 100,
          supplied: 100,
          verdict: CoverageVerdict.Closed,
          held: [[7, 100, 100]]
        }),
        row(NeedId.UndeadKnowledge, {
          required: 5,
          supplied: 0,
          verdict: CoverageVerdict.Uncovered,
          held: []
        })
      ],
      faltered: [],
      keyHero: heroId(5)
    });

    expect(wound?.hero).toBe(heroId(7));
  });

  it('wounds nobody when the crew answered for nothing the contract asked', () => {
    // The residual case §5.2 names: no held need means no point to have been on. One record
    // fewer than the grade declares, said out loud rather than discovered.
    expect(
      consequencesFor({
        grade: OutcomeGrade.Failed,
        coverage: [
          row(NeedId.Frontline, {
            required: 100,
            supplied: 0,
            verdict: CoverageVerdict.Uncovered,
            held: []
          })
        ],
        faltered: [],
        keyHero: heroId(5)
      })
    ).toEqual([]);
  });

  it('breaks a tie on the point by hero id', () => {
    const [wound] = consequencesFor({
      grade: OutcomeGrade.Failed,
      coverage: [
        row(NeedId.Frontline, {
          required: 200,
          supplied: 60,
          verdict: CoverageVerdict.Uncovered,
          // Handed over with the larger id first, so "keep the order given" answers 7.
          held: [
            [7, 40, 20],
            [3, 40, 40]
          ]
        })
      ],
      faltered: [],
      keyHero: heroId(5)
    });

    expect(wound?.hero).toBe(heroId(3));
  });
});

describe('who resents it (§5.2)', () => {
  it('names the one who brought least to his own need, not to the contract’s worst', () => {
    // Two heroes gave way on two different needs. §5.2 compares each against *his own* —
    // a rule that looked both up in one need would find the other absent at nought and
    // point at him every time.
    //
    // The one who brought least is hero 7, who is also the higher id and listed second in
    // `faltered`, so neither "lowest id" nor "first one listed" produces this answer.
    const [grudge] = consequencesFor({
      grade: OutcomeGrade.Failed,
      coverage: [
        row(NeedId.Frontline, {
          required: 200,
          supplied: 10,
          verdict: CoverageVerdict.Uncovered,
          held: [[7, 10, 10]]
        }),
        row(NeedId.Wilderness, {
          required: 200,
          supplied: 30,
          verdict: CoverageVerdict.Uncovered,
          held: [[3, 30, 30]]
        })
      ],
      faltered: [gaveWay(3, NeedId.Wilderness), gaveWay(7, NeedId.Frontline)],
      keyHero: heroId(5)
    });

    expect(grudge).toEqual({
      hero: heroId(7),
      kind: ConsequenceKind.Grudge,
      reason: OutcomeReasonCodes.GrudgeAfterFaltering,
      magnitude: GRUDGE_MAGNITUDE
    });
  });

  it('breaks a tie between two who gave way equally by hero id', () => {
    const [grudge] = consequencesFor({
      grade: OutcomeGrade.Failed,
      coverage: [
        row(NeedId.Wilderness, {
          required: 200,
          supplied: 45,
          verdict: CoverageVerdict.Uncovered,
          held: [
            [7, 30, 15],
            [3, 30, 30]
          ]
        })
      ],
      // Handed over with the larger id first, so "keep the order given" answers 7.
      faltered: [gaveWay(7, NeedId.Wilderness), gaveWay(3, NeedId.Wilderness)],
      keyHero: heroId(5)
    });

    expect(grudge?.hero).toBe(heroId(3));
  });
});

describe('who the guild loses (§5.2)', () => {
  it('costs the key hero his trust, and nobody else', () => {
    // Edition 1.0 spent this on the whole crew, which produced up to six records where two
    // were declared (§5.1). It belongs to the one man the guild actually dealt with — who
    // is deliberately neither the wounded man nor anyone on the failing need.
    const [, trust] = anInput({ grade: OutcomeGrade.Disaster });

    expect(trust).toEqual({
      hero: heroId(5),
      kind: ConsequenceKind.TrustLost,
      reason: OutcomeReasonCodes.TrustLostInDisaster,
      magnitude: TRUST_LOST_MAGNITUDE
    });
  });
});
