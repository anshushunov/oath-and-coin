import { describe, expect, it } from 'vitest';

import { SortedMap } from '../collections/sorted-map.ts';
import { SortedSet } from '../collections/sorted-set.ts';
import { compareContentIds, type ContentId } from '../ids/content-id.ts';
import { compareHeroIds, heroId, type HeroId } from '../ids/hero-id.ts';
import { aContext, aContract, aHero, aTrait, ids } from '../testing/fixtures.ts';

import { Actions } from './actions.ts';
import type { DecisionContext } from './context.ts';
import { decide, drawMood } from './contract-decision-rule.ts';
import { ReasonCodes } from './reason-codes.ts';

/**
 * The decision rule's own invariants, in the shape `HERO_DECISION_SPEC` §2 states them:
 * the gate before any arithmetic, one division per term, the exact-zero tie, the factor
 * order that reaches the canonical artifact.
 *
 * Every case here poses its question through a hand-built context rather than through
 * the frozen corpus. That is deliberate and it is the point of §8.7's first trap: on
 * shipped content every dividend is non-negative, so the corpus cannot tell truncation
 * from flooring, cannot reach a score of exactly zero on demand, and cannot construct a
 * hero listed in `acceptedBy` but missing from `crew`. Corpus parity is Task 10's job;
 * these are the properties parity would agree with while being wrong about.
 */

const crewOf = (entries: readonly (readonly [number, ContentId])[]): SortedMap<HeroId, ContentId> =>
  SortedMap.from<HeroId, ContentId>(
    compareHeroIds,
    entries.map(([id, definition]) => [heroId(id), definition] as const)
  );

describe('the gate runs before any arithmetic', () => {
  it('declines outright when a principle tag is on the contract, with no score', () => {
    const decision = decide(
      aContext({
        contract: aContract({ tags: SortedSet.from(compareContentIds, [ids.temple]) }),
        traits: [aTrait({ id: ids.refusesTemples, tag: ids.temple, isPrinciple: true, weight: 0 })]
      })
    );

    expect(decision.result.selectedAction).toBe(Actions.Decline);
    expect(decision.result.selectedScore).toBeNull();
    expect(decision.result.trace.blockedBy).toEqual([
      { reasonCode: ReasonCodes.PrincipleForbids, sourceEntity: ids.refusesTemples }
    ]);
    expect(decision.result.trace.positiveFactors).toEqual([]);
    expect(decision.result.trace.negativeFactors).toEqual([]);
    expect(decision.result.trace.tieBreak).toBeNull();
  });

  it('spends no RNG ordinal at all — not one, zero', () => {
    // §8.7 trap 3. An ordinal burned on a decision the red line closed would shift the
    // mood of every later decision in the campaign, and every replay would agree with
    // itself while being wrong about how much randomness had been spent.
    const blocked = decide(
      aContext({
        contract: aContract({ tags: SortedSet.from(compareContentIds, [ids.temple]) }),
        traits: [aTrait({ id: ids.refusesTemples, tag: ids.temple, isPrinciple: true, weight: 0 })]
      })
    );

    const scored = decide(aContext());

    expect(blocked.ordinalsConsumed).toBe(0n);
    expect(scored.ordinalsConsumed).toBe(1n);
  });

  it('reports every violated principle, in trait-id order, not the first one found', () => {
    const decision = decide(
      aContext({
        contract: aContract({ tags: SortedSet.from(compareContentIds, [ids.temple, ids.undead]) }),
        traits: [
          aTrait({ id: ids.hatesUndead, tag: ids.undead, isPrinciple: true, weight: 0 }),
          aTrait({ id: ids.refusesTemples, tag: ids.temple, isPrinciple: true, weight: 0 })
        ]
      })
    );

    expect(decision.result.trace.blockedBy.map((block) => block.sourceEntity)).toEqual([
      ids.hatesUndead,
      ids.refusesTemples
    ]);
  });

  it('lets a principle whose tag the contract does not carry through without contributing', () => {
    const decision = decide(
      aContext({
        contract: aContract({ tags: SortedSet.from(compareContentIds, [ids.undead]) }),
        traits: [aTrait({ id: ids.refusesTemples, tag: ids.temple, isPrinciple: true, weight: 30 })]
      })
    );

    expect(decision.result.trace.blockedBy).toEqual([]);
    // A principle carries no weight even when its authored weight says otherwise: the
    // contract's tags did not match, so it is neither a block nor an inclination.
    expect(decision.result.selectedScore).toBe(drawMood(7n, 0n).value);
  });
});

describe('every term divides on its own', () => {
  it('is not the same number as dividing the combined sum', () => {
    // payment*greed = 150 and risk*caution = 90. Term by term: 1 − 0 = 1. Sum first:
    // trunc(60/100) = 0. The two answers differ, and this context is the boundary where
    // they do.
    const decision = decide(
      aContext({
        hero: aHero({ greed: 10, caution: 10, pride: 0, trustInGuild: 0 }),
        contract: aContract({ payment: 15, risk: 9 }),
        decisionOrdinal: 6n
      })
    );

    expect(drawMood(7n, 6n).value).toBe(0);
    expect(decision.result.selectedScore).toBe(1);
    expect(decision.result.trace.positiveFactors).toEqual([
      { reasonCode: ReasonCodes.PaymentAttractive, sourceEntity: ids.crypt, magnitude: 1 }
    ]);
    expect(decision.result.trace.negativeFactors).toEqual([]);
  });

  it('rounds toward zero, not toward negative infinity', () => {
    // §8.7 trap 1, and the only place in this suite that can tell the two apart. Every
    // dividend on shipped content is non-negative, so `Math.floor` and `Math.trunc`
    // agree across all 54 corpus entries; a negative scale is the fixture that separates
    // them. insult = (70 − 0) * −45 / 100 → −31 truncated, −32 floored, and the score
    // subtracts it.
    const decision = decide(
      aContext({
        hero: aHero({ greed: 0, caution: 0, pride: -45, trustInGuild: 0 }),
        contract: aContract({ payment: 0, risk: 70 }),
        decisionOrdinal: 6n
      })
    );

    expect(decision.result.selectedScore).toBe(31);
  });
});

describe('the trace is the arithmetic, written down', () => {
  it('lists factors in the HERO_DECISION_SPEC §2.3 order, mood last', () => {
    const decision = decide(
      aContext({
        hero: aHero({
          greed: 100,
          caution: 100,
          pride: 100,
          trustInGuild: 50,
          relationships: SortedMap.from(compareContentIds, [
            [ids.doran, 5],
            [ids.zara, -5]
          ])
        }),
        contract: aContract({
          payment: 40,
          risk: 80,
          tags: SortedSet.from(compareContentIds, [ids.temple, ids.undead]),
          acceptedBy: SortedSet.from(compareHeroIds, [heroId(1), heroId(2)])
        }),
        traits: [
          aTrait({ id: ids.loyal, tag: ids.undead, weight: 7 }),
          aTrait({ id: ids.squeamish, tag: ids.temple, weight: -3 })
        ],
        crew: crewOf([
          [1, ids.doran],
          [2, ids.zara]
        ])
      })
    );

    expect(decision.result.trace.positiveFactors).toEqual([
      { reasonCode: ReasonCodes.PaymentAttractive, sourceEntity: ids.crypt, magnitude: 40 },
      { reasonCode: ReasonCodes.PersonalConviction, sourceEntity: ids.loyal, magnitude: 7 },
      { reasonCode: ReasonCodes.TrustsTheGuild, sourceEntity: ids.bram, magnitude: 5 },
      { reasonCode: ReasonCodes.StandsWithComrade, sourceEntity: ids.doran, magnitude: 5 }
    ]);
    expect(decision.result.trace.negativeFactors).toEqual([
      { reasonCode: ReasonCodes.RiskTooHigh, sourceEntity: ids.crypt, magnitude: 80 },
      { reasonCode: ReasonCodes.PaymentInsulting, sourceEntity: ids.crypt, magnitude: 40 },
      { reasonCode: ReasonCodes.PersonalAversion, sourceEntity: ids.squeamish, magnitude: 3 },
      { reasonCode: ReasonCodes.WillNotWorkWith, sourceEntity: ids.zara, magnitude: 5 },
      { reasonCode: ReasonCodes.UnpredictableMood, sourceEntity: ids.bram, magnitude: 2 }
    ]);
    expect(decision.result.selectedScore).toBe(-73);
    expect(decision.result.selectedAction).toBe(Actions.Decline);
  });

  it('sums to exactly the selected score', () => {
    const decision = decide(
      aContext({
        hero: aHero({ greed: 100, caution: 100, pride: 100, trustInGuild: 50 }),
        contract: aContract({ payment: 40, risk: 80 })
      })
    );

    const total = (factors: readonly { readonly magnitude: number }[]): number =>
      factors.reduce((sum, factor) => sum + factor.magnitude, 0);

    expect(
      total(decision.result.trace.positiveFactors) - total(decision.result.trace.negativeFactors)
    ).toBe(decision.result.selectedScore);
  });

  it('omits a term that weighed nothing rather than listing it at zero', () => {
    // A reason that changed nothing is noise crowding real reasons out of the top rows
    // (`HERO_DECISION_SPEC` §2.3). Greed 0 makes the payment pull 0, and a fairly paid
    // contract has no insult *at all* — not an insult of zero.
    const decision = decide(
      aContext({
        hero: aHero({ greed: 0, caution: 0, pride: 100, trustInGuild: 0 }),
        contract: aContract({ payment: 80, risk: 40 }),
        decisionOrdinal: 6n
      })
    );

    expect(decision.result.trace.positiveFactors).toEqual([]);
    expect(decision.result.trace.negativeFactors).toEqual([]);
    expect(decision.result.selectedScore).toBe(0);
  });

  it('draws mood on every scored path, inside the grey band or far outside it', () => {
    // The draw is unconditional so that a change in payment cannot change whether an
    // ordinal was spent — otherwise a contrast pair would measure the wrong thing
    // (`HERO_DECISION_SPEC` §2.4).
    const decisive = decide(
      aContext({
        hero: aHero({ greed: 100, caution: 0, pride: 0, trustInGuild: 0 }),
        contract: aContract({ payment: 100, risk: 0 })
      })
    );

    expect(decisive.ordinalsConsumed).toBe(1n);
    expect(decisive.result.trace.negativeFactors).toEqual([
      { reasonCode: ReasonCodes.UnpredictableMood, sourceEntity: ids.bram, magnitude: 2 }
    ]);
  });
});

describe('exactly zero is a tie, not a quiet acceptance', () => {
  it('names the rule that settled it and still accepts', () => {
    const decision = decide(aContext({ decisionOrdinal: 6n }));

    expect(decision.result.selectedScore).toBe(0);
    expect(decision.result.selectedAction).toBe(Actions.Accept);
    expect(decision.result.trace.tieBreak).toBe(ReasonCodes.NoReasonToRefuse);
  });

  it('leaves the tie-break empty when the score is not zero', () => {
    const decision = decide(aContext());

    expect(decision.result.selectedScore).toBe(-2);
    expect(decision.result.selectedAction).toBe(Actions.Decline);
    expect(decision.result.trace.tieBreak).toBeNull();
  });
});

describe('bonds', () => {
  it('count only heroes who have already accepted, not everyone who responded', () => {
    const hero = aHero({
      greed: 0,
      caution: 0,
      pride: 0,
      trustInGuild: 0,
      relationships: SortedMap.from(compareContentIds, [
        [ids.doran, 9],
        [ids.zara, 9]
      ])
    });

    const decision = decide(
      aContext({
        hero,
        contract: aContract({
          respondedBy: SortedSet.from(compareHeroIds, [heroId(1), heroId(2)]),
          acceptedBy: SortedSet.from(compareHeroIds, [heroId(1)])
        }),
        crew: crewOf([[1, ids.doran]]),
        decisionOrdinal: 6n
      })
    );

    expect(decision.result.selectedScore).toBe(9);
    expect(decision.result.trace.positiveFactors).toHaveLength(1);
  });

  it('ignore an accepted hero the deciding hero has no opinion about', () => {
    const decision = decide(
      aContext({
        contract: aContract({ acceptedBy: SortedSet.from(compareHeroIds, [heroId(1)]) }),
        crew: crewOf([[1, ids.doran]]),
        decisionOrdinal: 6n
      })
    );

    expect(decision.result.selectedScore).toBe(0);
    expect(decision.result.trace.positiveFactors).toEqual([]);
  });

  it('fail loudly when an accepted hero is missing from the crew', () => {
    expect(() =>
      decide(
        aContext({
          contract: aContract({ acceptedBy: SortedSet.from(compareHeroIds, [heroId(1)]) })
        })
      )
    ).toThrow(/context-assembly bug/);
  });
});

/**
 * Hero profiles the sweep below walks, chosen to put each scale at both ends of its own
 * behaviour and at an ordinary middle — not to reproduce any authored hero.
 */
const PROFILES: readonly (readonly [number, number, number, number])[] = [
  [0, 0, 0, 0],
  [100, 100, 100, 100],
  [60, 30, 45, 50],
  [99, 1, 1, 9],
  [1, 99, 99, 91]
];

/**
 * A deterministic sweep of contexts, built here from {@link aContext} rather than drawn
 * from a generator: global randomness is banned in this package, and an enumeration is
 * reproducible on top of that — a failure names the same context on every run.
 *
 * Every term of `HERO_DECISION_SPEC` §2.3 is moved by something in here: payment and
 * risk (which also drives the insult term on and off, since insult exists only while
 * payment is below risk), the four hero scales, an inclination pulling each way, a bond
 * pulling each way, and three mood ordinals. The traits carry both tags the contract
 * does, so both fire.
 */
function localContexts(): readonly DecisionContext[] {
  const contexts: DecisionContext[] = [];

  for (const [greed, caution, pride, trustInGuild] of PROFILES) {
    for (const payment of [0, 15, 40, 100]) {
      for (const risk of [0, 9, 55, 80, 100]) {
        for (const traitWeight of [-30, -3, 0, 7, 30]) {
          for (const bondWeight of [-20, -5, 0, 5, 20]) {
            for (const decisionOrdinal of [0n, 3n, 6n]) {
              contexts.push(
                aContext({
                  hero: aHero({
                    greed,
                    caution,
                    pride,
                    trustInGuild,
                    relationships: SortedMap.from(compareContentIds, [
                      [ids.doran, bondWeight],
                      [ids.zara, -bondWeight]
                    ])
                  }),
                  contract: aContract({
                    payment,
                    risk,
                    tags: SortedSet.from(compareContentIds, [ids.temple, ids.undead]),
                    acceptedBy: SortedSet.from(compareHeroIds, [heroId(1), heroId(2)])
                  }),
                  traits: [
                    aTrait({ id: ids.loyal, tag: ids.undead, weight: traitWeight }),
                    aTrait({ id: ids.squeamish, tag: ids.temple, weight: -traitWeight })
                  ],
                  crew: crewOf([
                    [1, ids.doran],
                    [2, ids.zara]
                  ]),
                  decisionOrdinal
                })
              );
            }
          }
        }
      }
    }
  }

  // A red line closes the decision before any score exists, so these carry the score the
  // sweep must skip rather than sum. Present on purpose: an invariant stated only over
  // scored decisions would not say what it does about the other kind.
  for (const decisionOrdinal of [0n, 3n, 6n]) {
    contexts.push(
      aContext({
        contract: aContract({ tags: SortedSet.from(compareContentIds, [ids.temple]) }),
        traits: [aTrait({ id: ids.refusesTemples, tag: ids.temple, isPrinciple: true, weight: 0 })],
        decisionOrdinal
      })
    );
  }

  return contexts;
}

describe('the recorded score is the recorded factors', () => {
  it('записанный счёт равен сумме записанных факторов', () => {
    // Движок считает счёт из слагаемых, а факторы складывает отдельным списком: два
    // параллельных пути. Восстановление шагов из сохранения опирается на их совпадение,
    // поэтому оно проверяется, а не подразумевается.
    //
    // Контексты строятся локально, из `aContext` — этот тест не знает про границы
    // контента и знать не может. Что тождество держится на всём, что пропускает
    // загрузчик, проверяет тест в `packages/content`.
    const contexts = localContexts();

    // Названо числом: молчаливо сжавшийся перебор прошёл бы эту проверку целиком, и
    // «зелено» означало бы «нечего было проверять».
    expect(contexts).toHaveLength(7503);

    let scored = 0;
    let blocked = 0;

    for (const context of contexts) {
      const { result } = decide(context);

      if (result.selectedScore === null) {
        blocked += 1;
        continue;
      }

      scored += 1;

      const positive = result.trace.positiveFactors.reduce((a, f) => a + f.magnitude, 0);
      const negative = result.trace.negativeFactors.reduce((a, f) => a + f.magnitude, 0);

      expect(positive - negative).toBe(result.selectedScore);
    }

    expect(blocked).toBe(3);
    expect(scored).toBe(7500);
  });
});

describe('trait order is checked, not assumed', () => {
  it('refuses traits that are not strictly sorted by id', () => {
    expect(() =>
      decide(
        aContext({
          traits: [aTrait({ id: ids.squeamish }), aTrait({ id: ids.loyal })]
        })
      )
    ).toThrow(/strictly sorted by id/);
  });

  it('refuses a repeated trait id, which would double-count its weight', () => {
    expect(() =>
      decide(
        aContext({
          traits: [aTrait({ id: ids.loyal }), aTrait({ id: ids.loyal })]
        })
      )
    ).toThrow(/strictly sorted by id/);
  });
});
