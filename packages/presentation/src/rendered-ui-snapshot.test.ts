import { describe, expect, it } from 'vitest';

import { OfferPhase, ReasonCodes, parseContentId } from '@oath-and-coin/simulation';

import {
  createContractOfferScreenModel,
  leversOf,
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
    // Fully crewed on purpose: `SettlementLine`'s own doc comment gates a non-`null`
    // settlement on `phase = Settled` or `phase = Locked` with every seat filled
    // (`ContractStatus.Crewed`), and `offer.phase` below is `Locked`. `requiredCrew: 4`
    // with `acceptedCount: 3` — the fixture's own value before external review of this
    // task — described a state the engine cannot produce: a locked, uncrewed offer
    // carrying a settlement anyway. Two seats, both filled, matches `settlement.crew`'s
    // two entries below and is the state `NEGOTIATION_SPEC` §5.1 actually describes.
    requiredCrew: 2,
    acceptedCount: 2
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
  // The negotiation fields (`DEC-008` Tasks 15-16) are this file's own question as of
  // Task 17, which is what walks and resolves them. Every optional branch of that
  // projection appears here too, for the same reason the rest of the fixture is
  // deliberately richer than any single scenario: a chosen method tag among two
  // alternatives, a promise (so `promiseTerms` is not `null`), a key hero distinct from
  // the roster's first entry, and a filled crew's settlement.
  treasury: 400,
  offer: {
    version: 3,
    phase: OfferPhase.Locked,
    // Every lever disabled, and each saying so on its own line: this package is locked
    // with its crew filled, which is where `composeOffer` stops being legal
    // (`NEGOTIATION_SPEC` §3.1). The fixture takes the disabled branch on purpose —
    // `null` throughout would leave `resolveOffer`'s reason lines unwalked by any test
    // in this file.
    advanceLever: { value: 15, min: 0, max: 40, disabledReasonKey: 'offer.locked' },
    bonusLever: { value: 20, min: 0, max: 40, disabledReasonKey: 'offer.locked' },
    methodLever: {
      // Deliberately the *second* option, not the first: external review of Task 17
      // found that a chosen-first fixture cannot distinguish a correct projection of
      // the chosen tag from a wrong one that just showed `options[0]` — the two
      // coincide whenever the choice happens to sort first, which the factory's own
      // convention always arranges for real model output. This fixture is hand-built
      // and owes that convention nothing.
      chosen: parseContentId('method:deception'),
      options: [
        { value: parseContentId('method:open'), labelKey: 'tag.method.open' },
        { value: parseContentId('method:deception'), labelKey: 'tag.method.deception' }
      ],
      disabledReasonKey: 'offer.locked'
    },
    keyHeroLever: {
      // Deliberately not the roster's first entry, for the reason above.
      chosen: parseContentId('core:doran'),
      options: [
        { value: parseContentId('core:bram'), labelKey: 'hero.core.bram.name' },
        { value: parseContentId('core:doran'), labelKey: 'hero.core.doran.name' }
      ],
      disabledReasonKey: 'offer.locked'
    },
    crewLever: {
      chosen: [parseContentId('core:bram'), parseContentId('core:doran')],
      options: [
        { value: parseContentId('core:bram'), labelKey: 'hero.core.bram.name' },
        { value: parseContentId('core:doran'), labelKey: 'hero.core.doran.name' }
      ],
      exactly: 2,
      disabledReasonKey: 'offer.locked'
    },
    budget: { available: 400, maxAdvance: 190, maxBonus: 370 },
    // `advance × requiredCrew + promisedBonus` = `15 × 2 + 20` (`NEGOTIATION_SPEC`
    // §2.3, §3.3's own reservation formula — `commitmentOf`, `@oath-and-coin/simulation`).
    lockCommitment: 50
  },
  // `treasury + patronFee − advance × acceptedCount − promisedBonus` = `400 + 40 −
  // 15 × 2 − 20` — `settleContract`'s own formula (`NEGOTIATION_SPEC` §3.3) with
  // `pay: true`.
  treasuryForecast: 390,
  promiseTerms: {
    fulfilKey: 'offer.promise.fulfil',
    breachKey: 'offer.promise.breach',
    bonus: 20
  },
  settlement: {
    promisedBonus: 20,
    keyHeroDefinition: 'core:doran',
    // Two entries, matching `contract.acceptedCount: 2` above — `SettlementLine.crew`'s
    // own doc comment defines it as `OfferState.acceptedBy`, and a crew list of a
    // different size than the contract's own `acceptedCount` is the second half of the
    // inconsistency external review of this task found.
    crew: ['core:bram', 'core:doran'],
    // Same formula as `treasuryForecast` above, `pay: true` — the two are required to
    // agree (`toSettlement`'s own doc comment in `contract-offer-screen-model-factory.ts`).
    treasuryIfKept: 390,
    // `pay: false` skips the promised-bonus term: `390 + 20`.
    treasuryIfBroken: 410
  }
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
      '2',
      'text(field.contract.accepted_count)',
      '2',
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
      'text(response.wavered.false)',
      'text(field.offer.version)',
      '3',
      'text(offer.phase.locked)',
      'text(field.offer.advance)',
      '15',
      'text(offer.locked)',
      'text(field.offer.method)',
      'text(tag.method.open)',
      'text(tag.method.deception)',
      'text(field.offer.method_selected)',
      'text(tag.method.deception)',
      'text(offer.locked)',
      'text(field.offer.promised_bonus)',
      '20',
      'text(offer.locked)',
      'text(field.offer.key_hero)',
      'text(hero.core.doran.name)',
      'text(offer.locked)',
      'text(field.offer.crew)',
      'text(hero.core.bram.name)',
      'text(hero.core.doran.name)',
      'text(offer.locked)',
      'text(field.offer.budget_available)',
      '400',
      'text(field.offer.max_advance)',
      '40',
      'text(field.offer.max_bonus)',
      '40',
      'text(field.offer.lock_commitment)',
      '50',
      'text(field.treasury)',
      '400',
      'text(field.treasury_forecast)',
      '390',
      'text(offer.promise.fulfil)',
      'text(offer.promise.breach)',
      'text(field.offer.promised_bonus)',
      '20',
      'text(field.offer.promised_bonus)',
      '20',
      'text(field.offer.key_hero)',
      'text(hero.core.doran.name)',
      'text(field.settlement.crew)',
      'text(hero.core.bram.name)',
      'text(hero.core.doran.name)',
      'text(field.settlement.treasury_if_kept)',
      '390',
      'text(field.settlement.treasury_if_broken)',
      '410'
    ]);
  });

  it('resolves every key the model carries, and shows no key the model does not', () => {
    // The independent half of the assertion above. That one states an order; this one
    // states coverage — every key on the model reaches the frame exactly as many times
    // as the model carries it. A dropped binding fails both, and a binding added to
    // the projection without a model field behind it fails this one.
    const texts = expectedSnapshot(aFullModel, everyKeyOf(aFullModel));
    const shown = texts.filter((text) => text.startsWith('text(')).map((text) => text.slice(5, -1));

    // A real lookup rather than a hand-typed name per entry: `settlement.crew` and
    // `offer.keyHeroDefinition`/`settlement.keyHeroDefinition` are raw definitions, and
    // asserting `'hero.core.bram.name'` for each position regardless of which
    // definition is actually there is exactly the copy-paste that stopped noticing a
    // real hero's name went unresolved (external review of this task's first version).
    const heroDisplayNameKeyOf = new Map(
      aFullModel.roster.map((hero) => [hero.definition, hero.displayNameKey])
    );
    const nameOf = (definition: string): string => {
      const key = heroDisplayNameKeyOf.get(definition);

      if (key === undefined) {
        throw new Error(`Fixture bug: '${definition}' is not in aFullModel.roster.`);
      }

      return key;
    };

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
      ]),
      ...aFullModel.offer!.methodLever.options.map((option) => option.labelKey),
      // The chosen tag is one of the options, but shown twice on screen — once in the
      // group, once as the selection — and the coverage list says so plainly rather
      // than relying on the group's own entry to stand in for both.
      ...aFullModel
        .offer!.methodLever.options.filter(
          (option) => option.value === aFullModel.offer!.methodLever.chosen
        )
        .map((option) => option.labelKey),
      nameOf(aFullModel.offer!.keyHeroLever.chosen!),
      ...aFullModel.offer!.crewLever.chosen.map(nameOf),
      // Every lever's own reason, once per lever — five identical texts on this fixture,
      // which the ordered assertion above pins position by position.
      ...leversOf(aFullModel.offer!).flatMap((lever) =>
        lever.disabledReasonKey === null ? [] : [lever.disabledReasonKey]
      ),
      aFullModel.promiseTerms!.fulfilKey,
      aFullModel.promiseTerms!.breachKey,
      nameOf(aFullModel.settlement!.keyHeroDefinition!),
      ...aFullModel.settlement!.crew.map(nameOf)
    ]) {
      expect(shown, `the frame must resolve '${key}'`).toContain(key);
    }
  });

  it('shows the objective numbers literally and nothing else unresolved', () => {
    const texts = expectedSnapshot(aFullModel, everyKeyOf(aFullModel));
    const literals = texts.filter((text) => !text.startsWith('text('));

    // Payment, required crew, accepted count, then the offer's own version, advance and
    // promised bonus, the three budget figures the levers are bounded by, its lock
    // commitment, the treasury and its forecast, the promise's own bonus (shown again
    // beside its two predicates) and the settlement's promised bonus and its two treasury
    // outcomes — the values spec keeps as numbers on purpose. Any extra literal is a key
    // or an identifier that escaped resolution.
    expect(literals).toEqual([
      '40',
      '2',
      '2',
      '3',
      '15',
      '20',
      '400',
      '40',
      '40',
      '50',
      '400',
      '390',
      '20',
      '20',
      '390',
      '410'
    ]);
  });

  it('keeps every raw content id off the screen', () => {
    const texts = expectedSnapshot(aFullModel, everyKeyOf(aFullModel)).join('\u001f');

    for (const identifier of [
      'core:escort_the_caravan',
      'core:bram',
      'core:doran',
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
