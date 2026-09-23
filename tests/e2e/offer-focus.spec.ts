import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test, type ConsoleMessage, type Page, type Request } from '@playwright/test';

import { measureLayout } from './layout.ts';

/**
 * A focused control is never hidden under the pinned summary row (WCAG 2.4.11, Focus Not
 * Obscured), measured.
 *
 * **Found by external review, 2026-09-23.** Only the summary row sticks to the top of the
 * offer screen (owner's decision of that day); the levers and the ladder scroll under it. A
 * browser scrolls a control the keyboard reaches only when it is outside the scrolling box,
 * and a control under the row is inside the box — the browser is content it is on screen,
 * and the player is looking at the row instead of at the control he is on.
 *
 * Neither hash can see it, and `contract-offer.spec.ts`'s reachability measurement answers
 * another question — whether content can be scrolled to, not whether a control the keyboard
 * just reached is covered. This run asks exactly that, control by control: the screen is
 * wheeled to its end, and then, going back up, each control is left where a wheel leaves a
 * control that is passing under the row — twice, wholly behind it and only just behind it
 * ({@link DEPTHS}) — focus is put on the control after it, and Shift+Tab is pressed (the last
 * control, with nothing after it, is reached with Tab from the one before). Wherever the
 * browser then stands the control focus landed on, it must stand wholly under the row's
 * bottom edge.
 *
 * **Why a sweep and not one Shift+Tab walk from the end.** A walk was the first version, and
 * whether it met the defect at all depended on how the controls happened to fall against the
 * row at each step: the browser centres a control that is out of view, so most steps jumped
 * clear of the row, and on `screen_normal` two runs of the same code met the row once and
 * not at all. The sweep puts every control in the one place the defect lives, so each press
 * asks the question rather than possibly asking it.
 *
 * Wholly, where 2.4.11 asks only "not entirely hidden": a control half under the row reads
 * as the row's own, and the stricter bound is the one the fix is built to meet.
 *
 * Two states, because the row has two heights: one line of text, and two when the count
 * reads "Отряд ещё не спрашивали" and the treasury wraps under the contract. A fix sized by
 * a number taken off the one-line row would pass the first and fail the second; how many
 * lines each state draws is asserted, not assumed, so a copy change that stopped the wrap
 * would say so here.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = join(HERE, '..', '..');
const EVIDENCE_ROOT = join(REPOSITORY_ROOT, 'artifacts', 'browser-evidence', 'offer_focus');

const SEED = 424242n;
const LOCALE = 'ru';

/** The screen element, which is the one scrolling box on the page (`layout.ts`). */
const SCREEN = 'contract-offer-screen';

/** The narrow row pinned to the top of the screen while the rest scrolls (spec §4). */
const SUMMARY = 'offer-summary';

/**
 * What a keyboard can land on in the screen, in document order — which is tab order here,
 * since nothing in the screen sets a positive `tabindex`. Every control the screen draws is
 * visible; one that is not is left out by the `getClientRects` filter where this is used.
 */
const FOCUSABLE = ['input', 'button', 'select', 'textarea', 'a[href]', '[tabindex]']
  .map((tag) => `${tag}:not(:disabled):not([tabindex="-1"])`)
  .join(', ');

/**
 * The states swept, and how many lines of text the summary row draws on each — the premise
 * of the pair, asserted before the verdict.
 */
const STATES = [
  { scenario: 'screen_normal', summaryLines: 1 },
  // The run `offer-refusal.spec.ts` starts from: a package nobody has been asked about yet,
  // so the count reads "Отряд ещё не спрашивали" and the treasury wraps under the contract.
  { scenario: 'battle_lab', summaryLines: 2 }
] as const;

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * How far behind the row a control is left before the press, and each asks its own question.
 *
 * - `deep`: its top edge a pixel inside the box's top edge — wholly behind the row, the
 *   control 2.4.11 is about. Any padding at all makes the browser scroll here, so this one
 *   says only that the box knows its top is covered.
 * - `shallow`: its top edge a pixel above the row's bottom edge — the least a control can be
 *   behind the row. The browser scrolls here only if the padding reaches the row's bottom,
 *   so this is the one that tells a padding sized to the one-line row from one sized to the
 *   row as it is: on the two-line row a one-line padding leaves the control where it was.
 */
const DEPTHS = ['deep', 'shallow'] as const;

type Depth = (typeof DEPTHS)[number];

/** One key press, and where it left the focused control and the summary row. */
interface FocusStep {
  readonly key: 'Tab' | 'Shift+Tab';
  readonly depth: Depth;
  /** The control that was left under the row before the press. */
  readonly target: string;
  /** Whether the target stood behind the pinned row before the press — the question asked. */
  readonly target_under_row_before: boolean;
  /** The control focus landed on; the target, or its radio group's checked member. */
  readonly focused: string;
  readonly scroll_top_before: number;
  readonly scroll_top_after: number;
  readonly control_box: Box;
  readonly summary_box: Box;
  /** The row is stuck to the screen's top edge rather than standing in its place in the flow. */
  readonly summary_pinned: boolean;
  /** How far the focused control's top edge stands under the row's bottom; negative is behind it. */
  readonly clearance: number;
}

for (const { scenario, summaryLines } of STATES) {
  test(`${scenario}: no control the keyboard reaches is hidden under the pinned summary row`, async ({
    page
  }) => {
    const events: string[] = [];
    recordEvents(page, events);

    await page.goto(runUrl(scenario));
    await expect(page.getByTestId(SCREEN)).toBeVisible();
    await expect(page.getByTestId(SUMMARY)).toBeVisible();

    const linesDrawn = await summaryLinesOf(page);

    // Wheeled to the end, as a person who has read the squad down to its last card is; from
    // there the sweep goes back up.
    await measureLayout(page, SCREEN);

    const count = await page.evaluate(
      ({ testId, focusable }) =>
        Array.from(
          document.querySelector(`[data-testid="${testId}"]`)?.querySelectorAll(focusable) ?? []
        ).filter((element) => element.getClientRects().length > 0).length,
      { testId: SCREEN, focusable: FOCUSABLE }
    );
    const steps: FocusStep[] = [];
    let worstFrame: Buffer | null = null;

    // Every control but the last is reached with Shift+Tab from the one after it, which is
    // the walk back up the screen; the last — a button of the ladder when one is enabled —
    // has nothing after it in the screen, so it is reached with Tab from the one before.
    for (let index = count - 1; index >= 0 && count > 1; index -= 1) {
      for (const depth of DEPTHS) {
        const step = await pressOnto(page, index, index === count - 1 ? 'Tab' : 'Shift+Tab', depth);

        if (step === null) {
          continue;
        }

        const closest = steps.every((earlier) => step.clearance < earlier.clearance);
        steps.push(step);

        // The frame of the press that came closest to the row — the one a reader wants to see.
        if (closest) {
          worstFrame = await page.screenshot({ fullPage: false });
        }
      }
    }

    // Each state clears its own directory and no other: Playwright runs the states in
    // parallel workers, and a `beforeAll` clearing the whole root runs once per worker — it
    // deleted a report another worker had just written (`contract-offer.spec.ts` records the
    // same trap).
    const directory = join(EVIDENCE_ROOT, scenario);
    rmSync(directory, { recursive: true, force: true });
    mkdirSync(directory, { recursive: true });

    const asked = steps.filter((step) => step.target_under_row_before);
    const worst = steps.reduce<FocusStep | null>(
      (closest, step) => (closest === null || step.clearance < closest.clearance ? step : closest),
      null
    );

    if (worstFrame !== null) {
      writeFileSync(join(directory, 'screenshot.png'), worstFrame);
    }

    writeFileSync(join(directory, 'events.jsonl'), events.map((line) => `${line}\n`).join(''));
    writeFileSync(
      join(directory, 'report.json'),
      `${JSON.stringify(
        {
          scenario,
          seed: SEED.toString(),
          locale: LOCALE,
          summary_lines: linesDrawn,
          summary_height: worst?.summary_box.height ?? null,
          presses: steps.length,
          presses_under_pinned_row: asked.length,
          min_clearance: worst?.clearance ?? null,
          worst,
          presses_log: steps,
          events: events.length
        },
        null,
        2
      )}\n`
    );

    // The premise, in two parts: the state draws the row at the height it is here for, and
    // some press really started from a control behind the pinned row — a sweep whose
    // controls never stood there would be green about nothing.
    expect(linesDrawn, `the summary row must draw ${String(summaryLines)} line(s) here`).toBe(
      summaryLines
    );
    expect(
      asked.length,
      'some press must start from a control behind the pinned summary row'
    ).toBeGreaterThan(0);

    // The verdict: every control focus landed on stands wholly under the row.
    for (const step of steps) {
      expect(
        step.clearance,
        `focused ${step.focused} ${describe(step.control_box)} must stand under the summary ` +
          `row ${describe(step.summary_box)} at scrollTop ${String(step.scroll_top_after)}`
      ).toBeGreaterThanOrEqual(0);
    }

    expect(events, 'the page must produce no error or failed request').toEqual([]);
  });
}

/**
 * How many lines the summary row's content stands on, counted off the rail's own children.
 *
 * Not the distinct tops: the rail aligns its items on a baseline, so a large title and a
 * small caption on one line start at different heights — measured, that read one line as
 * three. A child starts a new line when it begins under the bottom of every child on the
 * line so far, which is what wrapping is.
 */
async function summaryLinesOf(page: Page): Promise<number> {
  return page.evaluate((testId: string) => {
    const rail = document.querySelector(`[data-testid="${testId}"] > .rail`);

    if (rail === null) {
      throw new Error(`The page has no rail inside [data-testid="${testId}"] to count lines of.`);
    }

    const boxes = Array.from(rail.children, (child) => child.getBoundingClientRect()).sort(
      (a, b) => a.top - b.top
    );
    let lines = 0;
    let lineBottom = Number.NEGATIVE_INFINITY;

    for (const box of boxes) {
      if (box.top >= lineBottom) {
        lines += 1;
        lineBottom = box.bottom;
      } else {
        lineBottom = Math.max(lineBottom, box.bottom);
      }
    }

    return lines;
  }, SUMMARY);
}

/**
 * One press of the sweep: the control at `index` left behind the row the way a wheel leaves
 * it — as deep as {@link Depth} says — focus put on its neighbour without scrolling — the control after it
 * for Shift+Tab, the one before it for Tab — the key pressed, and where the browser left
 * things once the screen stopped moving. `null` when focus left the screen.
 *
 * The scroll and the first focus are the page's own (`scrollTop`, `focus({ preventScroll:
 * true })`): they only set the stage. The press is a real key press, so where the control
 * lands is where the browser's own focus navigation put it.
 */
async function pressOnto(
  page: Page,
  index: number,
  key: 'Tab' | 'Shift+Tab',
  depth: Depth
): Promise<FocusStep | null> {
  const staged = await page.evaluate(
    ({ testId, summaryId, focusable, at, from, shallow }) => {
      const screen = document.querySelector(`[data-testid="${testId}"]`);
      const summary = document.querySelector(`[data-testid="${summaryId}"]`);
      const controls = Array.from(screen?.querySelectorAll<HTMLElement>(focusable) ?? []).filter(
        (element) => element.getClientRects().length > 0
      );
      const target = controls[at];
      const neighbour = controls[from];

      if (screen === null || summary === null || target === undefined || neighbour === undefined) {
        throw new Error(`The sweep lost the screen, its summary row or control ${String(at)}.`);
      }

      // The target's top edge one pixel inside the box's top edge — behind the pinned row, as
      // long as the screen can scroll that far.
      const inside = screen.getBoundingClientRect().top + screen.clientTop;
      screen.scrollTop += target.getBoundingClientRect().top - inside - 1;

      // Shallow: back down until the top edge is a pixel above the row's bottom edge. Read off
      // the row after the first scroll, which is what pinned it.
      if (shallow) {
        screen.scrollTop -=
          summary.getBoundingClientRect().bottom - 1 - target.getBoundingClientRect().top;
      }
      neighbour.focus({ preventScroll: true });

      return {
        target: describeControl(target),
        // Behind the row, and the row pinned over the scrolled content rather than standing
        // in its place in the flow — the two together are the question this press asks.
        underRow:
          target.getBoundingClientRect().top < summary.getBoundingClientRect().bottom &&
          summary.getBoundingClientRect().top - screen.getBoundingClientRect().top <= 2,
        scrollTop: Math.round(screen.scrollTop)
      };

      function describeControl(element: Element): string {
        const id = element.getAttribute('data-testid');

        return id === null
          ? `<${element.tagName.toLowerCase()}>`
          : `<${element.tagName.toLowerCase()} data-testid="${id}">`;
      }
    },
    {
      testId: SCREEN,
      summaryId: SUMMARY,
      focusable: FOCUSABLE,
      at: index,
      from: key === 'Tab' ? index - 1 : index + 1,
      shallow: depth === 'shallow'
    }
  );

  await page.keyboard.press(key);

  const landed = await page.evaluate(
    async ({ testId, summaryId }) => {
      const screen = document.querySelector(`[data-testid="${testId}"]`);
      const summary = document.querySelector(`[data-testid="${summaryId}"]`);
      const control = document.activeElement;

      if (screen === null || summary === null) {
        throw new Error('The page lost the offer screen or its summary row during the sweep.');
      }

      if (control === null || !screen.contains(control)) {
        return null;
      }

      // Three frames on which the scroll offset agrees, the way `layout.ts` waits for a wheel.
      let last = screen.scrollTop;
      let agreed = 0;

      for (let frame = 0; frame < 60 && agreed < 2; frame += 1) {
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
        agreed = screen.scrollTop === last ? agreed + 1 : 0;
        last = screen.scrollTop;
      }

      const round = (rect: DOMRect) => ({
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      });
      const controlRect = control.getBoundingClientRect();
      const summaryRect = summary.getBoundingClientRect();
      const screenRect = screen.getBoundingClientRect();
      const id = control.getAttribute('data-testid');

      return {
        focused:
          id === null
            ? `<${control.tagName.toLowerCase()}>`
            : `<${control.tagName.toLowerCase()} data-testid="${id}">`,
        scrollTop: Math.round(screen.scrollTop),
        controlBox: round(controlRect),
        summaryBox: round(summaryRect),
        // Stuck when the row's top edge is at the screen's own, give or take its border and
        // a pixel of rounding; in the flow it stands under the title, tens of pixels lower.
        summaryPinned: summaryRect.top - screenRect.top <= 2,
        // A control inside the row itself is its own pinned surface and cannot be behind it.
        clearance: summary.contains(control) ? 0 : Math.floor(controlRect.top - summaryRect.bottom)
      };
    },
    { testId: SCREEN, summaryId: SUMMARY }
  );

  return landed === null
    ? null
    : {
        key,
        depth,
        target: staged.target,
        target_under_row_before: staged.underRow,
        focused: landed.focused,
        scroll_top_before: staged.scrollTop,
        scroll_top_after: landed.scrollTop,
        control_box: landed.controlBox,
        summary_box: landed.summaryBox,
        summary_pinned: landed.summaryPinned,
        clearance: landed.clearance
      };
}

function describe(box: Box): string {
  return `[x ${String(box.x)}, y ${String(box.y)}, w ${String(box.width)}, h ${String(box.height)}]`;
}

function runUrl(scenario: string): string {
  const parameters = new URLSearchParams({
    scenario,
    checkpoint: scenario,
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
