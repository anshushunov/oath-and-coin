import { CommitmentState, NeedId } from '@oath-and-coin/simulation';
import { describe, expect, it } from 'vitest';

import {
  AFTER_ACTION_LOADING_SCREEN,
  afterActionFailedScreen,
  afterActionScreenModel,
  createAfterActionScreenModel,
  type AfterActionScreenModel
} from './after-action-screen-model.ts';
import {
  CONTRACT_BOARD_LOADING_SCREEN,
  contractBoardFailedScreen,
  contractBoardScreenModel,
  createContractBoardScreenModel,
  type ContractBoardScreenModel
} from './contract-board-screen-model.ts';
import { LOADING_SCREEN, contractOfferScreenModel } from './contract-offer-screen-model-factory.ts';
import {
  createContractOfferScreenModel,
  type ContractOfferScreenModel
} from './contract-offer-screen-model.ts';
import { expectedSnapshot } from './rendered-ui-snapshot.ts';
import { SCREEN_KINDS, ScreenKind } from './screen-kind.ts';
import { describeReadModel, readModelHash, type ScreenModel } from './screen-model.ts';
import {
  aCapableHero,
  aCrewedContract,
  aResolvedCampaign,
  aState,
  aStep,
  ids,
  withContracts,
  withHeroes
} from './testing/fixtures.ts';

/**
 * The union the session shows one of.
 *
 * The three models below are real ones — built by their own factories out of a campaign the
 * engine resolved — because what this file is about is whether the *readers* of the union
 * answer for all three, and a hand-built model would let a reader agree with a shape no
 * factory produces.
 */

const soldier = aCapableHero({
  id: 0,
  definition: ids.bram,
  grade: 100,
  expertise: [
    [NeedId.Frontline, 100],
    [NeedId.Wilderness, 100]
  ]
});

/**
 * Two men on one contract at different grades, so §4.3's halving is visible: the stronger
 * counts whole and the weaker, sorting second, counts a half.
 *
 * The debrief snapshot is walked over this rather than over the single-hero campaign below,
 * and that is not a preference: with one man `amount` and `counted` are the same number, so
 * a walk that emitted the first of them twice would produce an identical list.
 */
function anUnequalState() {
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

/** {@link anUnequalState}'s crew, on a package that promised the key hero a bonus. */
function aPromisedState() {
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
        promisedBonus: 12,
        crew: [
          { hero: weaker, commitment: CommitmentState.Committed },
          { hero: stronger, commitment: CommitmentState.Committed }
        ]
      })
    ]
  });
}

function aResolvedState() {
  return aResolvedCampaign({
    heroes: [soldier],
    contracts: [
      aCrewedContract({
        id: ids.caravan,
        needs: [
          [NeedId.Frontline, 40],
          [NeedId.Wilderness, 40]
        ],
        risk: 0,
        crew: [{ hero: soldier, commitment: CommitmentState.Committed }]
      })
    ]
  });
}

function everyScreen(): readonly ScreenModel[] {
  const resolved = aResolvedState();

  return [
    contractOfferScreenModel(withHeroes(aState(), [soldier]), [aStep()]),
    afterActionScreenModel(resolved, ids.caravan),
    contractBoardScreenModel(resolved)
  ];
}

/** The three constants and the three refusals, one of each kind. */
function everyScreenWithNoCampaign(): readonly ScreenModel[] {
  return [
    LOADING_SCREEN,
    AFTER_ACTION_LOADING_SCREEN,
    CONTRACT_BOARD_LOADING_SCREEN,
    afterActionFailedScreen('CONTENT_ROOT_NOT_FOUND', 'nowhere'),
    contractBoardFailedScreen('CONTENT_ROOT_NOT_FOUND', 'nowhere')
  ];
}

const catalogue = new Map(
  ['screen.contract_offer.title', 'screen.after_action.title', 'screen.contract_board.title'].map(
    (key) => [key, key]
  )
);

/** The three models' own content, without the field their gates stamp. */
function offerContent() {
  const { screen, ...content } = everyScreen()[0] as ContractOfferScreenModel;
  void screen;

  return content;
}

function afterActionContent() {
  const { screen, ...content } = everyScreen()[1] as AfterActionScreenModel;
  void screen;

  return content;
}

function boardContent() {
  const { screen, ...content } = everyScreen()[2] as ContractBoardScreenModel;
  void screen;

  return content;
}

describe('the discriminant', () => {
  it('is stamped by each factory and never by a caller', () => {
    expect(everyScreen().map((model) => model.screen)).toEqual([
      ScreenKind.ContractOffer,
      ScreenKind.AfterAction,
      ScreenKind.ContractBoard
    ]);
  });

  it('overrides a discriminant a caller tried to supply', () => {
    // The claim above is "no caller supplies it", and on its own it is satisfied by a
    // factory that merely *defaults* the field — `{ screen: ScreenKind.X, ...model }`
    // typechecks, reads identically at a glance, and lets whatever the caller passed win.
    // Each gate takes a variable here rather than an object literal, which is what makes
    // the excess property legal to pass and the question worth asking.
    const foreign = { screen: ScreenKind.ContractBoard } as unknown as Record<string, never>;

    expect(createContractOfferScreenModel({ ...offerContent(), ...foreign }).screen).toBe(
      ScreenKind.ContractOffer
    );
    expect(createAfterActionScreenModel({ ...afterActionContent(), ...foreign }).screen).toBe(
      ScreenKind.AfterAction
    );
    expect(createContractBoardScreenModel({ ...boardContent(), ...foreign }).screen).toBe(
      ScreenKind.ContractBoard
    );
  });

  it('survives a spread of a finished model back through its own gate', () => {
    // The other half: a model that has already been stamped is re-validated in two places
    // (the projection and the snapshot walk), and a spread of it carries the field along.
    // A gate that dropped it there would leave those two readers narrowing on `undefined`.
    const [offer, debrief, board] = everyScreen();

    expect(createContractOfferScreenModel({ ...offer! } as never).screen).toBe(
      ScreenKind.ContractOffer
    );
    expect(createAfterActionScreenModel({ ...debrief! } as never).screen).toBe(
      ScreenKind.AfterAction
    );
    expect(createContractBoardScreenModel({ ...board! } as never).screen).toBe(
      ScreenKind.ContractBoard
    );
  });

  it('names one screen per kind the union declares', () => {
    // Not "three": how many screens there are is `SCREEN_KINDS`, and a fourth added to the
    // union without a model here would leave this file measuring two thirds of it.
    expect(new Set(everyScreen().map((model) => model.screen))).toEqual(new Set(SCREEN_KINDS));
  });
});

describe('the read-model hash', () => {
  it('answers for every model of the union', () => {
    for (const model of [...everyScreen(), ...everyScreenWithNoCampaign()]) {
      expect(readModelHash(model), model.screen).toMatch(/^[0-9a-f]{64}$/u);
    }
  });

  it('carries the screen’s own name inside the projection it hashes', () => {
    // The one field that keeps two screens with identical content apart. Asserted on the
    // projection rather than only through the hash: a hash comparison passes as soon as
    // *anything* differs, and on real models plenty does — the title alone would carry it.
    for (const model of [...everyScreen(), ...everyScreenWithNoCampaign()]) {
      expect(describeReadModel(model)).toHaveProperty('screen', model.screen);
    }
  });

  it('does not collide across the three screens', () => {
    const hashes = [...everyScreen(), ...everyScreenWithNoCampaign()].map(readModelHash);

    expect(new Set(hashes).size).toBe(hashes.length);
  });

  it('still distinguishes two screens of one kind that differ only in state', () => {
    // The property the frozen corpus already rests on, restated over the union: adding the
    // screen's name to the projection must not have made the state redundant.
    expect(readModelHash(AFTER_ACTION_LOADING_SCREEN)).not.toBe(
      readModelHash(afterActionFailedScreen('CONTENT_ROOT_NOT_FOUND', 'nowhere'))
    );
  });
});

describe('the rendered-UI snapshot', () => {
  it('answers for every model of the union, and says something on each', () => {
    for (const model of everyScreen()) {
      expect(expectedSnapshot(model, fullCatalogue(model)).length, model.screen).toBeGreaterThan(0);
    }
  });

  it('walks the debrief in the order §6.1 lists it, and names every bare number', () => {
    // The list a correctly bound debrief must produce, key by key — the thing the screen
    // of task 7 will be compared against. A walk that dropped a section, or put a number
    // on the page with nothing naming it, agrees with "length > 0" and fails here.
    //
    // The catalogue answers every key with the key itself, so what this asserts is the
    // walk and not the translations; that the shipped texts exist at all is `tests/locale`,
    // where both catalogues are visible at once.
    const model = afterActionScreenModel(anUnequalState(), ids.caravan);

    // The weaker man brings 100 across two needs and 50 of it counts; the stronger brings
    // 120 and all of it does (§4.3). A walk that emitted `amount` in both places would be
    // invisible on any crew of one, which is why this case has two.
    //
    // The run came out `Failed`, so the patron pays `PARTIAL_FEE_PERCENT` of 40 — 16 — and
    // the treasury the block projects is the campaign's 400 plus that. Nothing was
    // promised, so keeping the word and breaking it come to the same figure.
    expect(expectedSnapshot(model, identityCatalogue(model))).toEqual([
      'screen.after_action.title',
      'screen.after_action.state.incomplete',
      'contract.core.escort_the_caravan.name',
      'field.after_action.grade',
      'outcome.grade.failed',
      'field.after_action.events',
      'outcome.event.need_short',
      'need.frontline',
      'outcome.need_weak',
      'outcome.event.need_short',
      'need.wilderness',
      'outcome.need_weak',
      'outcome.event.objective_lost',
      'outcome.objective_lost',
      'outcome.event.hero_suffered_consequence',
      'hero.core.doran.name',
      'outcome.wound_on_the_point',
      'outcome.event.contract_resolved',
      'outcome.objective_lost',
      'field.after_action.contributions',
      'hero.core.bram.name',
      'field.after_action.brought',
      '100',
      'field.after_action.counted',
      '50',
      'field.after_action.commitment',
      'commitment.committed',
      'field.after_action.provenance',
      'outcome.need_weak',
      'hero.core.doran.name',
      'field.after_action.brought',
      '120',
      'field.after_action.counted',
      '120',
      'field.after_action.commitment',
      'commitment.committed',
      'field.after_action.provenance',
      'outcome.need_weak',
      'outcome.wound_on_the_point',
      'field.after_action.coverage',
      'need.frontline',
      'outcome.verdict.weak',
      'need.wilderness',
      'outcome.verdict.weak',
      'field.after_action.deficits',
      'outcome.deficit.capability_gap',
      'field.after_action.deficit_magnitude',
      '24',
      'need.frontline',
      'need.wilderness',
      'hero.core.bram.name',
      'hero.core.doran.name',
      'field.after_action.dominant',
      'outcome.deficit.capability_gap',
      'field.after_action.consequences',
      'hero.core.doran.name',
      'outcome.consequence.wound',
      'outcome.wound_on_the_point',
      'field.after_action.consequence_magnitude',
      '1',
      'field.after_action.patron_pays',
      '16',
      'field.offer.promised_bonus',
      '0',
      'field.offer.key_hero',
      'hero.core.bram.name',
      'field.settlement.crew',
      'hero.core.bram.name',
      'hero.core.doran.name',
      'field.settlement.treasury_if_kept',
      '416',
      // No consequence between the figure and the button: nothing was promised, so
      // `settleContract` ignores `pay` and there is no grievance to warn anybody about
      // (`NEGOTIATION_SPEC` §6). The buttons stay — the command still has to be sent.
      'settlement.pay',
      'field.settlement.treasury_if_broken',
      '416',
      'settlement.refuse'
    ]);
  });

  it('puts each branch of a real promise beside the button that chooses it', () => {
    // The same walk on the case the one above cannot reach: a package that promised
    // something. Each branch is a treasury, what it costs beyond the treasury and its own
    // control — the layout `RESOLUTION_SPEC` §6.1 asks for, since two bare numbers side by
    // side do not say that one of them costs a man's trust.
    const model = afterActionScreenModel(aPromisedState(), ids.caravan);

    expect(expectedSnapshot(model, identityCatalogue(model)).slice(-9)).toEqual([
      'field.settlement.treasury_if_kept',
      String(model.settlement?.treasuryIfKept),
      'settlement.consequence.kept',
      'settlement.pay',
      'field.settlement.treasury_if_broken',
      String(model.settlement?.treasuryIfBroken),
      'settlement.consequence.broken_grievance',
      'settlement.consequence.broken_disbelief',
      'settlement.refuse'
    ]);
  });

  it('walks a board row with its fee, its seats, what it asks for and how far it has got', () => {
    const model = contractBoardScreenModel(aResolvedState());

    expect(expectedSnapshot(model, identityCatalogue(model))).toEqual([
      'screen.contract_board.title',
      'screen.contract_board.state.incomplete',
      'field.treasury',
      '400',
      'contract.core.escort_the_caravan.name',
      'field.contract.patron_fee',
      '40',
      'field.contract.required_crew',
      '1',
      'field.board.needs',
      'need.frontline',
      'need.wilderness',
      'field.board.availability',
      'board.availability.resolved'
    ]);
  });

  it('refuses a key the catalogue has no text for, on every screen', () => {
    // A missing translation fails loudly rather than letting a raw key reach a label — the
    // rule `resolveText` keeps, checked on all three walks rather than on the one that had
    // it before the union existed.
    for (const model of everyScreen()) {
      expect(() => expectedSnapshot(model, catalogue), model.screen).toThrow(/no entry for key/u);
    }
  });
});

/**
 * A catalogue answering every key `model` can ask for, with the key itself.
 *
 * Enough for "does this walk produce anything at all", which is what the union owes; that
 * the *texts* are the shipped ones is `tests/locale`'s claim and is made over both
 * catalogues at once, where both sides of the boundary are visible.
 */
function identityCatalogue(model: ScreenModel): ReadonlyMap<string, string> {
  return new Map([...fullCatalogue(model).keys()].map((key) => [key, key]));
}

function fullCatalogue(model: ScreenModel): ReadonlyMap<string, string> {
  const answered = new Map<string, string>();

  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      expectedSnapshot(model, answered);

      return answered;
    } catch (cause) {
      const missing = /key '([^']+)'/u.exec(cause instanceof Error ? cause.message : '');

      if (missing?.[1] === undefined) {
        throw cause;
      }

      answered.set(missing[1], `текст для ${missing[1]}`);
    }
  }

  throw new Error(`Could not satisfy the catalogue for '${model.screen}' in 200 attempts.`);
}

describe('a campaign with nothing on its board', () => {
  it('is an Empty board rather than a board of no rows under some other state', () => {
    const board = contractBoardScreenModel(withContracts(aState(), []));

    expect(board.screen).toBe(ScreenKind.ContractBoard);
    expect(readModelHash(board)).not.toBe(readModelHash(CONTRACT_BOARD_LOADING_SCREEN));
  });
});
