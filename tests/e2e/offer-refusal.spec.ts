import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadUiTextCatalogue } from '@oath-and-coin/content/node';
import { OfferLeverId, RejectionCodes } from '@oath-and-coin/presentation';
import { expect, test, type ConsoleMessage, type Page, type Request } from '@playwright/test';

/**
 * Where a refusal lands on the frame, measured.
 *
 * **Found by the owner playing, 2026-08-31.** He typed an advance of 100 into the siege
 * camp's package — the ceiling is 65, the patron's fee — pressed `Записать условия`, and
 * `Условие вышло за границы платы заказчика` printed under seven rows of buttons. At 1280×800
 * that is below the screen's box: the lever he had to move sat in the middle of the window
 * and the sentence about it stood 34px under its bottom edge. The session stalled there.
 *
 * Neither hash can see it. Every text on that frame was the right text in the right order;
 * *where* a text stands is not a text node, and `contract-offer.spec.ts`'s reachability
 * measurement answers a different question — whether content can be scrolled to, not
 * whether a sentence is on screen at the moment it is printed. This run asks exactly that:
 * after the press, with the screen scrolled to wherever pressing left it, the refusal's box
 * is inside the screen's box, and it is inside the block of the lever it is about.
 *
 * The same walk `combat-loop.spec.ts` starts with, up to the press — the same contract, the
 * same seed, the same key hero and crew — with the one number the owner typed.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = join(HERE, '..', '..');
const EVIDENCE_ROOT = join(REPOSITORY_ROOT, 'artifacts', 'browser-evidence', 'offer_refusal');

const SEED = 424242n;
const LOCALE = 'ru';
const SCENARIO = 'battle_lab';

/** The advance the owner typed, and the ceiling the lever declared when he did. */
const ADVANCE_TYPED = 100;
const CEILING = 65;

/** The screen element, which is the one scrolling box on the page (`layout.ts`). */
const SCREEN = 'contract-offer-screen';

const catalogue = loadUiTextCatalogue(join(REPOSITORY_ROOT, 'ui-text', `${LOCALE}.json`));

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

test.beforeAll(() => {
  rmSync(EVIDENCE_ROOT, { recursive: true, force: true });
  mkdirSync(EVIDENCE_ROOT, { recursive: true });
});

test('a term the engine refuses is refused on screen, beside the lever it came from', async ({
  page
}) => {
  const events: string[] = [];
  recordEvents(page, events);

  await page.goto(runUrl());
  await expect(page.getByTestId(SCREEN)).toBeVisible();

  // The premise, pinned before the press: the lever declares the ceiling the owner went
  // past. If the fee or the budget ever moved this, the run below would be measuring a
  // package the engine accepts, and "the refusal is on screen" would be about nothing.
  await expect(page.getByTestId('offer.advance')).toHaveAttribute('max', String(CEILING));

  await page.getByTestId('offer.advance').fill(String(ADVANCE_TYPED));
  await page.getByTestId('key-hero-option-0').check();

  for (let index = 0; index < 4; index += 1) {
    await page.getByTestId(`crew-option-${String(index)}`).check();
  }

  // Playwright scrolls a control into view to press it, as a person does; from here on the
  // screen is not scrolled by this test at all. What is on screen after the press is what
  // the player sees after the press.
  const scrollTopBefore = await scrollTop(page);
  await page.getByTestId('action-compose').click();
  const scrollTopAfter = await scrollTop(page);

  const refusal = page.getByTestId('offer-rejection');
  const expectedSentence = catalogue.get(RejectionCodes.OfferTermsOutOfBounds);

  if (expectedSentence === undefined) {
    throw new Error(`ui-text/${LOCALE}.json ships no sentence for the refusal under test.`);
  }

  await expect(refusal).toHaveText(expectedSentence);

  // The block the refusal is in, asked of the DOM: the three term levers share one block,
  // and the sentence has to be inside it — not under the buttons, where it used to be.
  const lever = await refusal.evaluate(
    (element) => element.closest('[data-lever]')?.getAttribute('data-lever') ?? null
  );

  expect(lever, 'the refusal must stand in the block of the levers it is about').toBe(
    OfferLeverId.Terms
  );

  const screenBox = await boxOf(page, `[data-testid="${SCREEN}"]`);
  const leverBox = await boxOf(page, `[data-lever="${OfferLeverId.Terms}"]`);
  const advanceBox = await boxOf(page, '[data-testid="offer.advance"]');
  const refusalBox = await boxOf(page, '[data-testid="offer-rejection"]');

  await page.screenshot({ path: join(EVIDENCE_ROOT, 'screenshot.png'), fullPage: false });
  writeFileSync(join(EVIDENCE_ROOT, 'events.jsonl'), events.map((line) => `${line}\n`).join(''));
  writeFileSync(
    join(EVIDENCE_ROOT, 'report.json'),
    `${JSON.stringify(
      {
        scenario: SCENARIO,
        seed: SEED.toString(),
        locale: LOCALE,
        advance_typed: ADVANCE_TYPED,
        ceiling: CEILING,
        refusal: expectedSentence,
        lever,
        scroll_top_before: scrollTopBefore,
        scroll_top_after: scrollTopAfter,
        screen_box: screenBox,
        lever_box: leverBox,
        advance_box: advanceBox,
        refusal_box: refusalBox,
        refusal_within_screen: within(refusalBox, screenBox),
        refusal_within_lever_block: within(refusalBox, leverBox),
        events: events.length
      },
      null,
      2
    )}\n`
  );

  // The verdict, in the two halves it has. Inside the lever's own block first — that is what
  // "beside" means — and inside the screen's box second, without anything having been
  // scrolled since the press: a sentence a person has to go looking for is the defect.
  expect(within(refusalBox, leverBox), 'the refusal must be drawn inside the lever block').toBe(
    true
  );
  expect(
    within(refusalBox, screenBox),
    `the refusal must be on screen the moment it is printed: refusal ${describe(refusalBox)} ` +
      `against screen ${describe(screenBox)}`
  ).toBe(true);
  expect(scrollTopAfter, 'the press itself must not scroll the screen').toBe(scrollTopBefore);

  // And the number it is about is on the same screen, so both halves of "you typed 100
  // over a ceiling of 65" can be read at once.
  expect(within(advanceBox, screenBox), 'the advance control must be on screen too').toBe(true);

  expect(events, 'the page must produce no error or failed request').toEqual([]);
});

/** Whether `inner` lies entirely inside `outer`, to the pixel. */
function within(inner: Box, outer: Box): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

function describe(box: Box): string {
  return `[x ${String(box.x)}, y ${String(box.y)}, w ${String(box.width)}, h ${String(box.height)}]`;
}

/**
 * The visible box of the first element `selector` matches, rounded to whole pixels.
 *
 * `boundingBox` is a viewport-relative rectangle after layout and after scrolling, which is
 * the right frame of reference for "is it on screen": the screen element's own box is what a
 * person sees of the screen, and an element scrolled past its bottom edge has a `y` below it.
 */
async function boxOf(page: Page, selector: string): Promise<Box> {
  const box = await page.locator(selector).first().boundingBox();

  if (box === null) {
    throw new Error(`The page has no visible '${selector}' to measure.`);
  }

  return {
    x: Math.round(box.x),
    y: Math.round(box.y),
    width: Math.round(box.width),
    height: Math.round(box.height)
  };
}

async function scrollTop(page: Page): Promise<number> {
  return page.evaluate((testId: string) => {
    const element = document.querySelector(`[data-testid="${testId}"]`);

    if (element === null) {
      throw new Error(`The page has no [data-testid="${testId}"] to read scrollTop off.`);
    }

    return element.scrollTop;
  }, SCREEN);
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
