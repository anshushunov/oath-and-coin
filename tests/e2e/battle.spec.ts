import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  loadAndRunScenario,
  loadLocaleCatalogue,
  loadUiTextCatalogue
} from '@oath-and-coin/content/node';
import {
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

import { expectWindowBoundedScreen, measureLayout } from './layout.ts';

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
 * skip — one click, and the same click a player makes.
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
  /** The scenario whose run puts the lab in this state. */
  readonly scenario: string;
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
    state: 'Normal',
    scenario: 'battle_ready',
    press: async (page) => {
      await page.getByTestId('battle-skip').click();
      await expect(page.getByTestId(SCREEN)).toHaveAttribute('data-state', 'Normal');
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
    test(`${run.state.toLowerCase()} draws the fight it declares, and all of it is reachable`, async ({
      page
    }) => {
      const events: string[] = [];

      recordEvents(page, events);
      await page.goto(runUrl(run.scenario));

      await expect(page.getByTestId(SCREEN)).toBeVisible();

      if (run.press !== undefined) {
        await run.press(page);
      }

      // After the press, because the press is what reaches the state: `Normal` is the frame
      // the feed arrives at, and the lab opens on the one before it.
      await expect(page.getByTestId(SCREEN)).toHaveAttribute('data-state', run.state);

      const renderedTexts = await collectRenderedTexts(page);
      const layout = await measureLayout(page, SCREEN);

      const directory = join(EVIDENCE_ROOT, run.state.toLowerCase());

      mkdirSync(directory, { recursive: true });
      // Back to the top before the frame is taken: `measureLayout` wheels the box to its
      // end to find out how far a person can scroll it, and a screenshot after that is a
      // picture of the bottom of the screen. What a reader of this evidence needs to see
      // first is what a player sees first.
      await page.evaluate((testId: string) => {
        document.querySelector(`[data-testid="${testId}"]`)?.scrollTo(0, 0);
      }, SCREEN);
      await page.screenshot({ path: join(directory, 'screenshot.png'), fullPage: false });
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
            texts: renderedTexts.length,
            layout,
            events: events.length
          },
          null,
          2
        )}\n`
      );

      // The list, not a hash of it: a hash says two screens differ and only the list says
      // where. Built here from the catalogue on disk and from a model this process ran the
      // resolver for, so nothing in it can know what the page rendered.
      expect(renderedTexts).toEqual(expectedSnapshot(run.model(), catalogue));

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
 * The URL a run declares itself with.
 *
 * Every input is stated, including the ones that equal the page's defaults: a run whose
 * evidence does not say which seed and which screen produced it is evidence about whatever
 * the source file last defaulted to.
 */
function runUrl(scenario: string): string {
  const parameters = new URLSearchParams({
    scenario,
    checkpoint: scenario,
    seed: SEED.toString(),
    locale: LOCALE,
    screen: 'battle'
  });

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
