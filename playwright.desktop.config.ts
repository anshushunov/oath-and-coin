import { defineConfig } from '@playwright/test';

/**
 * A config of its own rather than a second project inside
 * `playwright.config.ts`: the browser suite starts a preview web server for
 * every run, and the packaged host needs no server at all. Sharing one config
 * would mean either starting a server nothing uses or making the server
 * conditional, and a conditional gate is a gate whose state has to be guessed.
 */
export default defineConfig({
  testDir: 'tests/desktop',

  // The packaged application is launched and torn down per test file, which is
  // slower than a browser context and not worth parallelising on one machine.
  workers: 1,
  retries: 0,
  forbidOnly: true,

  reporter: [['list'], ['html', { outputFolder: 'artifacts/desktop-report', open: 'never' }]],
  outputDir: 'artifacts/desktop-results',

  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  }
});
