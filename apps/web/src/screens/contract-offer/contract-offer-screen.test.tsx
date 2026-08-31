// @vitest-environment jsdom
import { startSession, type SessionState } from '@oath-and-coin/application';
import {
  LeverDisabledKeys,
  OFFER_ACTIONS,
  OfferAction,
  OfferFieldKeys,
  REJECTION_KEYS,
  RejectionCodes,
  offerActionKey,
  PromiseTermsKeys,
  QualitativeGrade,
  ScreenKind,
  ScreenState,
  SettlementFieldKeys,
  TITLE_KEY,
  createContractOfferScreenModel,
  expectedSnapshot,
  failedScreen,
  snapshotHash,
  type AvailableAction,
  type ContentId,
  type ContractOfferScreenModel,
  type RejectionCode
} from '@oath-and-coin/presentation';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  browserContentSource,
  browserLocaleCatalogue,
  browserUiTextCatalogue
} from '../../content-source.ts';
import { collectRenderedAttributes, collectRenderedTexts } from '../../rendered-texts.ts';
import { click, mount, render, type } from '../../testing/render.tsx';
import { TextSource } from '../../text.tsx';

import { ContractOfferScreen, type OfferScreenActions } from './contract-offer-screen.tsx';

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
 * **The `wavered` branch is `grey_zone_flip` again, restored rather than replaced.**
 * `DEC-008` Task 8 moved the decision rule's benefit term from `contract.patronFee`
 * onto `contract.offer.advance` (`NEGOTIATION_SPEC` §4) and removed this entry — not
 * because no scenario could compose an offer (`grey_zone_flip` already did, `advance =
 * 70` on `core:cleanse_the_crypt`, the full patron fee, the same number `patronFee`
 * itself used to supply as the benefit term before Task 8), but because that particular
 * number stopped landing inside the mood's grey band once it started being read as an
 * `advance` rather than assumed as the full fee. Task 20's fix is a retune, not a new
 * capability: `grey_zone_flip`'s own commands were rewritten to a different offer
 * entirely (`core:escort_the_caravan`, `advance = 22`, no promise) whose pre-mood score
 * lands back inside the grey band at the CLI's default seed — the same seed every
 * canonical snapshot is recorded at, so the branch and the snapshot agree on which run
 * they are both describing.
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
  },
  {
    scenario: 'grey_zone_flip',
    checkpoint: 'final',
    seed: 424242n,
    branch: 'a hero whose mood turned the answer the other factors would have given',
    covers: (model: ContractOfferScreenModel) =>
      model.responses.some((response) => response.wavered)
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

/**
 * One run's session, with its screen narrowed to the one this file is about.
 *
 * `SessionState.screen` is a union of three since the contract loop grew a debrief and a
 * board; every scenario here is a negotiation, so a run that landed anywhere else has
 * stopped being the thing under test and says so rather than reading `undefined` off a
 * screen of the wrong shape.
 */
function sessionFor(
  scenario: string,
  checkpoint: string,
  seed: bigint
): Omit<SessionState, 'screen'> & { readonly screen: ContractOfferScreenModel } {
  const session = startSession({
    content: browserContentSource(),
    scenario,
    // Stated rather than left to the manifest's default, because a checkpoint is an
    // input to a run (`ADR-008`) and a test that let it be inferred would stop noticing
    // if it moved.
    checkpoint,
    seed
  });

  if (session.screen.screen !== ScreenKind.ContractOffer) {
    throw new Error(
      `'${scenario}' landed on '${session.screen.screen}', not on the contract-offer screen.`
    );
  }

  return { ...session, screen: session.screen };
}

function renderScreen(model: ContractOfferScreenModel): HTMLElement {
  return render(
    <TextSource catalogue={catalogue}>
      <ContractOfferScreen model={model} controller={fakeController()} />
    </TextSource>
  );
}

/**
 * A controller that records what the screen asked of it and answers as told.
 *
 * Six methods, not the whole `SessionController`: the screen's prop type is the subset it
 * is allowed to use (`OfferScreenActions`), so a fake of that subset is a complete fake —
 * and a screen that grew a call to `save` or `load` would not compile against it, which is
 * the point of narrowing the prop in the first place.
 */
interface FakeController extends OfferScreenActions {
  readonly calls: { name: string; args: readonly unknown[] }[];
}

function fakeController(refusal: RejectionCode | null = null): FakeController {
  const calls: { name: string; args: readonly unknown[] }[] = [];
  const answer = (name: string) =>
    ((...args: readonly unknown[]) => {
      calls.push({ name, args });

      return refusal === null
        ? { applied: true, rejectionCode: null, state: null, events: [], decisions: [] }
        : { applied: false, rejectionCode: refusal, state: null, events: [], decisions: [] };
    }) as never;

  return {
    calls,
    composeOfferFromDraft: answer('composeOfferFromDraft'),
    askKeyHero: answer('askKeyHero'),
    lockOffer: answer('lockOffer'),
    pollCrew: answer('pollCrew'),
    placeCrewFromDraft: answer('placeCrewFromDraft'),
    resolveContract: answer('resolveContract'),
    show: answer('show')
  };
}

function renderWith(model: ContractOfferScreenModel, controller: FakeController) {
  return mount(
    <TextSource catalogue={catalogue}>
      <ContractOfferScreen model={model} controller={controller} />
    </TextSource>
  );
}

/** The control carrying `testId`, or a loud failure naming what was looked for. */
function control(container: HTMLElement, testId: string): HTMLElement {
  const element = container.querySelector(`[data-testid="${testId}"]`);

  if (element === null) {
    throw new Error(`No control marked '${testId}' was rendered.`);
  }

  return element as HTMLElement;
}

function actionButton(container: HTMLElement, action: OfferAction): HTMLButtonElement {
  return control(container, `action-${action}`) as HTMLButtonElement;
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
          <ContractOfferScreen model={screen} controller={fakeController()} />
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

  if (model.offer !== null) {
    // Every id the package carries for bookkeeping: the key hero, the crew it invites and
    // every option either lever offers. All of them are joined to a display-name key
    // before they reach a label, and none may appear on the frame itself (`TDD` §11.1).
    if (model.offer.keyHeroLever.chosen !== null) {
      identifiers.push(model.offer.keyHeroLever.chosen);
    }

    identifiers.push(...model.offer.crewLever.chosen);
    identifiers.push(
      ...model.offer.keyHeroLever.options.map((option) => option.value),
      ...model.offer.crewLever.options.map((option) => option.value),
      ...model.offer.methodLever.options.map((option) => option.value)
    );
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
 * Task 17's own tests: the offer screen draws the draft block, the promise
 * predicates, the treasury the deal would leave, and the settlement block — what the
 * promise costs and who is bound by it — that only exists once a crew is filled, and
 * does every one of it through `ui-text/ru.json`, never a literal typed into the
 * component.
 *
 * **The settlement block draws no control.** An earlier version of this screen drew two
 * `<button>` elements here with no `onClick` at all — reachable, pressable and inert the
 * moment a real `pollCrew` filled a crew. A whole-branch review found them; the owner's
 * ruling was to remove rather than wire them, because a control that does nothing is
 * worse than no control (`ContractOfferScreen`'s own `SettlementBlock` doc comment). The
 * tests below assert that the block still shows everything it is meant to show, and that
 * it now renders no interactive element at all — not the narrower claim the previous
 * version of this comment made, that the two buttons existed only once a crew was
 * filled.
 *
 * The models below are hand-built rather than run out of a shipped scenario, unlike
 * the two matrices above. Those exist to prove a real run reaches the markup this
 * screen draws; these exist to prove one *feature* of the markup in isolation — a
 * promised bonus greater than zero, a chosen method tag, a crew short of
 * `requiredCrew` — and no scenario in the corpus composes an offer with a promise or a
 * method choice yet (`NEGOTIATION_SPEC` §10.3's `promise_kept`, `promise_broken` and
 * `method_choice_flips_the_key_hero` are Task 20's). A hand-built model is the only way
 * to exercise those branches before that task lands.
 *
 * **`createContractOfferScreenModel` does not check §2.1 for us, and an earlier version
 * of this comment wrongly claimed it did.** It refuses a `null`/non-`null` mismatch
 * against {@link ContractOfferScreenModel.state} and nothing else — not the crew-size
 * invariants, not "`settlement` is non-`null` only when the crew is actually filled",
 * not the arithmetic of §3.3. External review of this task found exactly that gap in
 * `rendered-ui-snapshot.test.ts`'s own fixture (a `locked`, three-of-four-seats offer
 * that still carried a `settlement`, and money that did not balance). The three models
 * below are legal against §2.1 by hand — checked line by line, not by a gate — and
 * that is the only thing keeping them legal.
 */
describe('the draft block, the promise, the treasury and the settlement', () => {
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
    // checked, which the second assertion below is what would fail if the screen drew
    // both as checked or neither. `draftModel` deliberately lists the chosen tag
    // *second* in `methodOptionKeys`, so an implementation that checked "whichever
    // option renders first" instead of `key === offer.methodTagKey` would check
    // `tag.method.deception` here and fail both radio assertions.
    expect(radioChecked(container, textOf('tag.method.open'))).toBe(true);
    expect(radioChecked(container, textOf('tag.method.deception'))).toBe(false);

    // The same fact again, but as ordinary rendered text rather than a DOM property:
    // `checked` has no text node behind it at all, so `OfferFieldKeys.SelectedMethod`
    // is what lets this selection be seen (and the snapshot hash `pnpm verify` already
    // covers) the same way every other field on this screen is seen.
    expect(captionedValue(container, textOf(OfferFieldKeys.SelectedMethod))).toBe(
      textOf('tag.method.open')
    );
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

  it('renders no settlement block when the model carries no settlement to act on', () => {
    // What this proves, precisely: `ContractOfferScreen`'s own conditional
    // (`model.settlement === null ? null : <SettlementBlock .../>`) draws nothing
    // absent a settlement. It does *not* prove that `lockedUncrewedModel`'s particular
    // contract/offer combination is one `pollCrew` could actually leave uncrewed — that
    // would need the model built through the real factory, off a real `ContractState`,
    // which no shipped scenario reaches through this screen's own matrix above
    // (`NEGOTIATION_SPEC` §5.1's own two settlement-eligible phases).
    const container = renderScreen(lockedUncrewedModel());

    expect(container.querySelector('.settlement')).toBeNull();
  });

  it('shows what the promise costs and who is bound by it, and draws no control for it', () => {
    // `crewedModel` carries a settlement (`NEGOTIATION_SPEC` §5.1: the crew is filled).
    // Everything the block is meant to show — the promised bonus, the key hero it is
    // owed to, the crew it binds, and the two treasury outcomes a kept and a broken
    // promise would each leave — has to appear; nothing that presses a command may.
    // A whole-branch review found two `<button>` elements here with no `onClick` at
    // all, and the owner's ruling was to remove rather than wire them
    // (`ContractOfferScreen`'s own `SettlementBlock` doc comment) — the price of the
    // promise is this task's delivery, an action on it is not.
    const container = renderScreen(crewedModel());
    const texts = collectRenderedTexts(container);

    expect(captionedValue(container, textOf(OfferFieldKeys.PromisedBonus))).toBe('10');
    expect(captionedValue(container, textOf(OfferFieldKeys.KeyHero))).toBe(
      textOf('hero.core.bram.name')
    );
    expect(texts).toContain(textOf(SettlementFieldKeys.Crew));
    expect(texts).toContain(textOf('hero.core.doran.name'));
    expect(captionedValue(container, textOf(SettlementFieldKeys.TreasuryIfKept))).toBe('290');
    expect(captionedValue(container, textOf(SettlementFieldKeys.TreasuryIfBroken))).toBe('300');

    // **The settlement block itself still draws no control**, which is what this test has
    // always been about: it briefly carried two `<button>` elements with no `onClick` at
    // all, and the owner's ruling was to remove rather than wire them. Scoped to `.settlement`
    // since Task 5, because the screen now does have buttons — the six protocol commands,
    // which is a different claim tested below and not a retraction of this one.
    expect(container.querySelector('.settlement')?.querySelectorAll('button')).toHaveLength(0);
  });

  it('offers all six commands, dark ones carrying the refusal they would get', () => {
    // `crewedModel` refuses every one of the six, so this fixture exercises the dark branch
    // — a button that is `disabled` and a reason line beside it. `draftModel` takes the
    // other branch below.
    const container = renderScreen(crewedModel());
    const buttons = [...container.querySelectorAll('[data-testid="offer-actions"] button')];

    expect(buttons.map((button) => button.textContent)).toEqual(
      OFFER_ACTIONS.map((action) => textOf(offerActionKey(action)))
    );
    expect(buttons.every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
    expect(collectRenderedTexts(container)).toContain(textOf(RejectionCodes.AlreadySettled));
  });

  it('leaves a live command enabled and says nothing beside it', () => {
    const container = renderScreen(everyActionLive());
    const buttons = [...container.querySelectorAll('[data-testid="offer-actions"] button')];

    expect(buttons).toHaveLength(OFFER_ACTIONS.length);
    expect(buttons.some((button) => (button as HTMLButtonElement).disabled)).toBe(false);
    // No refusal anywhere on the frame — a live control explains itself by being live.
    expect(
      collectRenderedTexts(container).filter((text) =>
        REJECTION_KEYS.some((key) => text === textOf(key))
      )
    ).toEqual([]);
  });

  it('never darkens a control without saying why', () => {
    // **The rule the whole block exists for, asserted over every state rather than for the
    // six the engine refuses.** `composeOffer` would accept a draft a player has not
    // finished typing, so its refusal is `null`, and the first edition darkened the one
    // control that starts the loop in silence. The owner opened the build and reported
    // "nothing is clickable" — which is what a screen that will not say what it wants looks
    // like from the outside, and what neither hash can see: a `disabled` attribute is not
    // a text node.
    for (const model of [draftModel(), crewedModel(), everyActionLive()]) {
      const container = renderScreen(model);
      const texts = collectRenderedTexts(container);

      for (const button of container.querySelectorAll('[data-testid^="action-"]')) {
        if (!(button as HTMLButtonElement).disabled) {
          continue;
        }

        // The reason sits next to the button it is about, so a screen with several dark
        // controls does not make the player match sentences to buttons by eye.
        const beside = button.nextElementSibling?.textContent ?? '';

        expect(
          beside.trim(),
          `${button.getAttribute('data-testid') ?? '?'} is dark in silence`
        ).not.toBe('');
        expect(texts).toContain(beside);
      }
    }
  });

  it('tells the player what the first control is waiting for, in the order he fills it in', () => {
    // A name first, then the crew: the two reasons are the two halves of a package, and the
    // second cannot be acted on before the first. This is the state a build actually opens
    // on — nothing named, nobody invited — which is where the owner met seven dark buttons.
    const base = draftModel();
    const untouched = createContractOfferScreenModel({
      ...base,
      offer: {
        ...base.offer!,
        keyHeroLever: { ...base.offer!.keyHeroLever, chosen: null },
        crewLever: { ...base.offer!.crewLever, chosen: [] }
      }
    });

    expect(collectRenderedTexts(renderScreen(untouched))).toContain(
      textOf(LeverDisabledKeys.NoKeyHero)
    );

    const named = createContractOfferScreenModel({
      ...base,
      offer: { ...base.offer!, crewLever: { ...base.offer!.crewLever, chosen: [] } }
    });

    expect(collectRenderedTexts(renderScreen(named))).toContain(
      textOf(LeverDisabledKeys.CrewNotChosen)
    );
  });

  it('renders every label from ui-text, never a literal', () => {
    expect(literalsIn(ContractOfferScreen)).toEqual([]);
  });
});

/**
 * A draft whose crew is exactly the size the contract asks for — one seat, one hero — so
 * the compose control is live and the package can actually be sent.
 *
 * {@link draftModel} deliberately cannot: it needs three and invites one, which is what
 * makes it the fixture for "a crew of the wrong size".
 */
function crewedDraftModel(): ContractOfferScreenModel {
  const base = draftModel();

  return createContractOfferScreenModel({
    ...base,
    contract: { ...base.contract!, requiredCrew: 1 },
    offer: { ...base.offer!, crewLever: { ...base.offer!.crewLever, exactly: 1 } }
  });
}

/** The same package with every command live, for the five controls that carry no terms. */
function everyActionLive(): ContractOfferScreenModel {
  return createContractOfferScreenModel({ ...crewedDraftModel(), availableActions: LIVE_ACTIONS });
}

/**
 * Three heroes, two seats, two method alternatives — a package in which *every* term can be
 * moved to something the model does not already record.
 *
 * The crew is the reason there are three heroes and two seats: with two of each, a crew can
 * only be emptied and refilled, never exchanged, and "the screen sent the draft" would still
 * be indistinguishable from "the screen sent the model".
 */
function richDraftModel(): ContractOfferScreenModel {
  const base = twoSeatDraftModel();
  const heroes = [
    { value: id('core:bram'), labelKey: 'hero.core.bram.name' },
    { value: id('core:doran'), labelKey: 'hero.core.doran.name' },
    { value: id('core:zara'), labelKey: 'hero.core.zara.name' }
  ];

  return createContractOfferScreenModel({
    ...base,
    roster: [
      ...base.roster,
      {
        definition: 'core:zara',
        displayNameKey: 'hero.core.zara.name',
        greed: QualitativeGrade.Low,
        caution: QualitativeGrade.Low,
        pride: QualitativeGrade.High,
        principleKeys: [],
        inclinationKeys: []
      }
    ],
    availableActions: LIVE_ACTIONS,
    offer: {
      ...base.offer!,
      keyHeroLever: {
        chosen: id('core:bram'),
        options: heroes.map((hero) => ({
          ...hero,
          selected: hero.value === id('core:bram')
        })),
        disabledReasonKey: null
      },
      crewLever: {
        ...base.offer!.crewLever,
        chosen: [id('core:bram'), id('core:doran')],
        options: heroes.map((hero) => ({
          ...hero,
          selected: hero.value !== id('core:zara')
        })),
        exactly: 2,
        disabledReasonKey: null
      }
    }
  });
}

/**
 * Two seats and two heroes invited — the shape a crew can actually be *changed* in.
 *
 * {@link crewedDraftModel} has one seat and one hero, so there is no tick to undo without
 * emptying the crew altogether; this one can lose a member and get it back.
 */
function twoSeatDraftModel(): ContractOfferScreenModel {
  const base = draftModel();
  const heroes = [
    { value: id('core:bram'), labelKey: 'hero.core.bram.name', selected: true },
    { value: id('core:doran'), labelKey: 'hero.core.doran.name', selected: true }
  ];

  return createContractOfferScreenModel({
    ...base,
    contract: { ...base.contract!, requiredCrew: 2 },
    roster: [
      ...base.roster,
      {
        definition: 'core:doran',
        displayNameKey: 'hero.core.doran.name',
        greed: QualitativeGrade.High,
        caution: QualitativeGrade.Low,
        pride: QualitativeGrade.Low,
        principleKeys: [],
        inclinationKeys: []
      }
    ],
    offer: {
      ...base.offer!,
      keyHeroLever: {
        ...base.offer!.keyHeroLever,
        options: heroes.map((hero) => ({ ...hero, selected: hero.value === id('core:bram') }))
      },
      crewLever: {
        ...base.offer!.crewLever,
        chosen: [id('core:bram'), id('core:doran')],
        options: heroes,
        exactly: 2
      }
    }
  });
}

/**
 * The six commands with nothing refusing them, and the six with every one refused.
 *
 * Two constants rather than one, because the component draws a different branch for each —
 * a live button carries no reason line, a dark one does — and a fixture that only ever took
 * one of them would leave the other unrendered by every test in this file.
 */
const LIVE_ACTIONS: readonly AvailableAction[] = OFFER_ACTIONS.map((action) => ({
  action,
  disabledReasonKey: null
}));

const DARK_ACTIONS: readonly AvailableAction[] = OFFER_ACTIONS.map((action) => ({
  action,
  disabledReasonKey: RejectionCodes.AlreadySettled
}));

/**
 * A content id in a hand-built fixture.
 *
 * A cast rather than `parseContentId`, because `apps/web` declares no dependency on the
 * simulation and must not gain one (`ADR-010`). Nothing in the app ever builds an id —
 * every one it holds came off a model — so the parser belongs to the layers that make
 * models, and these three fixtures are the only place in this app that states one at all.
 */
function id(text: string): ContentId {
  return text as ContentId;
}

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
      definition: id('core:escort_the_caravan'),
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
      // A draft: every lever live, every reason `null`. `max` is the patron fee on both
      // money levers, because the budget alone would allow far more on a treasury of 400
      // — `(400 − 25) / 3` and `400 − 40 × 3` — and whichever ceiling binds first is the
      // one a control can actually reach.
      advanceLever: { value: 40, min: 0, max: 40, disabledReasonKey: null },
      bonusLever: { value: 25, min: 0, max: 40, disabledReasonKey: null },
      methodLever: {
        // Deliberately the *second* option, not the first: external review of Task 17
        // found that a chosen-first fixture cannot tell a correct projection of the
        // chosen tag apart from a wrong one that just shows whichever option happens to
        // render first — the two coincide whenever the choice sorts first, which is what
        // the real factory's own convention always arranges. This model is hand-built and
        // owes that convention nothing, so the test below can actually discriminate.
        chosen: id('method:open'),
        options: [
          { value: id('method:deception'), labelKey: 'tag.method.deception', selected: false },
          { value: id('method:open'), labelKey: 'tag.method.open', selected: true }
        ],
        disabledReasonKey: null
      },
      keyHeroLever: {
        chosen: id('core:bram'),
        options: [{ value: id('core:bram'), labelKey: 'hero.core.bram.name', selected: true }],
        disabledReasonKey: null
      },
      crewLever: {
        chosen: [id('core:bram')],
        options: [{ value: id('core:bram'), labelKey: 'hero.core.bram.name', selected: true }],
        exactly: 3,
        disabledReasonKey: null
      },
      budget: { available: 400, maxAdvance: 125, maxBonus: 280, shortfall: 0 },
      lockCommitment: 145
    },
    // `400 + 40 - 40 * 1 - 25 = 375` — `settleContract`'s own formula
    // (`NEGOTIATION_SPEC` §3.3) with `pay: true`, over one accepted seat: the draft
    // phase can only have the key hero in `acceptedBy` (`NEGOTIATION_SPEC` §2.1).
    treasuryForecast: 375,
    availableActions: LIVE_ACTIONS,
    promiseTerms: {
      fulfilKey: PromiseTermsKeys.Fulfil,
      breachKey: PromiseTermsKeys.Breach,
      bonus: 25
    },
    settlement: null,
    deployment: null,
    forecast: null
  });
}

/**
 * A package locked with the crew still short a seat, as `NEGOTIATION_SPEC` §5.1
 * describes one: `requiredCrew: 3` against `acceptedCount: 1`. `settlement: null` is
 * set directly here, standing in for what a real `pollCrew` that did not fill the crew
 * would leave behind — this fixture does not run that command, so it proves the
 * screen's own conditional and not the engine's, exactly what the fourth test's own
 * comment now says.
 */
function lockedUncrewedModel(): ContractOfferScreenModel {
  return createContractOfferScreenModel({
    state: ScreenState.Incomplete,
    titleKey: TITLE_KEY,
    contract: {
      definition: id('core:silence_the_cult'),
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
      // Locked with a seat still open — the one shape where `locked` does *not* disable
      // anything (`RESOLUTION_SPEC` §6.2): a new version of the package is exactly the
      // move left, and every reason below is `null` because of it.
      advanceLever: { value: 20, min: 0, max: 55, disabledReasonKey: null },
      bonusLever: { value: 0, min: 0, max: 55, disabledReasonKey: null },
      methodLever: { chosen: null, options: [], disabledReasonKey: null },
      keyHeroLever: {
        chosen: id('core:mira'),
        options: [{ value: id('core:mira'), labelKey: 'hero.core.mira.name', selected: true }],
        disabledReasonKey: null
      },
      crewLever: {
        chosen: [id('core:mira')],
        options: [{ value: id('core:mira'), labelKey: 'hero.core.mira.name', selected: true }],
        exactly: 3,
        disabledReasonKey: null
      },
      budget: { available: 300, maxAdvance: 100, maxBonus: 240, shortfall: 0 },
      lockCommitment: 60
    },
    treasuryForecast: 335,
    availableActions: LIVE_ACTIONS,
    promiseTerms: null,
    settlement: null,
    deployment: null,
    forecast: null
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
      definition: id('core:collect_the_debt'),
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
      // Locked *and* crewed: the deal is struck, so every lever is disabled and each says
      // so on its own line — the branch `draftModel` and `lockedUncrewedModel` never take.
      advanceLever: { value: 15, min: 0, max: 30, disabledReasonKey: LeverDisabledKeys.Locked },
      bonusLever: { value: 10, min: 0, max: 30, disabledReasonKey: LeverDisabledKeys.Locked },
      methodLever: { chosen: null, options: [], disabledReasonKey: LeverDisabledKeys.Locked },
      keyHeroLever: {
        chosen: id('core:bram'),
        options: [
          { value: id('core:bram'), labelKey: 'hero.core.bram.name', selected: true },
          { value: id('core:doran'), labelKey: 'hero.core.doran.name', selected: false }
        ],
        disabledReasonKey: LeverDisabledKeys.Locked
      },
      crewLever: {
        chosen: [id('core:bram'), id('core:doran')],
        options: [
          { value: id('core:bram'), labelKey: 'hero.core.bram.name', selected: true },
          { value: id('core:doran'), labelKey: 'hero.core.doran.name', selected: true }
        ],
        exactly: 2,
        disabledReasonKey: LeverDisabledKeys.Locked
      },
      budget: { available: 300, maxAdvance: 145, maxBonus: 270, shortfall: 0 },
      lockCommitment: 40
    },
    treasuryForecast: 290,
    availableActions: DARK_ACTIONS,
    promiseTerms: {
      fulfilKey: PromiseTermsKeys.Fulfil,
      breachKey: PromiseTermsKeys.Breach,
      bonus: 10
    },
    deployment: null,
    forecast: null,
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
 * which a player reads — so this looks only at the four attributes a literal could
 * hide behind unseen by a text-node walk: `aria-label`, `title`, `placeholder`, `alt`.
 */
function literalsIn(Component: typeof ContractOfferScreen): readonly string[] {
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
        <Component model={model} controller={fakeController()} />
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

/**
 * `aria-label`, `title`, `placeholder` and `alt` — the attributes a literal could hide
 * behind. This screen renders no `<img>` today, so `alt` is latent coverage rather than
 * a branch this file currently exercises — the brief named it beside the other three,
 * and a scanner that only checks the ones a current component happens to use is a
 * scanner with an expiry date.
 */
function collectLabelledAttributes(root: Node): readonly string[] {
  const values: string[] = [];
  const ATTRIBUTES = ['aria-label', 'title', 'placeholder', 'alt'];

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

/**
 * The levers, wired.
 *
 * Everything below is about the one thing the model deliberately cannot hold: a package a
 * player is still assembling. `ContractOfferScreenModel` is what the campaign *records*,
 * and it is rebuilt from the engine on every command — so half-typed terms have nowhere to
 * live in it, and they live in the component instead. The rules that state governs are the
 * whole subject: what it starts as, what survives a refusal, and what a new contract
 * throws away.
 */
describe('the package a player is still assembling', () => {
  it('sends the whole package under one command, as the player left it', () => {
    // **Every term is moved off what the model records before the package is sent**, and
    // that is what makes this test worth anything. External review found the first version
    // typing `40` into a field the model already read `40` from, over a method, a key hero
    // and a crew nobody touched — so a screen that ignored the draft entirely and sent
    // `offer.advanceLever.value` and its neighbours would have passed. Not one field below
    // matches what `richDraftModel` records.
    const controller = fakeController();
    const { container } = renderWith(richDraftModel(), controller);

    type(control(container, 'offer.advance'), '41');
    type(control(container, 'offer.promised_bonus'), '26');
    // The method the package did *not* choose: `richDraftModel` chose `method:open`, which
    // the contract lists second.
    click(control(container, 'method-option-0'));
    // The third hero, neither the package's key hero nor the roster's first.
    click(control(container, 'key-hero-option-2'));
    // A different crew of the same size: drop `core:doran`, take `core:zara`.
    click(control(container, 'crew-option-1'));
    click(control(container, 'crew-option-2'));
    click(actionButton(container, OfferAction.Compose));

    expect(controller.calls.map((call) => call.name)).toEqual(['composeOfferFromDraft']);
    expect(controller.calls[0]?.args[0]).toBe('core:escort_the_caravan');
    // Every term of the package, not only the ones that were touched: `composeOffer`
    // replaces the package whole (`NEGOTIATION_SPEC` §3.3), so a screen sending less would
    // silently reset the rest to nothing.
    //
    // `invited` is in the options' own order and not the order the boxes were ticked —
    // `core:zara` was taken last and is listed last because that is where the roster puts
    // it, which is the rule this assertion pins.
    expect(controller.calls[0]?.args[1]).toEqual({
      advance: 41,
      promisedBonus: 26,
      methodTag: 'method:deception',
      keyHero: 'core:zara',
      invited: ['core:bram', 'core:zara']
    });
  });

  it('sends a different command when the key hero is asked', () => {
    // Two actions rather than one: recording the terms and asking the hero about them are
    // separate commands, and a screen that folded them into one button would either never
    // record the terms or never ask.
    const controller = fakeController();
    const { container } = renderWith(crewedDraftModel(), controller);

    click(actionButton(container, OfferAction.AskKeyHero));

    expect(controller.calls.map((call) => call.name)).toEqual(['askKeyHero']);
  });

  it('refuses to send a crew of the wrong size', () => {
    // `draftModel` needs three and offers one, so the crew is short from the start.
    // The bound is the model's own `crewLever.exactly`, not a number this screen picked.
    const { container } = renderWith(draftModel(), fakeController());

    expect(actionButton(container, OfferAction.Compose).disabled).toBe(true);
  });

  it('sends the crew a player actually ticked', () => {
    const controller = fakeController();
    const { container } = renderWith(twoSeatDraftModel(), controller);

    // Two seats, both ticked to begin with. Untick the second — `core:doran`, the option at
    // index 1 — and the crew is one short of what the contract asks, so the control goes
    // dark against the model's own `crewLever.exactly`.
    click(control(container, 'crew-option-1'));
    expect(actionButton(container, OfferAction.Compose).disabled).toBe(true);

    click(control(container, 'crew-option-1'));
    click(actionButton(container, OfferAction.Compose));

    expect(controller.calls[0]?.args[1]).toMatchObject({
      invited: ['core:bram', 'core:doran']
    });
  });

  it('keeps what was typed when the command is refused, and says why', () => {
    // The refusal leaves the campaign untouched, so the model comes back unchanged — and a
    // form rebuilt from an unchanged model would silently discard everything the player
    // had entered. This is the case that rule exists for.
    const controller = fakeController(RejectionCodes.StaleState);
    const { container } = renderWith(crewedDraftModel(), controller);

    type(control(container, 'offer.advance'), '17');
    click(actionButton(container, OfferAction.Compose));

    expect((control(container, 'offer.advance') as HTMLInputElement).value).toBe('17');
    expect(collectRenderedTexts(container)).toContain(textOf(RejectionCodes.StaleState));
  });

  it('throws the draft away when the contract underneath changes', () => {
    const { container, rerender } = renderWith(crewedDraftModel(), fakeController());

    type(control(container, 'offer.advance'), '17');
    expect((control(container, 'offer.advance') as HTMLInputElement).value).toBe('17');

    // Another contract entirely — `core:silence_the_cult` against `core:escort_the_caravan`.
    rerender(
      <TextSource catalogue={catalogue}>
        <ContractOfferScreen model={lockedUncrewedModel()} controller={fakeController()} />
      </TextSource>
    );

    expect((control(container, 'offer.advance') as HTMLInputElement).value).toBe(
      String(lockedUncrewedModel().offer!.advanceLever.value)
    );
  });

  it('throws the draft away when the package moves to a new version', () => {
    // The other half of the same rule, and the one a refusal must *not* trigger: an applied
    // `composeOffer` answers with `version + 1`, and everything the player typed is now
    // recorded — so the form starts again from what the campaign says rather than from what
    // they were still editing.
    const composed = crewedDraftModel();
    const { container, rerender } = renderWith(composed, fakeController());

    type(control(container, 'offer.advance'), '17');

    rerender(
      <TextSource catalogue={catalogue}>
        <ContractOfferScreen
          model={createContractOfferScreenModel({
            ...composed,
            offer: { ...composed.offer!, version: composed.offer!.version + 1 }
          })}
          controller={fakeController()}
        />
      </TextSource>
    );

    expect((control(container, 'offer.advance') as HTMLInputElement).value).toBe(
      String(composed.offer!.advanceLever.value)
    );
  });

  it.each([
    [OfferAction.Lock, 'lockOffer'],
    [OfferAction.Poll, 'pollCrew'],
    [OfferAction.Resolve, 'resolveContract']
  ])('%s presses its own command and nothing else', (action, expected) => {
    const controller = fakeController();
    const { container } = renderWith(everyActionLive(), controller);

    click(actionButton(container, action));

    expect(controller.calls.map((call) => call.name)).toEqual([expected]);
  });

  it('sends the player to the debrief rather than settling blind', () => {
    // Owner's decision of 2026-08-28. Settling means choosing whether to pay the promised
    // bonus, and the price of both branches is on the debrief — a button here that paid
    // one way or the other would be the Football Manager failure mode this whole design
    // fights: a promise answered without the player being able to see what it cost.
    const controller = fakeController();
    const { container } = renderWith(everyActionLive(), controller);

    click(actionButton(container, OfferAction.Settle));

    expect(controller.calls).toEqual([{ name: 'show', args: ['after_action'] }]);
  });

  it('presses nothing at all through a dark control', () => {
    const controller = fakeController();
    const { container } = renderWith(crewedModel(), controller);

    for (const action of OFFER_ACTIONS) {
      click(actionButton(container, action));
    }

    expect(controller.calls).toEqual([]);
  });
});

/**
 * What a number field does with input that is legal for `input[type=number]` and is not an
 * integer.
 *
 * Every money term of a package is an integer — `advance` and `promisedBonus` are ints all
 * the way down to the canonical artifact (`RESOLUTION_SPEC` §4.8) — but the control accepts
 * far more than integers, and external review found what the first implementation did with
 * the rest: `Number.parseInt` reads `1e1` as `1` and `1.5` as `1`, so the package quietly
 * carried a term the player never typed.
 */
describe('the numbers a player types', () => {
  function advanceAfter(typed: string): number {
    const controller = fakeController();
    const { container } = renderWith(everyActionLive(), controller);

    type(control(container, 'offer.advance'), typed);
    click(actionButton(container, OfferAction.Compose));

    return (controller.calls[0]?.args[1] as { readonly advance: number }).advance;
  }

  it.each([
    ['a plain integer', '7', 7],
    // Legal in the control and not an integer: the field must keep what it had rather than
    // invent a term by truncation. `draftModel`'s own advance is 40.
    ['exponential notation', '1e1', 10],
    ['a fraction', '1.5', 40],
    ['nothing at all', '', 40]
  ])('%s becomes %s', (_name, typed, expected) => {
    expect(advanceAfter(typed)).toBe(expected);
  });

  it('declares itself an integer control', () => {
    // `step` is what makes the browser itself refuse a fraction, rather than leaving the
    // whole burden on the handler above.
    const { container } = renderWith(everyActionLive(), fakeController());

    expect((control(container, 'offer.advance') as HTMLInputElement).step).toBe('1');
  });
});

/**
 * A screen whose six controls are not all in the same condition.
 *
 * External review found that every interactive fixture in this file was uniform — six live
 * or six dark, all for one reason — so an implementation that computed `disabled` once, off
 * the first entry, would pass the lot. Real models are never uniform: the whole point of
 * `availableActions` is that one command is live while five explain themselves.
 */
describe('a screen with some controls live and others dark', () => {
  const MIXED: readonly AvailableAction[] = [
    { action: OfferAction.Compose, disabledReasonKey: null },
    { action: OfferAction.AskKeyHero, disabledReasonKey: RejectionCodes.AlreadyResponded },
    { action: OfferAction.Lock, disabledReasonKey: null },
    { action: OfferAction.Poll, disabledReasonKey: RejectionCodes.OfferNotLocked },
    { action: OfferAction.Resolve, disabledReasonKey: RejectionCodes.CrewNotFilled },
    { action: OfferAction.Settle, disabledReasonKey: RejectionCodes.NotResolved }
  ];

  function mixedModel(): ContractOfferScreenModel {
    return createContractOfferScreenModel({ ...crewedDraftModel(), availableActions: MIXED });
  }

  it('darkens exactly the ones the model refuses', () => {
    const { container } = renderWith(mixedModel(), fakeController());

    expect(MIXED.map((available) => actionButton(container, available.action).disabled)).toEqual(
      MIXED.map((available) => available.disabledReasonKey !== null)
    );
  });

  it('presses only through the live ones', () => {
    const controller = fakeController();
    const { container } = renderWith(mixedModel(), controller);

    for (const available of MIXED) {
      click(actionButton(container, available.action));
    }

    // Compose and lock, in that order, and nothing from the four that are dark.
    expect(controller.calls.map((call) => call.name)).toEqual([
      'composeOfferFromDraft',
      'lockOffer'
    ]);
  });
});
