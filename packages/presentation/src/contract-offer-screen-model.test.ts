import { OfferPhase } from '@oath-and-coin/simulation';
import { describe, expect, it } from 'vitest';

import {
  createContractOfferScreenModel,
  type ContractOfferScreenContent,
  type ContractLine,
  type HeroCard,
  type OfferLine,
  type PromiseTermsLine,
  type SettlementLine
} from './contract-offer-screen-model.ts';
import { QualitativeGrade } from './qualitative-scale.ts';
import { ScreenState } from './screen-state.ts';
import { TITLE_KEY } from './keys.ts';

const aContractLine: ContractLine = {
  definition: 'core:escort_the_caravan',
  displayNameKey: 'contract.core.escort_the_caravan.name',
  patronFee: 40,
  risk: QualitativeGrade.Moderate,
  tagKeys: [],
  requiredCrew: 2,
  acceptedCount: 0
};

const aHeroCard: HeroCard = {
  definition: 'core:bram',
  displayNameKey: 'hero.core.bram.name',
  greed: QualitativeGrade.Moderate,
  caution: QualitativeGrade.Low,
  pride: QualitativeGrade.Moderate,
  principleKeys: [],
  inclinationKeys: []
};

/** A minimal, legal `OfferLine` — no promise, no method chosen, no key hero yet. */
function anOfferLine(): OfferLine {
  return {
    version: 1,
    phase: OfferPhase.Draft,
    advance: 0,
    methodTagKey: null,
    methodOptionKeys: [],
    promisedBonus: 0,
    keyHeroDefinition: null,
    lockCommitment: 0
  };
}

function aModel(overrides: Partial<ContractOfferScreenContent> = {}): ContractOfferScreenContent {
  return {
    state: ScreenState.Normal,
    titleKey: TITLE_KEY,
    contract: aContractLine,
    roster: [aHeroCard],
    responses: [],
    errorCode: null,
    errorDetail: null,
    treasury: 400,
    offer: anOfferLine(),
    treasuryForecast: 400,
    promiseTerms: null,
    settlement: null,
    ...overrides
  };
}

/** A model with nothing to offer — the shape {@link anOfferLine} must never ride along on. */
function anEmptyModel(): ContractOfferScreenContent {
  return createContractOfferScreenModel(
    aModel({ state: ScreenState.Empty, contract: null, roster: [], offer: null })
  );
}

function aPromiseTermsLine(): PromiseTermsLine {
  return { fulfilKey: 'offer.promise.fulfil', breachKey: 'offer.promise.breach', bonus: 25 };
}

function aSettlementLine(): SettlementLine {
  return {
    promisedBonus: 25,
    keyHeroDefinition: 'core:bram',
    crew: ['core:bram'],
    treasuryIfKept: 400,
    treasuryIfBroken: 425
  };
}

describe('the combinations a screen model refuses', () => {
  it('accepts the five states with the fields each of them owns', () => {
    expect(() => createContractOfferScreenModel(aModel())).not.toThrow();
    expect(() =>
      createContractOfferScreenModel(aModel({ state: ScreenState.Incomplete }))
    ).not.toThrow();
    expect(() =>
      createContractOfferScreenModel(
        aModel({ state: ScreenState.Loading, contract: null, roster: [], offer: null })
      )
    ).not.toThrow();
    expect(() =>
      createContractOfferScreenModel(
        aModel({ state: ScreenState.Empty, contract: null, roster: [], offer: null })
      )
    ).not.toThrow();
    expect(() =>
      createContractOfferScreenModel(
        aModel({
          state: ScreenState.Error,
          contract: null,
          roster: [],
          offer: null,
          errorCode: 'CONTENT_ROOT_NOT_FOUND',
          errorDetail: 'no such directory'
        })
      )
    ).not.toThrow();
  });

  it('refuses a detail with no error to detail', () => {
    expect(() => createContractOfferScreenModel(aModel({ errorDetail: 'orphan' }))).toThrow(
      /orphaned string/u
    );
  });

  it('refuses an Error screen with no code', () => {
    expect(() =>
      createContractOfferScreenModel(
        aModel({ state: ScreenState.Error, contract: null, roster: [] })
      )
    ).toThrow(/errorCode must be set/u);
  });

  it.each([ScreenState.Loading, ScreenState.Empty, ScreenState.Incomplete, ScreenState.Normal])(
    'refuses an error code on a %s screen',
    (state) => {
      const contract =
        state === ScreenState.Loading || state === ScreenState.Empty ? null : aContractLine;
      const roster = contract === null ? [] : [aHeroCard];

      expect(() =>
        createContractOfferScreenModel(
          aModel({ state, contract, roster, errorCode: 'SCHEMA_INVALID', errorDetail: 'bad field' })
        )
      ).toThrow(/errorCode must be null/u);
    }
  );

  it.each([ScreenState.Loading, ScreenState.Empty])(
    'refuses a roster carried over onto a %s screen',
    (state) => {
      // The failure this is about: a screen with nothing to offer showing the roster of
      // some earlier offer, which reads to a player as a live table.
      expect(() => createContractOfferScreenModel(aModel({ state, contract: null }))).toThrow(
        /must all be empty/u
      );
    }
  );

  it('refuses an Error screen carrying a contract', () => {
    expect(() =>
      createContractOfferScreenModel(
        aModel({
          state: ScreenState.Error,
          roster: [],
          errorCode: 'CONTENT_INVALID',
          errorDetail: 'duplicate id'
        })
      )
    ).toThrow(/must all be empty/u);
  });

  it.each([ScreenState.Incomplete, ScreenState.Normal])(
    'refuses a %s screen with nothing on offer',
    (state) => {
      expect(() => createContractOfferScreenModel(aModel({ state, contract: null }))).toThrow(
        /nothing to offer/u
      );
    }
  );

  it('refuses a state outside the five', () => {
    // Reachable from JSON that crossed a process boundary, which is exactly where a
    // sixth spelling would arrive from.
    expect(() => createContractOfferScreenModel(aModel({ state: 'Blank' as never }))).toThrow(
      /Unknown screen state/u
    );
  });

  it('refuses a model that carries an offer with no contract', () => {
    // The same failure shape `requireNoContractContent` already refused for a roster
    // riding along on an Empty screen (above) — an offer from some earlier contract is
    // exactly the same kind of leftover.
    expect(() =>
      createContractOfferScreenModel({ ...anEmptyModel(), offer: anOfferLine() })
    ).toThrow(/offer/u);
  });

  it('refuses a model that carries promise terms with no contract', () => {
    // External review found this half of `requireNoContractContent`'s new check
    // entirely unpinned: the test above only ever sets `offer`, so a mutant deleting
    // just the `promiseTerms` clause left every test green.
    expect(() =>
      createContractOfferScreenModel({ ...anEmptyModel(), promiseTerms: aPromiseTermsLine() })
    ).toThrow(/promiseTerms/u);
  });

  it('refuses a model that carries a settlement with no contract', () => {
    // Same gap, the third field.
    expect(() =>
      createContractOfferScreenModel({ ...anEmptyModel(), settlement: aSettlementLine() })
    ).toThrow(/settlement/u);
  });

  it.each([ScreenState.Incomplete, ScreenState.Normal])(
    'refuses a %s screen with a contract and no offer',
    (state) => {
      // External review found this check unpinned too: every other test that reaches
      // this branch goes through `aModel()`'s own default `offer: anOfferLine()`, so a
      // mutant deleting the whole check left every test in this file green.
      expect(() => createContractOfferScreenModel(aModel({ state, offer: null }))).toThrow(
        /offer must not be null/u
      );
    }
  );
});
