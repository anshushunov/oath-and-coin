import { describe, expect, it } from 'vitest';

import {
  Actions,
  ContractStatus,
  OfferPhase,
  ReasonCodes,
  SortedMap,
  SortedSet,
  canCover,
  compareContentIds,
  compareHeroIds,
  divideTowardZero,
  heroId,
  parseContentId,
  type ContentId,
  type GameState,
  type HeroId,
  type HeroState
} from '@oath-and-coin/simulation';

import {
  LOADING_SCREEN,
  contractOfferScreenModel,
  failedScreen
} from './contract-offer-screen-model-factory.ts';
import { leversOf } from './contract-offer-screen-model.ts';
import type { OfferBudget } from './lever.ts';
import { describeReadModel, readModelHash } from './screen-model.ts';
import { QualitativeGrade } from './qualitative-scale.ts';
import { ReasonDirection, ScreenState } from './screen-state.ts';
import {
  aContract,
  aDecision,
  aFactor,
  aHero,
  anOffer,
  aState,
  aStep,
  aTrait,
  ids,
  withContracts,
  withHeroes,
  withTraitRules
} from './testing/fixtures.ts';

function heroes(...definitions: readonly ContentId[]): readonly HeroState[] {
  return definitions.map((definition, index) =>
    aHero({
      id: heroId(index),
      definition,
      displayNameKey: `hero.core.${String(definition).split(':')[1]}.name`
    })
  );
}

function responded(...indices: readonly number[]): SortedSet<HeroId> {
  return SortedSet.from(compareHeroIds, indices.map(heroId));
}

describe('the screen with nothing to offer', () => {
  it('is Empty when the campaign has no contracts', () => {
    const state = { ...aState(), contracts: SortedMap.empty<ContentId, never>(compareContentIds) };

    expect(contractOfferScreenModel(state as never, []).state).toBe(ScreenState.Empty);
  });

  it('is Empty when the campaign has contracts and nobody to offer them to', () => {
    // The half the C# original left out. With an empty roster the completeness check
    // reads `0 >= 0` and reports Normal — a screen telling the player everyone had
    // answered, above an empty table.
    const state = withHeroes(aState(), []);

    expect(contractOfferScreenModel(state, []).state).toBe(ScreenState.Empty);
  });

  it('carries no roster, no contract and no error on an Empty screen', () => {
    const model = contractOfferScreenModel(withHeroes(aState(), []), []);

    expect(model).toMatchObject({ contract: null, roster: [], responses: [], errorCode: null });
  });
});

describe('which contract the screen is about', () => {
  const caravan = aContract({ id: ids.caravan });
  const crypt = aContract({ id: ids.crypt, patronFee: 90 });

  it('is the one the first step named', () => {
    const state = withContracts(aState(), [caravan, crypt]);
    const model = contractOfferScreenModel(state, [aStep({ command: { contract: ids.crypt } })]);

    expect(model.contract?.definition).toBe(ids.crypt);
  });

  it('falls back to the lexicographically first when nothing has been offered yet', () => {
    // `core:cleanse_the_crypt` sorts before `core:escort_the_caravan`, and the map is
    // already sorted — so the fallback is deterministic rather than insertion order.
    const state = withContracts(aState(), [caravan, crypt]);

    expect(contractOfferScreenModel(state, []).contract?.definition).toBe(ids.crypt);
  });

  it('is the one the caller named, over the lexicographically first fallback', () => {
    // The first of the two rules the third argument has to beat, and the one a session
    // reopened from a save lands on whenever its history is empty: nothing was applied,
    // so no step survives to name a contract, and without the focus the screen would
    // show `core:cleanse_the_crypt` — a contract the player was never looking at.
    const state = withContracts(aState(), [caravan, crypt]);

    expect(contractOfferScreenModel(state, [], ids.caravan).contract?.definition).toBe(ids.caravan);
  });

  it('is the one the caller named, over the contract the first step answered', () => {
    // The second rule, and the one the frozen corpus provably cannot distinguish:
    // measured over all 50 entries that reached a state, none has a rejected first step
    // and none has a `read_model.contract` differing from the contract of its first
    // applied step (`contract-offer-screen-model-factory.ts`, and design spec §2.7).
    //
    // This is that missing input, hand-made. A rejected step produces no event, so it
    // does not survive a save; the step that does survive answered a *different*
    // contract, and only the envelope's `focused_contract` still knows which screen the
    // player was on. The responses follow the focus rather than the step, which is the
    // half a comparison of `contract.definition` alone would miss.
    const state = withContracts(withHeroes(aState(), heroes(ids.bram, ids.doran)), [
      caravan,
      crypt
    ]);
    const steps = [aStep({ command: { contract: ids.crypt }, heroDefinition: ids.doran })];

    const model = contractOfferScreenModel(state, steps, ids.caravan);

    expect(model.contract?.definition).toBe(ids.caravan);
    expect(model.responses).toEqual([]);

    // Stated as the difference it makes, not only as the value it produces: without the
    // third argument this same state and these same steps give the other screen, and a
    // check that did not say so could pass with the argument ignored.
    expect(contractOfferScreenModel(state, steps).contract?.definition).toBe(ids.crypt);
  });

  it('leaves answers to another contract off this screen', () => {
    const state = withContracts(withHeroes(aState(), heroes(ids.bram, ids.doran)), [
      caravan,
      crypt
    ]);
    const model = contractOfferScreenModel(state, [
      aStep({ command: { contract: ids.caravan }, heroDefinition: ids.bram }),
      aStep({ command: { contract: ids.crypt }, heroDefinition: ids.doran })
    ]);

    expect(model.contract?.definition).toBe(ids.caravan);
    expect(model.responses.map((response) => response.heroDefinition)).toEqual([ids.bram]);
  });

  it('refuses a step naming a contract the state does not have', () => {
    expect(() =>
      contractOfferScreenModel(aState(), [aStep({ command: { contract: ids.crypt } })])
    ).toThrow(/has no such contract/u);
  });
});

describe('whether everyone has answered', () => {
  const roster = heroes(ids.bram, ids.doran);

  it('is Normal when the contract records an answer from every hero', () => {
    const state = withContracts(withHeroes(aState(), roster), [
      // The crew the package invited is the two heroes who answered — "everyone has
      // answered" is measured against `invited`, not against the roster
      // (`DEC-012` as amended, `RESOLUTION_SPEC` §8).
      aContract({ offer: anOffer({ keyHero: heroId(0), respondedBy: responded(0, 1) }) })
    ]);

    expect(contractOfferScreenModel(state, [aStep()]).state).toBe(ScreenState.Normal);
  });

  it('is Incomplete while one hero has not answered', () => {
    const state = withContracts(withHeroes(aState(), roster), [
      aContract({ offer: anOffer({ respondedBy: responded(0) }) })
    ]);

    expect(contractOfferScreenModel(state, [aStep()]).state).toBe(ScreenState.Incomplete);
  });

  it('counts the contract\u2019s own answers, not the response lines this screen kept', () => {
    // A hero appearing in two steps would double-count if completeness were read off
    // the filtered list — two lines, two heroes in the roster, "everyone answered"
    // while one of them never did.
    const state = withContracts(withHeroes(aState(), roster), [
      aContract({ offer: anOffer({ respondedBy: responded(0) }) })
    ]);
    const twice = [aStep({ heroDefinition: ids.bram }), aStep({ heroDefinition: ids.bram })];

    expect(contractOfferScreenModel(state, twice).state).toBe(ScreenState.Incomplete);
  });
});

describe('the contract line', () => {
  it('shows objective numbers literally and everything else on the qualitative scale', () => {
    const state = withContracts(aState(), [
      aContract({
        patronFee: 40,
        risk: 55,
        requiredCrew: 4,
        offer: anOffer({ acceptedBy: responded(0, 1, 2) }),
        tags: SortedSet.from(compareContentIds, [ids.merchants, ids.undead])
      })
    ]);

    expect(contractOfferScreenModel(state, []).contract).toEqual({
      definition: ids.caravan,
      displayNameKey: 'contract.core.escort_the_caravan.name',
      patronFee: 40,
      risk: QualitativeGrade.Moderate,
      tagKeys: ['tag.patron.merchant_guild', 'tag.target.undead'],
      requiredCrew: 4,
      acceptedCount: 3
    });
  });
});

describe('a hero card', () => {
  it('splits traits into principles and inclinations, each named from its own id', () => {
    const state = withTraitRules(
      withHeroes(aState(), [aHero({ traits: [ids.squeamish, ids.refusesTemples, ids.loyal] })]),
      [
        aTrait({ id: ids.loyal }),
        aTrait({ id: ids.squeamish, tag: ids.undead }),
        aTrait({ id: ids.refusesTemples, isPrinciple: true, weight: 0 })
      ]
    );

    const [card] = contractOfferScreenModel(state, []).roster;

    // Sorted by id inside each list, not by the order the hero authored them: two runs
    // of the same campaign must produce the same hash.
    expect(card?.principleKeys).toEqual(['trait.core.will_not_strike_a_temple.name']);
    expect(card?.inclinationKeys).toEqual([
      'trait.core.fears_undeath.name',
      'trait.core.loyal_to_the_merchant_guild.name'
    ]);
  });

  it('names a trait from its id and never from its tag', () => {
    // A tag is what a *contract* latches onto. Naming a principle after it would show
    // "Temple" where the principle is "will not strike a temple".
    const state = withTraitRules(withHeroes(aState(), [aHero({ traits: [ids.loyal] })]), [
      aTrait({ id: ids.loyal, tag: ids.undead })
    ]);

    expect(contractOfferScreenModel(state, []).roster[0]?.inclinationKeys).toEqual([
      'trait.core.loyal_to_the_merchant_guild.name'
    ]);
  });

  it('refuses a hero carrying a trait the rulebook has no entry for', () => {
    const state = withHeroes(aState(), [aHero({ traits: [ids.loyal] })]);

    expect(() => contractOfferScreenModel(state, [])).toThrow(/content-loading bug/u);
  });
});

describe('how a response ranks its reasons', () => {
  const state = withHeroes(aState(), heroes(ids.bram, ids.doran, ids.zara));

  function reasonsOf(
    positiveFactors: readonly ReturnType<typeof aFactor>[],
    negativeFactors: readonly ReturnType<typeof aFactor>[],
    selectedAction = Actions.Accept
  ) {
    const step = aStep({
      decisions: [
        aDecision({
          selectedAction,
          trace: { traceId: 0, positiveFactors, negativeFactors, blockedBy: [], tieBreak: null }
        })
      ]
    });

    return contractOfferScreenModel(state, [step]).responses[0]?.reasons ?? [];
  }

  it('shows two supporting reasons and one against, when both sides can fill their share', () => {
    const reasons = reasonsOf(
      [
        aFactor({ reasonCode: ReasonCodes.PaymentAttractive, magnitude: 3 }),
        aFactor({ reasonCode: ReasonCodes.TrustsTheGuild, sourceEntity: ids.bram, magnitude: 2 })
      ],
      [
        aFactor({ reasonCode: ReasonCodes.RiskTooHigh, magnitude: 30 }),
        aFactor({ reasonCode: ReasonCodes.PaymentInsulting, magnitude: 29 })
      ]
    );

    // The finding that produced the split: ranked purely by magnitude, this hero would
    // show three reasons to refuse beneath the word "accepted".
    expect(reasons.map((reason) => reason.direction)).toEqual([
      ReasonDirection.Supported,
      ReasonDirection.Supported,
      ReasonDirection.Opposed
    ]);
    expect(reasons.map((reason) => reason.reasonCode)).toEqual([
      ReasonCodes.PaymentAttractive,
      ReasonCodes.TrustsTheGuild,
      ReasonCodes.RiskTooHigh
    ]);
  });

  it('gives the supporting side the slot the other cannot fill', () => {
    const reasons = reasonsOf(
      [
        aFactor({ reasonCode: ReasonCodes.PaymentAttractive, magnitude: 30 }),
        aFactor({ reasonCode: ReasonCodes.TrustsTheGuild, sourceEntity: ids.bram, magnitude: 20 }),
        aFactor({
          reasonCode: ReasonCodes.PersonalConviction,
          sourceEntity: ids.loyal,
          magnitude: 10
        })
      ],
      []
    );

    expect(reasons).toHaveLength(3);
    expect(reasons.every((reason) => reason.direction === ReasonDirection.Supported)).toBe(true);
  });

  it('gives the opposing side the slots the supporting one cannot fill', () => {
    const reasons = reasonsOf(
      [aFactor({ reasonCode: ReasonCodes.PaymentAttractive, magnitude: 1 })],
      [
        aFactor({ reasonCode: ReasonCodes.RiskTooHigh, magnitude: 30 }),
        aFactor({ reasonCode: ReasonCodes.PaymentInsulting, magnitude: 20 })
      ]
    );

    expect(reasons.map((reason) => reason.direction)).toEqual([
      ReasonDirection.Supported,
      ReasonDirection.Opposed,
      ReasonDirection.Opposed
    ]);
  });

  it('reads the supporting side off the action, not off the sign in the trace', () => {
    // On a refusal it is the negative list that supported the answer.
    const reasons = reasonsOf(
      [aFactor({ reasonCode: ReasonCodes.PaymentAttractive, magnitude: 5 })],
      [aFactor({ reasonCode: ReasonCodes.RiskTooHigh, magnitude: 40 })],
      Actions.Decline
    );

    expect(reasons[0]).toMatchObject({
      reasonCode: ReasonCodes.RiskTooHigh,
      direction: ReasonDirection.Supported
    });
    expect(reasons[1]).toMatchObject({
      reasonCode: ReasonCodes.PaymentAttractive,
      direction: ReasonDirection.Opposed
    });
  });

  it('caps each side after sorting, so what is shown is that side\u2019s strongest', () => {
    // Four factors on the winning side, and the strongest is the *last* the trace
    // computed. Three would not pose the question at all: a side no longer than the cap
    // survives being cut before being sorted, and a mutant that slices first stayed
    // green through every case here until this one was written. The corpus cannot ask
    // it either \u2014 no shipped scenario puts more than three factors on one side.
    const reasons = reasonsOf(
      [
        aFactor({ reasonCode: ReasonCodes.PaymentAttractive, magnitude: 1 }),
        aFactor({ reasonCode: ReasonCodes.TrustsTheGuild, sourceEntity: ids.bram, magnitude: 2 }),
        aFactor({
          reasonCode: ReasonCodes.PersonalConviction,
          sourceEntity: ids.loyal,
          magnitude: 3
        }),
        aFactor({
          reasonCode: ReasonCodes.StandsWithComrade,
          sourceEntity: ids.doran,
          magnitude: 50
        })
      ],
      [aFactor({ reasonCode: ReasonCodes.RiskTooHigh, magnitude: 4 })]
    );

    // Capping before sorting would drop `stands_with_comrade` \u2014 the one motive that
    // actually carried the decision \u2014 and show the two weakest in its place.
    expect(reasons.map((reason) => reason.reasonCode)).toEqual([
      ReasonCodes.StandsWithComrade,
      ReasonCodes.PersonalConviction,
      ReasonCodes.RiskTooHigh
    ]);
  });

  it('breaks a tie on magnitude by reason code, and a tie on both by source entity', () => {
    const reasons = reasonsOf(
      [
        aFactor({
          reasonCode: ReasonCodes.StandsWithComrade,
          sourceEntity: ids.zara,
          magnitude: 7
        }),
        aFactor({
          reasonCode: ReasonCodes.StandsWithComrade,
          sourceEntity: ids.doran,
          magnitude: 7
        }),
        aFactor({ reasonCode: ReasonCodes.PaymentAttractive, magnitude: 7 })
      ],
      []
    );

    // Without the third tie-break the two comrades could come out in either order and
    // the read-model hash would disagree with itself between identical runs.
    expect(reasons.map((reason) => reason.sourceEntity)).toEqual([
      ids.caravan,
      ids.doran,
      ids.zara
    ]);
  });
});

describe('which reasons name their source', () => {
  const state = withHeroes(aState(), heroes(ids.bram, ids.doran));

  function sourceKeyFor(reasonCode: string, sourceEntity: ContentId): string | null {
    const step = aStep({
      decisions: [
        aDecision({
          trace: {
            traceId: 0,
            positiveFactors: [aFactor({ reasonCode, sourceEntity })],
            negativeFactors: [],
            blockedBy: [],
            tieBreak: null
          }
        })
      ]
    });

    return (
      contractOfferScreenModel(state, [step]).responses[0]?.reasons[0]?.sourceDisplayNameKey ?? null
    );
  }

  it('names the trait behind a conviction or an aversion', () => {
    expect(sourceKeyFor(ReasonCodes.PersonalConviction, ids.loyal)).toBe(
      'trait.core.loyal_to_the_merchant_guild.name'
    );
    expect(sourceKeyFor(ReasonCodes.PersonalAversion, ids.squeamish)).toBe(
      'trait.core.fears_undeath.name'
    );
  });

  it('names the comrade behind a bond', () => {
    expect(sourceKeyFor(ReasonCodes.StandsWithComrade, ids.doran)).toBe('hero.core.doran.name');
    expect(sourceKeyFor(ReasonCodes.WillNotWorkWith, ids.doran)).toBe('hero.core.doran.name');
  });

  it.each([
    ReasonCodes.PaymentAttractive,
    ReasonCodes.RiskTooHigh,
    ReasonCodes.PaymentInsulting,
    ReasonCodes.TrustsTheGuild,
    ReasonCodes.UnpredictableMood
  ])('leaves %s unnamed, because its source is already on the screen', (reasonCode) => {
    expect(sourceKeyFor(reasonCode, ids.caravan)).toBeNull();
  });

  it('refuses a bond naming a comrade absent from the roster', () => {
    expect(() => sourceKeyFor(ReasonCodes.StandsWithComrade, ids.zara)).toThrow(
      /no display-name key for it/u
    );
  });
});

describe('a blocked answer', () => {
  const state = withHeroes(aState(), heroes(ids.bram));

  const blocked = aStep({
    decisions: [
      aDecision({
        selectedAction: Actions.Decline,
        selectedScore: null,
        trace: {
          traceId: 0,
          positiveFactors: [aFactor({ magnitude: 90 })],
          negativeFactors: [],
          blockedBy: [
            { reasonCode: ReasonCodes.PrincipleForbids, sourceEntity: ids.refusesTemples }
          ],
          tieBreak: null
        }
      })
    ]
  });

  it('names the principle and shows no reasons beside it', () => {
    const [response] = contractOfferScreenModel(state, [blocked]).responses;

    // A red line closes the decision before any factor has a magnitude to rank
    // (HERO_DECISION_SPEC §2.2), so the positive factor above must not surface.
    expect(response).toMatchObject({
      reasons: [],
      blockedByEntity: ids.refusesTemples,
      blockedByDisplayNameKey: 'trait.core.will_not_strike_a_temple.name',
      tieBreakCode: null,
      wavered: false
    });
  });
});

describe('whether the hero wavered', () => {
  const state = withHeroes(aState(), heroes(ids.bram));

  function waveredFor(
    selectedScore: number,
    mood: { readonly magnitude: number; readonly positive: boolean } | null
  ): boolean {
    const moodFactor = aFactor({
      reasonCode: ReasonCodes.UnpredictableMood,
      sourceEntity: ids.bram,
      magnitude: mood?.magnitude ?? 0
    });

    const step = aStep({
      decisions: [
        aDecision({
          selectedAction: selectedScore >= 0 ? Actions.Accept : Actions.Decline,
          selectedScore,
          trace: {
            traceId: 0,
            positiveFactors: mood?.positive === true ? [moodFactor] : [],
            negativeFactors: mood?.positive === false ? [moodFactor] : [],
            blockedBy: [],
            tieBreak: null
          }
        })
      ]
    });

    return contractOfferScreenModel(state, [step]).responses[0]?.wavered ?? false;
  }

  it('is true when the mood carried the answer across zero', () => {
    // Final +3 with a mood of +10 means the rest of the factors summed to −7.
    expect(waveredFor(3, { magnitude: 10, positive: true })).toBe(true);
    expect(waveredFor(-3, { magnitude: 10, positive: false })).toBe(true);
  });

  it('is false when the answer would have been the same without the mood', () => {
    expect(waveredFor(30, { magnitude: 10, positive: true })).toBe(false);
    expect(waveredFor(-30, { magnitude: 10, positive: false })).toBe(false);
  });

  it('is false when no mood was drawn at all', () => {
    expect(waveredFor(5, null)).toBe(false);
  });

  it('treats an exactly zero score as accepted on both sides of the comparison', () => {
    // The rule is "score ≥ 0 accepts". A mood of 0 cannot flip anything, and a
    // reconstructed score of exactly 0 must read the same way the final one does.
    expect(waveredFor(0, { magnitude: 0, positive: true })).toBe(false);
  });
});

describe('the screens no run produces', () => {
  it('has one Loading model, stated once', () => {
    expect(LOADING_SCREEN.state).toBe(ScreenState.Loading);
    expect(LOADING_SCREEN).toMatchObject({
      contract: null,
      roster: [],
      responses: [],
      errorCode: null
    });
  });

  it('builds an error screen that names the failing stage', () => {
    const model = failedScreen('CONTENT_ROOT_NOT_FOUND', "Content root 'C:/nope' does not exist.");

    expect(model).toMatchObject({
      state: ScreenState.Error,
      errorCode: 'CONTENT_ROOT_NOT_FOUND',
      errorDetail: "Content root 'C:/nope' does not exist."
    });
  });

  it('refuses an error screen with nothing to say', () => {
    expect(() => failedScreen('', 'detail')).toThrow(/errorCode must not be empty/u);
    expect(() => failedScreen('CONTENT_INVALID', '')).toThrow(/errorDetail must not be empty/u);
  });
});

describe('the read-model hash', () => {
  it('does not depend on whether N decisions arrive as one step or as N steps', () => {
    // The obligation `DEC-008` Task 5 inherits from the Task 2 spike
    // (`docs/technical/SPIKE_2026-08-22-evidence-and-decisions.md`): a command answering
    // several heroes at once (`pollCrew`, Tasks 6, 10-14) must collapse into `responses`
    // no differently than the same decisions spread over several one-decision steps. The
    // spike measured that equality once, on a temporary `pollCrew` probe that was thrown
    // away with the rest of its code; this is the test that makes the number
    // reproducible from the repository rather than resting on a discarded run.
    const state = withContracts(withHeroes(aState(), heroes(ids.bram)), [
      aContract({ offer: anOffer({ respondedBy: responded(0) }) })
    ]);

    // Three distinct decisions — different actions, different traces — so a projection
    // that quietly dropped all but the first would still be caught: a test built from
    // three identical decisions could not tell "collapsed correctly" from "kept only
    // one".
    const decisions = [
      aDecision({
        selectedAction: Actions.Accept,
        selectedScore: 5,
        trace: {
          traceId: 0,
          positiveFactors: [aFactor({ reasonCode: ReasonCodes.PaymentAttractive, magnitude: 5 })],
          negativeFactors: [],
          blockedBy: [],
          tieBreak: null
        }
      }),
      aDecision({
        selectedAction: Actions.Decline,
        selectedScore: -40,
        trace: {
          traceId: 1,
          positiveFactors: [],
          negativeFactors: [aFactor({ reasonCode: ReasonCodes.RiskTooHigh, magnitude: 40 })],
          blockedBy: [],
          tieBreak: null
        }
      }),
      aDecision({
        selectedAction: Actions.Accept,
        selectedScore: 0,
        trace: {
          traceId: 2,
          positiveFactors: [],
          negativeFactors: [],
          blockedBy: [],
          tieBreak: ReasonCodes.NoReasonToRefuse
        }
      })
    ];

    const oneStepWithThree = [aStep({ decisions })];
    const threeStepsWithOne = decisions.map((decision) => aStep({ decisions: [decision] }));

    const collapsed = contractOfferScreenModel(state, oneStepWithThree);
    const spread = contractOfferScreenModel(state, threeStepsWithOne);

    expect(collapsed.responses).toHaveLength(3);
    expect(collapsed.responses).toEqual(spread.responses);
    expect(readModelHash(collapsed)).toBe(readModelHash(spread));
  });

  it('does not depend on whether N heroes answer in one step or in N steps of their own', () => {
    // The multi-hero version of the test above — `DEC-008` Task 13's own obligation,
    // not Task 5's: `pollCrew` is the one command that puts *several different*
    // heroes' decisions inside a single step, and `DecidedStep.heroDefinition` alone
    // cannot name all of them (`contract-offer-screen-model.ts`'s own note on
    // `DecidedOutcome.heroDefinition`). The test above reuses one hero for all three
    // decisions, so an implementation that quietly stamped every decision with the
    // step's single `heroDefinition` would still pass it — the three response lines
    // would already agree on the hero by construction. This one gives each decision a
    // *different* hero of its own and checks the response lines name them correctly,
    // which only reading `decision.heroDefinition` can make true.
    const roster = heroes(ids.bram, ids.doran, ids.zara);
    const state = withContracts(withHeroes(aState(), roster), [
      aContract({ offer: anOffer({ respondedBy: responded(0, 1, 2) }) })
    ]);

    const rawDecisions = [
      aDecision({
        selectedAction: Actions.Accept,
        selectedScore: 5,
        trace: {
          traceId: 0,
          positiveFactors: [aFactor({ reasonCode: ReasonCodes.PaymentAttractive, magnitude: 5 })],
          negativeFactors: [],
          blockedBy: [],
          tieBreak: null
        }
      }),
      aDecision({
        selectedAction: Actions.Decline,
        selectedScore: -40,
        trace: {
          traceId: 1,
          positiveFactors: [],
          negativeFactors: [aFactor({ reasonCode: ReasonCodes.RiskTooHigh, magnitude: 40 })],
          blockedBy: [],
          tieBreak: null
        }
      }),
      aDecision({
        selectedAction: Actions.Accept,
        selectedScore: 0,
        trace: {
          traceId: 2,
          positiveFactors: [],
          negativeFactors: [],
          blockedBy: [],
          tieBreak: ReasonCodes.NoReasonToRefuse
        }
      })
    ];
    const heroDefinitions: readonly ContentId[] = [ids.bram, ids.doran, ids.zara];

    // One step, three decisions, each carrying its own hero — the shape only
    // `pollCrew` produces.
    const oneStepWithThree = [
      aStep({
        decisions: rawDecisions.map((decision, index) => ({
          ...decision,
          heroDefinition: heroDefinitions[index]!
        }))
      })
    ];
    // Three ordinary single-hero steps, each relying on the step's own
    // `heroDefinition` — the shape every other command produces — built from the
    // same raw decisions, with no per-decision override at all.
    const threeStepsWithOne = rawDecisions.map((decision, index) =>
      aStep({ decisions: [decision], heroDefinition: heroDefinitions[index]! })
    );

    const collapsed = contractOfferScreenModel(state, oneStepWithThree);
    const spread = contractOfferScreenModel(state, threeStepsWithOne);

    expect(collapsed.responses).toHaveLength(3);
    // Names each hero correctly — the assertion a same-hero fixture cannot make: a
    // factory that ignored the decision's own hero and stamped every line with the
    // step's one `heroDefinition` would show `bram, bram, bram` here instead.
    expect(collapsed.responses.map((response) => response.heroDefinition)).toEqual(heroDefinitions);
    expect(collapsed.responses).toEqual(spread.responses);
    expect(readModelHash(collapsed)).toBe(readModelHash(spread));
  });

  it('distinguishes two screens that differ only in state', () => {
    // Incomplete and Normal can carry an identical roster and identical responses. If
    // the state were outside the hash, a screen still waiting on a hero would be
    // indistinguishable from one that finished.
    const roster = heroes(ids.bram, ids.doran);
    // Same invited crew on both sides, so the only difference is how many of them have
    // answered — which is what makes this a test about `state` and not about the crew.
    const incomplete = withContracts(withHeroes(aState(), roster), [
      aContract({
        offer: anOffer({ keyHero: heroId(0), invited: responded(0, 1), respondedBy: responded(0) })
      })
    ]);
    const complete = withContracts(withHeroes(aState(), roster), [
      aContract({
        offer: anOffer({
          keyHero: heroId(0),
          invited: responded(0, 1),
          respondedBy: responded(0, 1)
        })
      })
    ]);

    const left = contractOfferScreenModel(incomplete, [aStep()]);
    const right = contractOfferScreenModel(complete, [aStep()]);

    expect(left.responses).toEqual(right.responses);
    expect(readModelHash(left)).not.toBe(readModelHash(right));
  });

  it('leaves the error detail out, so the same failure hashes the same twice', () => {
    // The detail carries an absolute path off whichever machine produced it.
    const here = failedScreen('CONTENT_ROOT_NOT_FOUND', "Content root 'C:/a' does not exist.");
    const there = failedScreen('CONTENT_ROOT_NOT_FOUND', "Content root '/home/b' does not exist.");

    expect(readModelHash(here)).toBe(readModelHash(there));
    expect(JSON.stringify(describeReadModel(here))).not.toMatch(/does not exist/u);
  });

  it('refuses to hash a model built by stepping around the factory', () => {
    // External review reproduced this with the exact value below. In C# the cross-field
    // rules lived in `init` accessors, so `Loading with { State = Normal }` re-ran them
    // and threw; a TypeScript spread runs no accessor at all, and this hashed to
    // 54a6996d… without complaint — a Normal screen with nothing on offer.
    const impossible = { ...LOADING_SCREEN, state: ScreenState.Normal };

    expect(() => readModelHash(impossible)).toThrow(/nothing to offer/u);
    expect(() => describeReadModel(impossible)).toThrow(/nothing to offer/u);
  });

  it('refuses to hash a string the corpus and this repository canonicalize differently', () => {
    // `failedScreen` is the one place a caller supplies a projection string freely, and
    // `A+B` is the input external review used: the C# writer escapes `+` as + and
    // RFC 8785 leaves it literal, so the hash would be one the corpus could never have
    // recorded — and a comparison against it would mean nothing.
    expect(() => readModelHash(failedScreen('A+B', 'detail'))).toThrow(/outside the set/u);
    expect(() => readModelHash(failedScreen('ОШИБКА', 'detail'))).toThrow(/outside the set/u);
    // Escaped rather than typed literally: a raw control character in a source file is
    // invisible to whoever reads this next, which is the wrong property for the one
    // case that is about invisible characters.
    expect(() => readModelHash(failedScreen('A\u0007B', 'detail'))).toThrow(/outside the set/u);
  });

  it('names where an uncomparable string sat, not only that one existed', () => {
    // The walk covers the whole projection rather than the one field that is loose
    // today, so a field added to a later projection cannot reopen the hole quietly.
    expect(() => readModelHash(failedScreen("it's broken", 'detail'))).toThrow(
      /\$\.error_code is/u
    );
  });

  it('still accepts every shape the shipped corpus records', () => {
    // The domain has to be wider than the simulation's artifact-safe alphabet, which is
    // lowercase-only: a read model legitimately carries `Normal`, `Moderate` and
    // `CONTENT_ROOT_NOT_FOUND`. A check that rejected those would be a check nothing
    // could pass.
    expect(() => readModelHash(failedScreen('CONTENT_ROOT_NOT_FOUND', 'detail'))).not.toThrow();
    expect(() => readModelHash(LOADING_SCREEN)).not.toThrow();
  });

  it('is a hash of the canonical projection, not of the model object', () => {
    // The projection is a stable, named contract with snake_case keys the frozen
    // corpus records; the model's own field names are this package's business.
    expect(describeReadModel(LOADING_SCREEN)).toEqual({
      // Which screen this is, first: two screens can carry identical content — an `Empty`
      // board and an `Empty` debrief carry none at all — and a hash that could not tell
      // them apart would call two different runs the same one.
      screen: 'contract_offer',
      state: 'Loading',
      title_key: 'screen.contract_offer.title',
      error_code: null,
      contract: null,
      roster: [],
      responses: [],
      treasury: 0,
      offer: null,
      treasury_forecast: 0,
      promise_terms: null,
      settlement: null,
      // `null` rather than an empty board: a formation is a decision about a *known* crew
      // and belongs to a locked package on a contract with a plan (`COMBAT_SPEC` §3.7), so
      // a loading screen has no board to offer — which hashes differently from a board
      // nobody has stood on, as it should.
      deployment: null,
      // `null` for the reason the board above is: a forecast of a crew nobody has answered
      // for is a forecast of a guess (`COMBAT_SPEC` §10.1).
      forecast: null,
      // Empty rather than seven dark entries: a loading screen has no package behind it, so
      // there is no command to press against one — which is a different claim from "every
      // command is refused" and hashes differently, as it should.
      available_actions: []
    });
  });
});

describe('what the screen shows about the negotiation itself', () => {
  /** A draft package promising the key hero a bonus, before anything is signed. */
  function draftWithAPromise(): GameState {
    const hero = aHero({
      id: heroId(0),
      definition: ids.bram,
      displayNameKey: 'hero.core.bram.name'
    });
    const contract = aContract({
      patronFee: 100,
      negotiableTags: SortedSet.from(compareContentIds, [ids.methodDeception, ids.methodOpen]),
      offer: anOffer({
        keyHero: heroId(0),
        methodTag: ids.methodOpen,
        promisedBonus: 25
      })
    });

    return withContracts(withHeroes(aState(), [hero]), [contract]);
  }

  /**
   * The same contract, hero and negotiable tags as {@link draftWithAPromise} — byte for
   * byte, down to `patronFee` — with nothing promised and no method chosen.
   * `readModelHash`'s own test needs the two fixtures to disagree about *only* the
   * offer: a stray difference anywhere else (a different `patronFee`, say) would let
   * that test pass for the wrong reason, agreeing with a `describeReadModel` that
   * dropped the new fields entirely as readily as with a correct one.
   */
  function draftWithoutAPromise(): GameState {
    const hero = aHero({
      id: heroId(0),
      definition: ids.bram,
      displayNameKey: 'hero.core.bram.name'
    });
    const contract = aContract({
      patronFee: 100,
      negotiableTags: SortedSet.from(compareContentIds, [ids.methodDeception, ids.methodOpen]),
      offer: anOffer()
    });

    return withContracts(withHeroes(aState(), [hero]), [contract]);
  }

  /**
   * A `locked` package over a roster one hero larger than `crew`, so the extra hero has
   * not answered yet and the screen reads `Incomplete` by construction — the shape
   * `lockedCampaign()`'s own test needs, without that test having to state it. The first
   * `crew` heroes both answered and accepted, so `crew` also doubles as `acceptedBy.size`
   * for the test that reads the treasury forecast off it.
   */
  function lockedCampaign(
    overrides: {
      readonly treasury?: number;
      readonly patronFee?: number;
      readonly advance?: number;
      readonly crew?: number;
      readonly promisedBonus?: number;
    } = {}
  ): GameState {
    const { treasury = 400, patronFee = 60, advance = 0, crew = 2, promisedBonus = 0 } = overrides;

    const roster = Array.from({ length: crew + 1 }, (_unused, index) =>
      aHero({
        id: heroId(index),
        definition: parseContentId(`core:hero${String(index)}`),
        displayNameKey: `hero.core.hero${String(index)}.name`
      })
    );
    const acceptedBy = SortedSet.from(
      compareHeroIds,
      roster.slice(0, crew).map((hero) => hero.id)
    );

    const contract = aContract({
      patronFee,
      requiredCrew: crew,
      // `acceptedBy.size` is always `crew` here, which is always `requiredCrew` too —
      // so §2.1's biconditional (`status = 'crewed' ⇔ acceptedBy.size = requiredCrew`)
      // leaves exactly one legal status for this fixture, not the `aContract` default
      // (`Offered`) review of Task 15 found this had been carrying instead.
      status: ContractStatus.Crewed,
      offer: anOffer({
        phase: OfferPhase.Locked,
        keyHero: roster[0]!.id,
        advance,
        promisedBonus,
        respondedBy: acceptedBy,
        acceptedBy
      })
    });

    return withContracts(withHeroes(aState({ treasury }), roster), [contract]);
  }

  /**
   * `locked`, one seat still open — `NEGOTIATION_SPEC` §3.2's "отряд не набран" branch.
   * `respondedBy` is the *whole* roster, same as {@link crewedCampaign}: both heroes
   * answered, only one accepted. Review of Task 15 found the original pair of fixtures
   * varying `respondedBy` too, which made `Normal` versus `Incomplete` differ between
   * them for free — an implementation gating the settlement on `state ===
   * ScreenState.Normal` instead of on the crew would have passed the very test this
   * fixture exists for.
   */
  function lockedButUncrewed(): GameState {
    const roster = heroes(ids.bram, ids.doran);
    const contract = aContract({
      requiredCrew: 2,
      status: ContractStatus.Offered,
      offer: anOffer({
        phase: OfferPhase.Locked,
        keyHero: heroId(0),
        respondedBy: responded(0, 1),
        acceptedBy: responded(0)
      })
    });

    return withContracts(withHeroes(aState(), roster), [contract]);
  }

  /**
   * `locked`, every seat filled — the phase/status pair `settleContract` waits on. Same
   * `respondedBy` as {@link lockedButUncrewed}, so both fixtures read `Normal`; only
   * `acceptedBy` and `status` — the actual crew — differ.
   */
  function crewedCampaign(): GameState {
    const roster = heroes(ids.bram, ids.doran);
    const contract = aContract({
      requiredCrew: 2,
      status: ContractStatus.Crewed,
      offer: anOffer({
        phase: OfferPhase.Locked,
        keyHero: heroId(0),
        respondedBy: responded(0, 1),
        acceptedBy: responded(0, 1)
      })
    });

    return withContracts(withHeroes(aState(), roster), [contract]);
  }

  /**
   * `locked`, crewed, mid-negotiation on every axis at once — every field of `offer`,
   * `promiseTerms` and `settlement` carries a distinct, nonzero value, so a `toEqual`
   * against the full projection is sensitive to each of the three sub-objects' own
   * fields individually, not only to whether the sub-object is `null` or present.
   */
  function crewedCampaignWithPromise(): GameState {
    const roster = heroes(ids.bram, ids.doran);
    const contract = aContract({
      patronFee: 100,
      requiredCrew: 2,
      status: ContractStatus.Crewed,
      negotiableTags: SortedSet.from(compareContentIds, [ids.methodDeception, ids.methodOpen]),
      offer: anOffer({
        version: 3,
        phase: OfferPhase.Locked,
        keyHero: heroId(0),
        advance: 15,
        methodTag: ids.methodOpen,
        promisedBonus: 30,
        respondedBy: responded(0, 1),
        acceptedBy: responded(0, 1)
      })
    });

    return withContracts(withHeroes(aState({ treasury: 500 }), roster), [contract]);
  }

  it('shows what fulfilment and breach will mean, before anything is signed', () => {
    const model = contractOfferScreenModel(draftWithAPromise(), []);

    expect(model.promiseTerms).toEqual({
      fulfilKey: 'offer.promise.fulfil',
      breachKey: 'offer.promise.breach',
      bonus: 25
    });
  });

  it('shows no promise terms when nothing was promised', () => {
    expect(contractOfferScreenModel(draftWithoutAPromise(), []).promiseTerms).toBeNull();
  });

  it('forecasts the treasury as keeping the word would leave it', () => {
    const model = contractOfferScreenModel(
      lockedCampaign({ treasury: 400, patronFee: 60, advance: 10, crew: 3, promisedBonus: 20 }),
      []
    );

    expect(model.treasuryForecast).toBe(400 + 60 - 30 - 20);
  });

  /**
   * Draft, one of three seats filled by the key hero's own draft acceptance — the
   * shape `lockCommitment` exists to stay honest about. `requiredCrew` (3) and
   * `acceptedBy.size` (1) disagree here, which every other fixture in this file does
   * not: `crewedCampaignWithPromise`'s own projection test has `acceptedBy.size ===
   * requiredCrew`, where `advance × requiredCrew + promisedBonus` and `advance ×
   * acceptedBy.size + promisedBonus` coincide by construction. A `lockCommitment`
   * computed off `acceptedBy.size` instead of `requiredCrew` — exactly the mistake the
   * field exists to not make — would still pass that pinned assertion and only
   * reddens against a state where the two formulas can disagree.
   */
  function draftWithOneSeatOfThreeFilled(): GameState {
    const hero = aHero({
      id: heroId(0),
      definition: ids.bram,
      displayNameKey: 'hero.core.bram.name'
    });
    const contract = aContract({
      requiredCrew: 3,
      offer: anOffer({
        keyHero: heroId(0),
        advance: 10,
        promisedBonus: 5,
        respondedBy: responded(0),
        acceptedBy: responded(0)
      })
    });

    return withContracts(withHeroes(aState(), [hero]), [contract]);
  }

  it('reserves what locking the full crew would commit, not just who has answered so far', () => {
    // advance × requiredCrew + promisedBonus = 10×3+5 = 35; advance × acceptedBy.size +
    // promisedBonus = 10×1+5 = 15. The two disagree, and `lockCommitment` must be the
    // first.
    const model = contractOfferScreenModel(draftWithOneSeatOfThreeFilled(), []);

    expect(model.offer?.lockCommitment).toBe(35);
  });

  it('keeps the phase out of the five screen states', () => {
    // A locked package one of whose invited heroes has not answered: `Incomplete`
    // means "somebody the package asked has not answered yet", and `locked` is a fact
    // about the negotiation — the two axes are independent, which is what this asserts.
    // `lockedCampaign()` itself no longer serves: every hero it invites has accepted,
    // and since the crew became part of the package that is exactly `Normal`.
    const roster = [aHero({ id: heroId(0) }), aHero({ id: heroId(1), definition: ids.doran })];
    const state = withContracts(withHeroes(aState(), roster), [
      aContract({
        requiredCrew: 2,
        offer: anOffer({
          phase: OfferPhase.Locked,
          keyHero: heroId(0),
          invited: responded(0, 1),
          respondedBy: responded(0),
          acceptedBy: responded(0)
        })
      })
    ]);

    const model = contractOfferScreenModel(state, []);

    expect(model.state).toBe(ScreenState.Incomplete);
    expect(model.offer?.phase).toBe(OfferPhase.Locked);
  });

  it('names both alternatives of a negotiable tag, not only the chosen one', () => {
    // Sorted order, which is `method:deception` before `method:open` — **not** the chosen
    // one first. Owner's decision of 2026-08-28: the list of alternatives does not
    // reorder itself when a player picks one, because a control that rearranges under the
    // cursor is one a player has to re-read before every second click. Which one is
    // chosen is said by `selected`, not by position.
    expect(
      contractOfferScreenModel(draftWithAPromise(), []).offer?.methodLever.options.map(
        (option) => option.labelKey
      )
    ).toEqual(['tag.method.deception', 'tag.method.open']);
  });

  it('keeps the alternatives in one order however the choice moves', () => {
    // The property the row above only samples: the *same* contract with a different
    // choice, and with none, produces the identical list. A "chosen first" implementation
    // reddens on the first comparison; one that sorted only when nothing is chosen reddens
    // on the second.
    const labelsOf = (methodTag: ContentId | null) => {
      const contract = aContract({
        patronFee: 100,
        negotiableTags: SortedSet.from(compareContentIds, [ids.methodDeception, ids.methodOpen]),
        offer: anOffer({ keyHero: heroId(0), invited: responded(0), methodTag })
      });
      const state = withContracts(withHeroes(aState(), heroes(ids.bram)), [contract]);

      return contractOfferScreenModel(state, [], ids.caravan).offer!.methodLever.options.map(
        (option) => option.labelKey
      );
    };

    expect(labelsOf(ids.methodOpen)).toEqual(labelsOf(ids.methodDeception));
    expect(labelsOf(ids.methodOpen)).toEqual(labelsOf(null));
  });

  it('shows the settlement only once the crew is filled', () => {
    expect(contractOfferScreenModel(lockedButUncrewed(), []).settlement).toBeNull();
    expect(contractOfferScreenModel(crewedCampaign(), []).settlement).not.toBeNull();
  });

  it('changes the read model hash when the offer changes and not when a translation does', () => {
    expect(readModelHash(contractOfferScreenModel(draftWithAPromise(), []))).not.toBe(
      readModelHash(contractOfferScreenModel(draftWithoutAPromise(), []))
    );
  });

  it('projects every field of the offer, the promise and the settlement, not only whether each is present', () => {
    // External review of this task found the gap the seven tests above leave: none of
    // them ever puts a *non-null* `settlement` through `describeReadModel` at all, so
    // `describeSettlement` had never actually run, and the other two pinned tests only
    // ever check `offer`/`promiseTerms` field by field on the *model*, never on the
    // projection `readModelHash` is taken over. A field could be dropped, renamed or
    // miscomputed inside `describeOffer`/`describePromiseTerms`/`describeSettlement` and
    // every test above would still pass. `toEqual` closes that: a projection missing a
    // key compares unequal to an expectation that states one, the same property the
    // `LOADING_SCREEN` projection test above already leans on for its five `null`s — so
    // this single assertion is sensitive to each of the sixteen sub-fields below on its
    // own, not only to whether `offer`/`promise_terms`/`settlement` are `null`.
    const model = contractOfferScreenModel(crewedCampaignWithPromise(), []);
    const projection = describeReadModel(model) as Record<string, unknown>;

    // acceptedBy.size is 2 here (both heroes crewed), so §3.3's formula reads
    // 500 + 100 − 15×2 − 30 = 540 kept, 570 broken (the 30 not paid).
    expect(projection['treasury']).toBe(500);
    expect(projection['treasury_forecast']).toBe(540);
    // requiredCrew is 2 here (`crewedCampaignWithPromise`), so `lockCommitment` reads
    // `commitmentOf` — 15 × 2 + 30 = 60 — the full-crew price `lockOffer` would have
    // reserved, not the `acceptedBy.size`-scaled figure `treasuryForecast` uses.
    // `crewedCampaignWithPromise` is locked *and* crewed, so every lever names the same
    // reason — the deal is struck and the terms no longer move (`NEGOTIATION_SPEC` §3.1).
    // Treasury 500, no other locked contract, so `available` is the whole 500; the
    // ceilings are then `(500 − 30) / 2 = 235` and `500 − 15×2 = 470`, both clamped by the
    // patron fee of 100 before they reach a lever.
    const crewOptions = [
      { value: ids.bram, label_key: 'hero.core.bram.name', selected: true },
      { value: ids.doran, label_key: 'hero.core.doran.name', selected: true }
    ];
    const keyHeroOptions = [
      { value: ids.bram, label_key: 'hero.core.bram.name', selected: true },
      { value: ids.doran, label_key: 'hero.core.doran.name', selected: false }
    ];

    expect(projection['offer']).toEqual({
      version: 3,
      phase: 'locked',
      advance_lever: { value: 15, min: 0, max: 100, disabled_reason_key: 'offer.locked' },
      bonus_lever: { value: 30, min: 0, max: 100, disabled_reason_key: 'offer.locked' },
      method_lever: {
        chosen: ids.methodOpen,
        options: [
          { value: ids.methodDeception, label_key: 'tag.method.deception', selected: false },
          { value: ids.methodOpen, label_key: 'tag.method.open', selected: true }
        ],
        disabled_reason_key: 'offer.locked'
      },
      key_hero_lever: {
        chosen: ids.bram,
        options: keyHeroOptions,
        disabled_reason_key: 'offer.locked'
      },
      crew_lever: {
        chosen: [ids.bram, ids.doran],
        options: crewOptions,
        exactly: 2,
        disabled_reason_key: 'offer.locked'
      },
      budget: { available: 500, max_advance: 235, max_bonus: 470, shortfall: 0 },
      lock_commitment: 60
    });
    expect(projection['promise_terms']).toEqual({
      fulfil_key: 'offer.promise.fulfil',
      breach_key: 'offer.promise.breach',
      bonus: 30
    });
    expect(projection['settlement']).toEqual({
      promised_bonus: 30,
      key_hero_definition: ids.bram,
      crew: [ids.bram, ids.doran],
      treasury_if_kept: 540,
      treasury_if_broken: 570
    });
  });
});

describe('the levers a player may pull', () => {
  /**
   * A campaign where a *second* contract already holds a reserve, so `available` cannot
   * be the treasury and cannot be "the treasury minus this package" either.
   *
   * Every number here is chosen so that no ceiling lands on the patron fee: `patronFee`
   * is 200 while the budget answers 100 and 150, so a lever that ignored the budget and
   * clamped on the fee alone would read 200 and redden. The plan's own case — "простое
   * `max <= treasury` разрешит заведомо отказной пакет" — needs exactly that separation.
   */
  function campaignWithAnotherReserve(
    overrides: { readonly advance?: number; readonly promisedBonus?: number } = {}
  ): GameState {
    const { advance = 60, promisedBonus = 30 } = overrides;
    const roster = heroes(ids.bram, ids.doran, ids.zara);
    const everyone = responded(0, 1, 2);

    const focused = aContract({
      id: ids.caravan,
      patronFee: 200,
      requiredCrew: 3,
      negotiableTags: SortedSet.from(compareContentIds, [ids.methodDeception, ids.methodOpen]),
      offer: anOffer({
        keyHero: heroId(0),
        invited: everyone,
        advance,
        methodTag: ids.methodOpen,
        promisedBonus
      })
    });

    // Locked, so it reserves: `advance × requiredCrew + promisedBonus` = 20×3 + 10 = 70.
    const elsewhere = aContract({
      id: ids.crypt,
      patronFee: 100,
      requiredCrew: 3,
      offer: anOffer({
        phase: OfferPhase.Locked,
        keyHero: heroId(1),
        invited: everyone,
        advance: 20,
        promisedBonus: 10
      })
    });

    return withContracts(withHeroes(aState({ treasury: 400 }), roster), [focused, elsewhere]);
  }

  function budgetOf(state: GameState): OfferBudget {
    return contractOfferScreenModel(state, [], ids.caravan).offer!.budget;
  }

  it('counts other locked offers against the money this package may still spend', () => {
    const budget = budgetOf(campaignWithAnotherReserve());

    expect(budget.available).toBe(400 - 70);
    expect(budget.maxAdvance).toBe(divideTowardZero(330 - 30, 3));
    expect(budget.maxBonus).toBe(330 - 60 * 3);
  });

  it('lowers the advance ceiling when the promise rises', () => {
    expect(budgetOf(campaignWithAnotherReserve({ promisedBonus: 30 })).maxAdvance).toBeLessThan(
      budgetOf(campaignWithAnotherReserve({ promisedBonus: 0 })).maxAdvance
    );
  });

  it('leaves this package its own reserve to spend again', () => {
    // The focused contract is `locked` here, so `reservedCommitments` counts it too.
    // Revising a package returns it to `draft` (`RESOLUTION_SPEC` §6.2), and a draft
    // reserves nothing — so its own money is money the next version may spend, and a
    // budget that subtracted it would refuse a player the coins they already hold.
    const state = campaignWithAnotherReserve();
    const focused = state.contracts.get(ids.caravan)!;
    const locked = withContracts(state, [
      { ...focused, offer: { ...focused.offer, phase: OfferPhase.Locked } },
      state.contracts.get(ids.crypt)!
    ]);

    expect(budgetOf(locked).available).toBe(400 - 70);
  });

  it('stops the advance exactly where lockOffer would start refusing', () => {
    // The whole point of the ceiling: one over it is a package the engine is certain to
    // refuse, and the player had no way to see it coming. Measured against the engine's
    // own predicate rather than against a second copy of its arithmetic written here.
    const state = campaignWithAnotherReserve();
    const contract = state.contracts.get(ids.caravan)!;
    const { max } = contractOfferScreenModel(state, [], ids.caravan).offer!.advanceLever;

    const at = (advance: number) => ({ ...contract, offer: { ...contract.offer, advance } });

    expect(max).toBe(100);
    expect(canCover(state, at(max))).toBe(true);
    expect(canCover(state, at(max + 1))).toBe(false);
  });

  /**
   * A campaign whose whole treasury is reserved by somebody else, over a package that
   * already promises a coin.
   *
   * Reachable, not contrived: `composeOffer` checks no treasury at all
   * (`NEGOTIATION_SPEC` §3.3), so a package composed while the money was there stays
   * composed after another contract locks it away. External review of this task found
   * that the ceilings alone describe this state as if it were fine.
   */
  function campaignWithNothingLeft(): GameState {
    const roster = heroes(ids.bram);
    const seat = responded(0);
    const focused = aContract({
      id: ids.caravan,
      patronFee: 100,
      requiredCrew: 1,
      offer: anOffer({ keyHero: heroId(0), invited: seat, advance: 0, promisedBonus: 1 })
    });
    const elsewhere = aContract({
      id: ids.crypt,
      patronFee: 400,
      requiredCrew: 1,
      offer: anOffer({
        phase: OfferPhase.Locked,
        keyHero: heroId(0),
        invited: seat,
        advance: 400,
        promisedBonus: 0
      })
    });

    return withContracts(withHeroes(aState({ treasury: 400 }), roster), [focused, elsewhere]);
  }

  it('says by how much a package has stopped fitting, rather than describing a ceiling that is not one', () => {
    // `available` is 0 and every ceiling clamps to 0, so the levers on their own read
    // exactly like a package that fits with nothing to spare. It does not fit: the coin
    // already promised is one more than the guild has, and `lockOffer` refuses even at an
    // advance of zero. `shortfall` is what says so, and it is the number a player acts on
    // — it names the promise to lower.
    const state = campaignWithNothingLeft();
    const contract = state.contracts.get(ids.caravan)!;
    const offer = contractOfferScreenModel(state, [], ids.caravan).offer!;

    expect(offer.budget.available).toBe(0);
    expect(offer.advanceLever.max).toBe(0);
    expect(canCover(state, contract)).toBe(false);
    expect(offer.budget.shortfall).toBe(1);
  });

  it('reports no shortfall for a package that does fit', () => {
    // The other half of the pair: `shortfall` must not be a number that is simply always
    // positive, and a fixture where the package fits with room is what says so.
    const offer = contractOfferScreenModel(campaignWithAnotherReserve(), [], ids.caravan).offer!;

    expect(offer.budget.shortfall).toBe(0);
  });

  it('agrees with lockOffer on every package it is shown', () => {
    // The property behind both numbers, stated once: a package fits exactly when the
    // engine's own predicate says it does. Measured over both fixtures rather than
    // asserted twice by hand, so neither can drift into agreeing by coincidence.
    for (const state of [campaignWithAnotherReserve(), campaignWithNothingLeft()]) {
      const contract = state.contracts.get(ids.caravan)!;
      const offer = contractOfferScreenModel(state, [], ids.caravan).offer!;

      expect(offer.budget.shortfall === 0).toBe(canCover(state, contract));
    }
  });

  it('never offers a term the patron fee itself forbids', () => {
    // `composeOffer` bounds both money terms by `patronFee` (`NEGOTIATION_SPEC` §3.3),
    // and on a rich campaign the budget alone would answer far above it.
    const contract = aContract({
      patronFee: 12,
      requiredCrew: 1,
      offer: anOffer({ keyHero: heroId(0), invited: responded(0) })
    });
    const state = withContracts(withHeroes(aState({ treasury: 400 }), heroes(ids.bram)), [
      contract
    ]);

    const offer = contractOfferScreenModel(state, [], ids.caravan).offer!;

    expect(offer.advanceLever.max).toBe(12);
    expect(offer.bonusLever.max).toBe(12);
    expect(offer.advanceLever.min).toBe(0);
    expect(offer.bonusLever.min).toBe(0);
  });

  it('carries every invited hero on the crew lever, and the whole roster as its options', () => {
    const ilsa = parseContentId('core:ilsa');
    const roster = heroes(ids.bram, ids.doran, ids.zara, ilsa);
    const contract = aContract({
      requiredCrew: 4,
      offer: anOffer({ keyHero: heroId(0), invited: responded(0, 1, 2, 3) })
    });
    const state = withContracts(withHeroes(aState(), roster), [contract]);

    const { crewLever } = contractOfferScreenModel(state, [], ids.caravan).offer!;

    expect(crewLever.chosen).toEqual([ids.bram, ids.doran, ids.zara, ilsa]);
    expect(crewLever.exactly).toBe(4);
    expect(crewLever.options).toHaveLength(4);
  });

  it('gives every option a label key, not only a value', () => {
    const offer = contractOfferScreenModel(campaignWithAnotherReserve(), [], ids.caravan).offer!;

    for (const option of [
      ...offer.methodLever.options,
      ...offer.crewLever.options,
      ...offer.keyHeroLever.options
    ]) {
      expect(option.labelKey).not.toBe('');
      expect(option.labelKey).not.toBe(String(option.value));
    }

    // The contract's own sorted order, not "chosen first" (owner, 2026-08-28) —
    // `method:deception` sorts before `method:open`, and choosing `open` does not move it.
    expect(offer.methodLever.options.map((option) => option.labelKey)).toEqual([
      'tag.method.deception',
      'tag.method.open'
    ]);
    expect(offer.methodLever.chosen).toBe(ids.methodOpen);
    expect(offer.keyHeroLever.chosen).toBe(ids.bram);
  });

  it('marks which options are selected, so nothing downstream has to compare ids', () => {
    // External review of this task found the screen doing `option.value === chosen` to
    // decide a radio's `checked` — a branch on a *value*, which is the one kind this
    // layer exists to take off the screen. Stated on the option instead, once, here.
    // `chosen` stays because it is what a command is built from; `selected` is how it is
    // drawn, and the factory is the only place the two are related.
    const offer = contractOfferScreenModel(campaignWithAnotherReserve(), [], ids.caravan).offer!;

    expect(offer.methodLever.options.map((option) => option.selected)).toEqual([false, true]);
    // The key hero is the roster's first entry here, and the crew invites all three — so
    // the two levers disagree about which options are selected, and a `selected` computed
    // from the wrong lever cannot satisfy both.
    expect(offer.keyHeroLever.options.map((option) => option.selected)).toEqual([
      true,
      false,
      false
    ]);
    expect(offer.crewLever.options.map((option) => option.selected)).toEqual([true, true, true]);
  });

  it('leaves every option unselected when nothing has been chosen', () => {
    // The closed vocabulary's other value: without this, `selected: true` could be a
    // constant and every assertion above would still pass.
    const contract = aContract({
      requiredCrew: 1,
      negotiableTags: SortedSet.from(compareContentIds, [ids.methodDeception, ids.methodOpen]),
      offer: anOffer()
    });
    const state = withContracts(withHeroes(aState(), heroes(ids.bram)), [contract]);

    const offer = contractOfferScreenModel(state, [], ids.caravan).offer!;

    expect(offer.methodLever.chosen).toBeNull();
    expect(offer.methodLever.options.map((option) => option.selected)).toEqual([false, false]);
    expect(offer.keyHeroLever.options.map((option) => option.selected)).toEqual([false]);
    expect(offer.crewLever.options.map((option) => option.selected)).toEqual([false]);
  });

  /** A campaign whose focused contract sits in `phase`, with `status` to match. */
  function campaignInPhase(phase: OfferPhase, status: ContractStatus): GameState {
    const acceptedBy = status === ContractStatus.Crewed ? responded(0, 1) : responded(0);
    const contract = aContract({
      requiredCrew: 2,
      status,
      offer: anOffer({
        phase,
        keyHero: heroId(0),
        invited: responded(0, 1),
        respondedBy: responded(0, 1),
        acceptedBy
      })
    });

    return withContracts(withHeroes(aState(), heroes(ids.bram, ids.doran)), [contract]);
  }

  it.each([
    ['a draft', OfferPhase.Draft, ContractStatus.Offered, null],
    // `RESOLUTION_SPEC` §6.2: a locked package whose crew never filled is exactly where
    // a new version is legal, so the levers stay live — this row is the way out of the
    // dead end, not an oversight.
    ['locked with the crew unfilled', OfferPhase.Locked, ContractStatus.Offered, null],
    ['locked with the crew filled', OfferPhase.Locked, ContractStatus.Crewed, 'offer.locked'],
    ['settled', OfferPhase.Settled, ContractStatus.Crewed, 'offer.settled']
  ])('%s: every lever answers %s', (_name, phase, status, expected) => {
    const model = contractOfferScreenModel(campaignInPhase(phase, status), [], ids.caravan);
    const levers = leversOf(model.offer!);

    expect(levers).toHaveLength(5);
    expect(levers.map((lever) => lever.disabledReasonKey)).toEqual(levers.map(() => expected));
  });

  it('distinguishes two models that differ only in a lever', () => {
    const hashFor = (advance: number) =>
      readModelHash(
        contractOfferScreenModel(campaignWithAnotherReserve({ advance }), [], ids.caravan)
      );

    expect(hashFor(40)).not.toBe(hashFor(50));
  });

  it('projects every lever and the budget, not only the terms they carry', () => {
    const projection = describeReadModel(
      contractOfferScreenModel(campaignWithAnotherReserve(), [], ids.caravan)
    ) as Record<string, unknown>;

    const crewOptions = [
      { value: ids.bram, label_key: 'hero.core.bram.name', selected: true },
      { value: ids.doran, label_key: 'hero.core.doran.name', selected: true },
      { value: ids.zara, label_key: 'hero.core.zara.name', selected: true }
    ];
    const keyHeroOptions = [
      { value: ids.bram, label_key: 'hero.core.bram.name', selected: true },
      { value: ids.doran, label_key: 'hero.core.doran.name', selected: false },
      { value: ids.zara, label_key: 'hero.core.zara.name', selected: false }
    ];

    expect(projection['offer']).toEqual({
      version: 1,
      phase: 'draft',
      advance_lever: { value: 60, min: 0, max: 100, disabled_reason_key: null },
      bonus_lever: { value: 30, min: 0, max: 150, disabled_reason_key: null },
      method_lever: {
        chosen: ids.methodOpen,
        options: [
          { value: ids.methodDeception, label_key: 'tag.method.deception', selected: false },
          { value: ids.methodOpen, label_key: 'tag.method.open', selected: true }
        ],
        disabled_reason_key: null
      },
      key_hero_lever: { chosen: ids.bram, options: keyHeroOptions, disabled_reason_key: null },
      crew_lever: {
        chosen: [ids.bram, ids.doran, ids.zara],
        options: crewOptions,
        exactly: 3,
        disabled_reason_key: null
      },
      budget: { available: 330, max_advance: 100, max_bonus: 150, shortfall: 0 },
      lock_commitment: 210
    });
  });
});
