import { describe, expect, it } from 'vitest';

import { ReasonCodes } from '@oath-and-coin/simulation';

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

const aFullModel = createContractOfferScreenModel({
  state: ScreenState.Normal,
  titleKey: TITLE_KEY,
  contract: {
    definition: 'core:escort_the_caravan',
    displayNameKey: 'contract.core.escort_the_caravan.name',
    payment: 40,
    risk: QualitativeGrade.Moderate,
    tagKeys: ['tag.patron.merchant_guild'],
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
        }
      ],
      blockedByEntity: null,
      blockedByDisplayNameKey: null,
      tieBreakCode: null,
      wavered: false
    }
  ],
  errorCode: null,
  errorDetail: null
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
      errorDetail: null
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

    expect(texts).toEqual([
      'text(screen.contract_offer.title)',
      'text(screen.contract_offer.state.normal)',
      'text(contract.core.escort_the_caravan.name)',
      'text(field.contract.payment)',
      '40',
      'text(field.contract.risk)',
      'text(qualitative.moderate)',
      'text(field.contract.required_crew)',
      '4',
      'text(field.contract.accepted_count)',
      '3',
      'text(field.contract.tags)',
      'text(tag.patron.merchant_guild)',
      'text(hero.core.bram.name)',
      'text(field.hero.greed)',
      'text(qualitative.moderate)',
      'text(field.hero.caution)',
      'text(qualitative.low)',
      'text(field.hero.pride)',
      'text(qualitative.moderate)',
      'text(field.hero.principles)',
      'text(trait.core.will_not_strike_a_temple.name)',
      'text(hero.core.bram.name)',
      'text(action.accept)',
      'text(hero.decision.personal_conviction)',
      'text(trait.core.loyal_to_the_merchant_guild.name)',
      'text(reason.direction.supported)',
      'text(field.reason.strength)',
      'text(qualitative.low)',
      'text(response.wavered.false)'
    ]);
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
    const withoutTags = createContractOfferScreenModel({
      ...aFullModel,
      contract: { ...aFullModel.contract!, tagKeys: [] },
      roster: [{ ...aFullModel.roster[0]!, principleKeys: [] }]
    });

    const texts = expectedSnapshot(withoutTags, everyKeyOf(withoutTags));

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

  it('gives a blocked answer its own captioned line, and a tie-break its own', () => {
    const model = createContractOfferScreenModel({
      ...aFullModel,
      responses: [
        {
          ...aFullModel.responses[0]!,
          reasons: [],
          blockedByEntity: 'core:will_not_strike_a_temple',
          blockedByDisplayNameKey: 'trait.core.will_not_strike_a_temple.name'
        },
        {
          ...aFullModel.responses[0]!,
          reasons: [],
          tieBreakCode: ReasonCodes.NoReasonToRefuse
        }
      ]
    });

    const texts = expectedSnapshot(model, everyKeyOf(model));

    expect(texts).toContain('text(field.response.blocked_by)');
    expect(texts).toContain(`text(${ReasonCodes.NoReasonToRefuse})`);
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
