// @vitest-environment jsdom
import {
  createSessionController,
  type SaveStorePort,
  type SessionController
} from '@oath-and-coin/application';
import { RULESET_VERSION } from '@oath-and-coin/content';
import {
  AFTER_ACTION_LOADING_SCREEN,
  RejectionCodes,
  SETTLEMENT_CONSEQUENCE_KEYS,
  ScreenKind,
  ScreenState,
  afterActionFailedScreen,
  afterActionScreenModel,
  expectedSnapshot,
  snapshotHash,
  type AfterActionScreenModel,
  type ContentId,
  type RejectionCode
} from '@oath-and-coin/presentation';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  browserContentSource,
  browserLocaleCatalogue,
  browserUiTextCatalogue,
  shippedContentVersion
} from '../../content-source.ts';
import { collectRenderedAttributes, collectRenderedTexts } from '../../rendered-texts.ts';
import { click, render } from '../../testing/render.tsx';
import { TextSource } from '../../text.tsx';

import { AfterActionScreen, type AfterActionScreenActions } from './after-action-screen.tsx';

/**
 * The debrief, held to the two comparisons the offer screen is held to.
 *
 * `expectedSnapshot` builds the texts a correctly bound debrief should produce, this file
 * walks the DOM one actually produced, and neither side can see the other — which is what
 * makes agreement evidence rather than a tautology. `readModelHash` cannot stand in for it:
 * a forgotten binding, two swapped blocks or a dropped consequence leave that one green.
 *
 * **The models are runs, not hand-written objects.** Every one below comes out of a scenario
 * this repository ships, replayed against the shipped content, so a screen agreeing with a
 * model no campaign can produce would still be red here. The two states that have no
 * campaign behind them at all — `Loading` and `Error` — are the factories' own constants,
 * which is exactly what those exist for.
 */

/** The seed the scenario runner's CLI defaults to, and the one the corpus records. */
const SEED = 424242n;

let catalogue: ReadonlyMap<string, string>;

beforeAll(() => {
  catalogue = new Map([...browserLocaleCatalogue('ru'), ...browserUiTextCatalogue('ru')]);
});

/**
 * A store that refuses every call, for the sessions below that never save or load.
 *
 * Loud rather than empty: a controller reaching a storage in a test about a screen would be
 * doing something this file did not ask for, and a stub answering `null` politely would let
 * it.
 */
function noSaveStore(): SaveStorePort {
  const refuse = (): never => {
    throw new Error('This test drives a screen, not a save slot.');
  };

  return { read: refuse, write: refuse, list: refuse, clear: refuse } as unknown as SaveStorePort;
}

/** A live session over the shipped content, replayed to `checkpoint` of `scenario`. */
function controllerFor(scenario: string, checkpoint: string): SessionController {
  const controller = createSessionController({
    request: {
      content: browserContentSource(),
      scenario,
      // Stated rather than left to the manifest's default: a checkpoint is an input to a run
      // (`ADR-008`), and a test that let it be inferred would stop noticing if it moved.
      checkpoint,
      seed: SEED
    },
    saves: noSaveStore(),
    now: () => '1970-01-01T00:00:00.000Z',
    expected: { rulesetVersion: RULESET_VERSION, contentVersion: shippedContentVersion() }
  });

  void controller.start();

  return controller;
}

/**
 * The debrief of whatever contract `scenario` left the player on.
 *
 * Built through the factory rather than read off `session.screen`, because two of the five
 * states are only reachable that way: `RESOLUTION_SPEC` §6.4 routes a settled campaign to the
 * board and an unresolved one to the offer, and the debrief of each still exists — a player
 * reaches it with the manual move `SessionController.show` makes.
 */
function debriefFor(scenario: string, checkpoint: string): AfterActionScreenModel {
  const session = controllerFor(scenario, checkpoint).store.snapshot();

  if (session.state === null || session.focusedContract === null) {
    throw new Error(`'${scenario}' produced no campaign to debrief.`);
  }

  return afterActionScreenModel(session.state, session.focusedContract);
}

/**
 * A promise still to be answered: `screen_locked`'s package, polled and sent out by **live**
 * commands.
 *
 * The two commands are dispatched here rather than scripted into the scenario because no
 * shipped scenario stops between the outcome and the settlement — every one that resolves
 * goes on to settle in the same command list, which is the state §6.4 routes to the board.
 * So the run supplies the package and these dispatches supply the two steps that turn it
 * into an outcome, exactly as a player's own presses do.
 *
 * **`screen_locked` rather than `screen_settlement_due`, and the difference is the whole
 * point of the fixture.** That one is a single-seat contract whose key hero *is* the entire
 * crew, so a component rendering `keyHero` where it should render the crew — or the crew's
 * first man where it should render the key hero — agreed with the expectation by
 * coincidence. Here four heroes go out and the key hero is `core:ilsa`, who is neither the
 * first of them nor the only one.
 *
 * The screen is read off the session rather than rebuilt, because this is the one state
 * §6.4's first row is about: an applied `resolveContract` *is* the debrief.
 */
function aPromisedDebrief(): AfterActionScreenModel {
  return aResolvedDebrief('screen_locked', 'screen_locked', ['pollCrew', 'resolveContract']);
}

/**
 * The same shape with nothing promised: `crew_filled`'s package, whose crew the run has
 * already filled, so only `resolveContract` is left to dispatch.
 *
 * `settleContract` ignores `pay` here (`NEGOTIATION_SPEC` §6), which is why this run and the
 * one above must both be drawn: they are the two shapes the settlement block has, and a
 * matrix carrying only the promised one lets the other be drawn as a choice that does not
 * exist.
 *
 * `resolution-fitting-crew-wins` would be the obvious pick — it stops at its own
 * `resolveContract` — and cannot be used: its content root names contracts under
 * `fixture:the_long_road`, which `content/locale/ru.json` does not answer for, so a render
 * against the shipped catalogue throws on the contract's own name.
 */
function anUnpromisedDebrief(): AfterActionScreenModel {
  return aResolvedDebrief('crew_filled', 'final', ['resolveContract']);
}

function aResolvedDebrief(
  scenario: string,
  checkpoint: string,
  live: readonly ('pollCrew' | 'resolveContract')[]
): AfterActionScreenModel {
  const controller = controllerFor(scenario, checkpoint);
  const contractId = controller.store.snapshot().focusedContract;

  if (contractId === null) {
    throw new Error(`'${scenario}' left no contract focused.`);
  }

  for (const command of live) {
    const result =
      command === 'pollCrew'
        ? controller.pollCrew({ contractId })
        : controller.resolveContract({ contractId });

    if (!result.applied) {
      throw new Error(
        `The fixture's own ${command} on '${scenario}' was refused as ` +
          `'${String(result.rejectionCode)}'; a run that cannot send its crew out is measuring ` +
          'the refusal, not the screen.'
      );
    }
  }

  const { screen } = controller.store.snapshot();

  if (screen.screen !== ScreenKind.AfterAction) {
    throw new Error(`'${scenario}' landed on '${screen.screen}', not the debrief.`);
  }

  return screen;
}

/** The contract a debrief is about, or a loud failure when it is about none. */
function contractOf(model: AfterActionScreenModel): ContentId {
  if (model.contractDefinition === null) {
    throw new Error('This debrief names no contract, so there is nothing to settle.');
  }

  return model.contractDefinition;
}

/**
 * The five shapes the debrief can be in, each from the run that produces it — and `Incomplete`
 * twice, because the settlement block has two shapes of its own inside that one state.
 *
 * `screen_normal` polls a crew and stops, so its contract carries no resolution — the `Empty`
 * debrief, which is what a player sees on a contract whose crew is still at home.
 * `promise_kept` settles, which closes the contract and leaves nothing to answer.
 */
const STATES = [
  {
    state: ScreenState.Loading,
    describe: 'a page whose session has not arrived',
    model: () => AFTER_ACTION_LOADING_SCREEN
  },
  {
    state: ScreenState.Error,
    describe: 'a run that never reached a campaign',
    model: () => afterActionFailedScreen('CONTENT_ROOT_NOT_FOUND', 'irrelevant to this check')
  },
  {
    state: ScreenState.Empty,
    describe: 'a contract whose crew has not gone out',
    model: () => debriefFor('screen_normal', 'screen_normal')
  },
  {
    state: ScreenState.Incomplete,
    describe: 'an outcome whose promise has not been answered',
    model: aPromisedDebrief
  },
  {
    state: ScreenState.Incomplete,
    describe: 'an outcome on a package that promised nothing',
    model: anUnpromisedDebrief
  },
  {
    state: ScreenState.Normal,
    describe: 'a contract that has been settled',
    model: () => debriefFor('promise_kept', 'final')
  }
] as const;

interface FakeController extends AfterActionScreenActions {
  readonly calls: { name: string; args: readonly unknown[] }[];
}

/**
 * A controller that records what the screen asked of it and answers as told.
 *
 * One method, because the screen's prop type is the one command it may send: a debrief that
 * grew a call to `lockOffer` or to `save` would not compile against this fake, which is the
 * point of narrowing the prop rather than handing the component the whole controller.
 */
function fakeController(refusal: RejectionCode | null = null): FakeController {
  const calls: { name: string; args: readonly unknown[] }[] = [];

  return {
    calls,
    settleContract: ((...args: readonly unknown[]) => {
      calls.push({ name: 'settleContract', args });

      return refusal === null
        ? { applied: true, rejectionCode: null, state: null, events: [], decisions: [] }
        : { applied: false, rejectionCode: refusal, state: null, events: [], decisions: [] };
    }) as never
  };
}

function renderScreen(
  model: AfterActionScreenModel,
  controller: AfterActionScreenActions = fakeController()
): HTMLElement {
  return render(
    <TextSource catalogue={catalogue}>
      <AfterActionScreen model={model} controller={controller} />
    </TextSource>
  );
}

/** The control carrying `testId`, or a loud failure naming what was looked for. */
function control(container: HTMLElement, testId: string): HTMLButtonElement {
  const element = container.querySelector(`[data-testid="${testId}"]`);

  if (element === null) {
    throw new Error(`No control marked '${testId}' was rendered.`);
  }

  return element as HTMLButtonElement;
}

/** The text `key` resolves to, or a loud failure — the same rule the screen itself follows. */
function textOf(key: string): string {
  const text = catalogue.get(key);

  if (text === undefined) {
    throw new Error(`Neither catalogue answers '${key}'.`);
  }

  return text;
}

describe('the five states a debrief can be in', () => {
  it.each(STATES)('$describe is $state', ({ state, model }) => {
    // Asserted rather than believed: the comparisons below say the markup matches the
    // model, never that the model is the one this row is about.
    expect(model().state).toBe(state);
  });

  it.each(STATES)('$describe renders exactly the texts the snapshot expects', ({ model }) => {
    const screen = model();

    expect(collectRenderedTexts(renderScreen(screen))).toEqual(expectedSnapshot(screen, catalogue));
  });

  it.each(STATES)('$describe agrees on the rendered-ui hash', ({ model }) => {
    // The same claim in the form the runtime harness compares (`ADR-008`). Kept beside the
    // list comparison rather than instead of it: a hash says the two differ, the list says
    // where.
    const screen = model();

    expect(snapshotHash(collectRenderedTexts(renderScreen(screen)))).toBe(
      snapshotHash(expectedSnapshot(screen, catalogue))
    );
  });
});

describe('the promise still to be answered', () => {
  it('prices both branches, and both are pressable, before either is chosen', () => {
    // The Football Manager failure mode this screen exists to fix: there, a promise is
    // answered without its price being legible, so the player learns to read promises as a
    // tax. Both futures are on the page before either button is live.
    const model = aPromisedDebrief();
    const container = renderScreen(model);
    const shown = collectRenderedTexts(container);

    expect(model.settlement?.treasuryIfKept).not.toBe(model.settlement?.treasuryIfBroken);
    expect(shown).toContain(String(model.settlement?.treasuryIfKept));
    expect(shown).toContain(String(model.settlement?.treasuryIfBroken));
    expect(control(container, 'settle-pay').disabled).toBe(false);
    expect(control(container, 'settle-refuse').disabled).toBe(false);
  });

  it('names what each branch costs beyond the purse', () => {
    // The money is the half a player can work out for themselves. What breaking a word does
    // to the man it was given to is the other half, and the reason `RESOLUTION_SPEC` §6.1
    // puts this block in front of them at all.
    const model = aPromisedDebrief();
    const shown = collectRenderedTexts(renderScreen(model));
    const promise = model.settlement?.promise;

    expect(promise?.keepConsequenceKeys.length).toBeGreaterThan(0);
    expect(promise?.breakConsequenceKeys.length).toBeGreaterThan(0);

    for (const key of [...(promise?.keepConsequenceKeys ?? [])]) {
      expect(shown).toContain(textOf(key));
    }

    for (const key of [...(promise?.breakConsequenceKeys ?? [])]) {
      expect(shown).toContain(textOf(key));
    }
  });

  it.each([
    { testId: 'settle-pay', pay: true },
    { testId: 'settle-refuse', pay: false }
  ])('$testId settles this contract with pay: $pay', ({ testId, pay }) => {
    const model = aPromisedDebrief();
    const controller = fakeController();

    click(control(renderScreen(model, controller), testId));

    expect(controller.calls).toEqual([
      { name: 'settleContract', args: [{ contractId: contractOf(model), pay }] }
    ]);
  });

  it('shows the refusal a settlement came back with', () => {
    // §6.4: a refused `settleContract` leaves the player on the debrief. Nothing moves, so
    // the code the engine answered with is the only thing that can say what happened.
    const controller = fakeController(RejectionCodes.StaleState);
    const container = renderScreen(aPromisedDebrief(), controller);

    click(control(container, 'settle-pay'));

    expect(collectRenderedTexts(container)).toContain(textOf(RejectionCodes.StaleState));
  });

  it('says nothing about a refusal until one has happened', () => {
    // The refusal belongs to the moment rather than to the model, which is why it is outside
    // every snapshot above — and why a screen showing one before any press would put a text
    // on the page that `expectedSnapshot` cannot account for.
    expect(collectRenderedTexts(renderScreen(aPromisedDebrief()))).not.toContain(
      textOf(RejectionCodes.StaleState)
    );
  });

  it('names the whole crew and the key hero, who is neither the first of them nor all of them', () => {
    // Two mutants this closes, both of which the single-seat fixture this file started with
    // left green: rendering `keyHero` where the crew belongs, and rendering the crew's first
    // man where the key hero belongs.
    const model = aPromisedDebrief();
    const shown = collectRenderedTexts(renderScreen(model));
    const crew = model.settlement?.crew ?? [];
    const keyHero = model.settlement?.keyHero;

    expect(crew.length).toBeGreaterThan(1);
    expect(keyHero?.definition).not.toBe(crew[0]?.definition);

    for (const hero of crew) {
      expect(shown).toContain(textOf(hero.displayNameKey));
    }

    expect(shown).toContain(textOf(keyHero?.displayNameKey ?? ''));
  });

  it('offers nothing to press once the contract is settled', () => {
    // The money has moved and there is no promise left to answer, so a button here would
    // offer a choice the player has already made.
    const container = renderScreen(debriefFor('promise_kept', 'final'));

    expect(container.querySelector('[data-testid="settle-pay"]')).toBeNull();
    expect(container.querySelector('[data-testid="settle-refuse"]')).toBeNull();
  });
});

describe('a package that promised nothing', () => {
  it('offers one command and one figure, not a choice between two of each', () => {
    // `settleContract` ignores `pay` here (`NEGOTIATION_SPEC` §6): both presses produce the
    // same campaign, and the two treasuries are the same number. External review found this
    // drawn as a decision on a shipped run, which is a screen inventing one the campaign
    // does not offer.
    const model = anUnpromisedDebrief();
    const container = renderScreen(model);

    expect(model.settlement?.promise).toBeNull();
    expect(model.settlement?.treasuryIfKept).toBe(model.settlement?.treasuryIfBroken);
    expect(container.querySelector('[data-testid="settle-pay"]')).toBeNull();
    expect(container.querySelector('[data-testid="settle-refuse"]')).toBeNull();
    expect(control(container, 'settle').disabled).toBe(false);
  });

  it('warns of no consequence, because the engine applies none', () => {
    const shown = collectRenderedTexts(renderScreen(anUnpromisedDebrief()));

    for (const key of SETTLEMENT_CONSEQUENCE_KEYS) {
      expect(shown).not.toContain(textOf(key));
    }
  });

  it('settles the contract when its one command is pressed', () => {
    const model = anUnpromisedDebrief();
    const controller = fakeController();

    click(control(renderScreen(model, controller), 'settle'));

    expect(controller.calls).toEqual([
      { name: 'settleContract', args: [{ contractId: contractOf(model), pay: true }] }
    ]);
  });
});

describe('what never reaches a player', () => {
  it('shows no raw content id, in text or in an attribute, on any of the five states', () => {
    // `TDD` §11.1. The snapshot comparisons above already fail when a definition is
    // rendered, but only because `expectedSnapshot` leaves it out — this states the rule
    // itself, so an edit teaching both sides to show one would still have to answer for it.
    //
    // Attributes as well as text, and substrings rather than equality: a `data-testid`
    // carrying a hero's id is the same leak as a label carrying it, and `id: core:bram`
    // leaks exactly as much as `core:bram`.
    for (const row of STATES) {
      const model = row.model();
      const shown = shownStrings(renderScreen(model));

      for (const identifier of rawIdentifiersOf(model)) {
        expect(
          shown.filter((value) => value.includes(identifier)),
          `${row.state} must not show '${identifier}'`
        ).toEqual([]);
      }
    }
  });

  it('shows no part of the error detail, on the state that has one', () => {
    // Assembled in code, carrying a machine's own path, and covered by neither hash — the
    // one unlocalized player-facing string the Godot original leaked, through a tooltip.
    const detail = 'C:/somewhere/that/does/not/exist';

    expect(
      shownStrings(renderScreen(afterActionFailedScreen('CONTENT_ROOT_NOT_FOUND', detail)))
    ).toEqual(expect.not.arrayContaining([expect.stringContaining(detail)]));
  });
});

function shownStrings(container: HTMLElement): readonly string[] {
  return [...collectRenderedTexts(container), ...collectRenderedAttributes(container)];
}

/** Every content id the model carries for bookkeeping, none of which may reach the page. */
function rawIdentifiersOf(model: AfterActionScreenModel): readonly string[] {
  return [
    ...(model.contractDefinition === null ? [] : [model.contractDefinition]),
    ...model.events.flatMap((line) => (line.heroDefinition === null ? [] : [line.heroDefinition])),
    ...model.contributions.map((line) => line.heroDefinition),
    ...model.deficits.flatMap((line) => line.heroes.map((hero) => hero.definition)),
    ...model.consequences.map((line) => line.heroDefinition),
    ...(model.settlement === null
      ? []
      : [
          ...(model.settlement.keyHero === null ? [] : [model.settlement.keyHero.definition]),
          ...model.settlement.crew.map((hero) => hero.definition)
        ])
  ].map(String);
}
