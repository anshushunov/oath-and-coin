import { expect, type Page } from '@playwright/test';

/**
 * Every coloured span under `testId` is painted the colour its role names (`DEC-018`).
 *
 * The component tests say which span carries which role; only a browser says the stylesheet
 * turns the role into the colour — a rule deleted from `styles.css` leaves every attribute in
 * place and every span in the ink of the text around it. Compared against the token read off
 * the page, never against a literal written here.
 *
 * Shared, because `COMBAT_SPEC` §10.2.1 asks it of both screens that print the journal: the
 * battle screen's own and the debrief's feed. The stylesheet rule is one, but a rule scoped
 * under one screen's class would pass on that screen and leave the other uncoloured.
 *
 * Computed style, not pixels: a span below the fold has its colour all the same, so this does
 * not need the feed scrolled into view.
 */
export async function expectToneColours(page: Page, testId: string): Promise<void> {
  const { checked, wrong } = await page.evaluate((root: string) => {
    const element = document.querySelector(`[data-testid="${root}"]`);

    if (element === null) {
      throw new Error(`The page has no [data-testid="${root}"].`);
    }

    const tokens = getComputedStyle(document.documentElement);
    const spans = Array.from(element.querySelectorAll('[data-tone]'));
    const mismatched: string[] = [];

    for (const span of spans) {
      const tone = span.getAttribute('data-tone') ?? '';
      const declared = tokens.getPropertyValue(`--${tone}`).trim();
      const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/iu.exec(declared);

      if (match === null) {
        mismatched.push(`${tone}: no token --${tone} on the page`);
        continue;
      }

      const [red, green, blue] = [match[1], match[2], match[3]].map((part) =>
        Number.parseInt(part ?? '', 16)
      );
      const expected = `rgb(${String(red)}, ${String(green)}, ${String(blue)})`;
      const actual = getComputedStyle(span).color;

      if (actual !== expected) {
        mismatched.push(`${tone}: ${actual}, expected ${expected}`);
      }
    }

    return { checked: spans.length, wrong: mismatched };
  }, testId);

  expect(checked, `a finished fight has coloured spans in '${testId}'`).toBeGreaterThan(0);
  expect(wrong, `every coloured span in '${testId}' is the colour of its role`).toEqual([]);
}
