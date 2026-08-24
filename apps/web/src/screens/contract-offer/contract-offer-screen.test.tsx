// @vitest-environment jsdom
import { startSession, type SessionState } from '@oath-and-coin/application';
import {
  OfferFieldKeys,
  PromiseTermsKeys,
  QualitativeGrade,
  ScreenState,
  SettlementActionKeys,
  TITLE_KEY,
  createContractOfferScreenModel,
  expectedSnapshot,
  failedScreen,
  snapshotHash,
  type ContractOfferScreenModel
} from '@oath-and-coin/presentation';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  browserContentSource,
  browserLocaleCatalogue,
  browserUiTextCatalogue
} from '../../content-source.ts';
import { collectRenderedAttributes, collectRenderedTexts } from '../../rendered-texts.ts';
import { render } from '../../testing/render.tsx';
import { TextSource } from '../../text.tsx';

import { ContractOfferScreen } from './contract-offer-screen.tsx';

/**
 * The second hash, on the browser side of it.
 *
 * `readModelHash` proves that two implementations built the same model. It proves
 * nothing about whether that model reached the markup: a forgotten binding, two
 * swapped blocks or a dropped reason all leave it green. The comparisons below are the
 * ones that see them — `expectedSnapshot` builds the texts a correctly bound screen
 * should produce, this file walks the DOM the screen actually produced, and the two
 * lists come from unrelated code paths on purpose. Nothing in `expectedSnapshot` can
 * know what the components rendered, which is exactly why agreeing means something.
 *
 * The models are not hand-built. They come from `startSession` over the browser
 * content source, on scenarios the frozen corpus records, so the fixtures are the
 * shipped ones and the run reaching them is the run the game makes. A hand-built model
 * would let this file agree with a screen that no scenario can actually produce.
 *
 * There are two matrices because there are two questions. The first is the five
 * *states*, which is what `AGENTS.md` §7 asks a UI task for. The second is the
 * *branches* — a blocked response, a tie-break, a hero whose mood turned the answer,
 * an empty list — and it exists because external review found that the five shipped
 * `screen_*` scenarios reach none of them.
 */

/** The five scenarios whose manifests declare the five states, in state order. */
const SCREEN_SCENARIOS = [
  { scenario: 'screen_loading', state: ScreenState.Loading },
  { scenario: 'screen_empty', state: ScreenState.Empty },
  { scenario: 'screen_error', state: ScreenState.Error },
  { scenario: 'screen_incomplete', state: ScreenState.Incomplete },
  { scenario: 'screen_normal', state: ScreenState.Normal }
] as const;

/**
 * Scenarios carrying the markup branches no `screen_*` scenario produces.
 *
 * The seed is part of each entry rather than a constant: `zero_sum_tie` settles a dead
 * heat on seed 7 and not on 424242. A matrix that fixed the seed would have listed the
 * right scenario and still not tested the branch.
 *
 * **The `wavered` branch — a hero whose mood turned the answer the other factors would
 * have given — has no entry here.** It used to, as `grey_zone_flip` at seed 7. `DEC-008`
 * Task 8 moved the decision rule's benefit term from `contract.patronFee` onto
 * `contract.offer.advance` (`NEGOTIATION_SPEC` §4), and no shipped scenario can give an
 * offer a nonzero advance yet — that needs `composeOffer`, a command `DEC-008` Tasks
 * 10-14 have not built. Every scenario here still starts every contract on
 * `advance = 0`, so `grey_zone_flip`'s pre-mood score, tuned to land inside the grey
 * band under the old `patronFee`-driven benefit, moved outside it, and mood no longer
 * flips the answer. Task 20 restores this branch once a shipped scenario can compose a
 * real offer.
 */
const BRANCH_SCENARIOS = [
  {
    scenario: 'two_principles_blocked',
    checkpoint: 'final',
    seed: 424242n,
    branch: 'a response blocked outright, and heroes carrying no principles at all',
    covers: (model: ContractOfferScreenModel) =>
      model.responses.some((response) => response.blockedByDisplayNameKey !== null) &&
      model.roster.some((hero) => hero.principleKeys.length === 0)
  },
  {
    scenario: 'zero_sum_tie',
    checkpoint: 'final',
    seed: 7n,
    branch: 'a tie-break, and a contract with no tags',
    covers: (model: ContractOfferScreenModel) =>
      model.responses.some((response) => response.tieBreakCode !== null) &&
      model.contract !== null &&
      model.contract.tagKeys.length === 0
  },
  {
    scenario: 'two_principles_blocked',
    checkpoint: 'final',
    seed: 7n,
    branch: 'heroes carrying no inclinations',
    covers: (model: ContractOfferScreenModel) =>
      model.roster.some((hero) => hero.inclinationKeys.length === 0)
  }
] as const;

/** The seed the scenario runner's CLI defaults to, and the one the corpus records. */
const SEED = 424242n;

let catalogue: ReadonlyMap<string, string>;

beforeAll(() => {
  // Both catalogues, merged the same way `App.tsx`'s `browserCatalogue` merges them:
  // since Task 17 the screen resolves interface-invented keys (`ADR-012`) — the
  // offer's own captions, the treasury, the settlement — as well as content's, and a
  // catalogue holding only the content half would fail every render that reaches one.
  catalogue = new Map([...browserLocaleCatalogue('ru'), ...browserUiTextCatalogue('ru')]);
});

function sessionFor(scenario: string, checkpoint: string, seed: bigint): SessionState {
  return startSession({
    content: browserContentSource(),
    scenario,
    // Stated rather than left to the manifest's default, because a checkpoint is an
    // input to a run (`ADR-008`) and a test that let it be inferred would stop noticing
    // if it moved.
    checkpoint,
    seed
  });
}

function renderScreen(model: ContractOfferScreenModel): HTMLElement {
  return render(
    <TextSource catalogue={catalogue}>
      <ContractOfferScreen model={model} />
    </TextSource>
  );
}

describe('the five states the shipped scenarios reach', () => {
  it('are all five, and each is the one its manifest declares', () => {
    // Without this the loops below could pass while two scenarios landed on the same
    // screen: agreeing with `expectedSnapshot` says the markup matches the model, not
    // that the model is the one the run was supposed to produce.
    expect(
      SCREEN_SCENARIOS.map(({ scenario }) => sessionFor(scenario, scenario, SEED).screen.state)
    ).toEqual(SCREEN_SCENARIOS.map(({ state }) => state));
  });

  it.each(SCREEN_SCENARIOS)(
    '$scenario renders exactly the texts the snapshot expects, in order',
    ({ scenario }) => {
      const { screen } = sessionFor(scenario, scenario, SEED);

      expect(collectRenderedTexts(renderScreen(screen))).toEqual(
        expectedSnapshot(screen, catalogue)
      );
    }
  );

  it.each(SCREEN_SCENARIOS)('$scenario agrees on the rendered-ui hash', ({ scenario }) => {
    // The same claim as above, in the form the runtime harness actually compares
    // (`ADR-008`, and Task 15's `report.json`). Kept beside the list comparison rather
    // than instead of it: a hash says they differ, the list says where.
    const { screen } = sessionFor(scenario, scenario, SEED);

    expect(snapshotHash(collectRenderedTexts(renderScreen(screen)))).toBe(
      snapshotHash(expectedSnapshot(screen, catalogue))
    );
  });
});

describe('the markup branches the five states never reach', () => {
  it.each(BRANCH_SCENARIOS)(
    '$scenario at seed $seed carries $branch',
    ({ scenario, checkpoint, seed, covers }) => {
      // Asserted rather than believed. Which branch a scenario exercises is a property
      // of the corpus, and an edit that made one of these stop carrying its branch
      // would leave the comparison below green over a model that tests nothing — the
      // matrix would keep its size and lose its point.
      expect(covers(sessionFor(scenario, checkpoint, seed).screen)).toBe(true);
    }
  );

  it.each(BRANCH_SCENARIOS)(
    '$scenario at seed $seed renders exactly the texts the snapshot expects, in order',
    ({ scenario, checkpoint, seed }) => {
      const { screen } = sessionFor(scenario, checkpoint, seed);

      expect(collectRenderedTexts(renderScreen(screen))).toEqual(
        expectedSnapshot(screen, catalogue)
      );
    }
  );
});

describe('what never reaches a player', () => {
  it('shows no raw content id, on any run either matrix drives', () => {
    // `TDD` §11.1 from the other end. The snapshot comparisons above already fail if a
    // definition is rendered, but only because `expectedSnapshot` leaves it out — this
    // states the rule itself, so an edit that taught both sides to show one would still
    // have to answer for it.
    //
    // Substring rather than equality, and attributes as well as text: a label reading
    // `id: core:bram` is the same leak as one reading `core:bram`, and a `title` or an
    // `aria-label` carrying it is the leak neither hash can see.
    for (const run of everyRun()) {
      const { screen } = sessionFor(run.scenario, run.checkpoint, run.seed);
      const shown = shownStrings(renderScreen(screen));

      for (const identifier of rawIdentifiersOf(screen)) {
        expect(
          shown.filter((value) => value.includes(identifier)),
          `${run.scenario} must not show '${identifier}'`
        ).toEqual([]);
      }
    }
  });

  it('shows no part of the error detail, on the state that has one', () => {
    // The detail is assembled in code and carries a machine's own path. In the Godot
    // original it arrived as a tooltip, which neither hash covers, so nothing could
    // have noticed it was the one unlocalized player-facing string on the screen.
    //
    // The whole recorded value is looked for, not a fragment of it, and in attributes
    // as well as in text: `title` is that tooltip's browser spelling, and a walk over
    // text nodes is blind to it.
    const { screen, errorDetail } = sessionFor('screen_error', 'screen_error', SEED);
    const shown = shownStrings(renderScreen(screen));

    expect(errorDetail).not.toBeNull();
    expect(screen.errorDetail).toBe(errorDetail);

    const detail = screen.errorDetail ?? '';
    expect(detail).not.toBe('');
    expect(shown.filter((value) => value.includes(detail))).toEqual([]);

    // And the machine-specific fragment on its own, so a detail that grew a prefix
    // between runs cannot make the assertion above vacuously true.
    expect(shown.filter((value) => value.includes('does-not-exist'))).toEqual([]);
  });
});

describe('a catalogue that cannot answer', () => {
  it('fails the render rather than putting the key on the screen', () => {
    const { screen } = sessionFor('screen_normal', 'screen_normal', SEED);
    const incomplete = new Map(catalogue);
    incomplete.delete(screen.titleKey);

    expect(() =>
      render(
        <TextSource catalogue={incomplete}>
          <ContractOfferScreen model={screen} />
        </TextSource>
      )
    ).toThrow(/screen[.]contract_offer[.]title/u);
  });
});

/** Every run either matrix drives, so a leak rule is stated over all of them at once. */
function everyRun(): readonly {
  readonly scenario: string;
  readonly checkpoint: string;
  readonly seed: bigint;
}[] {
  return [
    ...SCREEN_SCENARIOS.map(({ scenario }) => ({ scenario, checkpoint: scenario, seed: SEED })),
    ...BRANCH_SCENARIOS.map(({ scenario, checkpoint, seed }) => ({ scenario, checkpoint, seed }))
  ];
}

/** Everything a rendered screen puts in front of a browser: its texts and its attributes. */
function shownStrings(container: HTMLElement): readonly string[] {
  return [...collectRenderedTexts(container), ...collectRenderedAttributes(container)];
}

/** Every content id the model carries for bookkeeping and no screen may show. */
function rawIdentifiersOf(model: ContractOfferScreenModel): readonly string[] {
  const identifiers: string[] = [];

  if (model.contract !== null) {
    identifiers.push(model.contract.definition);
  }

  for (const hero of model.roster) {
    identifiers.push(hero.definition);
  }

  for (const response of model.responses) {
    identifiers.push(response.heroDefinition);

    if (response.blockedByEntity !== null) {
      identifiers.push(response.blockedByEntity);
    }

    for (const reason of response.reasons) {
      identifiers.push(reason.sourceEntity);
    }
  }

  if (model.offer !== null && model.offer.keyHeroDefinition !== null) {
    identifiers.push(model.offer.keyHeroDefinition);
  }

  if (model.settlement !== null) {
    if (model.settlement.keyHeroDefinition !== null) {
      identifiers.push(model.settlement.keyHeroDefinition);
    }

    identifiers.push(...model.settlement.crew);
  }

  return identifiers;
}

/**
 * Task 17's own five tests: the offer screen draws the draft block, the promise
 * predicates, the treasury the deal would leave, and the settlement buttons that only
 * exist once a crew is filled — and does every one of it through `ui-text/ru.json`,
 * never a literal typed into the component.
 *
 * The models below are hand-built rather than run out of a shipped scenario, unlike
 * the two matrices above. Those exist to prove a real run reaches the markup this
 * screen draws; these exist to prove one *feature* of the markup in isolation — a
 * promised bonus greater than zero, a chosen method tag, a crew short of
 * `requiredCrew` — and no scenario in the corpus composes an offer with a promise or a
 * method choice yet (`NEGOTIATION_SPEC` §10.3's `promise_kept`, `promise_broken` and
 * `method_choice_flips_the_key_hero` are Task 20's). A hand-built model is the only way
 * to exercise those branches before that task lands, and `createContractOfferScreenModel`
 * still refuses one that violates §2.1.
 */
describe('the draft block, the promise, the treasury and the settlement buttons', () => {
  it('shows the advance, the method choice and the promise as one draft block', () => {
    const container = renderScreen(draftModel());

    // The lever and its price sit together (the CK3 layout rule this task follows):
    // the advance and the promised bonus are the two money levers, and both are
    // visible as a caption beside its value, the same treatment every other objective
    // number on this screen already gets.
    expect(captionedValue(container, textOf(OfferFieldKeys.Advance))).toBe('40');
    expect(captionedValue(container, textOf(OfferFieldKeys.PromisedBonus))).toBe('25');

    // The chosen method tag is a real radio among the two named alternatives — the
    // other one (`tag.method.deception`) exists on the same package and is not
    // checked, which the third assertion below is what would fail if the screen drew
    // both as checked or neither.
    expect(radioChecked(container, textOf('tag.method.open'))).toBe(true);
    expect(radioChecked(container, textOf('tag.method.deception'))).toBe(false);
  });

  it('says what counts as keeping the word and what counts as breaking it', () => {
    const texts = collectRenderedTexts(renderScreen(draftModel()));

    expect(texts).toContain(textOf(PromiseTermsKeys.Fulfil));
    expect(texts).toContain(textOf(PromiseTermsKeys.Breach));
  });

  it('shows the treasury the deal would leave, next to the promise', () => {
    const container = renderScreen(draftModel());
    const forecast = container.querySelector('[data-testid="treasury-forecast"]');

    expect(forecast).not.toBeNull();
    expect(forecast?.textContent).toContain('375');

    // "Next to the promise": the forecast and the promise's own two sentences share
    // one container, so a reader sees the price and the predicate it prices without
    // having to look elsewhere on the screen.
    expect(forecast?.closest('.price')?.textContent).toContain(textOf(PromiseTermsKeys.Fulfil));
  });

  it('offers no settlement buttons until the crew is filled', () => {
    const container = renderScreen(lockedUncrewedModel());

    expect(container.querySelector('[data-testid="settlement-pay"]')).toBeNull();
    expect(container.querySelector('[data-testid="settlement-refuse"]')).toBeNull();
    expect(findButtonByText(container, textOf(SettlementActionKeys.Pay))).toBeNull();
  });

  it('renders every label from ui-text, never a literal', () => {
    expect(literalsIn(ContractOfferScreen)).toEqual([]);
  });
});

/** The catalogue's own answer for `key`, so a test reads the same text the screen does. */
function textOf(key: string): string {
  const text = catalogue.get(key);

  if (text === undefined) {
    throw new Error(
      `No catalogue entry for '${key}' — the fixture below asked for a key ` + 'nothing ships.'
    );
  }

  return text;
}

/**
 * A package mid-negotiation: an advance, a promised bonus and a chosen method among
 * two alternatives, all still open to revision — `NEGOTIATION_SPEC` §5.1's "draft
 * block" and its promise predicates, both live at once.
 */
function draftModel(): ContractOfferScreenModel {
  return createContractOfferScreenModel({
    state: ScreenState.Incomplete,
    titleKey: TITLE_KEY,
    contract: {
      definition: 'core:escort_the_caravan',
      displayNameKey: 'contract.core.escort_the_caravan.name',
      patronFee: 40,
      risk: QualitativeGrade.Moderate,
      tagKeys: ['tag.target.bandits'],
      requiredCrew: 3,
      acceptedCount: 1
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
    responses: [],
    errorCode: null,
    errorDetail: null,
    treasury: 400,
    offer: {
      version: 1,
      phase: 'draft',
      advance: 40,
      methodTagKey: 'tag.method.open',
      methodOptionKeys: ['tag.method.open', 'tag.method.deception'],
      promisedBonus: 25,
      keyHeroDefinition: 'core:bram',
      lockCommitment: 145
    },
    // `400 + 40 - 40 * 1 - 25 = 375` — `settleContract`'s own formula
    // (`NEGOTIATION_SPEC` §3.3) with `pay: true`, over one accepted seat: the draft
    // phase can only have the key hero in `acceptedBy` (`NEGOTIATION_SPEC` §2.1).
    treasuryForecast: 375,
    promiseTerms: {
      fulfilKey: PromiseTermsKeys.Fulfil,
      breachKey: PromiseTermsKeys.Breach,
      bonus: 25
    },
    settlement: null
  });
}

/**
 * A package locked with the crew still short a seat: `NEGOTIATION_SPEC` §5.1's
 * settlement line is `null` here on purpose — `pollCrew` ran and did not fill
 * `requiredCrew` — which is the one state the fourth test needs and no shipped
 * scenario reaches through this screen's own matrix above.
 */
function lockedUncrewedModel(): ContractOfferScreenModel {
  return createContractOfferScreenModel({
    state: ScreenState.Incomplete,
    titleKey: TITLE_KEY,
    contract: {
      definition: 'core:silence_the_cult',
      displayNameKey: 'contract.core.silence_the_cult.name',
      patronFee: 55,
      risk: QualitativeGrade.High,
      tagKeys: ['tag.target.cult'],
      requiredCrew: 3,
      acceptedCount: 1
    },
    roster: [
      {
        definition: 'core:mira',
        displayNameKey: 'hero.core.mira.name',
        greed: QualitativeGrade.Low,
        caution: QualitativeGrade.High,
        pride: QualitativeGrade.Moderate,
        principleKeys: [],
        inclinationKeys: []
      }
    ],
    responses: [],
    errorCode: null,
    errorDetail: null,
    treasury: 300,
    offer: {
      version: 2,
      phase: 'locked',
      advance: 20,
      methodTagKey: null,
      methodOptionKeys: [],
      promisedBonus: 0,
      keyHeroDefinition: 'core:mira',
      lockCommitment: 60
    },
    treasuryForecast: 335,
    promiseTerms: null,
    settlement: null
  });
}

/**
 * A package settled — crew filled, a promise on the table — for the fifth test's
 * second pass through the component: {@link SettlementBlock}'s own captions, its
 * crew list and its two buttons all have to answer {@link literalsIn} clean too, and
 * {@link draftModel} never reaches that branch at all.
 */
function crewedModel(): ContractOfferScreenModel {
  return createContractOfferScreenModel({
    state: ScreenState.Normal,
    titleKey: TITLE_KEY,
    contract: {
      definition: 'core:collect_the_debt',
      displayNameKey: 'contract.core.collect_the_debt.name',
      patronFee: 30,
      risk: QualitativeGrade.Low,
      tagKeys: ['tag.patron.slavers'],
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
        principleKeys: [],
        inclinationKeys: ['trait.core.hungry_for_renown.name']
      },
      {
        definition: 'core:doran',
        displayNameKey: 'hero.core.doran.name',
        greed: QualitativeGrade.High,
        caution: QualitativeGrade.Negligible,
        pride: QualitativeGrade.Extreme,
        principleKeys: ['trait.core.will_not_serve_slavers.name'],
        inclinationKeys: []
      }
    ],
    responses: [],
    errorCode: null,
    errorDetail: null,
    treasury: 300,
    offer: {
      version: 3,
      phase: 'locked',
      advance: 15,
      methodTagKey: null,
      methodOptionKeys: [],
      promisedBonus: 10,
      keyHeroDefinition: 'core:bram',
      lockCommitment: 40
    },
    treasuryForecast: 290,
    promiseTerms: {
      fulfilKey: PromiseTermsKeys.Fulfil,
      breachKey: PromiseTermsKeys.Breach,
      bonus: 10
    },
    settlement: {
      promisedBonus: 10,
      keyHeroDefinition: 'core:bram',
      crew: ['core:bram', 'core:doran'],
      treasuryIfKept: 290,
      treasuryIfBroken: 300
    }
  });
}

/** The visible value of the `Captioned` pair whose caption text is `caption`. */
function captionedValue(container: HTMLElement, caption: string): string {
  const pair = [...container.querySelectorAll('.captioned')].find(
    (element) => element.querySelectorAll('.label')[0]?.textContent === caption
  );

  if (pair === undefined) {
    throw new Error(`No captioned field with caption '${caption}' was rendered.`);
  }

  return pair.querySelectorAll('.label')[1]?.textContent ?? '';
}

/** Whether the method-choice radio labelled `optionText` is the one currently checked. */
function radioChecked(container: HTMLElement, optionText: string): boolean {
  const label = [...container.querySelectorAll('label.method-option')].find(
    (element) => element.querySelector('.label')?.textContent === optionText
  );

  if (label === undefined) {
    throw new Error(`No method option labelled '${optionText}' was rendered.`);
  }

  const input = label.querySelector('input[type="radio"]');

  if (input === null) {
    throw new Error(`Method option '${optionText}' carries no radio input.`);
  }

  return (input as HTMLInputElement).checked;
}

/** The first `<button>` whose own text is exactly `text`, or `null`. */
function findButtonByText(container: HTMLElement, text: string): HTMLButtonElement | null {
  return (
    [...container.querySelectorAll('button')].find((button) => button.textContent === text) ?? null
  );
}

/**
 * Every text or attribute value {@link ContractOfferScreen} renders that is neither a
 * plain integer (the objective numbers `NEGOTIATION_SPEC` §5.1 keeps as numbers on
 * purpose) nor a string the real catalogue actually answered a key with — the shape
 * `TDD` §11.1's "no literal" rule takes on a component nobody may add a hand-typed
 * string to.
 *
 * Built by wrapping the real, merged catalogue rather than a fake one: a tracking
 * catalogue that invented its own text could not tell a resolved value from a literal
 * that happened to collide with it, and `resolveText`'s own throw-on-miss behaviour
 * has to keep working for a render that reaches a key with nothing to answer it.
 * `collectRenderedAttributes` is deliberately not reused here — it walks every
 * attribute a browser ever sees, including `class`, `type` and `data-testid`, none of
 * which a player reads — so this looks only at the three attributes a literal could
 * hide behind unseen by a text-node walk: `aria-label`, `title`, `placeholder`.
 */
function literalsIn(
  Component: (props: {
    readonly model: ContractOfferScreenModel;
  }) => ReturnType<typeof ContractOfferScreen>
): readonly string[] {
  const seen = new Set<string>();
  const tracked = new Proxy(catalogue, {
    get: (target, prop, receiver) => {
      if (prop === 'get') {
        return (key: string) => {
          const value = target.get(key);

          if (value !== undefined) {
            seen.add(value);
          }

          return value;
        };
      }

      return Reflect.get(target, prop, receiver);
    }
  }) as ReadonlyMap<string, string>;

  const isPlainInteger = /^-?\d+$/u;
  const literals = new Set<string>();

  for (const model of [
    draftModel(),
    crewedModel(),
    failedScreen('CONTENT_ROOT_NOT_FOUND', 'irrelevant to this check')
  ]) {
    const container = render(
      <TextSource catalogue={tracked}>
        <Component model={model} />
      </TextSource>
    );

    for (const value of [
      ...collectRenderedTexts(container),
      ...collectLabelledAttributes(container)
    ]) {
      if (isPlainInteger.test(value) || seen.has(value)) {
        continue;
      }

      literals.add(value);
    }
  }

  return [...literals];
}

/** `aria-label`, `title` and `placeholder` — the attributes a literal could hide behind. */
function collectLabelledAttributes(root: Node): readonly string[] {
  const values: string[] = [];
  const ATTRIBUTES = ['aria-label', 'title', 'placeholder'];

  const walk = (node: Node): void => {
    if (node.nodeType === node.ELEMENT_NODE) {
      for (const attribute of ATTRIBUTES) {
        const value = (node as Element).getAttribute(attribute);

        if (value !== null) {
          values.push(value);
        }
      }
    }

    for (const child of Array.from(node.childNodes)) {
      walk(child);
    }
  };

  walk(root);

  return values;
}
