import { defineConfig, devices } from '@playwright/test';

const previewUrl = 'http://127.0.0.1:4173';

export default defineConfig({
  testDir: 'tests/e2e',

  // A test that passes on the second attempt is a test that failed. ADR-008's
  // successor evidence rules are the same on this point: the artifact of a run
  // is the verdict, and a retry hides the run that produced the real one.
  retries: 0,
  forbidOnly: true,

  reporter: [['list'], ['html', { outputFolder: 'artifacts/e2e-report', open: 'never' }]],
  outputDir: 'artifacts/e2e-results',

  use: {
    baseURL: previewUrl,
    // 1280x800 is the size ADR-010's Definition of Done states for reachability
    // of screen content. Fixing it here means a later screen test inherits the
    // size the record talks about instead of Playwright's default.
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },

  projects: [{ name: 'chromium', use: devices['Desktop Chrome'] }],

  webServer: {
    // Built output, not the dev server. The dev server rewrites modules,
    // injects its own client and serves an unminified graph — so a bug in the
    // production build is invisible to it, and the packaged Electron host
    // loads the production build.
    //
    // Vite is invoked through Node directly rather than as
    // `pnpm --filter @oath-and-coin/web build`. A nested pnpm spawned from a
    // process that corepack already started resolves to corepack's known-good
    // release (11.9.0) instead of the pinned packageManager (11.22.0), and
    // pnpm then refuses to run at all: the whole suite dies with
    // "Process from config.webServer was not able to start", whose cause is
    // four lines of pnpm version text and nothing about Playwright. Same trap
    // as the one the root tsconfig documents.
    command: 'node node_modules/vite/bin/vite.js build && node node_modules/vite/bin/vite.js preview',
    cwd: 'apps/web',
    url: previewUrl,
    // Never adopt whatever is already listening on that port: a stale server
    // from an earlier commit would make this suite report on code that is no
    // longer in the tree.
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe'
  }
});
