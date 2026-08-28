// @vitest-environment jsdom
import {
  createSessionController,
  type SaveStorePort,
  type SessionController
} from '@oath-and-coin/application';
import { RULESET_VERSION } from '@oath-and-coin/content';
import {
  CONTRACT_BOARD_LOADING_SCREEN,
  ContractAvailability,
  ScreenKind,
  ScreenState,
  contractBoardFailedScreen,
  contractDisplayNameKey,
  createContractBoardScreenModel,
  expectedSnapshot,
  snapshotHash,
  type ContentId,
  type ContractBoardScreenModel
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

import { ContractBoardScreen, type ContractBoardScreenActions } from './contract-board-screen.tsx';

/**
 * The board, held to the two comparisons the other two screens are held to — and to one
 * thing neither of them has to answer: pressing a row is how the loop starts over, so this
 * file also walks a contract from a locked package to a settlement and back to the board.
 *
 * **The models are runs.** Every populated board below comes out of a scenario this
 * repository ships, replayed against the shipped content, so a component agreeing with a
 * model no campaign can produce would still be red here. The two states with no campaign
 * behind them at all — `Loading` and `Error` — are the factory's own constants.
 */

/** The seed the scenario runner's CLI defaults to, and the one the corpus records. */
const SEED = 424242n;

/** The contracts of the shipped tree this file presses on. */
const CRYPT = 'core:cleanse_the_crypt' as ContentId;
const DEBT = 'core:collect_the_debt' as ContentId;
const CARAVAN = 'core:escort_the_caravan' as ContentId;
const CULT = 'core:silence_the_cult' as ContentId;

/** The four heroes one fixture below sends to the crypt — the seats it asks for. */
const BRAM = 'core:bram' as ContentId;
const DORAN = 'core:doran' as ContentId;
const KESTREL = 'core:kestrel' as ContentId;
const MIRA = 'core:mira' as ContentId;

let catalogue: ReadonlyMap<string, string>;

beforeAll(() => {
  catalogue = new Map([...browserLocaleCatalogue('ru'), ...browserUiTextCatalogue('ru')]);
});

/**
 * A store that refuses every call, for the sessions below that never save or load.
 *
 * Loud rather than empty, the same choice the debrief's own suite makes: a controller
 * reaching a storage in a test about a screen would be doing something this file did not
 * ask for.
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
      // Stated rather than left to the manifest's default: a checkpoint is an input to a
      // run (`ADR-008`), and a test that let it be inferred would stop noticing if it moved.
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
 * The board a settled campaign lands on, with a second contract already under way.
 *
 * `screen_word_broken` settles `core:collect_the_debt` and breaks its word, which is
 * exactly the row §6.4 routes to the board (`session.ts`'s own table). The package composed
 * on the crypt afterwards is a live command, not a hand-built row, and it is here because
 * without it this file drew no `in_progress` row at all: external review of this task found
 * the mutant that follows from that, `disabled={opensScreen === null || availability ===
 * InProgress}` — the value-branch this whole design exists to forbid — surviving the entire
 * suite.
 *
 * Composing moves the focus to the crypt, and §6.4 then puts an unresolved contract on the
 * negotiation, so the board is asked for again with `show`. That the settlement *routes*
 * here on its own is the loop test's claim, asserted there against the untouched session.
 *
 * The result carries three of the four availabilities — settled, in progress, open — which
 * is every kind this component has to draw differently except the resolved one
 * ({@link aResolvedBoard}).
 */
function aSettledBoard(): ContractBoardScreenModel {
  const controller = controllerFor('screen_word_broken', 'screen_word_broken');
  const composed = controller.composeOfferFromDraft(CRYPT, {
    // Deliberately modest terms: `composeOffer` bounds the advance and the bonus by the
    // patron fee and checks the crew size, and nothing else (`NEGOTIATION_SPEC` §3.3) — this
    // fixture is about a contract being *started*, not about what it costs.
    advance: 5,
    promisedBonus: 0,
    methodTag: null,
    keyHero: BRAM,
    invited: [BRAM, DORAN, KESTREL, MIRA]
  });

  if (!composed.applied) {
    throw new Error(
      `The fixture's own composeOffer was refused as '${String(composed.rejectionCode)}'; a ` +
        'board with no contract under way is not the board this file is about.'
    );
  }

  controller.show(ScreenKind.ContractBoard);

  const { screen } = controller.store.snapshot();

  if (screen.screen !== ScreenKind.ContractBoard) {
    throw new Error(`'screen_word_broken' would not show the board; '${screen.screen}' did.`);
  }

  return screen;
}

/**
 * A board with nothing left to take.
 *
 * Assembled from {@link aSettledBoard}'s own rows rather than from a run, and that is a
 * limit of the shipped corpus rather than a preference: the tree ships six contracts and
 * no scenario starts all of them, so `Incomplete` is unreachable from any manifest. Every row
 * here is still a row a campaign produced — the filter drops rows, it does not invent one —
 * and the factory recomputes the state from what is left, so a board claiming the wrong
 * word about its own rows would throw here rather than render. The reachability of
 * `Incomplete` from a real campaign is `contract-board-screen-model.test.ts`'s to prove;
 * what this file needs is the markup for it.
 */
function aFinishedBoard(): ContractBoardScreenModel {
  const board = aSettledBoard();
  const rows = board.rows.filter((row) => row.availability !== ContractAvailability.Open);

  if (rows.length < 2) {
    throw new Error(
      'A finished board assembled from fewer than two rows would say nothing about the ' +
        'difference between a contract that is closed and one that is under way.'
    );
  }

  return createContractBoardScreenModel({
    ...board,
    state: ScreenState.Incomplete,
    rows
  });
}

/** The board of a campaign whose content root carries no contract at all. */
function anEmptyBoard(): ContractBoardScreenModel {
  const controller = controllerFor('screen_empty', 'screen_empty');
  const { state } = controller.store.snapshot();

  if (state === null) {
    throw new Error("'screen_empty' produced no campaign.");
  }

  controller.show(ScreenKind.ContractBoard);

  const { screen } = controller.store.snapshot();

  if (screen.screen !== ScreenKind.ContractBoard) {
    throw new Error(`'screen_empty' would not show the board; it showed '${screen.screen}'.`);
  }

  return screen;
}

const STATES = [
  {
    state: ScreenState.Loading,
    describe: 'a page whose session has not arrived',
    model: () => CONTRACT_BOARD_LOADING_SCREEN
  },
  {
    state: ScreenState.Error,
    describe: 'a run that never reached a campaign',
    model: () => contractBoardFailedScreen('CONTENT_ROOT_NOT_FOUND', 'irrelevant to this check')
  },
  {
    state: ScreenState.Empty,
    describe: 'a campaign with no contract on it',
    model: anEmptyBoard
  },
  {
    state: ScreenState.Incomplete,
    describe: 'a board with nothing left to take',
    model: aFinishedBoard
  },
  {
    state: ScreenState.Normal,
    describe: 'a campaign with one contract settled, one under way and two still open',
    model: aSettledBoard
  }
] as const;

interface FakeController extends ContractBoardScreenActions {
  readonly calls: { name: string; args: readonly unknown[] }[];
}

/**
 * A controller that records what the board asked of it.
 *
 * Two methods, because the prop type is the two moves a board may make: a board that grew a
 * call to `settleContract` or to `save` would not compile against this fake.
 */
function fakeController(): FakeController {
  const calls: { name: string; args: readonly unknown[] }[] = [];

  return {
    calls,
    focus: (contractId) => {
      calls.push({ name: 'focus', args: [contractId] });
    },
    show: (screen) => {
      calls.push({ name: 'show', args: [screen] });
    }
  };
}

function renderScreen(
  model: ContractBoardScreenModel,
  controller: ContractBoardScreenActions = fakeController()
): HTMLElement {
  return render(
    <TextSource catalogue={catalogue}>
      <ContractBoardScreen model={model} controller={controller} />
    </TextSource>
  );
}

/** The text `key` resolves to, or a loud failure — the same rule the screen itself follows. */
function textOf(key: string): string {
  const text = catalogue.get(key);

  if (text === undefined) {
    throw new Error(`Neither catalogue answers '${key}'.`);
  }

  return text;
}

/**
 * The control that opens `contract`, found by the name a player reads on it.
 *
 * By text rather than by a hook carrying the id, because the id may not reach an attribute
 * either (`TDD` §11.1) — and because "the contract's own name is what you press" is the
 * claim, so looking it up any other way would leave it unchecked.
 */
function rowControl(container: HTMLElement, contract: ContentId): HTMLButtonElement {
  const name = textOf(contractDisplayNameKey(contract));
  const control = [...container.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === name
  );

  if (control === undefined) {
    throw new Error(`No control on this board is named '${name}'.`);
  }

  return control;
}

describe('the five states a board can be in', () => {
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
    const screen = model();

    expect(snapshotHash(collectRenderedTexts(renderScreen(screen)))).toBe(
      snapshotHash(expectedSnapshot(screen, catalogue))
    );
  });
});

describe('what a row leads to', () => {
  it('will not reopen a contract that has already been settled', () => {
    // The money has moved and §6.4 puts a settled contract on this very board, so a live
    // control here would be one that takes a player to the page they are standing on.
    const board = aSettledBoard();

    expect(board.rows.find((row) => row.definition === DEBT)?.availability).toBe(
      ContractAvailability.Settled
    );
    expect(rowControl(renderScreen(board), DEBT).disabled).toBe(true);
  });

  it('opens the negotiation of a contract nobody has taken', () => {
    const controller = fakeController();
    const board = aSettledBoard();

    expect(board.rows.find((row) => row.definition === CULT)?.availability).toBe(
      ContractAvailability.Open
    );

    click(rowControl(renderScreen(board, controller), CULT));

    // Two calls in this order, and the order is the whole of it: `focus` moves the
    // contract and redraws whatever screen is up, `show` moves the screen — so a board
    // that showed first would draw the offer of the *previous* contract for a frame.
    expect(controller.calls).toEqual([
      { name: 'focus', args: [CULT] },
      { name: 'show', args: [ScreenKind.ContractOffer] }
    ]);
  });

  it('keeps a contract already under way open, and reopens its negotiation', () => {
    // The row external review found untested, and the mutant that followed from it:
    // `disabled={opensScreen === null || availability === InProgress}` survived the whole
    // suite. It is the value-branch this design forbids, and it would strand a player on a
    // package they had started — `RESOLUTION_SPEC` §6.2's way out of a dead end runs
    // through exactly this row.
    const controller = fakeController();
    const board = aSettledBoard();
    const container = renderScreen(board, controller);

    expect(board.rows.find((row) => row.definition === CRYPT)?.availability).toBe(
      ContractAvailability.InProgress
    );
    expect(rowControl(container, CRYPT).disabled).toBe(false);

    click(rowControl(container, CRYPT));

    expect(controller.calls).toEqual([
      { name: 'focus', args: [CRYPT] },
      { name: 'show', args: [ScreenKind.ContractOffer] }
    ]);
  });

  it('sends a contract whose crew came back to its debrief instead', () => {
    // The row passes the model's own answer through; it does not read the word beside it
    // and pick a screen. A component that always showed the offer would be green on every
    // other row of this file and wrong on exactly this one.
    const controller = fakeController();
    const board = aResolvedBoard();

    click(rowControl(renderScreen(board, controller), CARAVAN));

    expect(board.rows.find((row) => row.definition === CARAVAN)?.availability).toBe(
      ContractAvailability.Resolved
    );
    expect(controller.calls).toEqual([
      { name: 'focus', args: [CARAVAN] },
      { name: 'show', args: [ScreenKind.AfterAction] }
    ]);
  });

  it('offers nothing to press on a board with no campaign behind it', () => {
    expect(renderScreen(CONTRACT_BOARD_LOADING_SCREEN).querySelectorAll('button')).toHaveLength(0);
  });
});

/**
 * A campaign stopped between the outcome and the settlement, shown as a board.
 *
 * The resolution is dispatched live rather than scripted, for the reason the debrief's own
 * suite gives: no shipped scenario stops there — every one that resolves goes on to settle
 * in the same command list. `show` is the manual move a player makes with "back to the
 * board", which is the only way this state is reachable as a board at all (§6.4 routes it
 * to the debrief).
 */
function aResolvedBoard(): ContractBoardScreenModel {
  const controller = controllerFor('screen_locked', 'screen_locked');

  apply(controller, CARAVAN, ['pollCrew', 'resolveContract']);
  controller.show(ScreenKind.ContractBoard);

  const { screen } = controller.store.snapshot();

  if (screen.screen !== ScreenKind.ContractBoard) {
    throw new Error(`The board would not show; '${screen.screen}' did.`);
  }

  return screen;
}

type LoopCommand = 'pollCrew' | 'resolveContract' | 'settleContract';

/** Dispatches `commands` against `contract`, refusing to continue past a refusal. */
function apply(
  controller: SessionController,
  contract: ContentId,
  commands: readonly LoopCommand[]
): void {
  for (const command of commands) {
    const result =
      command === 'pollCrew'
        ? controller.pollCrew({ contractId: contract })
        : command === 'resolveContract'
          ? controller.resolveContract({ contractId: contract })
          : controller.settleContract({ contractId: contract, pay: true });

    if (!result.applied) {
      throw new Error(
        `The fixture's own ${command} was refused as '${String(result.rejectionCode)}'; a run ` +
          'that cannot get through the loop is measuring the refusal, not the screen.'
      );
    }
  }
}

describe('the loop closing', () => {
  it('leaves the settled contract shut and the next one waiting', () => {
    // The whole of `RESOLUTION_SPEC` §8's loop through the real controller: a locked
    // package goes out, comes back, is paid for, and the campaign lands on this board by
    // §6.4's own routing — not by anything this test asked for. What has to be true then is
    // that the contract just finished is closed and another one is still there to take.
    const controller = controllerFor('screen_locked', 'screen_locked');

    apply(controller, CARAVAN, ['pollCrew', 'resolveContract', 'settleContract']);

    const { screen } = controller.store.snapshot();

    expect(screen.screen).toBe(ScreenKind.ContractBoard);

    const container = renderScreen(
      screen as ContractBoardScreenModel,
      // The real controller, so the press below moves the real session rather than a
      // recording of one.
      controller
    );

    expect(rowControl(container, CARAVAN).disabled).toBe(true);
    expect(rowControl(container, DEBT).disabled).toBe(false);

    click(rowControl(container, DEBT));

    const next = controller.store.snapshot();

    expect(next.focusedContract).toBe(DEBT);
    expect(next.screen.screen).toBe(ScreenKind.ContractOffer);
  });
});

describe('what never reaches a player', () => {
  it('shows no raw content id, in text or in an attribute, on any of the five states', () => {
    // `TDD` §11.1. The snapshot comparisons above already fail when a definition is
    // rendered, but only because `expectedSnapshot` leaves it out — this states the rule
    // itself, so an edit teaching both sides to show one would still have to answer for it.
    for (const row of STATES) {
      const model = row.model();
      const shown = [
        ...collectRenderedTexts(renderScreen(model)),
        ...collectRenderedAttributes(renderScreen(model))
      ];

      for (const identifier of model.rows.map((line) => String(line.definition))) {
        expect(
          shown.filter((value) => value.includes(identifier)),
          `${row.state} must not show '${identifier}'`
        ).toEqual([]);
      }
    }
  });

  it('shows no part of the error detail, on the state that has one', () => {
    const detail = 'C:/somewhere/that/does/not/exist';
    const container = renderScreen(contractBoardFailedScreen('CONTENT_ROOT_NOT_FOUND', detail));

    expect([...collectRenderedTexts(container), ...collectRenderedAttributes(container)]).toEqual(
      expect.not.arrayContaining([expect.stringContaining(detail)])
    );
  });
});
