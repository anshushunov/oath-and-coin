import { describe, expect, it } from 'vitest';

import { OfferPhase, ReasonCodes } from '@oath-and-coin/simulation';

import {
  createContractOfferScreenModel,
  type ContractOfferScreenModel
} from './contract-offer-screen-model.ts';
import { LOADING_SCREEN, failedScreen } from './contract-offer-screen-model-factory.ts';
import { TITLE_KEY } from './keys.ts';
import { QualitativeGrade } from './qualitative-scale.ts';
import { ReasonDirection, ScreenState } from './screen-state.ts';
import { expectedSnapshot, snapshotHash } from './rendered-ui-snapshot.ts';

/**
 * A catalogue that answers every key with the key itself, prefixed. The prefix is what
 * makes the tests below able to tell a *resolved* text from a raw key that leaked
 * through unresolved — with an identity catalogue the two would be the same string and
 * the assertions would pass over the very defect they are about.
 */
function catalogueFor(keys: readonly string[]): ReadonlyMap<string, string> {
  return new Map(keys.map((key) => [key, `text(${key})`]));
}

function everyKeyOf(model: ContractOfferScreenModel): ReadonlyMap<string, string> {
  // Built by asking the snapshot which keys it wants, one missing key at a time. That
  // is circular for the *content* of the list and honest for its purpose here: these
  // tests are about order and about what is excluded, and a separate hand-written key
  // list would just be a second copy of the projection.
  const keys: string[] = [];

  for (;;) {
    try {
      expectedSnapshot(model, catalogueFor(keys));
      return catalogueFor(keys);
    } catch (cause) {
      const match = /key '([^']+)'/u.exec(cause instanceof Error ? cause.message : '');

      if (match?.[1] === undefined || keys.includes(match[1])) {
        throw cause;
      }

      keys.push(match[1]);
    }
  }
}

/**
 * A model that reaches every branch of the projection at once.
 *
 * Deliberately richer than the screen a single scenario produces, and that richness is
 * the point. The first version of this fixture had one hero with no inclinations, one
 * response with no block and no tie-break — so deleting the whole `inclinationKeys`
 * branch from `expectedSnapshot` left the order assertion below passing, and external
 * review reproduced exactly that. A branch not exercised by the order assertion is a
 * binding this test cannot notice going missing.
 *
 * Every optional branch therefore appears: a contract with tags, a hero with both
 * principles and inclinations, a hero with neither, a reason whose source is named, a
 * reason whose source is not, a blocked response and a response settled by a
 * tie-break.
 */
const aFullModel = createContractOfferScreenModel({
  state: ScreenState.Normal,
  titleKey: TITLE_KEY,
  contract: {
    definition: 'core:escort_the_caravan',
    displayNameKey: 'contract.core.escort_the_caravan.name',
    patronFee: 40,
    risk: QualitativeGrade.Moderate,
    tagKeys: ['tag.patron.merchant_guild', 'tag.target.bandits'],
    requiredCrew: 4,
    acceptedCount: 3
  },
  roster: [
    {
      definition: 'core:bram',
      displayNameKey: 'hero.core.bram.name',
      greed: QualitativeGrade.Moderate,
      caution: QualitativeGrade.Low,
      pride: QualitativeGrade.Moderate,
      principleKeys: ['trait.core.will_not_strike_a_temple.name'],
      inclinationKeys: ['trait.core.hates_the_cult.name', 'trait.core.hungry_for_renown.name']
    },
    {
      // A hero with neither list, so the "no caption over an empty list" rule is
      // exercised by the same walk that checks the order.
      definition: 'core:doran',
      displayNameKey: 'hero.core.doran.name',
      greed: QualitativeGrade.High,
      caution: QualitativeGrade.Negligible,
      pride: QualitativeGrade.Extreme,
      principleKeys: [],
      inclinationKeys: []
    }
  ],
  responses: [
    {
      heroDefinition: 'core:bram',
      heroDisplayNameKey: 'hero.core.bram.name',
      action: 'action:accept',
      reasons: [
        {
          reasonCode: ReasonCodes.PersonalConviction,
          sourceEntity: 'core:loyal_to_the_merchant_guild',
          strength: QualitativeGrade.Low,
          sourceDisplayNameKey: 'trait.core.loyal_to_the_merchant_guild.name',
          direction: ReasonDirection.Supported
        },
        {
          // Source deliberately unnamed: the contract is already on the screen under
          // its own key, so naming it again would repeat rather than explain.
          reasonCode: ReasonCodes.RiskTooHigh,
          sourceEntity: 'core:escort_the_caravan',
          strength: QualitativeGrade.High,
          sourceDisplayNameKey: null,
          direction: ReasonDirection.Opposed
        }
      ],
      blockedByEntity: null,
      blockedByDisplayNameKey: null,
      tieBreakCode: null,
      wavered: true
    },
    {
      heroDefinition: 'core:doran',
      heroDisplayNameKey: 'hero.core.doran.name',
      action: 'action:decline',
      reasons: [],
      blockedByEntity: 'core:will_not_serve_slavers',
      blockedByDisplayNameKey: 'trait.core.will_not_serve_slavers.name',
      tieBreakCode: null,
      wavered: false
    },
    {
      heroDefinition: 'core:bram',
      heroDisplayNameKey: 'hero.core.bram.name',
      action: 'action:accept',
      reasons: [],
      blockedByEntity: null,
      blockedByDisplayNameKey: null,
      tieBreakCode: ReasonCodes.NoReasonToRefuse,
      wavered: false
    }
  ],
  errorCode: null,
  errorDetail: null,
  // The negotiation fields (`DEC-008` Task 15) are not part of this file's own
  // question — nothing here walks or resolves them yet, that is Tasks 16-17's — so a
  // minimal, legal offer exercises no branch of the projection this file did not
  // already exercise before those fields existed.
  treasury: 400,
  offer: {
    version: 1,
    phase: OfferPhase.Draft,
    advance: 0,
    methodTagKey: null,
    methodOptionKeys: [],
    promisedBonus: 0,
    keyHeroDefinition: null
  },
  treasuryForecast: 400,
  promiseTerms: null,
  settlement: null
});

describe('the texts a correctly bound screen produces', () => {
  it('opens with the title and the screen state, on every state', () => {
    for (const model of [LOADING_SCREEN, failedScreen('SCHEMA_INVALID', 'bad field'), aFullModel]) {
      const texts = expectedSnapshot(model, everyKeyOf(model));

      expect(texts[0]).toBe(`text(${TITLE_KEY})`);
      expect(texts[1]).toBe(`text(screen.contract_offer.state.${model.state.toLowerCase()})`);
    }
  });

  it('tells Loading and Empty apart, which carry no other content at all', () => {
    const empty = createContractOfferScreenModel({
      state: ScreenState.Empty,
      titleKey: TITLE_KEY,
      contract: null,
      roster: [],
      responses: [],
      errorCode: null,
      errorDetail: null,
      treasury: 0,
      offer: null,
      treasuryForecast: 0,
      promiseTerms: null,
      settlement: null
    });

    const loadingTexts = expectedSnapshot(LOADING_SCREEN, everyKeyOf(LOADING_SCREEN));
    const emptyTexts = expectedSnapshot(empty, everyKeyOf(empty));

    // Without the state text these two would be byte-identical frames distinguished
    // only by a hidden model field.
    expect(loadingTexts).not.toEqual(emptyTexts);
    expect(snapshotHash(loadingTexts)).not.toBe(snapshotHash(emptyTexts));
  });

  it('walks title, state, error, contract, roster, then responses', () => {
    const texts = expectedSnapshot(aFullModel, everyKeyOf(aFullModel));

    // Every optional branch of the projection is in this list, which is what makes it
    // able to notice one going missing. Deleting any single `resolve` from
    // `expectedSnapshot` removes a line here.
    expect(texts).toEqual([
      'text(screen.contract_offer.title)',
      'text(screen.contract_offer.state.normal)',
      'text(contract.core.escort_the_caravan.name)',
      'text(field.contract.patron_fee)',
      '40',
      'text(field.contract.risk)',
      'text(qualitative.moderate)',
      'text(field.contract.required_crew)',
      '4',
      'text(field.contract.accepted_count)',
      '3',
      'text(field.contract.tags)',
      'text(tag.patron.merchant_guild)',
      'text(tag.target.bandits)',
      'text(hero.core.bram.name)',
      'text(field.hero.greed)',
      'text(qualitative.moderate)',
      'text(field.hero.caution)',
      'text(qualitative.low)',
      'text(field.hero.pride)',
      'text(qualitative.moderate)',
      'text(field.hero.principles)',
      'text(trait.core.will_not_strike_a_temple.name)',
      'text(field.hero.inclinations)',
      'text(trait.core.hates_the_cult.name)',
      'text(trait.core.hungry_for_renown.name)',
      'text(hero.core.doran.name)',
      'text(field.hero.greed)',
      'text(qualitative.high)',
      'text(field.hero.caution)',
      'text(qualitative.negligible)',
      'text(field.hero.pride)',
      'text(qualitative.extreme)',
      'text(hero.core.bram.name)',
      'text(action.accept)',
      'text(hero.decision.personal_conviction)',
      'text(trait.core.loyal_to_the_merchant_guild.name)',
      'text(reason.direction.supported)',
      'text(field.reason.strength)',
      'text(qualitative.low)',
      'text(hero.decision.risk_too_high)',
      'text(reason.direction.opposed)',
      'text(field.reason.strength)',
      'text(qualitative.high)',
      'text(response.wavered.true)',
      'text(hero.core.doran.name)',
      'text(action.decline)',
      'text(field.response.blocked_by)',
      'text(trait.core.will_not_serve_slavers.name)',
      'text(response.wavered.false)',
      'text(hero.core.bram.name)',
      'text(action.accept)',
      'text(hero.decision.no_reason_to_refuse)',
      'text(response.wavered.false)'
    ]);
  });

  it('resolves every key the model carries, and shows no key the model does not', () => {
    // The independent half of the assertion above. That one states an order; this one
    // states coverage — every key on the model reaches the frame exactly as many times
    // as the model carries it. A dropped binding fails both, and a binding added to
    // the projection without a model field behind it fails this one.
    const texts = expectedSnapshot(aFullModel, everyKeyOf(aFullModel));
    const shown = texts.filter((text) => text.startsWith('text(')).map((text) => text.slice(5, -1));

    for (const key of [
      aFullModel.contract!.displayNameKey,
      ...aFullModel.contract!.tagKeys,
      ...aFullModel.roster.flatMap((hero) => [
        hero.displayNameKey,
        ...hero.principleKeys,
        ...hero.inclinationKeys
      ]),
      ...aFullModel.responses.flatMap((response) => [
        response.heroDisplayNameKey,
        ...response.reasons.flatMap((reason) => [
          reason.reasonCode,
          ...(reason.sourceDisplayNameKey === null ? [] : [reason.sourceDisplayNameKey])
        ]),
        ...(response.blockedByDisplayNameKey === null ? [] : [response.blockedByDisplayNameKey]),
        ...(response.tieBreakCode === null ? [] : [response.tieBreakCode])
      ])
    ]) {
      expect(shown, `the frame must resolve '${key}'`).toContain(key);
    }
  });

  it('shows the three objective numbers literally and nothing else unresolved', () => {
    const texts = expectedSnapshot(aFullModel, everyKeyOf(aFullModel));
    const literals = texts.filter((text) => !text.startsWith('text('));

    // Payment, required crew, accepted count — the values spec keeps as numbers on
    // purpose. Any fourth literal is a key or an identifier that escaped resolution.
    expect(literals).toEqual(['40', '4', '3']);
  });

  it('keeps every raw content id off the screen', () => {
    const texts = expectedSnapshot(aFullModel, everyKeyOf(aFullModel)).join('\u001f');

    for (const identifier of [
      'core:escort_the_caravan',
      'core:bram',
      'core:loyal_to_the_merchant_guild',
      'action:accept'
    ]) {
      expect(texts).not.toContain(identifier);
    }
  });

  it('never draws a caption over an empty list', () => {
    const withoutLists = createContractOfferScreenModel({
      ...aFullModel,
      contract: { ...aFullModel.contract!, tagKeys: [] },
      roster: aFullModel.roster.map((hero) => ({
        ...hero,
        principleKeys: [],
        inclinationKeys: []
      }))
    });

    const texts = expectedSnapshot(withoutLists, everyKeyOf(withoutLists));

    expect(texts).not.toContain('text(field.contract.tags)');
    expect(texts).not.toContain('text(field.hero.principles)');
    expect(texts).not.toContain('text(field.hero.inclinations)');
  });

  it('shows the error key and never the detail', () => {
    const model = failedScreen('CONTENT_ROOT_NOT_FOUND', "Content root 'C:/nope' does not exist.");
    const texts = expectedSnapshot(model, everyKeyOf(model));

    expect(texts).toContain('text(error.content_root_not_found)');
    expect(texts.join(' ')).not.toContain('C:/nope');
  });

  it('refuses to describe a model no screen could draw', () => {
    // The C# original enforced its cross-field rules from `init` accessors, so a `with`
    // expression re-ran them and a copy could not weaken them. A TypeScript spread has
    // no such property, and external review reproduced the consequence: this exact
    // value is a Normal screen with nothing on offer, and it produced a snapshot and a
    // hash without complaint. Both places a model becomes evidence now re-validate.
    const impossible = { ...LOADING_SCREEN, state: ScreenState.Normal };

    expect(() => expectedSnapshot(impossible, everyKeyOf(LOADING_SCREEN))).toThrow(
      /nothing to offer/u
    );
  });

  it('fails loudly on a key the catalogue does not carry', () => {
    // The alternative — showing the key — is a player-facing string nobody wrote, and
    // it is exactly what a screen looks like when a translation was forgotten.
    expect(() => expectedSnapshot(LOADING_SCREEN, new Map())).toThrow(/no entry for key/u);
  });
});

describe('the snapshot hash', () => {
  it('separates the texts, so a boundary cannot move unnoticed', () => {
    // Without the separator "ab" + "c" and "a" + "bc" hash the same, and two labels
    // whose content shifted from one to the other would compare equal.
    expect(snapshotHash(['ab', 'c'])).not.toBe(snapshotHash(['a', 'bc']));
  });

  it('depends on order', () => {
    expect(snapshotHash(['a', 'b'])).not.toBe(snapshotHash(['b', 'a']));
  });

  it('distinguishes an empty list from a list holding one empty text', () => {
    expect(snapshotHash([])).not.toBe(snapshotHash(['']));
  });
});
