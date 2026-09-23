import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

import { frameDigest } from './frame-digest.ts';

/**
 * The live-redraw gate, standing on the battle board.
 *
 * `live-command.spec.ts` asked it of the contract offer's canvas until that canvas left the
 * page (`DEC-020`), and the suite left with it. The defect the gate was bought with — the renderer destroyed and brought
 * up again on every model change, a page frozen on the first press, `pnpm verify` green
 * throughout because jsdom replaces the canvas with `null` — is not a defect of the offer:
 * it lives in `WorldCanvas`, and the battle board is the one place that component stays.
 * So the question moves here **before** the offer's canvas goes, and not after: in between
 * there would be a window where nothing in a real Chromium could see it.
 *
 * **What this measures is that the frame changed, and only that.** Whether it is the *same*
 * renderer that redrew it is `apps/web/src/world/world-canvas.test.tsx`'s claim — a jsdom
 * recorder counts mounts and teardowns there; pixels cannot.
 *
 * The run is the one `battle.spec.ts` opens the lab with: `battle_ready`, straight onto the
 * battle screen, paused at the fight's first frame. Skip is the model change, and the frame
 * it lands on — the end of the fight — differs from the opening one on the board itself.
 */

const SEED = 424242n;
const LOCALE = 'ru';
const SCENARIO = 'battle_ready';

const REPOSITORY_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const EVIDENCE = join(REPOSITORY_ROOT, 'artifacts', 'browser-evidence', 'battle_redraw');

test.beforeAll(() => {
  rmSync(EVIDENCE, { recursive: true, force: true });
  mkdirSync(EVIDENCE, { recursive: true });
});

test('боевая доска перерисовывается, а не стоит мёртвым кадром', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto(battleRunUrl());

  // Сцена асинхронна: без ожидания кадр можно снять, пока рендерер ещё
  // поднимается, и пустой канвас будет неотличим от сломанного.
  await expect(page.getByTestId('world-canvas')).toHaveAttribute('data-scene-shapes', /^\d+$/u);

  const before = await frameDigest(page);

  await page.getByTestId('battle-skip').click();
  await expect(page.getByTestId('battle-screen')).toHaveAttribute('data-state', 'Normal');
  await expect(page.getByTestId('world-canvas')).toHaveAttribute('data-scene-shapes', /^\d+$/u);

  const after = await frameDigest(page);

  expect(after.pixels, 'кадр обязан измениться — иначе перерисовки не было').not.toBe(
    before.pixels
  );

  // Рендерер, потерявший контекст, заливает кадр одним цветом: это «изменился»
  // и «сломан» одновременно, поэтому проверяется отдельно от неравенства.
  expect(after.distinctColors, 'кадр не должен быть залит одним цветом').toBeGreaterThan(1);
  expect(errors, 'страница не должна ронять ошибок').toEqual([]);

  // Улика `AGENTS.md` §7: зелёный статус теста без отпечатков не даёт читателю CI ничего
  // проверить руками. Шаг «Summarise the battle-redraw evidence» в CI ждёт все три файла.
  await page.screenshot({ path: join(EVIDENCE, 'screenshot.png'), fullPage: false });
  writeFileSync(join(EVIDENCE, 'events.jsonl'), errors.map((line) => `${line}\n`).join(''));
  writeFileSync(
    join(EVIDENCE, 'report.json'),
    `${JSON.stringify(
      {
        scenario: SCENARIO,
        seed: SEED.toString(),
        locale: LOCALE,
        command: 'skip',
        scene_shapes_before: before.shapes,
        scene_shapes_after: after.shapes,
        frame_digest_before: before.pixels,
        frame_digest_after: after.pixels,
        distinct_colors_after: after.distinctColors,
        events: errors.length
      },
      null,
      2
    )}\n`
  );

  expect(existsSync(join(EVIDENCE, 'screenshot.png')), 'screenshot.png').toBe(true);
  expect(existsSync(join(EVIDENCE, 'events.jsonl')), 'events.jsonl').toBe(true);
  expect(existsSync(join(EVIDENCE, 'report.json')), 'report.json').toBe(true);
});

/**
 * The run this gate stands on, every input stated — the same URL `battle.spec.ts` builds for
 * the lab, so the two suites look at one fight.
 */
function battleRunUrl(): string {
  const parameters = new URLSearchParams({
    scenario: SCENARIO,
    checkpoint: SCENARIO,
    seed: SEED.toString(),
    locale: LOCALE,
    screen: 'battle'
  });

  return `/?${parameters.toString()}`;
}
