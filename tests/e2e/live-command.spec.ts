import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test, type ConsoleMessage, type Page, type Request } from '@playwright/test';

/**
 * What happens to the page **after** a player presses something.
 *
 * Clicking is not what is new here — `save-slots.spec.ts` saves and confirms, and its
 * presses leave the campaign exactly where it was. What no run in this directory did was
 * apply a command that *moves* the campaign, and every other run photographs a screen the
 * scenario replayed into place. That gap cost a real defect: from the moment the
 * negotiation controls became live, the first press of any command froze the page — the
 * renderer was destroyed and re-initialized on the same `<canvas>` on every model change,
 * and the second `init` on a released context blocks the renderer's main thread for good.
 * `pnpm verify` was green throughout, because the jsdom tests replace the canvas with
 * `null`.
 *
 * So this file measures two things the others structurally cannot: the page is still alive
 * once the campaign has moved, and the scene under it was redrawn rather than left
 * standing. A frozen page fails by timing out, which is the only way a frozen page can
 * fail; a stale scene fails on its own pixels, because the shape count does not move here.
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
  const drawnBefore = await frameDigest(page);

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
  // And the renderer is still the one that was brought up, and it **redrew**. Read off the
  // pixels rather than off `data-scene-shapes`, because that number does not move here: the
  // poll changes which heroes have answered, so the tokens change colour while their count
  // stays exactly what it was. A check on the count alone would pass over a component that
  // skipped the redraw entirely, which is a live mutant external review named.
  await expect(page.getByTestId('world-canvas')).toHaveAttribute('data-scene-shapes', /^\d+$/u);
  const drawnAfter = await answerWithin(frameDigest(page), 'redraw its scene');

  expect(drawnAfter.shapes).toBe(drawnBefore.shapes);
  expect(drawnAfter.pixels).not.toBe(drawnBefore.pixels);
  // Not a blank canvas: a renderer that lost its context clears to one colour, which would
  // differ from the frame before it and satisfy the line above on its own.
  expect(drawnAfter.distinctColors).toBeGreaterThan(1);
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
        scene_shapes_before: drawnBefore.shapes,
        scene_shapes_after: drawnAfter.shapes,
        // The pair that says the scene was redrawn rather than merely left standing: the
        // shape count is the same on both sides and the pixels are not.
        frame_digest_before: drawnBefore.pixels,
        frame_digest_after: drawnAfter.pixels,
        distinct_colors_after: drawnAfter.distinctColors,
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

/** What the canvas is actually showing, read back as pixels the page cannot fake. */
interface FrameDigest {
  /** The shape count the component reports, for comparison against the pixels. */
  readonly shapes: number;
  /** FNV-1a over every byte of the frame — equal frames, equal digest. */
  readonly pixels: string;
  readonly distinctColors: number;
}

/**
 * Reads the drawn frame back off the canvas.
 *
 * The same technique `contract-offer.spec.ts` uses to prove a scene was drawn at all —
 * `preserveDrawingBuffer` is on for exactly this — carried one step further: a digest, so
 * two frames of one scene can be told apart rather than only "something was drawn".
 */
async function frameDigest(page: Page): Promise<FrameDigest> {
  return page.evaluate((testId: string) => {
    const canvas = document.querySelector(`[data-testid="${testId}"]`);

    if (!(canvas instanceof HTMLCanvasElement)) {
      throw new Error(`The page has no <canvas data-testid="${testId}">.`);
    }

    const probe = document.createElement('canvas');
    probe.width = canvas.width;
    probe.height = canvas.height;

    const context = probe.getContext('2d', { willReadFrequently: true });

    if (context === null) {
      throw new Error('This browser gave no 2D context to read the scene back with.');
    }

    context.drawImage(canvas, 0, 0);

    const { data } = context.getImageData(0, 0, probe.width, probe.height);
    const colours = new Set<number>();
    let hash = 0x811c9dc5;

    for (let offset = 0; offset < data.length; offset += 4) {
      const pixel =
        ((data[offset] ?? 0) << 24) |
        ((data[offset + 1] ?? 0) << 16) |
        ((data[offset + 2] ?? 0) << 8) |
        (data[offset + 3] ?? 0);

      colours.add(pixel);
      hash = Math.imul(hash ^ (pixel & 0xff), 0x01000193);
      hash = Math.imul(hash ^ ((pixel >>> 8) & 0xff), 0x01000193);
      hash = Math.imul(hash ^ ((pixel >>> 16) & 0xff), 0x01000193);
      hash = Math.imul(hash ^ ((pixel >>> 24) & 0xff), 0x01000193);
    }

    return {
      shapes: Number(canvas.dataset['sceneShapes'] ?? '-1'),
      pixels: (hash >>> 0).toString(16).padStart(8, '0'),
      distinctColors: colours.size
    };
  }, 'world-canvas');
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
