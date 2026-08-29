import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test, type Page } from '@playwright/test';

/**
 * THROWAWAY SPIKE (`AGENTS.md` §4, `MVP_PLAN` §6.6): one tick carried from the simulation
 * core through an event queue into Pixi, with pause, two speeds, skip and replay, and a
 * frame off the canvas. What survives this file is the measurement it writes.
 */

const REPOSITORY_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const EVIDENCE = join(REPOSITORY_ROOT, 'artifacts', 'browser-evidence', 'combat_spike');

test.beforeAll(() => {
  rmSync(EVIDENCE, { recursive: true, force: true });
  mkdirSync(EVIDENCE, { recursive: true });
});

test('a tick reaches the renderer, and the four controls answer', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(message.text());
    }
  });

  const openedAt = Date.now();
  await page.goto('/spike.html');
  await expect(page.getByTestId('spike-canvas')).toHaveAttribute('data-scene-ready', '1');
  const readyMs = Date.now() - openedAt;

  // 1. The events arrive at all: the line under the canvas is written by `apply`.
  await expect(page.getByTestId('spike-line')).not.toBeEmpty();
  await page.waitForFunction(
    () => (document.querySelector('[data-testid="spike-line"]')?.textContent ?? '').includes('бьёт')
  );
  await page.screenshot({ path: join(EVIDENCE, 'hit.png') });

  // 2. Pause holds the frame. Both halves matter: the applied count stops moving *and* the
  //    pixels stop moving, because a paused queue with a running animation is still motion.
  await page.getByTestId('spike-pause').click();
  const pausedAt = await report(page);
  const pausedFrame = await frameDigest(page);
  await page.waitForTimeout(700);
  const stillPaused = await report(page);
  const stillPausedFrame = await frameDigest(page);

  expect(stillPaused.status.applied).toBe(pausedAt.status.applied);
  expect(stillPausedFrame).toBe(pausedFrame);
  await page.screenshot({ path: join(EVIDENCE, 'paused.png') });

  // 3. Two speeds. Measured as events applied per wall-clock second, on the same run:
  //    x2 must present roughly twice as many.
  await page.getByTestId('spike-speed-1').click();
  await page.getByTestId('spike-resume').click();
  const framesBefore = await frameCount(page);
  const oneX = await appliedPerSecond(page, 1200);
  const framesPerSecond = Number((((await frameCount(page)) - framesBefore) / 1.2).toFixed(1));

  await page.getByTestId('spike-replay').click();
  await page.getByTestId('spike-speed-2').click();
  const twoX = await appliedPerSecond(page, 1200);

  expect(twoX).toBeGreaterThan(oneX);

  // 4. Skip lands on the end of the battle, in one frame.
  await page.getByTestId('spike-replay').click();
  await page.getByTestId('spike-skip').click();
  const skipped = await report(page);

  expect(skipped.status.applied).toBe(skipped.events);
  expect(skipped.status.phase).toBe('finished');
  const skippedFrame = await frameDigest(page);
  await page.screenshot({ path: join(EVIDENCE, 'skipped.png') });

  // 5. Replay puts the scene back where it started — a different frame from the finished
  //    one, and the same count of applied events as a fresh run.
  await page.getByTestId('spike-replay').click();
  await page.getByTestId('spike-pause').click();
  const replayed = await report(page);
  const replayedFrame = await frameDigest(page);

  expect(replayed.status.applied).toBe(0);
  expect(replayedFrame).not.toBe(skippedFrame);
  await page.screenshot({ path: join(EVIDENCE, 'replayed.png') });

  expect(errors).toEqual([]);

  writeFileSync(
    join(EVIDENCE, 'report.json'),
    `${JSON.stringify(
      {
        ready_ms: readyMs,
        ticks: skipped.ticks,
        events: skipped.events,
        presentation_fps_1x: framesPerSecond,
        applied_per_second_1x: oneX,
        applied_per_second_2x: twoX,
        speed_ratio: Number((twoX / oneX).toFixed(2)),
        paused_frame: pausedFrame,
        skipped_frame: skippedFrame,
        replayed_frame: replayedFrame,
        page_errors: errors.length
      },
      null,
      2
    )}\n`
  );
});

interface SpikeReport {
  readonly ticks: number;
  readonly events: number;
  readonly status: { readonly applied: number; readonly phase: string; readonly elapsed: number };
}

async function report(page: Page): Promise<SpikeReport> {
  return JSON.parse((await page.getByTestId('spike-report').textContent()) ?? '') as SpikeReport;
}

/** Events applied per wall-clock second over `windowMs`. */
async function appliedPerSecond(page: Page, windowMs: number): Promise<number> {
  const before = await report(page);
  await page.waitForTimeout(windowMs);
  const after = await report(page);

  return Number(
    (((after.status.applied - before.status.applied) * 1000) / windowMs).toFixed(2)
  );
}

/** How many animation frames the presentation has drawn so far. */
async function frameCount(page: Page): Promise<number> {
  return Number(
    (await page.getByTestId('spike-canvas').getAttribute('data-scene-frames')) ?? '0'
  );
}

async function frameDigest(page: Page): Promise<string> {
  return page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="spike-canvas"]');

    if (!(canvas instanceof HTMLCanvasElement)) {
      throw new Error('no spike canvas');
    }

    const probe = document.createElement('canvas');
    probe.width = canvas.width;
    probe.height = canvas.height;

    const context = probe.getContext('2d', { willReadFrequently: true });

    if (context === null) {
      throw new Error('no 2d context');
    }

    context.drawImage(canvas, 0, 0);

    const { data } = context.getImageData(0, 0, probe.width, probe.height);
    let hash = 0x811c9dc5;

    for (let offset = 0; offset < data.length; offset += 4) {
      hash = Math.imul(hash ^ (data[offset] ?? 0), 0x01000193);
      hash = Math.imul(hash ^ (data[offset + 1] ?? 0), 0x01000193);
      hash = Math.imul(hash ^ (data[offset + 2] ?? 0), 0x01000193);
    }

    return (hash >>> 0).toString(16).padStart(8, '0');
  });
}
