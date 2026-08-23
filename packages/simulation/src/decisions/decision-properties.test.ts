import { describe, expect, it } from 'vitest';

import { deepEqual } from '../collections/deep-equal.ts';
import { heroId } from '../ids/hero-id.ts';
import {
  FULL_CONTEXT_SWEEP_SIZE,
  GRIEVANCES,
  HERO_SCALE_PROFILES,
  INCLINATION_WEIGHTS,
  METHOD_TAGS,
  MOOD_ORDINALS,
  OFFER_TERM_FLAGS,
  OFFER_TERM_VALUES,
  RELATIONSHIP_WEIGHTS,
  RISKS,
  aGatedContext,
  contextAt,
  fullContextSweep
} from '../testing/generators.ts';

import { Actions } from './actions.ts';
import { decide, type HeroDecision } from './contract-decision-rule.ts';
import { ReasonCodes } from './reason-codes.ts';

/**
 * `NEGOTIATION_SPEC` §10.1's properties — the five this task is scoped to. These
 * are universal claims over the offer, not statements about one hand-picked
 * example: `contract-decision-rule.test.ts`'s cases pin every axis but one and
 * read a single number off the trace, which is the right tool for "this term
 * divides on its own" but the wrong one for "raising the advance never turns an
 * acceptance into a refusal" — that claim is about every context the rule can be
 * asked to decide, not about one.
 *
 * Every sweep below is built from `../testing/generators.ts` — the same
 * generator `contract-decision-rule.test.ts`'s own sum-identity sweep now uses
 * (`fullContextSweep()`), not a second guess at what "a context" means. Where a
 * property below needs a background axis it is not sweeping, it reuses
 * {@link OFFER_TERM_FLAGS} or {@link OFFER_TERM_VALUES} exactly as the shared
 * sweep does, rather than inventing its own range.
 *
 * The mood ordinal is held fixed across every comparison a property draws
 * between two offers (`decisionOrdinal` never varies *within* one comparison,
 * only *across* them) — comparing decisions drawn on different ordinals would
 * measure two different mood rolls, not the effect of the offer term in
 * question.
 */

/**
 * A {@link HeroDecision} projected onto everything `NEGOTIATION_SPEC` §4 makes a
 * claim about, minus `trace.traceId` — plumbing carried straight from
 * `DecisionContext.traceId` (`causal-trace.ts`) rather than anything the
 * arithmetic decides, and no §10.1 property makes a claim about it.
 * `PromisedBonusMovesOnlyTheKeyHero` below compares this projection rather than
 * the raw `HeroDecision`, so it states exactly the claim its name makes — the
 * decision is unchanged — without also incidentally asserting an unrelated id
 * never varies.
 */
function decisionShape(decision: HeroDecision) {
  const { trace, ...result } = decision.result;
  const { traceId, ...restOfTrace } = trace;
  void traceId;
  return { ...decision, result: { ...result, trace: restOfTrace } };
}

describe('§10.1: raising the advance never turns an acceptance into a refusal', () => {
  it('RaisingAdvanceNeverTurnsAcceptanceIntoRefusal', () => {
    let combos = 0;

    for (const heroScales of HERO_SCALE_PROFILES) {
      for (const risk of RISKS) {
        for (const traitWeight of INCLINATION_WEIGHTS) {
          for (const bondWeight of RELATIONSHIP_WEIGHTS) {
            for (const promisedBonus of OFFER_TERM_FLAGS) {
              for (const grievance of GRIEVANCES) {
                for (const methodTag of METHOD_TAGS) {
                  for (const decisionOrdinal of MOOD_ORDINALS) {
                    combos += 1;

                    // `OFFER_TERM_VALUES` is already ascending — the sweep this
                    // property walks is exactly that order, so a comparison
                    // between consecutive draws is a comparison between a lower
                    // advance and a higher one, at the same mood ordinal.
                    let acceptedAtLowerAdvance = false;
                    for (const advance of OFFER_TERM_VALUES) {
                      const { result } = decide(
                        contextAt({
                          heroScales,
                          advance,
                          risk,
                          traitWeight,
                          bondWeight,
                          promisedBonus,
                          grievance,
                          methodTag,
                          decisionOrdinal
                        })
                      );

                      if (acceptedAtLowerAdvance && result.selectedAction !== Actions.Accept) {
                        throw new Error(
                          `advance ${String(advance)} refused after a lower advance was ` +
                            `accepted, at ${JSON.stringify({
                              heroScales,
                              risk,
                              traitWeight,
                              bondWeight,
                              promisedBonus,
                              grievance,
                              methodTag,
                              decisionOrdinal: decisionOrdinal.toString()
                            })}`
                        );
                      }

                      if (result.selectedAction === Actions.Accept) {
                        acceptedAtLowerAdvance = true;
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    // Named as a product, not assumed: a silently collapsed axis would still
    // leave every loop above running, and green would mean "nothing to check".
    expect(combos).toBe(
      HERO_SCALE_PROFILES.length *
        RISKS.length *
        INCLINATION_WEIGHTS.length *
        RELATIONSHIP_WEIGHTS.length *
        OFFER_TERM_FLAGS.length *
        GRIEVANCES.length *
        METHOD_TAGS.length *
        MOOD_ORDINALS.length
    );
    expect(combos).toBe(15000);
  });
});

describe('§10.1: raising the promised bonus never turns the key hero acceptance into a refusal', () => {
  it('RaisingPromisedBonusNeverTurnsAcceptanceIntoRefusal', () => {
    let combos = 0;

    // The deciding hero stays `heroId(0)`, `contextAt`'s own default `keyHero` —
    // so every `promisedBonus` swept below reaches a nonzero `trustedBonus`, the
    // only case this property makes a claim about.
    for (const heroScales of HERO_SCALE_PROFILES) {
      for (const risk of RISKS) {
        for (const traitWeight of INCLINATION_WEIGHTS) {
          for (const bondWeight of RELATIONSHIP_WEIGHTS) {
            for (const advance of OFFER_TERM_FLAGS) {
              for (const grievance of GRIEVANCES) {
                for (const methodTag of METHOD_TAGS) {
                  for (const decisionOrdinal of MOOD_ORDINALS) {
                    combos += 1;

                    let acceptedAtLowerBonus = false;
                    for (const promisedBonus of OFFER_TERM_VALUES) {
                      const { result } = decide(
                        contextAt({
                          heroScales,
                          advance,
                          risk,
                          traitWeight,
                          bondWeight,
                          promisedBonus,
                          grievance,
                          methodTag,
                          decisionOrdinal
                        })
                      );

                      if (acceptedAtLowerBonus && result.selectedAction !== Actions.Accept) {
                        throw new Error(
                          `promisedBonus ${String(promisedBonus)} refused after a lower bonus ` +
                            `was accepted, at ${JSON.stringify({
                              heroScales,
                              advance,
                              risk,
                              traitWeight,
                              bondWeight,
                              grievance,
                              methodTag,
                              decisionOrdinal: decisionOrdinal.toString()
                            })}`
                        );
                      }

                      if (result.selectedAction === Actions.Accept) {
                        acceptedAtLowerBonus = true;
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    expect(combos).toBe(
      HERO_SCALE_PROFILES.length *
        RISKS.length *
        INCLINATION_WEIGHTS.length *
        RELATIONSHIP_WEIGHTS.length *
        OFFER_TERM_FLAGS.length *
        GRIEVANCES.length *
        METHOD_TAGS.length *
        MOOD_ORDINALS.length
    );
    expect(combos).toBe(15000);
  });
});

describe('§10.1: raising the promised bonus changes nothing for anyone but the key hero', () => {
  it('PromisedBonusMovesOnlyTheKeyHero', () => {
    let combos = 0;

    // `heroId(1)` decides, `heroId(0)` stays `keyHero` (`contextAt`'s default) —
    // `trustedBonus` is 0 at every point of the sweep below, so the claim is
    // invariance, not merely monotonicity: every draw must equal the first.
    const decider = { heroId: heroId(1) };

    for (const heroScales of HERO_SCALE_PROFILES) {
      for (const risk of RISKS) {
        for (const traitWeight of INCLINATION_WEIGHTS) {
          for (const bondWeight of RELATIONSHIP_WEIGHTS) {
            for (const advance of OFFER_TERM_FLAGS) {
              for (const grievance of GRIEVANCES) {
                for (const methodTag of METHOD_TAGS) {
                  for (const decisionOrdinal of MOOD_ORDINALS) {
                    combos += 1;

                    let baseline: ReturnType<typeof decisionShape> | null = null;
                    for (const promisedBonus of OFFER_TERM_VALUES) {
                      const decision = decide(
                        contextAt(
                          {
                            heroScales,
                            advance,
                            risk,
                            traitWeight,
                            bondWeight,
                            promisedBonus,
                            grievance,
                            methodTag,
                            decisionOrdinal
                          },
                          decider
                        )
                      );

                      if (baseline === null) {
                        baseline = decisionShape(decision);
                      } else {
                        expect(decisionShape(decision)).toEqual(baseline);
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    expect(combos).toBe(
      HERO_SCALE_PROFILES.length *
        RISKS.length *
        INCLINATION_WEIGHTS.length *
        RELATIONSHIP_WEIGHTS.length *
        OFFER_TERM_FLAGS.length *
        GRIEVANCES.length *
        METHOD_TAGS.length *
        MOOD_ORDINALS.length
    );
    expect(combos).toBe(15000);
  });
});

describe('§10.1: a principle holds at every advance and every bonus', () => {
  it('PrincipleHoldsAtEveryAdvanceAndBonus', () => {
    let combos = 0;

    for (const heroScales of HERO_SCALE_PROFILES) {
      for (const advance of OFFER_TERM_VALUES) {
        for (const promisedBonus of OFFER_TERM_VALUES) {
          for (const decisionOrdinal of MOOD_ORDINALS) {
            combos += 1;

            const { result, ordinalsConsumed } = decide(
              aGatedContext({ heroScales, advance, promisedBonus, decisionOrdinal })
            );

            // The gate does not buy: it declines outright, with no score to
            // outweigh and no mood draw to have spent, regardless of what the
            // offer promises.
            expect(result.selectedAction).toBe(Actions.Decline);
            expect(result.selectedScore).toBeNull();
            expect(ordinalsConsumed).toBe(0n);
          }
        }
      }
    }

    expect(combos).toBe(
      HERO_SCALE_PROFILES.length *
        OFFER_TERM_VALUES.length *
        OFFER_TERM_VALUES.length *
        MOOD_ORDINALS.length
    );
    expect(combos).toBe(240);
  });
});

describe('§10.1: the same inputs produce the same decision, offer included', () => {
  it('SameInputsProduceTheSameDecision', () => {
    // Two independent calls to the same generator: `fullContextSweep()`
    // allocates a fresh object graph — including a fresh `OfferState`, with its
    // own `SortedSet`s — on every invocation, so `first[i]` and `second[i]` are
    // equal in value and never the same reference. If `decide()` secretly read
    // anything but the values on `DecisionContext` — a cache keyed by object
    // identity, a closed-over mutable default — this is what would catch it.
    const first = fullContextSweep();
    const second = fullContextSweep();

    // `FULL_CONTEXT_SWEEP_SIZE` is a product of the same axis lengths
    // `fullContextSweep()` walks, computed once in `generators.ts` rather than
    // restated here; the pinned literal below catches that shared computation
    // itself silently drifting.
    expect(first).toHaveLength(FULL_CONTEXT_SWEEP_SIZE);
    expect(second).toHaveLength(FULL_CONTEXT_SWEEP_SIZE);
    expect(first).toHaveLength(60003);
    expect(second).toHaveLength(60003);

    for (let index = 0; index < first.length; index += 1) {
      const contextA = first[index]!;
      const contextB = second[index]!;

      expect(contextA).not.toBe(contextB);
      expect(deepEqual(contextA, contextB)).toBe(true);

      const decisionA = decide(contextA);
      const decisionB = decide(contextB);

      // `toEqual` is enough here — `HeroDecision` holds only plain objects,
      // arrays, strings, numbers and one `bigint`, nothing `deepEqual`'s
      // `SortedMap`/`SortedSet` handling exists for.
      expect(decisionB).toEqual(decisionA);
      expect(decisionB.ordinalsConsumed).toBe(decisionA.ordinalsConsumed);
    }
  });
});

describe('§10.1: the promised bonus is ignored exactly when the hero stopped believing', () => {
  it('PromisedBonusIsIgnoredExactlyWhenTheHeroStoppedBelieving', () => {
    let combos = 0;

    // A key hero deliberately not `heroId(0)` — `contextAt`'s own default for
    // both `hero.id` and `offer.keyHero` — so this exercises
    // `ContextDecider.keyHero` as well as `.believesGuildPromises`, and a
    // mutant that only special-cased `heroId(0) === keyHero` cannot pass by
    // coincidence.
    const decider = heroId(3);

    // Fixed at `OFFER_TERM_VALUES`'s ceiling (`TRAIT_SCALE`, `100`): `bonusPull
    // = divideTowardZero(promisedBonus * greed, TRAIT_SCALE)` divides exactly
    // at this one value, `100 * greed / 100 = greed` with no truncation for
    // any `greed` in `HERO_SCALE_PROFILES`. So whether `PromiseOfABonus`
    // should appear is decidable from `greed` alone below, without a second,
    // independent implementation of the rule's own division.
    const promisedBonus = OFFER_TERM_VALUES[OFFER_TERM_VALUES.length - 1]!;

    for (const heroScales of HERO_SCALE_PROFILES) {
      const [greed] = heroScales;

      for (const risk of RISKS) {
        for (const traitWeight of INCLINATION_WEIGHTS) {
          for (const bondWeight of RELATIONSHIP_WEIGHTS) {
            for (const advance of OFFER_TERM_FLAGS) {
              for (const grievance of GRIEVANCES) {
                for (const methodTag of METHOD_TAGS) {
                  for (const decisionOrdinal of MOOD_ORDINALS) {
                    combos += 1;

                    const axes = {
                      heroScales,
                      advance,
                      risk,
                      traitWeight,
                      bondWeight,
                      promisedBonus,
                      grievance,
                      methodTag,
                      decisionOrdinal
                    };

                    const believing = decide(
                      contextAt(axes, {
                        heroId: decider,
                        keyHero: decider,
                        believesGuildPromises: true
                      })
                    );
                    const disbelieving = decide(
                      contextAt(axes, {
                        heroId: decider,
                        keyHero: decider,
                        believesGuildPromises: false
                      })
                    );

                    const hasBonusFactor = (decision: HeroDecision): boolean =>
                      decision.result.trace.positiveFactors.some(
                        (factor) => factor.reasonCode === ReasonCodes.PromiseOfABonus
                      );

                    // Necessary direction, unconditional on `greed`: a hero who
                    // stopped believing never carries the promise.
                    expect(hasBonusFactor(disbelieving)).toBe(false);

                    // Sufficient direction: at this one `promisedBonus`,
                    // `bonusPull` is exactly `greed` — present iff `greed > 0`,
                    // an algebraic fact of the fixture above, not an
                    // assumption about `decide()`.
                    expect(hasBonusFactor(believing)).toBe(greed > 0);
                  }
                }
              }
            }
          }
        }
      }
    }

    expect(combos).toBe(
      HERO_SCALE_PROFILES.length *
        RISKS.length *
        INCLINATION_WEIGHTS.length *
        RELATIONSHIP_WEIGHTS.length *
        OFFER_TERM_FLAGS.length *
        GRIEVANCES.length *
        METHOD_TAGS.length *
        MOOD_ORDINALS.length
    );
    expect(combos).toBe(15000);
  });
});
