import { expect, type Page } from '@playwright/test';

/**
 * How a screen is measured, for both screens, in one place.
 *
 * It lived inside `contract-offer.spec.ts` until Task 16.8 round 1, and the review that
 * moved it here named the reason: `save-slots.spec.ts` had written its own, simpler
 * version, whose `reachableHeight` was the box's own `clientHeight` rather than the wheel's
 * answer. That made its reachability assertion tautologically equal to "the content fits",
 * so a state that ever did overflow could not have passed it — and the column both suites
 * publish into the CI summary meant two different things under one heading. One
 * measurement, used by both, is the only version of this that stays comparable.
 *
 * Not a `.spec.ts`, so Playwright does not collect it as a suite; `tsconfig.json` here
 * includes it explicitly, because a helper outside the typecheck is a helper the gate
 * cannot see.
 */

/**
 * The four numbers `ScreenLayoutMeasurement` carried, measured in a browser, plus the two
 * that say whether the question was asked at all and one that says what the window was.
 *
 * `content*` is the content's natural size before clipping. `reachable*` is the box plus
 * however far a *person* can scroll it — measured with the mouse wheel, for the reason
 * {@link measureLayout} records: neither `scrollWidth - clientWidth` nor an assignment to
 * `scrollTop` can tell a scrolling box from one whose overflow is `hidden`.
 *
 * `viewport*` is how much of it is on screen at once, which is what says whether the
 * reachability question was even asked. `windowHeight` is the window itself, and it is
 * recorded beside them because the two are only meaningfully different numbers while the
 * screen is bounded by the window — which is a property nothing measured, until
 * {@link expectWindowBoundedScreen}.
 */
export interface LayoutMeasurement {
  readonly contentWidth: number;
  readonly contentHeight: number;
  readonly reachableWidth: number;
  readonly reachableHeight: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly windowHeight: number;
}

/**
 * How big the screen's content is, and how much of it a person at this window can get to.
 *
 * **The reachable extent is found with the mouse wheel, and the first version of this
 * function did it by assignment — which was wrong, and a mutant is what said so.**
 * Setting `element.scrollTop` scrolls a box whose computed overflow is `hidden` just as
 * happily as one set to `auto`: `overflow: hidden` removes the *user's* ability to
 * scroll, not the scripting API's. So the mutant this measurement exists for — the
 * container stops scrolling while both hashes stay green — left all five states green,
 * and the check was measuring "is this content addressable by script", which no player
 * has. Reading `scrollWidth - clientWidth` would have been worse still: that is the same
 * number whatever the overflow rule says.
 *
 * Wheeling is what a person does, so wheeling is what this does. The wheel is delivered
 * over the middle of the screen element and the resulting position is polled until it
 * stops changing, rather than waited for by a fixed delay: scrolling is applied
 * asynchronously, and a sleep long enough to be safe on this machine is a sleep that is
 * sometimes too short on a loaded CI runner.
 */
export async function measureLayout(page: Page, screen: string): Promise<LayoutMeasurement> {
  const box = await page.getByTestId(screen).boundingBox();

  if (box === null) {
    throw new Error(`The page has no visible [data-testid="${screen}"] to measure.`);
  }

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

  // One delta far larger than any screen here, so a scrollable box lands at its end in a
  // single step and an unscrollable one stays where it was. The size of the delta is not
  // a threshold — the position is read back, never assumed.
  const FAR = 100_000;

  const wheelDown = async (): Promise<void> => {
    await page.mouse.wheel(0, FAR);
  };
  const wheelRight = async (): Promise<void> => {
    await page.mouse.wheel(FAR, 0);
  };

  await wheelDown();
  const maxTop = await settledScroll(page, screen, 'scrollTop', wheelDown);

  await wheelRight();
  const maxLeft = await settledScroll(page, screen, 'scrollLeft', wheelRight);

  return page.evaluate(
    ({ testId, top, left }) => {
      const element = document.querySelector(`[data-testid="${testId}"]`);

      if (element === null) {
        throw new Error(`The page has no [data-testid="${testId}"] to measure.`);
      }

      // The screen is meant to be the only scrolling box on the page: `html`, `body` and
      // `#root` are pinned to the window's height, so nothing else can take the wheel.
      // Asserted rather than assumed, because if anything above the screen did scroll,
      // content this function called unreachable might be reachable by scrolling that
      // instead — and the measurement would be wrong in the direction that fails a
      // working screen.
      //
      // Every ancestor, not just `documentElement`, and both axes: external review
      // pointed out that the first version checked one element and one direction, while
      // `body`, `#root`, `main` and `document.scrollingElement` are all boxes a wheel
      // could go to. The walk is bounded by the document.
      //
      // **This is a guard, not a check proven by a plausible mutant.** Measured: neither
      // relaxing the grid row nor removing the screen's `min-height` makes any ancestor
      // overflow, because a grid item with `overflow: auto` already has a zero automatic
      // minimum size. It does fire — an explicit `height: 200%` on `main` reddens all
      // five states with the message below — so the mechanism works; what is missing is
      // an authoring mistake small enough to be likely. Named rather than counted as
      // covered, on the same terms as the horizontal reachability assertion.
      for (
        let ancestor: Element | null = element.parentElement;
        ancestor !== null;
        ancestor = ancestor.parentElement
      ) {
        if (
          ancestor.scrollHeight > ancestor.clientHeight ||
          ancestor.scrollWidth > ancestor.clientWidth
        ) {
          throw new Error(
            `<${ancestor.tagName.toLowerCase()}> above the screen overflows its own box, so the ` +
              'screen element is no longer the only place content can be reached from and this ' +
              'measurement no longer answers the question.'
          );
        }
      }

      return {
        contentWidth: element.scrollWidth,
        contentHeight: element.scrollHeight,
        reachableWidth: element.clientWidth + left,
        reachableHeight: element.clientHeight + top,
        viewportWidth: element.clientWidth,
        viewportHeight: element.clientHeight,
        // The window itself, so a report can be read without the reader having to know
        // what viewport the suite was configured with.
        windowHeight: document.documentElement.clientHeight
      };
    },
    { testId: screen, top: maxTop, left: maxLeft }
  );
}

/**
 * Where the screen ended up once it stopped moving.
 *
 * Two things make this less fragile than it first was, and external review named both.
 * A position is settled only after it has read the same across three consecutive
 * animation frames — two reads 25ms apart can both catch a wheel that has not been
 * processed yet and call a working screen unscrollable. And a position short of the
 * arithmetic maximum is not accepted on the first try: the wheel is delivered again, up
 * to a bounded number of attempts, because falling short is what a slow compositor looks
 * like and reaching the end is what a scrolling box does. A box that genuinely cannot
 * scroll spends the whole budget and still answers zero, which is the correct answer
 * arrived at slowly rather than a wrong one arrived at quickly.
 */
async function settledScroll(
  page: Page,
  screen: string,
  axis: 'scrollTop' | 'scrollLeft',
  wheel: () => Promise<void>
): Promise<number> {
  const extent = axis === 'scrollTop' ? 'vertical' : 'horizontal';

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { position, maximum } = await stableScrollPosition(page, screen, axis);

    if (position >= maximum) {
      return position;
    }

    // Short of the end. Either the box stops here — an overflow rule that denies the
    // user the rest — or the wheel has not been fully applied yet. Another wheel tells
    // the two apart; the loop bound stops it being a wait forever.
    await wheel();

    if (attempt === 4) {
      return position;
    }
  }

  throw new Error(`Unreachable: the ${extent} scroll loop always returns.`);
}

/** The screen's scroll offset once three consecutive frames agree on it. */
async function stableScrollPosition(
  page: Page,
  screen: string,
  axis: 'scrollTop' | 'scrollLeft'
): Promise<{ position: number; maximum: number }> {
  return page.evaluate(
    async ({ testId, property }) => {
      const element = document.querySelector(`[data-testid="${testId}"]`);

      if (element === null) {
        throw new Error(`The page has no [data-testid="${testId}"] to measure.`);
      }

      const nextFrame = async (): Promise<void> => {
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
      };

      const read = (): { position: number; maximum: number } =>
        property === 'scrollTop'
          ? {
              position: element.scrollTop,
              maximum: element.scrollHeight - element.clientHeight
            }
          : {
              position: element.scrollLeft,
              maximum: element.scrollWidth - element.clientWidth
            };

      let agreed = 0;
      let last = read();

      // Bounded: 60 frames is a second at 60Hz, and a scroll that is still moving after
      // a second of nothing but this is not a scroll anyone is waiting on.
      for (let frame = 0; frame < 60; frame += 1) {
        await nextFrame();
        const now = read();

        agreed = now.position === last.position ? agreed + 1 : 0;
        last = now;

        if (agreed >= 2) {
          return now;
        }
      }

      throw new Error(`The screen's ${property} never settled across 60 frames.`);
    },
    { testId: screen, property: axis }
  );
}

/**
 * How much taller the window is made to prove the screen is bounded by it.
 *
 * Large enough that no rounding or scrollbar can account for it, small enough that the
 * grown window is still an ordinary one.
 */
const GROWTH = 200;

/** Rounding room. Sub-pixel layout can lose a fraction of a pixel across a resize. */
const TOLERANCE = 4;

/**
 * Asserts the screen's box is a share of the *window* rather than a box the size of its
 * own content.
 *
 * The property nothing held before, and its absence had already cost a real defect: with
 * the screen link added above the screen and `grid-template-rows` left at three rows, the
 * *link* took `minmax(0, 1fr)` and the screen fell into an `auto` row — so it sized itself
 * to its content, the evidence recorded a 73px "viewport", and all fourteen browser tests
 * stayed green. They stayed green correctly: a box exactly as tall as its content neither
 * overflows nor needs scrolling, so every reachability assertion is satisfied trivially by
 * the very failure it exists to catch. The numbers that would have shown it lived in
 * comments.
 *
 * **Stated as a mechanism, not as a threshold.** The obvious version — "the box is at
 * least the window minus the other rows" — is circular and was measured to be: under the
 * collapsed grid the link row is the one that grew, so subtracting the rows' *actual*
 * heights leaves exactly the collapsed box and the assertion passes. What tells the two
 * apart is behaviour: a window-bounded box grows when the window grows, and a
 * content-bounded one does not move at all. So the window is grown, the box re-measured,
 * and the window put back — which also checks the box follows in both directions.
 */
export async function expectWindowBoundedScreen(
  page: Page,
  screen: string,
  measured: LayoutMeasurement
): Promise<void> {
  const size = page.viewportSize();

  if (size === null) {
    throw new Error('This page has no viewport size, so there is no window to measure against.');
  }

  await page.setViewportSize({ width: size.width, height: size.height + GROWTH });
  const grown = await screenHeight(page, screen);

  await page.setViewportSize(size);
  const restored = await screenHeight(page, screen);

  expect(
    grown - measured.viewportHeight,
    'the screen must take the leftover height of the window: a box that does not grow with ' +
      'the window is sized by its own content, and every reachability number above is then ' +
      'about that content rather than about what a person can see'
  ).toBeGreaterThanOrEqual(GROWTH - TOLERANCE);

  expect(
    restored,
    'and it must give the height back, so the measurement above is about this window'
  ).toBe(measured.viewportHeight);
}

async function screenHeight(page: Page, screen: string): Promise<number> {
  return page.evaluate((testId: string) => {
    const element = document.querySelector(`[data-testid="${testId}"]`);

    if (element === null) {
      throw new Error(`The page has no [data-testid="${testId}"] to measure.`);
    }

    return element.clientHeight;
  }, screen);
}
