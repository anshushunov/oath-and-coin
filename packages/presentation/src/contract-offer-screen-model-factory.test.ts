import { describe, expect, it } from 'vitest';

import {
  Actions,
  ReasonCodes,
  SortedMap,
  SortedSet,
  compareContentIds,
  compareHeroIds,
  heroId,
  type ContentId,
  type HeroId,
  type HeroState
} from '@oath-and-coin/simulation';

import {
  LOADING_SCREEN,
  contractOfferScreenModel,
  describeReadModel,
  failedScreen,
  readModelHash
} from './contract-offer-screen-model-factory.ts';
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
      aContract({ offer: anOffer({ respondedBy: responded(0, 1) }) })
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
    // `heroDefinitions`). The test above reuses one hero for all three decisions, so
    // an implementation that quietly stamped every decision with the step's single
    // `heroDefinition` would still pass it — the three response lines would already
    // agree on the hero by construction. This one gives each decision a *different*
    // hero and checks the response lines name them correctly, which only
    // `heroDefinitions` can make true.
    const roster = heroes(ids.bram, ids.doran, ids.zara);
    const state = withContracts(withHeroes(aState(), roster), [
      aContract({ offer: anOffer({ respondedBy: responded(0, 1, 2) }) })
    ]);

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
    const heroDefinitions: readonly ContentId[] = [ids.bram, ids.doran, ids.zara];

    const oneStepWithThree = [aStep({ decisions, heroDefinitions })];
    const threeStepsWithOne = decisions.map((decision, index) =>
      aStep({ decisions: [decision], heroDefinition: heroDefinitions[index]! })
    );

    const collapsed = contractOfferScreenModel(state, oneStepWithThree);
    const spread = contractOfferScreenModel(state, threeStepsWithOne);

    expect(collapsed.responses).toHaveLength(3);
    // Names each hero correctly — the assertion a same-hero fixture cannot make: a
    // factory that ignored `heroDefinitions` and stamped every line with the step's
    // one `heroDefinition` would show `bram, bram, bram` here instead.
    expect(collapsed.responses.map((response) => response.heroDefinition)).toEqual(heroDefinitions);
    expect(collapsed.responses).toEqual(spread.responses);
    expect(readModelHash(collapsed)).toBe(readModelHash(spread));
  });

  it('distinguishes two screens that differ only in state', () => {
    // Incomplete and Normal can carry an identical roster and identical responses. If
    // the state were outside the hash, a screen still waiting on a hero would be
    // indistinguishable from one that finished.
    const roster = heroes(ids.bram, ids.doran);
    const incomplete = withContracts(withHeroes(aState(), roster), [
      aContract({ offer: anOffer({ respondedBy: responded(0) }) })
    ]);
    const complete = withContracts(withHeroes(aState(), roster), [
      aContract({ offer: anOffer({ respondedBy: responded(0, 1) }) })
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
      state: 'Loading',
      title_key: 'screen.contract_offer.title',
      error_code: null,
      contract: null,
      roster: [],
      responses: []
    });
  });
});
