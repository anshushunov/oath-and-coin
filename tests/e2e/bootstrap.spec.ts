import { expect, test, type ConsoleMessage } from '@playwright/test';

/**
 * The bootstrap evidence of the browser build: the production bundle loads in
 * a real Chromium, React mounts into an `#root` that ships empty, and the page
 * reports that no Node API is reachable from it.
 *
 * This is the check that would catch what a unit test cannot — a bundle that
 * type-checks and never executes, a `base` path that resolves to nothing, a
 * CSP that blocks the very script it is supposed to allow.
 */
test.describe('web bootstrap', () => {
  test('the production bundle mounts the application', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (message: ConsoleMessage) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text());
      }
    });
    page.on('pageerror', (error: Error) => {
      consoleErrors.push(error.message);
    });

    await page.goto('/');

    // Rendered by React, never present in index.html. An empty `#root` is what
    // a failed bundle looks like, and it is indistinguishable from a healthy
    // page in a screenshot of a mostly empty screen.
    await expect(page.getByTestId('app-root')).toBeVisible();
    await expect(page).toHaveTitle('Oath & Coin');

    // A CSP that refuses the application's own script fails exactly here, with
    // an empty root and a console error, which is why both are asserted.
    expect(consoleErrors, 'the page must load with a clean console').toEqual([]);
  });

  test('the contract-offer screen shows content read out of the bundle', async ({ page }) => {
    await page.goto('/');

    // The one thing no unit test in `apps/web` can say. `import.meta.glob` is
    // resolved by Vite, and vitest and `vite build` are two different code paths
    // through it: a pattern that reaches the shipped tree in the dev transform
    // and inlines nothing in the production bundle leaves every jsdom test green
    // and the page blank. §13.5 of the migration journal named exactly this — a
    // browser source that had never run in a browser — as what Task 13 owes.
    //
    // The two texts asserted are the title and the screen state, both resolved
    // from `content/locale/ru.json`. A bundle that carried no content could not
    // produce either: the session would have failed before the screen existed.
    await expect(page.getByTestId('contract-offer-screen')).toBeVisible();
    await expect(page.getByTestId('contract-offer-screen')).toContainText('Предложение контракта');
    await expect(page.getByTestId('contract-offer-screen')).toContainText('Все ответили');
  });

  test('no Node API is reachable from the page', async ({ page }) => {
    await page.goto('/');

    // ADR-010 §80: `nodeIntegration: false` and `contextIsolation: true` are a
    // mandatory boundary of the desktop host. The browser build is where that
    // boundary is trivially true, so this assertion is cheap here and becomes
    // the same assertion against the packaged Electron host in Task 4 — one
    // property, observed from inside the page in both runtimes, rather than
    // read back out of the options that were supposed to set it.
    await expect(page.getByTestId('node-api-exposure')).toHaveText('absent');
  });
});
