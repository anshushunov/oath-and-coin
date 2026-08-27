import {
  CommitmentState,
  NeedId,
  OutcomeReasonCodes,
  contractOf,
  parseContentId,
  settleContract,
  type ContentId,
  type GameState
} from '@oath-and-coin/simulation';
import { describe, expect, it } from 'vitest';

import {
  AFTER_ACTION_LOADING_SCREEN,
  afterActionFailedScreen,
  afterActionScreenModel,
  createAfterActionScreenModel
} from './after-action-screen-model.ts';
import { AFTER_ACTION_TITLE_KEY, OutcomeEventKeys } from './keys.ts';
import { SCREEN_STATES, ScreenState } from './screen-state.ts';
import {
  aCapableHero,
  aCrewedContract,
  aResolvedCampaign,
  aState,
  ids,
  withContracts,
  withHeroes
} from './testing/fixtures.ts';

/**
 * The debrief, built from a campaign the engine actually resolved.
 *
 * Every fixture here goes out through `resolveContract` rather than carrying a
 * hand-written `ContractResolution`, and that is the whole instrument: the screen joins a
 * stored result to the events in `history`, and a hand-written result would leave the half
 * of the input this model exists to read completely empty. The numbers asserted below are
 * this build's own arithmetic (`RESOLUTION_SPEC` §4), worked through in the comment beside
 * each case so a moved constant fails here with something to read rather than with a diff.
 */

const debtId = parseContentId('core:collect_the_debt');

/**
 * One hero at grade 50 and one at 60, both answerable for the same two needs.
 *
 * The **stronger man carries the higher hero id**, and that is deliberate. §4.3 halves by
 * rank in contribution order, and `contributions` comes out in hero-id order — so with the
 * stronger hero first in both, an implementation reading `contributors[index]` positionally
 * would agree with the right answer by coincidence. Here the two orders disagree.
 */
const weaker = aCapableHero({
  id: 0,
  definition: ids.bram,
  grade: 50,
  expertise: [
    [NeedId.Frontline, 100],
    [NeedId.Wilderness, 100]
  ]
});

const stronger = aCapableHero({
  id: 1,
  definition: ids.doran,
  grade: 60,
  expertise: [
    [NeedId.Frontline, 100],
    [NeedId.Wilderness, 100]
  ]
});

/** A hero answerable for the front line alone, at half his own grade's worth. */
const frontliner = aCapableHero({
  id: 0,
  definition: ids.bram,
  grade: 50,
  expertise: [[NeedId.Frontline, 100]]
});

/** A hero answerable for nothing this campaign's contracts ask for. */
const bystander = aCapableHero({ id: 1, definition: ids.doran, grade: 90, expertise: [] });

/** A hero who can do everything asked of him, twice over. */
const paragon = aCapableHero({
  id: 0,
  definition: ids.bram,
  grade: 100,
  expertise: [
    [NeedId.Frontline, 100],
    [NeedId.Wilderness, 100]
  ]
});

/**
 * Everything closed, nobody hurt: one hero at grade 100 against two needs of 40 at no risk.
 *
 * Supplied 100 against a requirement of 40, so both needs close; the surplus is capped at
 * `120 %` of 40, which is 48, and the margin comes out `+16` before motive and `+19` after
 * — `Clean`, and `Clean` costs nobody anything (§5.1).
 */
function aCleanCampaign(): GameState {
  return aResolvedCampaign({
    heroes: [paragon],
    contracts: [
      aCrewedContract({
        id: ids.caravan,
        needs: [
          [NeedId.Frontline, 40],
          [NeedId.Wilderness, 40]
        ],
        risk: 0,
        crew: [{ hero: paragon, commitment: CommitmentState.Committed }]
      })
    ]
  });
}

/**
 * A catastrophe with two diagnoses of exactly equal weight, so neither may be named.
 *
 * Front line asks 100 and gets 50 from the one man answerable for it; the wilderness asks
 * 50 and nobody in the crew answers for it at all. Both shortfalls are `−50`, so removing
 * either counterfactually buys back the same `40` of margin — inside §4.7's 25 % dominance
 * margin, which is what makes `dominant` `null` rather than a coin toss.
 */
function aTwoDeficitCampaign(): GameState {
  return aResolvedCampaign({
    heroes: [frontliner, bystander],
    contracts: [
      aCrewedContract({
        id: ids.crypt,
        needs: [
          [NeedId.Frontline, 100],
          [NeedId.Wilderness, 50]
        ],
        risk: 0,
        crew: [
          { hero: frontliner, commitment: CommitmentState.Committed },
          { hero: bystander, commitment: CommitmentState.Committed }
        ]
      })
    ]
  });
}

/**
 * Two men on the same two needs, so §4.3's halving is visible on the screen.
 *
 * Each brings `expertise × grade / 100` to each need: 50 from the weaker, 60 from the
 * stronger. The stronger sorts first and counts whole; the weaker is second and counts a
 * half, rounded toward zero — 25 per need.
 */
function aSharedNeedCampaign(): GameState {
  return aResolvedCampaign({
    heroes: [weaker, stronger],
    contracts: [
      aCrewedContract({
        id: ids.caravan,
        needs: [
          [NeedId.Frontline, 100],
          [NeedId.Wilderness, 100]
        ],
        risk: 0,
        crew: [
          { hero: weaker, commitment: CommitmentState.Committed },
          { hero: stronger, commitment: CommitmentState.Committed }
        ]
      })
    ]
  });
}

/**
 * The same two men on the same two needs, neither of whom came freely.
 *
 * The coverage is `aSharedNeedCampaign`'s exactly — 85 against a requirement of 100 on both
 * needs, which is above §4.3's floor of 60 % and below the requirement, so both come out
 * `weak` rather than `uncovered`. What differs is the answers they gave: a bought agreement
 * and a resentful one, which is what puts a `faltered_early` in the feed for each of them
 * (§4.4), a `commitment_drag` among the diagnoses (§4.7) and a grudge on the man who
 * brought least to his own need (§5.2).
 */
function aReluctantCampaign(): GameState {
  return aResolvedCampaign({
    heroes: [weaker, stronger],
    contracts: [
      aCrewedContract({
        id: ids.caravan,
        needs: [
          [NeedId.Frontline, 100],
          [NeedId.Wilderness, 100]
        ],
        risk: 0,
        crew: [
          { hero: weaker, commitment: CommitmentState.Fragile },
          { hero: stronger, commitment: CommitmentState.Resentful }
        ]
      })
    ]
  });
}

/**
 * The same crew and the same needs as `aSharedNeedCampaign`, so the outcome is the same
 * `Failed` — with money on the table: a fee of 43 that `PARTIAL_FEE_PERCENT` does not
 * divide evenly, an advance of 5 a head and a promised bonus of 10, so keeping the word and
 * breaking it are two different figures and neither is the treasury the campaign stands on.
 */
function aPromisedCampaign(): GameState {
  return aResolvedCampaign({
    heroes: [weaker, stronger],
    contracts: [
      aCrewedContract({
        id: ids.caravan,
        needs: [
          [NeedId.Frontline, 100],
          [NeedId.Wilderness, 100]
        ],
        risk: 0,
        crew: [
          { hero: weaker, commitment: CommitmentState.Committed },
          { hero: stronger, commitment: CommitmentState.Committed }
        ],
        patronFee: 43,
        advance: 5,
        promisedBonus: 10
      })
    ]
  });
}

/**
 * Two contracts, both resolved, the debt second — so this contract's own feed is never the
 * whole of `history` and never its beginning either.
 */
function aTwoResolvedCampaign(): GameState {
  const crew = [
    { hero: weaker, commitment: CommitmentState.Committed },
    { hero: stronger, commitment: CommitmentState.Committed }
  ];

  return aResolvedCampaign({
    heroes: [weaker, stronger],
    contracts: [
      aCrewedContract({
        id: ids.caravan,
        needs: [
          [NeedId.Frontline, 100],
          [NeedId.Wilderness, 100]
        ],
        risk: 0,
        crew
      }),
      aCrewedContract({
        id: debtId,
        needs: [
          [NeedId.Frontline, 100],
          [NeedId.UndeadKnowledge, 50]
        ],
        risk: 0,
        crew
      })
    ]
  });
}

/**
 * The same campaign, settled by the engine — both the one state that finishes a contract's
 * story and the oracle the settlement block is measured against.
 */
function settled(state: GameState, contractId: ContentId, pay = true): GameState {
  const result = settleContract(state, {
    commandId: 99,
    contractId,
    pay,
    expectedStateVersion: state.metadata.stateVersion
  });

  if (!result.applied) {
    throw new Error(
      `The fixture could not settle '${contractId}': ${String(result.rejectionCode)}`
    );
  }

  return result.state;
}

/** A campaign whose contract was never sent out at all. */
function anUnresolvedCampaign(): GameState {
  return withContracts(withHeroes(aState(), [paragon]), [
    aCrewedContract({
      id: ids.caravan,
      needs: [
        [NeedId.Frontline, 40],
        [NeedId.Wilderness, 40]
      ],
      risk: 0,
      crew: [{ hero: paragon, commitment: CommitmentState.Committed }]
    })
  ]);
}

function modelIn(state: ScreenState) {
  switch (state) {
    case ScreenState.Loading:
      return AFTER_ACTION_LOADING_SCREEN;
    case ScreenState.Error:
      return afterActionFailedScreen('CONTENT_ROOT_NOT_FOUND', 'nowhere on this disk');
    case ScreenState.Empty:
      return afterActionScreenModel(anUnresolvedCampaign(), ids.caravan);
    case ScreenState.Incomplete:
      return afterActionScreenModel(aCleanCampaign(), ids.caravan);
    case ScreenState.Normal:
      return afterActionScreenModel(settled(aCleanCampaign(), ids.caravan), ids.caravan);
    default:
      throw new Error(`No fixture for screen state '${String(state)}'.`);
  }
}

describe('the five shapes the debrief takes', () => {
  it.each(SCREEN_STATES)('builds a model in state %s', (state) => {
    expect(modelIn(state).state).toBe(state);
  });

  it.each(SCREEN_STATES)(
    'titles the model in state %s without naming the screen twice',
    (state) => {
      expect(modelIn(state).titleKey).toBe(AFTER_ACTION_TITLE_KEY);
    }
  );

  it('carries no outcome at all on the three states that have none', () => {
    for (const state of [ScreenState.Loading, ScreenState.Error, ScreenState.Empty]) {
      const model = modelIn(state);

      expect(model.gradeKey, state).toBeNull();
      expect(model.contractDefinition, state).toBeNull();
      expect(model.events, state).toEqual([]);
      expect(model.contributions, state).toEqual([]);
      expect(model.settlement, state).toBeNull();
    }
  });

  it('is Incomplete while the promise is still owed and Normal once it is answered', () => {
    // Not two readings of one field: a resolved contract's outcome is complete the moment
    // `resolveContract` applies, and what is still owed is the *promise*. The two fixtures
    // differ in nothing but `settleContract` having been applied to the second.
    const resolved = aCleanCampaign();

    expect(afterActionScreenModel(resolved, ids.caravan).state).toBe(ScreenState.Incomplete);
    expect(afterActionScreenModel(settled(resolved, ids.caravan), ids.caravan).state).toBe(
      ScreenState.Normal
    );
  });

  it('refuses a contract the campaign does not carry', () => {
    expect(() => afterActionScreenModel(aCleanCampaign(), debtId)).toThrow(/routing bug/u);
  });

  it('refuses an error screen with nothing to say', () => {
    expect(() => afterActionFailedScreen('', 'detail')).toThrow(/name what failed/u);
    expect(() => afterActionFailedScreen('CODE', '')).toThrow(/not a report/u);
  });

  it('refuses a Normal model assembled by a spread around the factory', () => {
    expect(() =>
      createAfterActionScreenModel({ ...AFTER_ACTION_LOADING_SCREEN, state: ScreenState.Normal })
    ).toThrow(/debrief of nothing/u);
  });

  it('refuses an event line carrying an id with no key to label it', () => {
    const model = afterActionScreenModel(aTwoDeficitCampaign(), ids.crypt);
    const named = model.events.find((line) => line.heroDefinition !== null);

    expect(named).toBeDefined();
    expect(() =>
      createAfterActionScreenModel({
        ...model,
        events: [{ ...named!, heroDisplayNameKey: null }]
      })
    ).toThrow(/half a hero/u);
  });
});

describe('the feed', () => {
  it('reads this contract’s outcome events in the order history holds them', () => {
    // The exact sequence `RESOLUTION_SPEC` §3.3 fixes: coverage first, in the
    // vocabulary's own order, then the objective, then what it cost, then the closing
    // line. Written out rather than compared against a second filter over the same
    // history, which would agree with any order at all.
    const model = afterActionScreenModel(aTwoDeficitCampaign(), ids.crypt);

    expect(model.events.map((line) => line.key)).toEqual([
      OutcomeEventKeys.NeedShort,
      OutcomeEventKeys.NeedShort,
      OutcomeEventKeys.ObjectiveLost,
      OutcomeEventKeys.HeroSufferedConsequence,
      OutcomeEventKeys.HeroSufferedConsequence,
      OutcomeEventKeys.ContractResolved
    ]);
  });

  it('follows history when history disagrees with the stored result', () => {
    // The claim §6.1 makes — the chronology lives in `history` — stated as the one
    // experiment that can tell the two apart. `resolution` is untouched here; only the
    // log's order moves, and the feed moves with it. An implementation that rebuilt the
    // feed from `coverage`, `consequences` and the grade would answer identically to the
    // test above and fail this one.
    const state = aTwoResolvedCampaign();
    const forwards = afterActionScreenModel(state, debtId).events.map((line) => line.key);
    const backwards = afterActionScreenModel(
      { ...state, history: [...state.history].reverse() },
      debtId
    ).events.map((line) => line.key);

    expect(backwards).toEqual([...forwards].reverse());
  });

  it('leaves another contract’s outcome off this screen', () => {
    // Both contracts of this campaign end on `Failed` with the same five-line shape, so
    // counting lines is not enough on its own: the wilderness belongs to the caravan and
    // undead knowledge to the debt, and neither need may appear under the other's feed.
    const state = aTwoResolvedCampaign();

    expect(afterActionScreenModel(state, debtId).events.map((line) => line.needKey)).not.toContain(
      'need.wilderness'
    );
    expect(
      afterActionScreenModel(state, ids.caravan).events.map((line) => line.needKey)
    ).not.toContain('need.undead_knowledge');
  });

  it('names a hero only where an event named one', () => {
    // `Clean` costs nobody anything (§5.1) and a committed crew gives way to nothing
    // (§4.4), so every line of this feed is about the contract and none about a person —
    // while the screen still has a full crew to show elsewhere. A model that read its
    // feed's heroes off the crew, or off the deficits' sources, would name somebody here.
    const model = afterActionScreenModel(aCleanCampaign(), ids.caravan);

    expect(model.events.every((line) => line.heroDefinition === null)).toBe(true);
    expect(model.contributions).toHaveLength(1);
  });

  it('names the hero an event named, under a key and not under his id', () => {
    const model = afterActionScreenModel(aTwoDeficitCampaign(), ids.crypt);
    const suffered = model.events.filter(
      (line) => line.key === OutcomeEventKeys.HeroSufferedConsequence
    );

    expect(suffered.map((line) => line.heroDefinition)).toEqual([ids.bram, ids.bram]);
    expect(suffered.map((line) => line.heroDisplayNameKey)).toEqual([
      'hero.core.bram.name',
      'hero.core.bram.name'
    ]);
  });

  it('gives every line the reason the engine gave it, never one derived here', () => {
    // Two wounds of different kinds land on the same man in a catastrophe, so the join
    // back to the stored result has to be by `(hero, kind)` and not by hero alone —
    // a model matching on the hero would give both lines the first reason it found.
    const model = afterActionScreenModel(aTwoDeficitCampaign(), ids.crypt);

    expect(model.events.map((line) => line.reasonKey)).toEqual([
      OutcomeReasonCodes.NeedUncovered,
      OutcomeReasonCodes.NeedUncovered,
      OutcomeReasonCodes.ObjectiveLost,
      OutcomeReasonCodes.WoundOnThePoint,
      OutcomeReasonCodes.TrustLostInDisaster,
      // `ADR-015`: the closing line carries the objective's own code, chosen by the grade.
      OutcomeReasonCodes.ObjectiveLost
    ]);
  });

  it('tells a need held barely apart from one not held at all', () => {
    // Both are `need_short` events and their reasons differ (§4.4): 85 against 100 is
    // above §4.3's floor of 60 % and reads `weak`, while 50 against 100 is below it and
    // reads `uncovered`. A model taking either verdict's code as the constant for the
    // whole kind would agree with one of these two cases and fail the other.
    const weak = afterActionScreenModel(aSharedNeedCampaign(), ids.caravan);
    const uncovered = afterActionScreenModel(aTwoDeficitCampaign(), ids.crypt);

    expect(weak.events[0]?.key).toBe(OutcomeEventKeys.NeedShort);
    expect(weak.events[0]?.reasonKey).toBe(OutcomeReasonCodes.NeedWeak);
    expect(weak.coverage[0]?.verdictKey).toBe('outcome.verdict.weak');

    expect(uncovered.events[0]?.key).toBe(OutcomeEventKeys.NeedShort);
    expect(uncovered.events[0]?.reasonKey).toBe(OutcomeReasonCodes.NeedUncovered);

    // And a need that closed is neither: the third code of the three.
    const clean = afterActionScreenModel(aCleanCampaign(), ids.caravan);

    expect(clean.events[0]?.key).toBe(OutcomeEventKeys.NeedCovered);
    expect(clean.events[0]?.reasonKey).toBe(OutcomeReasonCodes.NeedClosed);
  });

  it('names the man who gave way early, and the need he gave way on', () => {
    // §4.4's `faltered_early`, at most one per hero and each about a need he was
    // answerable for. Both men here came unwillingly and both needs came out weak, so the
    // feed carries one line each, in hero-id order.
    const model = afterActionScreenModel(aReluctantCampaign(), ids.caravan);
    const gaveWay = model.events.filter((line) => line.key === OutcomeEventKeys.HeroFalteredEarly);

    expect(gaveWay.map((line) => [line.heroDefinition, line.needKey, line.reasonKey])).toEqual([
      [ids.bram, 'need.frontline', OutcomeReasonCodes.FalteredEarly],
      [ids.doran, 'need.frontline', OutcomeReasonCodes.FalteredEarly]
    ]);
  });

  it('reads the closing line’s reason off the grade, on an outcome that was taken', () => {
    // The other half of `ADR-015`'s rule. Without this case the mapping could be the
    // constant `ObjectiveLost` and the table above would still agree with it.
    const model = afterActionScreenModel(aCleanCampaign(), ids.caravan);

    expect(model.events.at(-1)?.key).toBe(OutcomeEventKeys.ContractResolved);
    expect(model.events.at(-1)?.reasonKey).toBe(OutcomeReasonCodes.ObjectiveTaken);
  });

  it('names the need a coverage line is about, and none where there is none', () => {
    const model = afterActionScreenModel(aTwoDeficitCampaign(), ids.crypt);

    expect(model.events.map((line) => line.needKey)).toEqual([
      'need.frontline',
      'need.wilderness',
      null,
      null,
      null,
      null
    ]);
  });
});

describe('what each hero brought', () => {
  it('shows what he brought beside how much of it counted', () => {
    // `DEC-014`'s two numbers, on the fixture where they differ. Each man brings
    // `expertise × grade / 100` to each of two needs — 50 from the weaker, 60 from the
    // stronger — and §4.3 halves whoever sorts second: 25 per need, so 50 across the
    // contract against the 100 he actually brought. The stronger man is halved by nothing
    // and his two numbers agree, which is what says the halving is read and not applied
    // to everybody.
    const model = afterActionScreenModel(aSharedNeedCampaign(), ids.caravan);

    expect(
      model.contributions.map((line) => [
        line.heroDefinition,
        line.heroDisplayNameKey,
        line.amount,
        line.counted
      ])
    ).toEqual([
      // The key comes from each hero's own `HeroState`, joined on his id — never one key
      // reused for the crew, which is what a screen would show if the join were dropped.
      [ids.bram, 'hero.core.bram.name', 100, 50],
      [ids.doran, 'hero.core.doran.name', 120, 120]
    ]);
  });

  it('adds the counted shares up rather than re-deriving them', () => {
    // The same claim from the other side: whatever the coverage rows say this hero's
    // shares were, the line is their sum. A model applying `2^k` for itself would have to
    // know the sort order of §4.3, which is exactly what `ADR-015` keeps out of this
    // layer.
    const state = aSharedNeedCampaign();
    const model = afterActionScreenModel(state, ids.caravan);
    const resolution = contractOf(state, ids.caravan).resolution!;

    for (const line of model.contributions) {
      const shares = resolution.coverage.flatMap((row) =>
        row.contributors.filter(
          (contributor) => line.heroDefinition === definitionOf(state, contributor.hero)
        )
      );

      expect(line.counted, line.heroDefinition).toBe(
        shares.reduce((sum, share) => sum + share.counted, 0)
      );
      expect(line.amount, line.heroDefinition).toBe(
        shares.reduce((sum, share) => sum + share.amount, 0)
      );
    }
  });

  it('says how willingly each man came, and says it per man', () => {
    // Three answers and three sentences (§2.4). Two fixtures rather than one, because a
    // crew that all came the same way would agree with a model that showed one constant:
    // the whole point of the field is that the men differ.
    expect(
      afterActionScreenModel(aSharedNeedCampaign(), ids.caravan).contributions.map(
        (line) => line.commitmentKey
      )
    ).toEqual(['commitment.committed', 'commitment.committed']);

    expect(
      afterActionScreenModel(aReluctantCampaign(), ids.caravan).contributions.map(
        (line) => line.commitmentKey
      )
    ).toEqual(['commitment.fragile', 'commitment.resentful']);
  });

  it('gives every contributor the outcome named its own provenance', () => {
    const model = afterActionScreenModel(aSharedNeedCampaign(), ids.caravan);

    for (const line of model.contributions) {
      expect(line.provenanceKeys.length, line.heroDefinition).toBeGreaterThan(0);
    }
  });

  it('leaves a man the outcome says nothing about with no provenance at all', () => {
    // The counterpart of the case above, and the reason it is not stated as a universal
    // law: a hero answerable for none of the contract's needs is named by no intent, so
    // there is nothing to attribute to him. A model that handed him the contract's own
    // reasons would be inventing a story about a man who did nothing.
    const model = afterActionScreenModel(aTwoDeficitCampaign(), ids.crypt);
    const idle = model.contributions.find((line) => line.heroDefinition === ids.doran);

    expect(idle?.provenanceKeys).toEqual([]);
  });
});

describe('coverage, deficits and consequences', () => {
  it('shows coverage qualitatively and never as a number', () => {
    const [first] = afterActionScreenModel(aTwoDeficitCampaign(), ids.crypt).coverage;

    expect(first).toEqual({ needKey: 'need.frontline', verdictKey: 'outcome.verdict.uncovered' });
    expect(first).not.toHaveProperty('supplied');
    expect(first).not.toHaveProperty('required');
  });

  it('refuses to name a leading cause when two diagnoses weigh the same', () => {
    const model = afterActionScreenModel(aTwoDeficitCampaign(), ids.crypt);

    expect(model.deficits.map((line) => [line.key, line.magnitude])).toEqual([
      ['outcome.deficit.capability_gap', 40],
      ['outcome.deficit.coverage_gap', 40]
    ]);
    expect(model.dominantKey).toBeNull();
  });

  it('names the leading cause when there is one', () => {
    // Without this case `dominantKey` could be the constant `null` and the table above
    // would agree with it.
    const model = afterActionScreenModel(aSharedNeedCampaign(), ids.caravan);

    expect(model.deficits).toHaveLength(1);
    expect(model.dominantKey).toBe('outcome.deficit.capability_gap');
  });

  it('keeps every source the stored deficit recorded', () => {
    const state = aTwoDeficitCampaign();
    const model = afterActionScreenModel(state, ids.crypt);
    const resolution = contractOf(state, ids.crypt).resolution!;

    expect(model.deficits).toHaveLength(resolution.deficits.length);

    for (const [index, deficit] of resolution.deficits.entries()) {
      expect(model.deficits[index]?.needKeys).toHaveLength(deficit.needs.length);
      expect(model.deficits[index]?.heroes).toHaveLength(deficit.heroes.length);
    }

    // Not only the counts: the capability gap is the front line, held by one man, and the
    // coverage gap is the wilderness, held by nobody at all — the shape §7's own table
    // calls "никто не отвечает за потребность".
    expect(model.deficits[0]?.needKeys).toEqual(['need.frontline']);
    expect(model.deficits[0]?.heroes.map((hero) => hero.definition)).toEqual([ids.bram]);
    expect(model.deficits[1]?.needKeys).toEqual(['need.wilderness']);
    expect(model.deficits[1]?.heroes).toEqual([]);
  });

  it('names a diagnosis’s heroes each under his own key', () => {
    // A crew that came unwillingly earns a second diagnosis whose sources are *both* men
    // (§4.7's `commitment_drag`), which is the only shape where one key reused for the
    // whole list would be visibly wrong.
    const model = afterActionScreenModel(aReluctantCampaign(), ids.caravan);

    expect(model.deficits.map((line) => line.key)).toEqual([
      'outcome.deficit.capability_gap',
      'outcome.deficit.commitment_drag'
    ]);
    expect(model.deficits[1]?.heroes).toEqual([
      { definition: ids.bram, displayNameKey: 'hero.core.bram.name' },
      { definition: ids.doran, displayNameKey: 'hero.core.doran.name' }
    ]);
    // A drag on the whole crew is about no need in particular (§4.7).
    expect(model.deficits[1]?.needKeys).toEqual([]);
  });

  it('gives every consequence a cause and a size', () => {
    const model = afterActionScreenModel(aTwoDeficitCampaign(), ids.crypt);

    expect(
      model.consequences.map((line) => [
        line.heroDefinition,
        line.kindKey,
        line.reasonKey,
        line.magnitude
      ])
    ).toEqual([
      [ids.bram, 'outcome.consequence.wound', OutcomeReasonCodes.WoundOnThePoint, 1],
      [ids.bram, 'outcome.consequence.trust_lost', OutcomeReasonCodes.TrustLostInDisaster, 1]
    ]);
  });

  it('names the man a consequence fell on under his own key', () => {
    // The wound goes to whoever carried the most of the worst-held need (§5.2), which here
    // is the *stronger* man — so the key on this line cannot be the crew's first.
    const model = afterActionScreenModel(aSharedNeedCampaign(), ids.caravan);

    expect(
      model.consequences.map((line) => [line.heroDefinition, line.heroDisplayNameKey])
    ).toEqual([[ids.doran, 'hero.core.doran.name']]);
  });

  it('names the step the outcome landed on', () => {
    expect(afterActionScreenModel(aCleanCampaign(), ids.caravan).gradeKey).toBe(
      'outcome.grade.clean'
    );
    expect(afterActionScreenModel(aTwoDeficitCampaign(), ids.crypt).gradeKey).toBe(
      'outcome.grade.disaster'
    );
  });

  it.each([
    ['a job done', aCleanCampaign, ids.caravan, 'outcome.grade.clean', 40],
    ['one survived', aSharedNeedCampaign, ids.caravan, 'outcome.grade.failed', 16],
    ['a catastrophe', aTwoDeficitCampaign, ids.crypt, 'outcome.grade.disaster', 0]
  ])(
    'pays the patron’s share for %s, not the whole fee',
    (_name, campaign, contractId, grade, patronPays) => {
      // `RESOLUTION_SPEC` §5.3: the patron pays 100 %, `PARTIAL_FEE_PERCENT` or nothing,
      // by the step the outcome landed on. All three contracts here carry the same fee of
      // 40, so the three figures below differ in nothing but the grade — a block that
      // credited the whole fee would agree with the first row and with neither other.
      const model = afterActionScreenModel(campaign(), contractId);

      expect(model.gradeKey).toBe(grade);
      expect(model.settlement?.patronPays).toBe(patronPays);
    }
  );

  it('truncates the patron’s share toward zero, like every division in the system', () => {
    // 43 at `PARTIAL_FEE_PERCENT` is 17.2, and §4.8 rounds toward zero — so 17. A fee
    // divisible by 100 would agree with any rounding rule at all, which is why the three
    // rows above cannot answer this on their own.
    const model = afterActionScreenModel(aPromisedCampaign(), ids.caravan);

    expect(model.gradeKey).toBe('outcome.grade.failed');
    expect(model.settlement?.patronPays).toBe(17);
  });

  it('prices both branches exactly as settleContract will settle them', () => {
    // The engine is the oracle here rather than a second copy of the formula written into
    // the expectation: the block's whole claim is "this is what pressing the button does".
    // The fixture promises a bonus of 10 on an advance of 5 a head, so the two branches
    // differ by the bonus and neither equals the treasury the campaign is standing on.
    const state = aPromisedCampaign();
    const model = afterActionScreenModel(state, ids.caravan);

    expect(model.settlement?.promisedBonus).toBe(10);
    expect(model.settlement?.treasuryIfKept).toBe(settled(state, ids.caravan, true).treasury);
    expect(model.settlement?.treasuryIfBroken).toBe(settled(state, ids.caravan, false).treasury);
    expect(model.settlement?.treasuryIfBroken).toBe((model.settlement?.treasuryIfKept ?? 0) + 10);
    expect(model.settlement?.treasuryIfKept).not.toBe(state.treasury);
  });

  it('names the crew and the key hero under their own keys', () => {
    const model = afterActionScreenModel(aPromisedCampaign(), ids.caravan);

    expect(model.settlement?.keyHero).toEqual({
      definition: ids.bram,
      displayNameKey: 'hero.core.bram.name'
    });
    expect(model.settlement?.crew).toEqual([
      { definition: ids.bram, displayNameKey: 'hero.core.bram.name' },
      { definition: ids.doran, displayNameKey: 'hero.core.doran.name' }
    ]);
  });

  it('offers no branch to choose once the contract is settled', () => {
    // The money has moved. A block still projecting two futures off the post-settlement
    // treasury would count the same payment twice — which is exactly what reusing the
    // offer screen's forecast here did before review found it.
    const state = aCleanCampaign();

    expect(afterActionScreenModel(state, ids.caravan).settlement).not.toBeNull();
    expect(
      afterActionScreenModel(settled(state, ids.caravan, true), ids.caravan).settlement
    ).toBeNull();
  });
});

function definitionOf(state: GameState, hero: number): ContentId {
  const found = state.heroes.values().find((candidate) => candidate.id === hero);

  if (found === undefined) {
    throw new Error(`No hero#${String(hero)} in this fixture.`);
  }

  return found.definition;
}
