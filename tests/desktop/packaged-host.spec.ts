import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';

/**
 * The Task 4 gate (ADR-010, narrowed by ADR-011): the packaged Windows
 * application starts, shows the browser build, keeps the mandatory security
 * boundary, answers exactly one IPC method, and fits the budgets.
 *
 * Everything here is observed from a running packaged application. Reading the
 * `webPreferences` object back out of the code that set it would prove that
 * the code says `sandbox: true`, which is a different claim: the OS-level
 * sandbox flag and what the page can actually reach are the facts, and both
 * are read from the live process below.
 */

const repoRoot = resolve(import.meta.dirname, '..', '..');
const packagedDirectory = join(repoRoot, 'artifacts', 'electron-spike', 'win-unpacked');
const executable = join(packagedDirectory, 'Oath and Coin.exe');

interface ProcessMetric {
  type: string;
  sandboxed: boolean | undefined;
  workingSetBytes: number;
}

/** Numbers the gate is judged on; written as an artifact, never retyped. */
interface GateEvidence {
  executable: string;
  packagedBytes: number;
  packagedFiles: number;
  rssBytes: number;
  processes: ProcessMetric[];
  pageExposure: PageExposure;
  hostDescription: unknown;
  inlineScriptBlocked: boolean;
  openedExternally: string[];
}

interface PageExposure {
  desktopApiKeys: string[];
  ipcRendererReachable: boolean;
  requireReachable: boolean;
  processReachable: boolean;
}

/**
 * Runs the inline-script probe inside the packaged page and reports what
 * happened.
 *
 * A function rather than an inline block because the report has to record the
 * value this probe actually produced. External review found the report writing
 * `inlineScriptBlocked: true` as a constant: if the CSP test failed and
 * Playwright restarted the worker, `gate-report.json` — published by CI with
 * `always()` — would still claim the policy held on a build where the inline
 * script ran. A failure artifact that contradicts the verdict is worse than no
 * artifact.
 */
async function probeInlineScript(app: ElectronApplication): Promise<boolean> {
  const page = await app.firstWindow();

  const inlineScriptRan = await page.evaluate(() => {
    const element = document.createElement('script');
    element.textContent = 'window.__inlineScriptRan = true;';
    document.head.append(element);
    return (window as unknown as Record<string, unknown>).__inlineScriptRan === true;
  });

  return !inlineScriptRan;
}

/**
 * Asks the page to open two URLs and reports which of them the host actually
 * handed to the operating system.
 *
 * `shell.openExternal` is replaced inside the main process for the duration of
 * the probe, because the alternative — observing whether Windows launched
 * something — is not something a test can do. The replacement records and
 * returns; the decision under test is the host's, and it happens before this
 * point.
 */
async function probeExternalOpen(app: ElectronApplication): Promise<string[]> {
  await app.evaluate(({ shell }) => {
    const opened: string[] = [];
    (globalThis as unknown as Record<string, unknown>).__openedExternally = opened;
    Object.defineProperty(shell, 'openExternal', {
      configurable: true,
      value: async (url: string) => {
        opened.push(url);
      }
    });
  });

  const page = await app.firstWindow();
  await page.evaluate(() => {
    // `file:` has a handler on every Windows install and is exactly what the
    // unguarded version forwarded; the https one proves the guard did not
    // simply turn the feature off.
    window.open('file:///C:/Windows/System32/calc.exe');
    window.open('https://example.com/docs');
  });

  // The handler runs in the main process, so the page returning is not proof
  // that it has run yet.
  await page.waitForTimeout(250);

  return app.evaluate(
    () => (globalThis as unknown as Record<string, string[]>).__openedExternally ?? []
  );
}

function directorySize(directory: string): { bytes: number; files: number } {
  let bytes = 0;
  let files = 0;

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = directorySize(path);
      bytes += nested.bytes;
      files += nested.files;
      continue;
    }
    bytes += statSync(path).size;
    files += 1;
  }

  return { bytes, files };
}

async function readProcessMetrics(app: ElectronApplication): Promise<ProcessMetric[]> {
  return app.evaluate(({ app: electronApp }) =>
    electronApp.getAppMetrics().map((metric) => ({
      type: metric.type,
      sandboxed: metric.sandboxed,
      // Electron reports the working set in kilobytes.
      workingSetBytes: metric.memory.workingSetSize * 1024
    }))
  );
}

async function readPageExposure(app: ElectronApplication): Promise<PageExposure> {
  const page = await app.firstWindow();

  return page.evaluate(() => {
    const scope = window as unknown as Record<string, unknown>;
    const api = scope.desktop;

    return {
      desktopApiKeys: typeof api === 'object' && api !== null ? Object.keys(api).sort() : [],
      // Reachable `ipcRenderer` means the page can talk to any channel, which
      // makes the allowlist decorative.
      ipcRendererReachable: 'ipcRenderer' in scope,
      // `require` appears when nodeIntegration is on, and also when a
      // sandboxed preload shares its context with the page — that is, when
      // contextIsolation is off.
      requireReachable: 'require' in scope,
      processReachable: 'process' in scope
    };
  });
}

test.describe('packaged desktop host', () => {
  let app: ElectronApplication;

  test.beforeAll(async () => {
    if (!existsSync(executable)) {
      throw new Error(
        `No packaged application at ${executable}. Run "pnpm package:desktop" before "pnpm test:desktop" — this gate measures the packaged build, not a run from source.`
      );
    }

    app = await electron.launch({ executablePath: executable });
  });

  test.afterAll(async () => {
    await app.close();
  });

  test('the packaged window shows the browser build', async () => {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    // Rendered by React from the same bundle the browser suite drives. An
    // empty window and a working one look alike in a log; they do not look
    // alike here.
    await expect(page.getByTestId('app-root')).toBeVisible();
    await expect(page.getByTestId('node-api-exposure')).toHaveText('absent');
  });

  test('the renderer runs sandboxed', async () => {
    const metrics = await readProcessMetrics(app);
    const renderers = metrics.filter((metric) => metric.type === 'Tab');

    expect(renderers.length, 'the host must run at least one renderer process').toBeGreaterThan(0);
    for (const renderer of renderers) {
      // The OS-level flag, reported by the running process rather than by the
      // options object that asked for it.
      expect(renderer.sandboxed, 'the renderer must be sandboxed').toBe(true);
    }
  });

  test('the page reaches the desktop API and nothing else', async () => {
    const exposure = await readPageExposure(app);

    expect(exposure.desktopApiKeys).toEqual(['describeHost']);
    expect(exposure.ipcRendererReachable).toBe(false);
    expect(exposure.requireReachable).toBe(false);
    expect(exposure.processReachable).toBe(false);
  });

  test('the content security policy blocks an inline script', async () => {
    // Behaviour, not a header string. Over file:// there is no response header
    // to read at all, and a policy can be present and permissive — what
    // matters is whether the page can execute script it did not ship with.
    expect(await probeInlineScript(app), 'an inline script must not run under the policy').toBe(
      true
    );
  });

  test('only web URLs are handed to the operating system', async () => {
    // ADR-010 §80 keeps the renderer sandboxed; this is the other direction —
    // what the sandboxed page can make the host do on its behalf. Electron's
    // security guidance names `shell.openExternal` with untrusted input as a
    // route to arbitrary command execution, and the page is the untrusted
    // input.
    expect(await probeExternalOpen(app)).toEqual(['https://example.com/docs']);
  });

  test('the one allowed IPC method answers, and the run is recorded', async () => {
    const page = await app.firstWindow();

    const hostDescription = await page.evaluate(async () => {
      const api = (window as unknown as { desktop: { describeHost(): Promise<unknown> } }).desktop;
      return api.describeHost();
    });

    expect(hostDescription).toMatchObject({ platform: 'win32', packaged: true });

    const metrics = await readProcessMetrics(app);
    const size = directorySize(packagedDirectory);

    // Measured here, in the run that writes the report, rather than assumed
    // from the tests above.
    const inlineScriptBlocked = await probeInlineScript(app);
    const openedExternally = await probeExternalOpen(app);

    const evidence: GateEvidence = {
      executable,
      packagedBytes: size.bytes,
      packagedFiles: size.files,
      // ADR-010's budget is the sum over the root process and all its
      // renderer/GPU/utility children, which is what getAppMetrics enumerates.
      rssBytes: metrics.reduce((total, metric) => total + metric.workingSetBytes, 0),
      processes: metrics,
      pageExposure: await readPageExposure(app),
      hostDescription,
      inlineScriptBlocked,
      openedExternally
    };

    // AGENTS.md §11: a number a reader sees comes from the run that produced
    // it. Written before the budget assertions, so a failed budget still
    // leaves the measurement behind to argue with.
    const reportDirectory = join(repoRoot, 'artifacts', 'electron-spike');
    mkdirSync(reportDirectory, { recursive: true });
    writeFileSync(
      join(reportDirectory, 'gate-report.json'),
      `${JSON.stringify(evidence, null, 2)}\n`,
      'utf8'
    );

    // The installed size is measured and recorded, and deliberately not
    // compared against anything. ADR-010 set 300 MB; this gate measured 304.2
    // MiB for an application containing no game content at all, with
    // Chromium's locales already pruned from 55 files to two — that is the
    // floor of a packaged Electron on Windows, not a symptom of waste. The
    // owner removed the budget rather than trim GPU fallbacks to squeeze under
    // a number the first art asset would break anyway (ADR-011).
    expect(evidence.packagedBytes).toBeGreaterThan(0);

    // The RSS budget stands, and the measurement fits it with room: 328.8 MiB
    // observed against 500 MB. This one is a real gate — a leak or a second
    // renderer would show up here.
    expect(evidence.rssBytes).toBeLessThanOrEqual(500 * 1024 * 1024);

    // The two security probes are asserted against the values written above,
    // not re-run. That is what keeps the artifact and the verdict from
    // disagreeing: if either probe came back wrong, the file on disk says so
    // and this test is red for the same reason.
    expect(evidence.inlineScriptBlocked).toBe(true);
    expect(evidence.openedExternally).toEqual(['https://example.com/docs']);
  });
});
