import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test, type ConsoleMessage, type Page, type Request } from '@playwright/test';

/**
 * The whole of `MVP_PLAN` §6.6's finish line, pressed in a browser: a crew is composed, put
 * on a 3×3 under a doctrine, sent, watched, and the debrief is read.
 *
 * **Every other suite photographs a screen a scenario replayed into place.** This one moves
 * the campaign — seven commands, each from a control a player can find — and it is the only
 * check in this repository that the loop *connects*. The three screens can each be right in
 * isolation while nothing joins them, and both hashes would be green throughout: they
 * measure a screen, and what this measures is the path between three of them.
 *
 * That blindness has already cost this project a page which froze the moment a player
 * touched it (`world-canvas.tsx` records it at length), with every jsdom check green and no
 * end-to-end run that applied a command.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = join(HERE, '..', '..');
const EVIDENCE_ROOT = join(REPOSITORY_ROOT, 'artifacts', 'browser-evidence', 'combat_loop');

const SEED = 424242n;
const LOCALE = 'ru';
const SCENARIO = 'battle_lab';

/**
 * The four cells the crew is put on, and they are not a straight line.
 *
 * A formation of four in one column would exercise the geometry least: §4.5's benefit is
 * about the *empty* cell and §4.3's obstruction about who stands in front of whom, so the
 * crew here has a front rank of two, a support behind them and a rear man in the third row.
 */
const FORMATION: readonly (readonly [number, number])[] = [
  [1, 1],
  [1, 2],
  [2, 2],
  [3, 2]
];

test.beforeAll(() => {
  rmSync(EVIDENCE_ROOT, { recursive: true, force: true });
  mkdirSync(EVIDENCE_ROOT, { recursive: true });
});

test('a crew is placed, the fight is watched, and the debrief reads back', async ({ page }) => {
  const events: string[] = [];

  recordEvents(page, events);
  await page.goto(runUrl());

  await expect(page.getByTestId('contract-offer-screen')).toBeVisible();

  // The package, chosen here rather than replayed: the scenario stops *before* its own
  // command, so what the page opens on is the siege camp with nothing composed — which is
  // where a tester starts, and choosing the crew is half of what §13.2 measures.
  // Enough advance for four people to take a job at risk 40 — the same figure the frozen
  // `battle_ready` scenario composes with, so what this test measures is the *loop* rather
  // than whether a stingy package gets a refusal.
  await page.getByTestId('offer.advance').fill('60');
  await page.getByTestId('key-hero-option-0').check();

  for (let index = 0; index < FORMATION.length; index += 1) {
    await page.getByTestId(`crew-option-${String(index)}`).check();
  }

  await press(page, 'action-compose');
  await press(page, 'action-ask_key_hero');
  await press(page, 'action-lock');
  await press(page, 'action-poll');

  // The formation (`COMBAT_SPEC` §3.7). A man is picked up and a cell is pressed, which is
  // the whole interaction — and the block only exists once the package is locked, so its
  // being here at all is a fact about the four presses above.
  await expect(page.getByTestId('offer-formation')).toBeVisible();

  const crew = await page.getByTestId('formation-board').locator('button').count();

  expect(crew, 'the board must be the nine cells of §3.1').toBe(9);

  const heroes = page.locator('[data-testid^="formation-hero-"]');

  await expect(heroes).toHaveCount(FORMATION.length);

  for (const [index, [row, column]] of FORMATION.entries()) {
    await heroes.nth(index).click();
    await page.getByTestId(`formation-cell-${String(row)}-${String(column)}`).click();
  }

  await page.getByTestId('formation-doctrine-hold_the_line').click();
  await press(page, 'action-place');

  // The send. On a contract with a plan this does not resolve anything: it opens the fight,
  // which is watched before the outcome is committed (§6.3).
  await press(page, 'action-resolve');

  await expect(page.getByTestId('battle-screen')).toBeVisible();
  await expect(page.getByTestId('battle-screen')).toHaveAttribute('data-state', 'Incomplete');

  await page.screenshot({ path: join(EVIDENCE_ROOT, 'watching.png'), fullPage: false });

  // The lever, live now that a round has started — `DEC-005`'s own measurement is how often
  // a person reaches for it, and a button that could not be pressed would measure nothing.
  await expect(page.getByTestId('battle-retreat')).toBeVisible();

  await page.getByTestId('battle-skip').click();
  await expect(page.getByTestId('battle-screen')).toHaveAttribute('data-state', 'Normal');

  const outcome = await page.getByTestId('battle-outcome').textContent();

  expect(outcome, 'a finished fight names how it ended').toBeTruthy();

  await page.screenshot({ path: join(EVIDENCE_ROOT, 'finished.png'), fullPage: false });

  // And the debrief. The outcome was committed the moment the fight ended; leaving is the
  // player's own press, so the line saying how it went is not taken off the screen by the
  // last event landing on it.
  await page.getByTestId('battle-leave').click();
  await expect(page.getByTestId('after-action-screen')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('after-action-battle')).toBeVisible();

  // The column §10.3 adds: what happened, beside what the forecast promised. Its presence
  // is the whole point of the section — a debrief that lost it would still read perfectly.
  await expect(page.getByTestId('after-action-coverage')).toContainText('Прогноз обещал');

  await page.screenshot({ path: join(EVIDENCE_ROOT, 'debrief.png'), fullPage: false });
  writeFileSync(join(EVIDENCE_ROOT, 'events.jsonl'), events.map((line) => `${line}\n`).join(''));
  writeFileSync(
    join(EVIDENCE_ROOT, 'report.json'),
    `${JSON.stringify(
      {
        screen: 'combat_loop',
        scenario: SCENARIO,
        seed: SEED.toString(),
        locale: LOCALE,
        formation: FORMATION.map(([row, column]) => `${String(row)}:${String(column)}`),
        outcome,
        events: events.length
      },
      null,
      2
    )}\n`
  );

  expect(events, 'the page must produce no error or failed request').toEqual([]);
});

test('the run can name which contract it opens on, which is what §13.2 counterbalances with', async ({
  page
}) => {
  // Without this the lab always opens on the campaign's lexicographically first contract,
  // and the playtest's "second battle" and "harder battle" would be one fact — the gate
  // would be measuring fatigue (`2026-08-30-combat-lab-playtest-protocol.md` §3.0).
  await page.goto(`${runUrl()}&contract=core:escort_the_relic`);

  await expect(page.getByTestId('contract-offer-screen')).toBeVisible();
  await expect(page.getByTestId('contract-offer-screen')).toContainText('реликвари');
});

/** Presses one control and refuses to continue if the engine turned it down. */
async function press(page: Page, testId: string): Promise<void> {
  await page.getByTestId(testId).click();

  // The refusal, if there was one, is on the screen — so a loop that stopped halfway names
  // *which* command the engine refused rather than failing on a control that never appeared
  // three steps later.
  const rejection = page.getByTestId('offer-rejection');

  if ((await rejection.count()) > 0) {
    expect(await rejection.textContent(), `'${testId}' was refused`).toBeNull();
  }
}

function runUrl(): string {
  const parameters = new URLSearchParams({
    scenario: SCENARIO,
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
    events.push(JSON.stringify({ kind: 'requestfailed', url: request.url() }));
  });
}
