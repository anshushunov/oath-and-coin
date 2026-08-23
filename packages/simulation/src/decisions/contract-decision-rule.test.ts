import { describe, expect, it } from 'vitest';

import { SortedMap } from '../collections/sorted-map.ts';
import { SortedSet } from '../collections/sorted-set.ts';
import { compareContentIds } from '../ids/content-id.ts';
import { compareHeroIds, heroId } from '../ids/hero-id.ts';
import { aContext, aContract, aHero, anOffer, aTrait, ids, setOf } from '../testing/fixtures.ts';
import {
  GRIEVANCES,
  HERO_SCALE_PROFILES,
  INCLINATION_WEIGHTS,
  METHOD_TAGS,
  MOOD_ORDINALS,
  OFFER_TERM_FLAGS,
  OFFER_TERM_VALUES,
  RELATIONSHIP_WEIGHTS,
  RISKS,
  crewOf,
  fullContextSweep
} from '../testing/generators.ts';

import { Actions } from './actions.ts';
import type { TraceFactor } from './causal-trace.ts';
import type { DecisionContext } from './context.ts';
import { decide, drawMood, type HeroDecision } from './contract-decision-rule.ts';
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
    // advance*greed = 150 and risk*caution = 90. Term by term: 1 − 0 = 1. Sum first:
    // trunc(60/100) = 0. The two answers differ, and this context is the boundary where
    // they do.
    const decision = decide(
      aContext({
        hero: aHero({ greed: 10, caution: 10, pride: 0, trustInGuild: 0 }),
        contract: aContract({ patronFee: 15, risk: 9, offer: anOffer({ advance: 15 }) }),
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
        contract: aContract({ patronFee: 0, risk: 70 }),
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
          patronFee: 40,
          risk: 80,
          tags: SortedSet.from(compareContentIds, [ids.temple, ids.undead]),
          offer: anOffer({
            advance: 40,
            acceptedBy: SortedSet.from(compareHeroIds, [heroId(1), heroId(2)])
          })
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
        contract: aContract({ patronFee: 40, risk: 80 })
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
    // (`HERO_DECISION_SPEC` §2.3). Greed 0 makes the patron-fee pull 0, and a fairly paid
    // contract has no insult *at all* — not an insult of zero.
    const decision = decide(
      aContext({
        hero: aHero({ greed: 0, caution: 0, pride: 100, trustInGuild: 0 }),
        contract: aContract({ patronFee: 80, risk: 40, offer: anOffer({ advance: 80 }) }),
        decisionOrdinal: 6n
      })
    );

    expect(decision.result.trace.positiveFactors).toEqual([]);
    expect(decision.result.trace.negativeFactors).toEqual([]);
    expect(decision.result.selectedScore).toBe(0);
  });

  it('draws mood on every scored path, inside the grey band or far outside it', () => {
    // The draw is unconditional so that a change in the patron fee cannot change whether
    // an ordinal was spent — otherwise a contrast pair would measure the wrong thing
    // (`HERO_DECISION_SPEC` §2.4).
    const decisive = decide(
      aContext({
        hero: aHero({ greed: 100, caution: 0, pride: 0, trustInGuild: 0 }),
        contract: aContract({ patronFee: 100, risk: 0, offer: anOffer({ advance: 100 }) })
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
          offer: anOffer({
            respondedBy: SortedSet.from(compareHeroIds, [heroId(1), heroId(2)]),
            acceptedBy: SortedSet.from(compareHeroIds, [heroId(1)])
          })
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
        contract: aContract({
          offer: anOffer({ acceptedBy: SortedSet.from(compareHeroIds, [heroId(1)]) })
        }),
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
          contract: aContract({
            offer: anOffer({ acceptedBy: SortedSet.from(compareHeroIds, [heroId(1)]) })
          })
        })
      )
    ).toThrow(/context-assembly bug/);
  });
});

// The nine-axis sweep this identity walks — hero profiles, `offer.advance`, risk,
// an inclination weight, a bond weight, `offer.promisedBonus`, `hero.grievance`, a
// chosen method tag, the mood ordinal, plus three gated contexts — now lives in
// `../testing/generators.ts`'s `fullContextSweep()`. Moved there, not duplicated,
// so `decision-properties.test.ts`'s §10.1 properties pose their questions over
// the same admissible input this identity does rather than a second guess at what
// "a context" means. `contract.patronFee` is deliberately **not** swept —
// `decide()` no longer reads it at all.

describe('the recorded score is the recorded factors', () => {
  it('записанный счёт равен сумме записанных факторов', () => {
    // Движок считает счёт из слагаемых, а факторы складывает отдельным списком: два
    // параллельных пути. Восстановление шагов из сохранения опирается на их совпадение,
    // поэтому оно проверяется, а не подразумевается.
    //
    // Контексты строятся через `fullContextSweep()` — этот тест не знает про границы
    // контента и знать не может. Что тождество держится на всём, что пропускает
    // загрузчик, проверяет тест в `packages/content`.
    const contexts = fullContextSweep();

    // Названо произведением перебираемых осей, не унаследовано: молчаливо
    // сжавшаяся ось прошла бы `toHaveLength` целиком, если бы число здесь не было
    // выведено из тех же констант, которые определяют перебор.
    expect(contexts).toHaveLength(
      HERO_SCALE_PROFILES.length *
        OFFER_TERM_VALUES.length *
        RISKS.length *
        INCLINATION_WEIGHTS.length *
        RELATIONSHIP_WEIGHTS.length *
        OFFER_TERM_FLAGS.length *
        GRIEVANCES.length *
        METHOD_TAGS.length *
        MOOD_ORDINALS.length +
        MOOD_ORDINALS.length
    );
    expect(contexts).toHaveLength(60003);

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
    expect(scored).toBe(60000);
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

/** The reason code a factor with `reasonCode` carries, from whichever list holds it. */
function factorOf(decision: HeroDecision, reasonCode: string): TraceFactor | undefined {
  return (
    decision.result.trace.positiveFactors.find((factor) => factor.reasonCode === reasonCode) ??
    decision.result.trace.negativeFactors.find((factor) => factor.reasonCode === reasonCode)
  );
}

/**
 * A context where every motive `NEGOTIATION_SPEC` §4 names fires exactly once: the
 * advance, the trusted bonus, the risk, the insult, one inclination, trust, one bond,
 * the guild's broken word, and — at the fixture campaign's default seed and ordinal
 * (`aContext`) — a mood of `−2`, established by the mood contrast in `'the trace is the
 * arithmetic, written down'` above.
 */
function aFullyMotivatedContext(): DecisionContext {
  return aContext({
    hero: aHero({
      greed: 100,
      caution: 100,
      pride: 100,
      trustInGuild: 50,
      grievance: 25,
      relationships: SortedMap.from(compareContentIds, [[ids.doran, 5]])
    }),
    contract: aContract({
      risk: 80,
      tags: SortedSet.from(compareContentIds, [ids.undead]),
      offer: anOffer({
        keyHero: heroId(0),
        advance: 10,
        promisedBonus: 20,
        acceptedBy: SortedSet.from(compareHeroIds, [heroId(1)])
      })
    }),
    traits: [aTrait({ id: ids.loyal, tag: ids.undead, weight: 7 })],
    crew: crewOf([[1, ids.doran]])
  });
}

describe('the offer, the promise and a broken word reach the decision', () => {
  it('pulls on the advance, not on the patron fee', () => {
    const decision = decide(
      aContext({
        hero: aHero({ greed: 100 }),
        contract: aContract({ patronFee: 100, risk: 0, offer: anOffer({ advance: 10 }) })
      })
    );
    expect(factorOf(decision, ReasonCodes.PaymentAttractive)?.magnitude).toBe(10);
  });

  it('names the promised bonus as its own reason, never folded into the payment', () => {
    const decision = decide(
      aContext({
        hero: aHero({ id: heroId(0), greed: 100 }),
        contract: aContract({
          risk: 0,
          offer: anOffer({ keyHero: heroId(0), advance: 10, promisedBonus: 20 })
        })
      })
    );
    expect(factorOf(decision, ReasonCodes.PaymentAttractive)?.magnitude).toBe(10);
    expect(factorOf(decision, ReasonCodes.PromiseOfABonus)?.magnitude).toBe(20);
  });

  it('divides the promised bonus on its own, not the same number as folding it into the advance first', () => {
    // At greed 100 every case above is the identity — ×100÷100 — so `bonusPull =
    // trustedBonus` unscaled would still pass them, and so would combining advance and
    // bonus into one division before splitting the result back apart. Greed 10 tells the
    // three apart: divided separately, advance 15 × 10 ÷ 100 = 1 and bonus 25 × 10 ÷ 100
    // = 2. Folded into one division first, (15 + 25) × 10 ÷ 100 = 4 — a different
    // `PaymentAttractive` and no separate bonus factor at all. Left unscaled, the bonus
    // factor would read 25, not 2.
    const decision = decide(
      aContext({
        hero: aHero({ id: heroId(0), greed: 10 }),
        contract: aContract({
          risk: 0,
          offer: anOffer({ keyHero: heroId(0), advance: 15, promisedBonus: 25 })
        })
      })
    );
    expect(factorOf(decision, ReasonCodes.PaymentAttractive)?.magnitude).toBe(1);
    expect(factorOf(decision, ReasonCodes.PromiseOfABonus)?.magnitude).toBe(2);
  });

  it('moves nobody but the hero the promise was given to', () => {
    const decision = decide(
      aContext({
        hero: aHero({ id: heroId(1), greed: 100 }),
        contract: aContract({ risk: 0, offer: anOffer({ keyHero: heroId(0), promisedBonus: 100 }) })
      })
    );
    expect(factorOf(decision, ReasonCodes.PromiseOfABonus)).toBeUndefined();
  });

  it('ignores the promise entirely once the hero stopped believing', () => {
    const decision = decide(
      aContext({
        hero: aHero({ id: heroId(0), greed: 100, believesGuildPromises: false }),
        contract: aContract({ risk: 0, offer: anOffer({ keyHero: heroId(0), promisedBonus: 100 }) })
      })
    );
    expect(factorOf(decision, ReasonCodes.PromiseOfABonus)).toBeUndefined();
  });

  it('counts the trusted bonus against the risk when weighing the insult', () => {
    const decision = decide(
      aContext({
        hero: aHero({ id: heroId(0), pride: 100, greed: 0, caution: 0 }),
        contract: aContract({
          risk: 50,
          offer: anOffer({ keyHero: heroId(0), advance: 20, promisedBonus: 30 })
        })
      })
    );
    expect(factorOf(decision, ReasonCodes.PaymentInsulting)).toBeUndefined();
  });

  it('does not let a promise nobody but the key hero can bank on shield the insult either', () => {
    // Same terms as the shielding case above — advance 20, promisedBonus 30, risk 50 —
    // except this hero is not the key hero, so `trustedBonus` is 0 and `expected` is 20:
    // (50 − 20) × pride 100 ÷ 100 = 30. A shield computed from the raw `promisedBonus`
    // instead of `trustedBonus` would read `expected` as 50, find nothing left for the
    // insult to bite on, and this factor would be absent.
    const decision = decide(
      aContext({
        hero: aHero({ id: heroId(1), pride: 100, greed: 0, caution: 0 }),
        contract: aContract({
          risk: 50,
          offer: anOffer({ keyHero: heroId(0), advance: 20, promisedBonus: 30 })
        })
      })
    );
    expect(factorOf(decision, ReasonCodes.PaymentInsulting)?.magnitude).toBe(30);
  });

  it('does not let a promise the hero stopped believing shield the insult either', () => {
    // Same shape again, this time with the key hero herself, but she no longer believes
    // the guild — `trustedBonus` is 0 for the same reason as `ignores the promise
    // entirely once the hero stopped believing` above, and the insult is exposed exactly
    // as it is when the promise went to someone else.
    const decision = decide(
      aContext({
        hero: aHero({
          id: heroId(0),
          pride: 100,
          greed: 0,
          caution: 0,
          believesGuildPromises: false
        }),
        contract: aContract({
          risk: 50,
          offer: anOffer({ keyHero: heroId(0), advance: 20, promisedBonus: 30 })
        })
      })
    );
    expect(factorOf(decision, ReasonCodes.PaymentInsulting)?.magnitude).toBe(30);
  });

  it('remembers a broken word as its own negative reason', () => {
    const decision = decide(aContext({ hero: aHero({ grievance: 25 }) }));
    expect(decision.result.trace.negativeFactors).toContainEqual({
      reasonCode: ReasonCodes.GuildBrokeItsWord,
      sourceEntity: ids.bram,
      magnitude: 25
    });
    // The direction is the whole point of the name "negative reason": a factor list is
    // not searched by code alone, because which list a code lands in is what says
    // whether grievance moved this hero toward the guild or away from it
    // (`HERO_DECISION_SPEC` §3). A push that landed the same entry in `positiveFactors`
    // instead — turning a grudge into a reason to take the contract — would satisfy the
    // assertion above just as well; this one catches exactly that.
    expect(decision.result.trace.positiveFactors).not.toContainEqual(
      expect.objectContaining({ reasonCode: ReasonCodes.GuildBrokeItsWord })
    );
  });

  it('lets the chosen method tag close the gate exactly like an authored one', () => {
    const decision = decide(
      aContext({
        contract: aContract({
          tags: setOf(ids.cult),
          offer: anOffer({ methodTag: ids.deception })
        }),
        traits: [
          aTrait({ id: ids.refusesDeception, tag: ids.deception, isPrinciple: true, weight: 0 })
        ]
      })
    );
    expect(decision.result.selectedAction).toBe(Actions.Decline);
    expect(decision.result.selectedScore).toBeNull();
    expect(decision.ordinalsConsumed).toBe(0n);
  });

  it('lets the chosen method tag move an inclination exactly like an authored one', () => {
    // The gate case above cannot tell "inclinations still read `contract.tags` alone"
    // apart from a correct implementation: a principle trait never reaches the
    // inclination loop at all, blocked or not. This one uses a plain inclination on the
    // method tag, with nothing authored on the contract for it to coincide with — a
    // revert of the inclination loop's `effectiveTags` back to `contract.tags` leaves
    // this factor unpushed.
    const decision = decide(
      aContext({
        contract: aContract({
          tags: setOf(ids.cult),
          offer: anOffer({ methodTag: ids.deception })
        }),
        traits: [aTrait({ id: ids.loyal, tag: ids.deception, isPrinciple: false, weight: 15 })]
      })
    );
    expect(factorOf(decision, ReasonCodes.PersonalConviction)?.magnitude).toBe(15);
  });

  it('keeps the factor order the artifact relies on', () => {
    // `positiveFactors` and `negativeFactors` are the two lists the canonical artifact
    // actually serializes (`HERO_DECISION_SPEC` §3) — asserted as ordered arrays each,
    // not merged and re-sorted by a table stated in the test itself. A merge-and-sort
    // would hold by construction regardless of what order the rule actually pushed in;
    // these two `toEqual` calls do not.
    const decision = decide(aFullyMotivatedContext());
    expect(decision.result.trace.positiveFactors.map((factor) => factor.reasonCode)).toEqual([
      ReasonCodes.PaymentAttractive,
      ReasonCodes.PromiseOfABonus,
      ReasonCodes.PersonalConviction,
      ReasonCodes.TrustsTheGuild,
      ReasonCodes.StandsWithComrade
    ]);
    expect(decision.result.trace.negativeFactors.map((factor) => factor.reasonCode)).toEqual([
      ReasonCodes.RiskTooHigh,
      ReasonCodes.PaymentInsulting,
      ReasonCodes.GuildBrokeItsWord,
      ReasonCodes.UnpredictableMood
    ]);
  });
});
