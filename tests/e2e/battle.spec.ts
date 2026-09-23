import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  loadAndRunScenario,
  loadLocaleCatalogue,
  loadUiTextCatalogue
} from '@oath-and-coin/content/node';
import {
  BattleFieldKeys,
  battleFailedScreen,
  battleScreenModel,
  expectedSnapshot,
  BATTLE_LOADING_SCREEN,
  type BattleScreenModel
} from '@oath-and-coin/presentation';
import {
  parseContentId,
  resolutionInputFor,
  resolverFor,
  type GameState
} from '@oath-and-coin/simulation';
import { expect, test, type ConsoleMessage, type Page, type Request } from '@playwright/test';

import { expectNextFrame, frameDigest, pixelsOfToken, sceneFrame } from './frame-digest.ts';
import { expectWindowBoundedScreen, measureLayout } from './layout.ts';
import { expectToneColours } from './tone-colours.ts';

/**
 * The battle screen in a browser — five states, a frame each (`AGENTS.md` §7, `COMBAT_SPEC`
 * §10.2).
 *
 * **This suite exists because jsdom cannot see the thing most likely to be wrong.** The
 * screen has a canvas on it, jsdom stubs `getContext` to `null`, and `FULL_TYPESCRIPT_MIGRATION`
 * §14.4 already recorded the measured version of that trap twice: a renderer that stopped
 * mounting left every jsdom check green, and a page that froze on the first command press
 * did the same. Whatever this file finds, it finds in Chromium.
 *
 * **The feed is paused at the opening frame, and that is what makes a screenshot mean
 * anything.** A feed running on `requestAnimationFrame` is at a different position every
 * run; a frame of one would be a picture of the machine's timing. So the lab opens paused,
 * the `Incomplete` state is the fight's first frame, and `Normal` is reached by pressing
 * skip — one click, and the same click a player makes. The middle of the fight is a third
 * frame, opened paused on a position the URL names (`midFight`).
 *
 * **Neither half of the text comparison can see the other**, the same discipline
 * `contract-offer.spec.ts` records: `expectedSnapshot` computes what a correctly bound
 * screen owes from a model this process builds off the scenario on disk, and the texts the
 * page rendered are walked out of its DOM.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = join(HERE, '..', '..');
const EVIDENCE_ROOT = join(REPOSITORY_ROOT, 'artifacts', 'browser-evidence', 'battle');

const SEED = 424242n;
const LOCALE = 'ru';
const SCREEN = 'battle-screen';

const CONTRACT = parseContentId('core:break_the_siege_camp');

// §14.4: both loaders answer a `SortedMap`, whose `entries()` is an array and which has no
// `Symbol.iterator`. `new Map(catalogue)` throws at runtime; spreading each array does not.
const catalogue = new Map([
  ...loadLocaleCatalogue(join(REPOSITORY_ROOT, 'content', 'locale', `${LOCALE}.json`)).entries(),
  ...loadUiTextCatalogue(join(REPOSITORY_ROOT, 'ui-text', `${LOCALE}.json`)).entries()
]);

/** One state of the screen: which scenario reaches it, and what to press once there. */
interface BattleRun {
  readonly state: string;
  /**
   * The name of its evidence directory and of its test, when the state alone does not tell
   * it apart: the middle of the fight is `Incomplete` exactly as the opening frame is.
   */
  readonly name?: string;
  /** The scenario whose run puts the lab in this state. */
  readonly scenario: string;
  /**
   * The position the run's URL states (`RunRequest.position`), or nothing for the lab's own
   * opening. A function for the reason `model` is one: it runs the resolver.
   */
  position?: () => number;
  /** Pressed after the page has settled, for the state that is a click away. */
  press?: (page: Page) => Promise<void>;
  /** The model this process builds for the same state, off the scenario on disk. */
  model: () => BattleScreenModel;
}

/**
 * The campaign a scenario produced, or `null` when it produced none.
 *
 * `screen_loading` never reaches a campaign at all and `screen_error` fails before it does;
 * both are states of this screen and both are built here from the same absence the page has.
 */
function campaignOf(scenario: string): GameState | null {
  const result = loadAndRunScenario({
    repositoryRoot: REPOSITORY_ROOT,
    scenario,
    checkpoint: scenario,
    seed: SEED
  });

  return result.kind === 'ran' ? result.outcome.finalState : null;
}

/**
 * The battle the resolver produces for the placed crew — the same fight the page is about to
 * play, run here through the same function.
 *
 * Not read off the contract's resolution: there is none. The whole arrangement of §6.3 is
 * that the fight is watched *before* it is committed, so both sides of this comparison run
 * the resolver and neither reads a stored answer.
 */
function battleOf(state: GameState) {
  const contract = state.contracts.get(CONTRACT);

  if (contract === undefined) {
    throw new Error(`The scenario produced no '${CONTRACT}' to fight over.`);
  }

  const record = resolverFor(contract)(resolutionInputFor(state, contract, null)).resolution.battle;

  if (record === null) {
    throw new Error(`'${CONTRACT}' produced no battle, so there is nothing for the lab to show.`);
  }

  return { contract, record };
}

/**
 * A position in the middle of the fight whose last intent is aimed at a man still standing —
 * the frame the line of intent is measured on.
 *
 * **Not the finished fight any more**, and that is the owner's decision of 2026-09-23: a
 * finished fight draws no arrow (`battle-scene-model.ts`, `intentOf`), so the frame skip lands
 * on can only say the line is absent. The opening frame has no intent at all. What is left is
 * a frame inside the fight, and it is named rather than timed: the lab opens paused on the
 * position the URL states, and a feed played and paused would stop wherever this machine's
 * timing put it.
 *
 * Chosen here, off the record this process ran the resolver for, and never read off the
 * page: the first position from the halfway point on whose model aims the intent at a man
 * standing. Standing, because an arrow at a man already down is the very picture the
 * decision removed from the end of the fight, and a check measured on one would be measuring
 * the case nobody wants to see.
 */
function midFight(): { readonly position: number; readonly model: BattleScreenModel } {
  const state = campaignOf('battle_ready');

  if (state === null) {
    throw new Error('battle_ready produced no campaign.');
  }

  const { record } = battleOf(state);

  for (
    let applied = Math.ceil(record.events.length / 2);
    applied < record.events.length;
    applied += 1
  ) {
    const model = battleScreenModel(state, CONTRACT, { applied, paused: true, record });
    const target = model.intent?.targetUnit ?? null;

    if (
      model.outcomeKey === null &&
      model.units.some((unit) => unit.unit === target && unit.standing)
    ) {
      return { position: applied, model };
    }
  }

  throw new Error(
    'The second half of the fight has no position whose intent is aimed at a man standing, so ' +
      'there is no frame left to measure the line of intent on.'
  );
}

const RUNS: readonly BattleRun[] = [
  {
    state: 'Loading',
    scenario: 'screen_loading',
    model: () => BATTLE_LOADING_SCREEN
  },
  {
    state: 'Error',
    scenario: 'screen_error',
    // The code the manifest declares, and the detail the page will have — the path it
    // failed on, which is machine-specific and therefore outside every hash and outside
    // the text comparison below (`errorDetail` never reaches a screen).
    model: () => battleFailedScreen('CONTENT_ROOT_NOT_FOUND', 'nowhere')
  },
  {
    state: 'Empty',
    // A contract that never goes to a fight (`ADR-016` §5 routes it to the abstract
    // resolver). "There is nothing here to watch" is a different sentence from "the fight
    // has not started", and this is the state that says the first.
    scenario: 'screen_normal',
    model: () => {
      const state = campaignOf('screen_normal');

      if (state === null) {
        throw new Error('screen_normal produced no campaign.');
      }

      return battleScreenModel(state, parseContentId('core:escort_the_caravan'), { applied: 0 });
    }
  },
  {
    state: 'Incomplete',
    scenario: 'battle_ready',
    model: () => {
      const state = campaignOf('battle_ready');

      if (state === null) {
        throw new Error('battle_ready produced no campaign.');
      }

      return battleScreenModel(state, CONTRACT, {
        applied: 0,
        paused: true,
        record: battleOf(state).record
      });
    }
  },
  {
    // The middle of the fight, paused on a position the URL names: the one frame the line of
    // intent is on the board, and so the one frame that can say the arrow is drawn at all.
    state: 'Incomplete',
    name: 'midfight',
    scenario: 'battle_ready',
    position: () => midFight().position,
    model: () => midFight().model
  },
  {
    state: 'Normal',
    scenario: 'battle_ready',
    press: async (page) => {
      // The frame from before the press, so the wait below is for the frame the press drew:
      // `data-scene-shapes` was set by the mount and would satisfy a wait at once.
      await expect(page.getByTestId('world-canvas')).toHaveAttribute('data-scene-frame', /^\d+$/u);
      const before = await sceneFrame(page);

      await page.getByTestId('battle-skip').click();
      await expect(page.getByTestId(SCREEN)).toHaveAttribute('data-state', 'Normal');
      await expectNextFrame(page, before);
    },
    model: () => {
      const state = campaignOf('battle_ready');

      if (state === null) {
        throw new Error('battle_ready produced no campaign.');
      }

      const { record } = battleOf(state);

      return battleScreenModel(state, CONTRACT, {
        applied: record.events.length,
        paused: true,
        record
      });
    }
  }
];

test.beforeAll(() => {
  // Cleared once per run, so a state that stops producing evidence leaves an empty
  // directory rather than the last run's screenshot under this run's name.
  rmSync(EVIDENCE_ROOT, { recursive: true, force: true });
  mkdirSync(EVIDENCE_ROOT, { recursive: true });
});

test.describe('the battle screen, in a browser', () => {
  for (const run of RUNS) {
    const name = run.name ?? run.state.toLowerCase();

    test(`${name} draws the fight it declares, and all of it is reachable`, async ({ page }) => {
      const events: string[] = [];
      const position = run.position?.() ?? null;

      recordEvents(page, events);
      await page.goto(runUrl(run.scenario, position));

      await expect(page.getByTestId(SCREEN)).toBeVisible();

      if (run.press !== undefined) {
        await run.press(page);
      }

      // After the press, because the press is what reaches the state: `Normal` is the frame
      // the feed arrives at, and the lab opens on the one before it.
      await expect(page.getByTestId(SCREEN)).toHaveAttribute('data-state', run.state);

      const renderedTexts = await collectRenderedTexts(page);
      const layout = await measureLayout(page, SCREEN);

      const directory = join(EVIDENCE_ROOT, name);

      mkdirSync(directory, { recursive: true });
      // Back to the top before the frame is taken: `measureLayout` wheels the box to its
      // end to find out how far a person can scroll it, and a screenshot after that is a
      // picture of the bottom of the screen. What a reader of this evidence needs to see
      // first is what a player sees first.
      await page.evaluate((testId: string) => {
        document.querySelector(`[data-testid="${testId}"]`)?.scrollTo(0, 0);
      }, SCREEN);

      // Built before the frame, off the scenario on disk, because it is what says whether this
      // state has a board at all: `Loading`, `Error` and `Empty` carry no units and mount no
      // canvas. Where there is one, the frame waits for the renderer to have drawn it —
      // `Application.init` is asynchronous, and a frame taken on the screen alone can be of
      // an empty canvas without anything here noticing. Read off the expected model rather
      // than off the page, so a board that failed to mount is a timeout, not a skipped wait.
      const model = run.model();

      if (model.units.length > 0) {
        await expect(page.getByTestId('world-canvas')).toHaveAttribute(
          'data-scene-shapes',
          /^\d+$/u
        );
      }

      await page.screenshot({ path: join(directory, 'screenshot.png'), fullPage: false });

      // What the canvas holds, which no text comparison below can see: a canvas has no text
      // nodes, and jsdom replaces it with nothing. Measured on the positions that have a board.
      const canvas = model.units.length > 0 ? await expectBoardDrawn(page, model) : null;

      // The outcome is the one headline of a finished fight, and nothing else on the screen
      // is set as large (the spec of the kit, §5.4: no second heading competing with it).
      if (model.outcomeKey !== null) {
        await expectOutcomeLargest(page);
      }

      // A second frame, of the journal, on the position that has one. The frame above is
      // what a player sees first, and on a finished fight that is the board — the journal
      // is further down, and the owner's first play was about *those* lines. A frame that
      // never reaches them is evidence of the half of the screen that was not changed.
      if (model.journal.length > 0) {
        await expectJournalRead(page, directory);
        await expectToneColours(page, SCREEN);
      }

      writeFileSync(join(directory, 'events.jsonl'), events.map((line) => `${line}\n`).join(''));
      writeFileSync(
        join(directory, 'report.json'),
        `${JSON.stringify(
          {
            screen: 'battle',
            scenario: run.scenario,
            seed: SEED.toString(),
            locale: LOCALE,
            battle_screen_state: run.state,
            // The position the URL stated, `null` where it stated none — the lab's opening,
            // or the end one press of skip reaches. What tells the middle of the fight from
            // its opening frame, which share a state.
            position,
            texts: renderedTexts.length,
            layout,
            // What the two canvas checks measured, so the thresholds they hold can be read
            // against the frame they were measured on (`AGENTS.md` §11).
            canvas,
            events: events.length
          },
          null,
          2
        )}\n`
      );

      // The list, not a hash of it: a hash says two screens differ and only the list says
      // where. Built here from the catalogue on disk and from a model this process ran the
      // resolver for, so nothing in it can know what the page rendered.
      expect(renderedTexts).toEqual(expectedSnapshot(model, catalogue));

      // Before the reachability assertion, and for the reason `layout.ts` records: it
      // compares content against a box, and a box sized by its own content satisfies it
      // whatever the layout does.
      await expectWindowBoundedScreen(page, SCREEN, layout);

      // One pixel of slack, and it is a browser arithmetic fact rather than a relaxed
      // standard. `scrollHeight` is a *ceiling* of a fractional content height, while
      // `clientHeight + scrollTop` is the exact position a box scrolled to its end — so a
      // screen whose content is 3595.4px tall reports 3596 against a reachable 3595 with
      // every line of it on the screen. The other suites never meet it because their
      // content is a few hundred pixels; this one's journal is eighty lines. A line of
      // text is fourteen pixels, so a real unreachable line cannot hide inside one.
      expect(
        layout.contentHeight - layout.reachableHeight,
        'content below the fold must be reachable by scrolling'
      ).toBeLessThanOrEqual(1);

      // A page that logged an error rendered the right texts by accident at best. Last, so
      // the comparisons above name the failure first when both go.
      expect(events, 'the page must produce no error or failed request').toEqual([]);
    });
  }
});

test.describe('what the controls actually do', () => {
  test('pause stops the feed and leaves the renderer running (COMBAT_SPEC §10.2 п.3)', async ({
    page
  }) => {
    // The requirement the spike bought with a frame: two screenshots 700 ms apart during a
    // pause had the same digest while the renderer kept drawing at 61.7 fps. Measured here
    // as "the round has not moved", which is what a player sees, and the renderer's own
    // liveness is the absence of a page error below.
    await page.goto(runUrl('battle_ready'));
    await expect(page.getByTestId(SCREEN)).toBeVisible();

    const before = await page.getByTestId('battle-round').textContent();

    await page.waitForTimeout(700);

    expect(await page.getByTestId('battle-round').textContent()).toBe(before);
  });

  test('replay puts the fight back to its first frame', async ({ page }) => {
    await page.goto(runUrl('battle_ready'));
    await expect(page.getByTestId(SCREEN)).toBeVisible();

    const opening = await page.getByTestId('battle-round').textContent();

    await page.getByTestId('battle-skip').click();
    await expect(page.getByTestId(SCREEN)).toHaveAttribute('data-state', 'Normal');

    await page.getByTestId('battle-replay').click();
    await expect(page.getByTestId(SCREEN)).toHaveAttribute('data-state', 'Incomplete');
    expect(await page.getByTestId('battle-round').textContent()).toBe(opening);
  });

  test('the retreat button is on the screen with its price, and dark before round one', async ({
    page
  }) => {
    // `DEC-005`'s lever, and `MVP_PLAN` §6.4 decides that decision by how often a tester
    // reaches for it — which a button nobody can find cannot measure. Dark rather than
    // absent at the opening frame, because a signal at round nought is one given before the
    // battle began and `resolveContract` refuses it by name.
    await page.goto(runUrl('battle_ready'));
    await expect(page.getByTestId(SCREEN)).toBeVisible();

    await expect(page.getByTestId('battle-retreat')).toBeVisible();
    await expect(page.getByTestId('battle-retreat')).toBeDisabled();
  });
});

/**
 * How many distinct colours a frame of words on tokens is at least.
 *
 * Measured by the spike on this very fight, opening frame (`docs/research/
 * BATTLE_LABEL_SPIKE_2026-09.md`, `frameDigest`): rectangles alone are 6, rectangles and the
 * floating number 11, one word 126, eight words 711 — antialiased text is hundreds of shades,
 * shapes with straight edges are a handful. The line of intent is antialiased too, and a few
 * dozen shades at most; this sits far above both and far below a board of named tokens.
 */
const WORDS_ON_THE_BOARD = 200;

/**
 * How many distinct colours each half of the board is at least — the crew's on the left, the
 * foes' on the right — so that *both* sides are seen to carry words.
 *
 * The count over the whole frame cannot say it: review of Task 7 asked what a regression that
 * labelled the crew alone would do, and a mutant doing exactly that measured 660 on the
 * finished frame where the full board measures 802 — far above the 200 either way. Per half,
 * that mutant leaves the foes' side with no text on it at all. Held at the spike's one word
 * (126) less a margin, because the fonts a CI runner rasterises with are not this machine's.
 */
const WORDS_ON_EACH_SIDE = 100;

/**
 * How many pixels of exactly the intent colour a drawn line of intent is at least.
 *
 * The line is three logical pixels wide and runs from one token's edge to another's — even
 * two tokens in neighbouring cells leave its head and a stub of line, dozens of pixels whose
 * colour antialiasing has not touched. Nothing else on the board is drawn in that colour
 * (`tokens.test.ts` holds it apart from every other role), so on a frame without the line the
 * count is nought.
 */
const LINE_OF_INTENT = 20;

/**
 * The two things on the canvas jsdom cannot see and the text comparison does not hold: the
 * words on the tokens and the line of intent.
 *
 * **Two checks, because one could not tell the halves apart.** A count of distinct colours
 * says there are words on the board; it is hundreds either way, so it is as green with the
 * line of intent as without it. The line is found by its own colour instead. On a position
 * whose model has no aimed intent the line must be absent — that is the half which says the
 * colour count is of the line and of nothing else.
 *
 * **Absent on a finished fight too, aimed or not** — the owner's decision of 2026-09-23
 * (`intentOf` in `battle-scene-model.ts`). The finished frame is where that decision is held
 * in a browser: its last intent *is* aimed, so the nought there is about the fight being over
 * and not about an intent with no target. Where the line is present is measured in the middle
 * of the fight (`midFight`).
 */
async function expectBoardDrawn(
  page: Page,
  model: BattleScreenModel
): Promise<{
  distinct_colors: number;
  crew_side_colors: number;
  foe_side_colors: number;
  intent_pixels: number;
  intent_expected: boolean;
}> {
  const digest = await frameDigest(page);
  const intentPixels = await pixelsOfToken(page, '--intent');
  const aimed = model.intent !== null && model.intent.targetUnit !== null;
  const drawn = aimed && model.outcomeKey === null;

  expect(
    digest.distinctColors,
    'the tokens must carry their words — a board of rectangles alone is a handful of colours'
  ).toBeGreaterThan(WORDS_ON_THE_BOARD);
  expect(
    digest.leftDistinctColors,
    'the crew’s side of the board must carry its words'
  ).toBeGreaterThan(WORDS_ON_EACH_SIDE);
  expect(
    digest.rightDistinctColors,
    'the foes’ side of the board must carry its words — the short word for each job'
  ).toBeGreaterThan(WORDS_ON_EACH_SIDE);

  // The finished fight is where the absence of the line is held, and it has to have an aimed
  // intent to be about the outcome: one whose last intent was aimed at nobody would draw no
  // line under the old rule as well, and the nought would say nothing about the new one.
  if (model.outcomeKey !== null) {
    expect(aimed, 'the last intent of the finished fight must be aimed at somebody').toBe(true);
  }

  if (drawn) {
    expect(intentPixels, 'the line of intent must be on the board').toBeGreaterThan(LINE_OF_INTENT);
  } else if (aimed) {
    expect(intentPixels, 'the fight is over, and its last intent is no arrow on the board').toBe(0);
  } else {
    expect(intentPixels, 'no intent, and nothing of its colour on the board').toBe(0);
  }

  return {
    distinct_colors: digest.distinctColors,
    crew_side_colors: digest.leftDistinctColors,
    foe_side_colors: digest.rightDistinctColors,
    intent_pixels: intentPixels,
    intent_expected: drawn
  };
}

/** The outcome of a finished fight is the largest text on the screen, and the only one that size. */
async function expectOutcomeLargest(page: Page): Promise<void> {
  const texts = await page.evaluate((testId: string) => {
    const root = document.querySelector(`[data-testid="${testId}"]`);

    if (root === null) {
      throw new Error(`The page has no [data-testid="${testId}"].`);
    }

    const found: { text: string; size: number; outcome: boolean }[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);

    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const element = node.parentElement;

      if (element === null || (node.nodeValue ?? '').trim() === '') {
        continue;
      }

      found.push({
        text: node.nodeValue ?? '',
        size: Number.parseFloat(getComputedStyle(element).fontSize),
        outcome: element.closest('[data-testid="battle-outcome"]') !== null
      });
    }

    return found;
  }, SCREEN);

  const largest = Math.max(...texts.map((text) => text.size));
  const atLargest = texts.filter((text) => text.size === largest);

  expect(
    atLargest.map((text) => ({ text: text.text, outcome: text.outcome })),
    'the outcome alone is set in the largest size on the screen'
  ).toEqual([{ text: atLargest[0]?.text, outcome: true }]);
}

/**
 * The journal, read the way a person reads it: its newest line in view without scrolling it,
 * and its first line reachable with the wheel.
 *
 * **The journal is a scroller inside the screen**, the kit's `Feed` — sticking to the bottom is
 * something only a scrolling box can do (§5.3 of the spec of the kit). That puts its hidden
 * lines outside `measureLayout`, which measures the screen's own box: the screen's
 * `scrollHeight` does not count what the feed has scrolled away. So the feed's reach is checked
 * here, with the wheel, as `layout.ts` checks the screen's: the head of the journal is on
 * screen only after a person has wheeled up to it.
 */
async function expectJournalRead(page: Page, directory: string): Promise<void> {
  const journal = page.getByTestId('battle-journal');
  const lines = journal.locator('li');
  const to = catalogue.get(BattleFieldKeys.To);

  if (to === undefined) {
    throw new Error(`The catalogue has no text for '${BattleFieldKeys.To}'.`);
  }

  await journal.evaluate((element) => {
    element.scrollIntoView({ block: 'end' });
  });

  // The feed on the screen, and holding more than it shows: otherwise there is nothing for it
  // to stick with, and the two checks after this one are about nothing. Not `ratio: 1` for
  // the box: scrolled flush to the window's edge it measured 0.99984 — a fraction of a pixel
  // of layout rounding, not a line out of view. The lines below are held to the whole.
  await expect(journal).toBeInViewport({ ratio: 0.99 });
  expect(
    await journal.evaluate((element) => element.scrollHeight > element.clientHeight),
    'the journal of a finished fight must be longer than its box'
  ).toBe(true);

  // Stuck to its newest line, with nobody having scrolled it: the last line whole on screen,
  // the first one scrolled away, and the last blow's arrow readable.
  await expect(lines.last()).toBeInViewport({ ratio: 1 });
  await expect(lines.first()).not.toBeInViewport();
  await expect(journal.locator('.journal-line', { hasText: to }).last()).toBeInViewport({
    ratio: 1
  });
  await page.screenshot({ path: join(directory, 'journal.png'), fullPage: false });

  // And the head of it is a wheel away, not lost.
  const box = await journal.boundingBox();

  if (box === null) {
    throw new Error('The journal has no box to wheel over.');
  }

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -100_000);
  await expect(lines.first()).toBeInViewport({ ratio: 1 });
}

/**
 * The URL a run declares itself with.
 *
 * Every input is stated, including the ones that equal the page's defaults: a run whose
 * evidence does not say which seed and which screen produced it is evidence about whatever
 * the source file last defaulted to.
 */
function runUrl(scenario: string, position: number | null = null): string {
  const parameters = new URLSearchParams({
    scenario,
    checkpoint: scenario,
    seed: SEED.toString(),
    locale: LOCALE,
    screen: 'battle'
  });

  if (position !== null) {
    parameters.set('position', String(position));
  }

  return `/?${parameters.toString()}`;
}

function recordEvents(page: Page, events: string[]): void {
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() === 'error') {
      events.push(JSON.stringify({ kind: 'console', type: message.type(), text: message.text() }));
    }
  });
  page.on('pageerror', (error: Error) => {
    events.push(JSON.stringify({ kind: 'pageerror', text: error.message }));
  });
  page.on('requestfailed', (request: Request) => {
    events.push(JSON.stringify({ kind: 'requestfailed', url: request.url() }));
  });
}

async function collectRenderedTexts(page: Page): Promise<readonly string[]> {
  return page.evaluate((testId: string) => {
    const root = document.querySelector(`[data-testid="${testId}"]`);

    if (root === null) {
      throw new Error(`The page has no [data-testid="${testId}"] to collect texts from.`);
    }

    const texts: string[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);

    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const value = node.nodeValue ?? '';

      if (value.trim() !== '') {
        texts.push(value);
      }
    }

    return texts;
  }, SCREEN);
}
