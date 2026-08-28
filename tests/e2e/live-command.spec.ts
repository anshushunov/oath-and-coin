import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test, type ConsoleMessage, type Page, type Request } from '@playwright/test';

/**
 * What happens to the page **after** a player presses something.
 *
 * Every other browser run in this suite photographs a screen the scenario replayed into
 * place and never touches a control. That is a real gap and it cost a real defect: from the
 * moment the negotiation controls became live, the first press of any command froze the
 * page — the renderer was destroyed and re-initialized on the same `<canvas>` on every
 * model change, and the second `init` on a released context blocks the renderer's main
 * thread for good. `pnpm verify` was green throughout, because the jsdom tests replace the
 * canvas with `null` and no run in this directory ever clicked.
 *
 * So this file measures one thing the others structurally cannot: the page is still alive
 * once the campaign has moved. It presses a real command, then asks the page a question and
 * requires an answer. A frozen page fails by timing out, which is the only way a frozen page
 * can fail.
 *
 * `screen_locked` is the run it presses on: its package is locked with seats still to fill,
 * so `pollCrew` is a command a player can actually press there, and applying it moves the
 * campaign — which is the transition that used to be fatal.
 */

const REPOSITORY_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const EVIDENCE_ROOT = join(REPOSITORY_ROOT, 'artifacts', 'browser-evidence');
const EVIDENCE = join(EVIDENCE_ROOT, 'live_command');

const SCENARIO = 'screen_locked';
const SEED = 424242n;
const LOCALE = 'ru';

/** How long the page is given to answer after the press. */
const ANSWER_TIMEOUT = 10000;

test.beforeAll(() => {
  rmSync(EVIDENCE, { recursive: true, force: true });
  mkdirSync(EVIDENCE, { recursive: true });
});

test('a page that has been pressed still answers, and still draws', async ({ page }) => {
  const events: string[] = [];
  recordEvents(page, events);

  await page.goto(runUrl());
  await expect(page.getByTestId('contract-offer-screen')).toBeVisible();
  // Waited for before the press: `Application.init` is asynchronous, and a command applied
  // while the renderer was still coming up would be measuring a different sequence than the
  // one a player produces.
  await expect(page.getByTestId('world-canvas')).toHaveAttribute('data-scene-shapes', /^\d+$/u);

  const before = await report(page);

  // The press itself is raced as well as the question after it, because a frozen page can
  // swallow either: Playwright waits for scheduled navigations once the click has landed,
  // and a renderer that has stopped running never lets that wait finish.
  await answerWithin(page.getByTestId('action-poll').click(), 'take a press');

  // The whole test in one line: a question the renderer's main thread has to run JavaScript
  // to answer. Everything below is detail about *what* the answer was.
  const after = await answerWithin(
    page.evaluate(() => document.querySelector('[data-testid="run-report"]')?.textContent ?? ''),
    'answer for the command it applied'
  );
  const parsed = JSON.parse(after) as PageReport;

  // The command really applied — otherwise the page would have been asked to survive
  // nothing at all, and a refusal would leave the model exactly where it was.
  expect(parsed.read_model_hash).not.toBe(before.read_model_hash);
  // And the renderer is still the one that was brought up: still attached, still reporting
  // what it drew. A page that answers while its canvas has gone blank is half the fix.
  await expect(page.getByTestId('world-canvas')).toHaveAttribute('data-scene-shapes', /^\d+$/u);
  // Nothing was thrown along the way. The renderer failing to come up reaches the page as an
  // unhandled rejection by design (`world-canvas.tsx`), so an empty log is a claim about the
  // renderer as well as about the screen.
  expect(events).toEqual([]);

  await page.screenshot({ path: join(EVIDENCE, 'screenshot.png'), fullPage: false });
  writeFileSync(join(EVIDENCE, 'events.jsonl'), events.map((line) => `${line}\n`).join(''));
  writeFileSync(
    join(EVIDENCE, 'report.json'),
    `${JSON.stringify(
      {
        scenario: SCENARIO,
        seed: SEED.toString(),
        locale: LOCALE,
        command: 'poll',
        read_model_hash_before: before.read_model_hash,
        read_model_hash_after: parsed.read_model_hash,
        screen_state_after: parsed.screen_state,
        campaign_screen_after: parsed.campaign_screen,
        scene_shapes_after: await sceneShapes(page),
        events: events.length
      },
      null,
      2
    )}\n`
  );

  // The evidence `AGENTS.md` §7 asks for, present on disk rather than merely written by a
  // call that did not throw.
  expect(existsSync(join(EVIDENCE, 'screenshot.png')), 'screenshot.png').toBe(true);
  expect(existsSync(join(EVIDENCE, 'events.jsonl')), 'events.jsonl').toBe(true);
  expect(existsSync(join(EVIDENCE, 'report.json')), 'report.json').toBe(true);
});

/**
 * Fails with a sentence rather than with a suite timeout when the page stops answering.
 *
 * `page.evaluate` takes no timeout of its own, and the failure this file exists to catch is
 * precisely "it never comes back": without this the whole run would die on Playwright's own
 * clock, in a message that names no cause.
 */
async function answerWithin<T>(answer: Promise<T>, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const gaveUp = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(
        new Error(
          `The page did not ${what} within ${String(ANSWER_TIMEOUT)}ms. That is what a frozen ` +
            'renderer looks like from outside: no error, no crash, and no JavaScript running to ' +
            'reply with.'
        )
      );
    }, ANSWER_TIMEOUT);
  });

  try {
    return await Promise.race([answer, gaveUp]);
  } finally {
    clearTimeout(timer);
  }
}

interface PageReport {
  readonly campaign_screen: string | null;
  readonly screen_state: string;
  readonly read_model_hash: string;
}

async function report(page: Page): Promise<PageReport> {
  return JSON.parse((await page.getByTestId('run-report').textContent()) ?? '') as PageReport;
}

async function sceneShapes(page: Page): Promise<string | null> {
  return page.getByTestId('world-canvas').getAttribute('data-scene-shapes');
}

function runUrl(): string {
  const parameters = new URLSearchParams({
    scenario: SCENARIO,
    // Named rather than left to the manifest's default: a checkpoint is an input to a run
    // (`ADR-008`), and a test that let it be inferred would stop noticing if it moved.
    checkpoint: SCENARIO,
    seed: SEED.toString(),
    locale: LOCALE
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
    events.push(
      JSON.stringify({
        kind: 'requestfailed',
        url: request.url(),
        text: request.failure()?.errorText ?? 'unknown'
      })
    );
  });
}
