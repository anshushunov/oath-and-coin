import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

// The host's own declaration of the channel name, not a second copy of the
// string: this gate breaks that channel on purpose below, and a gate that
// named it independently would silently stop breaking anything the day the
// host renamed it — the handler would answer as usual and the screen would
// never reach the state under test.
import { SAVE_LIST_CHANNEL } from '@oath-and-coin/desktop/src/contract.ts';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';

/**
 * The Task 4 gate (ADR-010, narrowed by ADR-011), extended by Task 17: the
 * packaged Windows application starts, shows the browser build, keeps the
 * mandatory security boundary, answers exactly the four IPC methods
 * `contract.ts` lists, keeps a save round trip whole in its own data
 * directory, and fits the budgets.
 *
 * Everything here is observed from a running packaged application. Reading the
 * `webPreferences` object back out of the code that set it would prove that
 * the code says `sandbox: true`, which is a different claim: the OS-level
 * sandbox flag and what the page can actually reach are the facts, and both
 * are read from the live process below.
 *
 * Task 17 is also where the gate learned to notice that it was measuring a
 * *stale* package. Task 16.6 grew the preload from one method to four, and
 * this file stayed green on a build produced before that change: the assertion
 * on the exposed surface described a package nobody had rebuilt. The identity
 * checks below — the packaged renderer against `apps/web/dist`, and the
 * `main.cjs`/`preload.cjs` inside `app.asar` against `apps/desktop/dist`, read
 * from within the running application — are what makes that impossible to
 * repeat.
 *
 * **What that identity is a claim about, exactly.** The comparison is the
 * *package* against `dist/`, not against the sources: a package whose asar
 * disagrees with the last build fails here. `dist/` itself is kept current by
 * `pnpm package:desktop`, which builds before it packages — so the pair of
 * commands the gate is run with holds the whole chain, while a bare
 * `pnpm test:desktop` over a `dist/` and a package that are stale *together* is
 * green and honest about only what it checked. Review of Task 17 named the
 * first wording of this paragraph as promising more than the checks hold.
 */

const repoRoot = resolve(import.meta.dirname, '..', '..');
const packagedDirectory = join(repoRoot, 'artifacts', 'electron-spike', 'win-unpacked');
const executable = join(packagedDirectory, 'Oath and Coin.exe');

/** What `pnpm build` produced, and what the package is expected to carry. */
const rendererBuildDirectory = join(repoRoot, 'apps', 'web', 'dist');
const packagedRendererDirectory = join(packagedDirectory, 'resources', 'web');
const hostPackageDirectory = join(repoRoot, 'apps', 'desktop');

/**
 * The host's two entries, named by their path *inside* the package — the same
 * string is used to read them from `apps/desktop/` on disk and from inside
 * `app.asar` through the running main process, so the two sides cannot be
 * comparing different files by accident. Sorted, like every other list of
 * paths in this file.
 */
const HOST_ENTRIES = ['dist/main.cjs', 'dist/preload.cjs'] as const;

/**
 * The slot the save round trip borrows.
 *
 * This gate runs against the real per-user data directory of a real packaged
 * application: `slot-c` is a slot a player uses, and there is no fourth,
 * service slot to borrow instead — the set is closed at three.
 *
 * So the previous contents are copied to {@link PROBE_BACKUP_SUFFIX} **on
 * disk**, inside the main process, before anything is written, and the copy is
 * removed only after the original has been put back. Review of Task 17 found
 * the first version holding the previous bytes in the test process's memory
 * and calling that "read first and put back afterwards": a run killed between
 * the write and the restore — Ctrl-C, a crashed worker, a rebooted machine —
 * destroyed a save with no copy anywhere. The window is not closed by being
 * short. With the file on disk, an interrupted run leaves the save recoverable
 * by hand under a name that says what it is.
 */
const PROBE_SLOT = 'slot-c';

/**
 * Appended to the slot's file name for the backup this gate takes. Not `.tmp`
 * and not `.save`: the host's `list()` filters on `.save`, so a leftover
 * backup is never mistaken for an occupied slot, and the name says both what
 * it is and who left it.
 */
const PROBE_BACKUP_SUFFIX = '.gate-backup';

/**
 * All 256 byte values. A save is bytes, and a probe of printable ASCII would
 * survive a bridge that quietly decoded and re-encoded the payload as text —
 * which is exactly the failure "byte for byte" is a claim about.
 */
const PROBE_BYTES = Array.from({ length: 256 }, (_unused, value) => value);

interface ProcessMetric {
  type: string;
  sandboxed: boolean | undefined;
  workingSetBytes: number;
}

interface FileHash {
  path: string;
  sha256: string;
}

interface FileSize {
  path: string;
  bytes: number;
}

interface SaveRoundTrip {
  wrote: string;
  readBack: string;
  /**
   * The absolute path the host wrote, derived inside the main process from
   * `app.getPath('userData')`, and whether a file was there afterwards.
   *
   * The round trip alone cannot say where the bytes went: a store rooted in
   * `%TEMP%`, in the drive root or in the process's working directory reads
   * back exactly as happily. Review of Task 17 pointed out that the negative
   * half — nothing appeared in the repository — was passing by coincidence,
   * because the packaged application's working directory happened to be the
   * repository root. This is the positive half, and it is mechanical.
   */
  path: string;
  written: boolean;
}

/**
 * A path the packaged `package.json` names, and whether the package contains
 * it. See `the packaged manifest names nothing the package does not carry`
 * below for what this closes.
 */
interface DeclaredEntryPoint {
  field: string;
  target: string;
  present: boolean;
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
  userDataPath: string;
  rendererAssetHashes: FileHash[];
  hostEntryHashes: FileHash[];
  packagedManifest: FileSize[];
  declaredEntryPoints: DeclaredEntryPoint[];
  saveRoundTrip: SaveRoundTrip;
  strayFilesInRepository: string[];
  /** The borrowed slot came back byte-identical, with no backup left behind. */
  saveSlotRestored: boolean;
  saveScreenStateOnHostRefusal: string;
}

interface PageExposure {
  desktopApiKeys: string[];
  ipcRendererReachable: boolean;
  requireReachable: boolean;
  processReachable: boolean;
}

/** The shape the preload puts on `window.desktop`; a type, so it erases. */
interface DesktopBridge {
  describeHost(): Promise<unknown>;
  readSave(slot: string): Promise<Uint8Array | null>;
  writeSave(slot: string, bytes: Uint8Array): Promise<void>;
  listSaves(): Promise<readonly string[]>;
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

function toPosix(path: string): string {
  return path.split(sep).join('/');
}

/**
 * Compares by path in code-point order rather than with `localeCompare`: the
 * order of a recorded artifact must not depend on the machine's locale.
 */
function byPath(left: { path: string }, right: { path: string }): number {
  if (left.path === right.path) {
    return 0;
  }
  return left.path < right.path ? -1 : 1;
}

function listFilesRecursively(directory: string): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...listFilesRecursively(path));
      continue;
    }
    found.push(path);
  }

  return found;
}

/**
 * Every file under `directory`, with its size, relative to it and sorted.
 *
 * The sort is not cosmetic: directory traversal order is a property of the
 * filesystem, so an unsorted listing would differ between machines that hold
 * byte-identical packages, and the artifact would look like evidence of a
 * difference that is not there.
 */
function fileSizes(directory: string): FileSize[] {
  return listFilesRecursively(directory)
    .map((path) => ({ path: toPosix(relative(directory, path)), bytes: statSync(path).size }))
    .sort(byPath);
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/**
 * **Every** file under `root`, hashed and sorted by relative path. Called on
 * both the build output and the packaged copy, so the two lists are comparable
 * as whole values rather than file by file.
 *
 * Recursive over the whole directory, and not over `index.html` plus
 * `assets/**` as the first version was. Review of Task 17 dropped
 * `resources/web/stray-injected.js` into the package and watched this gate stay
 * green: a comparison of two named branches says nothing about a third file
 * that only one side has, and "the packaged renderer is the browser build" is a
 * claim about the whole of it. The two directories agree file for file today
 * (measured), so the stronger comparison costs nothing.
 */
function hashRendererBuild(root: string): FileHash[] {
  return listFilesRecursively(root)
    .map((path) => ({ path: toPosix(relative(root, path)), sha256: sha256(path) }))
    .sort(byPath);
}

function hashHostBuild(): FileHash[] {
  return HOST_ENTRIES.map((entry) => ({
    path: entry,
    sha256: sha256(join(hostPackageDirectory, ...entry.split('/')))
  }));
}

const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set(['node_modules', '.git']);

/**
 * Every save file anywhere in the working tree.
 *
 * The claim this measures is the one Spike B made about the packaged build:
 * a save goes to the application's data directory and nothing appears in the
 * source tree. Matching on the store's own two suffixes — `<slot>.save` and
 * the `<slot>.<pid>.<uuid>.save.tmp` it renames from — rather than on a
 * directory named `saves`, because `apps/web/src/screens/saves/` is a real
 * directory in this repository and flagging it would make the check
 * permanently red for the wrong reason.
 */
function findSaveFilesInRepository(): string[] {
  const found: string[] = [];

  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) {
          walk(join(current, entry.name));
        }
        continue;
      }
      if (entry.name.endsWith('.save') || entry.name.endsWith('.save.tmp')) {
        found.push(toPosix(relative(repoRoot, join(current, entry.name))));
      }
    }
  };

  walk(repoRoot);
  return found.sort();
}

function toHex(bytes: readonly number[]): string {
  return bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('');
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

async function readUserDataPath(app: ElectronApplication): Promise<string> {
  return app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'));
}

/**
 * Hashes files from inside the running application.
 *
 * `app.getAppPath()` is the `app.asar` archive in a packaged build, and only
 * Electron's own patched `fs` can read through it — which is the point: this
 * reads the bytes the process it is talking to would load, not a copy of them
 * lying next to it.
 *
 * `process.mainModule.require`, rather than `require` or `import()`. Playwright
 * evaluates these callbacks in a scope of its own inside the main process:
 * `require` is not defined there (`typeof require === 'undefined'`, measured),
 * and a dynamic `import()` fails with "A dynamic import callback was not
 * specified" because the scope belongs to no module. The main module's own
 * `require` is reachable through `process`, and it is the asar-aware one.
 */
async function hashPackagedFiles(
  app: ElectronApplication,
  paths: readonly string[]
): Promise<FileHash[]> {
  return app.evaluate(({ app: electronApp }, wanted) => {
    const load = process.mainModule?.require as ((id: string) => unknown) | undefined;
    if (!load) {
      throw new Error('The packaged main process exposes no require; cannot read its own files.');
    }
    const { readFileSync } = load('node:fs') as typeof import('node:fs');
    const { createHash: hash } = load('node:crypto') as typeof import('node:crypto');
    const { join: joinPath } = load('node:path') as typeof import('node:path');

    return wanted.map((path) => ({
      path,
      sha256: hash('sha256')
        .update(readFileSync(joinPath(electronApp.getAppPath(), ...path.split('/'))))
        .digest('hex')
    }));
  }, paths);
}

/**
 * Every path the packaged `package.json` names in `main` or `exports`, with
 * whether the package contains it — resolved from inside the application, so
 * "contains" means "is in the asar", not "is somewhere in the repository".
 */
async function readDeclaredEntryPoints(app: ElectronApplication): Promise<DeclaredEntryPoint[]> {
  return app.evaluate(({ app: electronApp }) => {
    const load = process.mainModule?.require as ((id: string) => unknown) | undefined;
    if (!load) {
      throw new Error('The packaged main process exposes no require; cannot read its own files.');
    }
    const { existsSync: exists, readFileSync } = load('node:fs') as typeof import('node:fs');
    const { join: joinPath } = load('node:path') as typeof import('node:path');

    const appPath = electronApp.getAppPath();
    const manifest = JSON.parse(readFileSync(joinPath(appPath, 'package.json'), 'utf8')) as Record<
      string,
      unknown
    >;

    const claims: { field: string; target: string; present: boolean }[] = [];

    // `exports` is a tree of conditions, so every string leaf under it is a
    // path claim, whatever nesting it arrived at.
    const collect = (field: string, value: unknown): void => {
      if (typeof value === 'string') {
        claims.push({
          field,
          target: value,
          present: exists(joinPath(appPath, ...value.split('/')))
        });
        return;
      }
      if (typeof value === 'object' && value !== null) {
        for (const [key, nested] of Object.entries(value)) {
          collect(`${field}.${key}`, nested);
        }
      }
    };

    collect('main', manifest.main);
    collect('exports', manifest.exports);

    return claims;
  });
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

/**
 * What the probe has to put back, decided and prepared inside the main process
 * before a single byte is written.
 */
interface ProbeGround {
  /** `<userData>/saves/<slot>.save`, as the main process derives it. */
  path: string;
  /** The copy of the previous save, or `null` when the slot was empty. */
  backupPath: string | null;
  /** Whether the save directory existed before the probe created it. */
  directoryExisted: boolean;
  /** SHA-256 of what was in the slot, or `null` when it was empty. */
  sha256Before: string | null;
}

/** What the ground looked like once the probe had put everything back. */
interface ProbeAftermath {
  sha256After: string | null;
  backupExists: boolean;
  directoryExists: boolean;
}

/**
 * Copies whatever is in the probe slot to a backup file and reports where the
 * host will write.
 *
 * The copy is a real file, made by the main process, and it is what makes the
 * restore survive the test process dying — see {@link PROBE_SLOT}.
 */
async function prepareSaveProbe(app: ElectronApplication): Promise<ProbeGround> {
  return app.evaluate(
    ({ app: electronApp }, { slot, backupSuffix }) => {
      // See `hashPackagedFiles` for why the main module's `require`.
      const load = process.mainModule?.require as ((id: string) => unknown) | undefined;
      if (!load) {
        throw new Error('The packaged main process exposes no require; cannot guard the probe.');
      }
      const {
        copyFileSync,
        existsSync: exists,
        readFileSync: readBytes,
        renameSync
      } = load('node:fs') as typeof import('node:fs');
      const { createHash: hash } = load('node:crypto') as typeof import('node:crypto');
      const { join: joinPath } = load('node:path') as typeof import('node:path');

      const directory = joinPath(electronApp.getPath('userData'), 'saves');
      const path = joinPath(directory, `${slot}.save`);
      const directoryExisted = exists(directory);
      const staleBackup = `${path}${backupSuffix}`;

      // A backup from a run that died between the copy and the restore. Its
      // bytes are the player's and the slot's are this gate's, so the backup
      // wins — the interrupted run is finished here rather than left as a file
      // nobody knows what to do with. Without this the recovery the backup
      // exists for would be manual, which is a promise about a person.
      //
      // **Verified live, held by no check.** The state it repairs is one a
      // green run cannot arrange: it exists only after a previous run was
      // killed. It was tested by hand — a save directory holding only
      // `slot-c.save.gate-backup` and no slot came out of a run holding the
      // slot with exactly those bytes (§18.4) — and that is a measurement, not
      // a mechanism. Named here rather than left to look covered.
      if (exists(staleBackup)) {
        renameSync(staleBackup, path);
      }

      if (!exists(path)) {
        return { path, backupPath: null, directoryExisted, sha256Before: null };
      }

      const backupPath = `${path}${backupSuffix}`;
      copyFileSync(path, backupPath);
      return {
        path,
        backupPath,
        directoryExisted,
        sha256Before: hash('sha256').update(readBytes(path)).digest('hex')
      };
    },
    { slot: PROBE_SLOT, backupSuffix: PROBE_BACKUP_SUFFIX }
  );
}

/**
 * Puts the slot back exactly as {@link prepareSaveProbe} found it, and removes
 * the backup only once the original is in place.
 *
 * The order matters: `rename` over the target publishes the old bytes and
 * removes the copy in one operation, so there is no moment at which neither
 * file exists. An empty slot is restored by deleting the probe's file, and a
 * save directory this probe created is removed with it — a machine that had
 * never run the game should not be left holding an empty `saves` directory
 * because a gate ran.
 *
 * What it reports back is what the ground looks like afterwards, so the caller
 * can assert that the restore happened rather than trust that it was called.
 */
async function restoreSaveProbe(
  app: ElectronApplication,
  ground: ProbeGround
): Promise<ProbeAftermath> {
  return app.evaluate((_electronModule, probe) => {
    const load = process.mainModule?.require as ((id: string) => unknown) | undefined;
    if (!load) {
      throw new Error('The packaged main process exposes no require; cannot restore the probe.');
    }
    const {
      existsSync: exists,
      readFileSync: readBytes,
      renameSync,
      rmSync
    } = load('node:fs') as typeof import('node:fs');
    const { createHash: hash } = load('node:crypto') as typeof import('node:crypto');
    const { dirname } = load('node:path') as typeof import('node:path');

    if (probe.backupPath === null) {
      rmSync(probe.path, { force: true });
    } else {
      renameSync(probe.backupPath, probe.path);
    }

    const directory = dirname(probe.path);
    if (!probe.directoryExisted) {
      rmSync(directory, { recursive: true, force: true });
    }

    return {
      sha256After: exists(probe.path)
        ? hash('sha256').update(readBytes(probe.path)).digest('hex')
        : null,
      backupExists: probe.backupPath !== null && exists(probe.backupPath),
      directoryExists: exists(directory)
    };
  }, ground);
}

/**
 * Writes a save through the packaged bridge, reads it back, and looks at where
 * the write landed and what it left in the repository.
 *
 * The three belong to one probe because the last two are only meaningful after
 * the first: scanning a tree, or a data directory, before anything has been
 * written proves nothing. The slot is restored before returning, whatever the
 * caller then asserts, and it is restored from a file rather than from this
 * process's memory.
 */
async function probeSaveRoundTrip(app: ElectronApplication): Promise<{
  roundTrip: SaveRoundTrip;
  strayFilesInRepository: string[];
  ground: ProbeGround;
  aftermath: ProbeAftermath;
}> {
  const page = await app.firstWindow();
  const wrote = toHex(PROBE_BYTES);
  const ground = await prepareSaveProbe(app);

  // Assigned in the `finally` below, so the restore happens whatever the probe
  // does — and its result is still what the caller gets to assert on.
  let aftermath: ProbeAftermath;
  let readBack: string;
  let written: boolean;
  let strayFilesInRepository: string[];

  try {
    readBack = await page.evaluate(
      async ({ slot, hex }) => {
        const api = (window as unknown as { desktop: DesktopBridge }).desktop;
        const bytes = new Uint8Array(
          (hex.match(/../g) ?? []).map((pair) => Number.parseInt(pair, 16))
        );
        await api.writeSave(slot, bytes);
        const back = await api.readSave(slot);
        return back === null
          ? ''
          : [...back].map((byte) => byte.toString(16).padStart(2, '0')).join('');
      },
      { slot: PROBE_SLOT, hex: wrote }
    );

    // Asked of the main process, at the path the main process derived from
    // `app.getPath('userData')` — the positive half of "the save went to the
    // application's data directory".
    written = await app.evaluate((_electronModule, path) => {
      const load = process.mainModule?.require as ((id: string) => unknown) | undefined;
      if (!load) {
        throw new Error('The packaged main process exposes no require; cannot locate the save.');
      }
      const { existsSync: exists } = load('node:fs') as typeof import('node:fs');
      return exists(path);
    }, ground.path);

    strayFilesInRepository = findSaveFilesInRepository();
  } finally {
    aftermath = await restoreSaveProbe(app, ground);
  }

  return {
    roundTrip: { wrote, readBack, path: ground.path, written },
    strayFilesInRepository,
    ground,
    aftermath
  };
}

/**
 * Breaks the host's `desktop:save-list` channel and reports what the slots
 * screen becomes.
 *
 * This is the one error path the desktop build has and the browser build does
 * not. `apps/web/src/save/desktop-store.ts` collapses every rejection from
 * `window.desktop` into `SAVE_STORAGE_UNAVAILABLE`, and a failed listing
 * refuses all three slots at once, which is the screen's `Error` state
 * (`slot-descriptions.ts`, design spec §3.2). Until Task 17 nothing had ever
 * executed it in a packaged application: the browser suite reaches `Error` by
 * replacing `IDBFactory.prototype.open`, a route that does not exist here.
 *
 * The handler is replaced rather than the data disturbed, deliberately: the
 * alternative — making the real store fail by moving the save directory aside
 * — puts a player's whole save directory at risk to test a screen state.
 *
 * **The channel is not put back.** The shipped handler's closure is not
 * reachable from outside the module that registered it, and a handler rebuilt
 * here would no longer be the shipped code, so restoring it would replace a
 * known-broken channel with a lie. This runs last, and the application is torn
 * down immediately afterwards; nothing above it uses `listSaves`.
 */
async function probeSaveScreenOnHostRefusal(app: ElectronApplication): Promise<string> {
  await app.evaluate(({ ipcMain }, channel) => {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, () => {
      throw new Error('the gate replaced this handler to exercise the host refusal path.');
    });
  }, SAVE_LIST_CHANNEL);

  const page = await app.firstWindow();
  await page.getByTestId('open-saves').click();

  const screen = page.getByTestId('saves-screen');
  // The screen shows `Loading` until the storage has answered, so what is
  // waited for is that it has answered at all. Which answer it gave is the
  // caller's assertion, not this wait's — a wait that already spelled `Error`
  // would leave nothing for the check to be wrong about.
  await expect(screen).not.toHaveAttribute('data-state', 'Loading');

  return (await screen.getAttribute('data-state')) ?? '';
}

test.describe('packaged desktop host', () => {
  let app: ElectronApplication;

  /**
   * Measured once and asserted twice: by the test that provokes it and by the
   * run that writes the report, so the artifact cannot claim a state the
   * verdict did not see. Kept here rather than re-probed because the probe
   * leaves the host's list channel broken on purpose — running it twice would
   * measure the second time against a page already sitting on the answer.
   */
  let saveScreenStateOnHostRefusal: string | null = null;

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

    // The whole preload surface, written out. Task 16.6 took it from one
    // method to four and this list stayed at `['describeHost']`, green,
    // because the package under test predated the change — the debt Task 17
    // was handed and the reason the identity checks further down exist. The
    // list stays exhaustive rather than a subset check: a fifth method that
    // nobody meant to expose is exactly what this is for.
    expect(exposure.desktopApiKeys).toEqual(['describeHost', 'listSaves', 'readSave', 'writeSave']);
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

  test('the packaged application keeps its data under its own name', async () => {
    const userDataPath = await readUserDataPath(app);

    // Spike B measured this exact call on a packaged build without
    // `app.setName`: `AppData\Roaming\@oath-and-coin\desktop`, where the slash
    // in the package name had become a directory level. `main.ts` sets the
    // name before anything derives a path from it (Task 16.6); this is the
    // assertion that says so, on the packaged build rather than on the source.
    expect(userDataPath).toContain('Oath and Coin');
    expect(userDataPath).not.toContain('@oath-and-coin');
  });

  test('a save survives the packaged bridge byte for byte and goes to the data directory', async () => {
    const { roundTrip, strayFilesInRepository, ground, aftermath } = await probeSaveRoundTrip(app);
    const userDataPath = await readUserDataPath(app);

    // Through `contextBridge`, Electron IPC, the main process's Zod schemas
    // and the atomic file write — and back.
    expect(roundTrip.readBack).toBe(roundTrip.wrote);

    // Where it went, positively: the file was there, at the path the main
    // process derives from `app.getPath('userData')`. Without this pair, a
    // store rooted in `%TEMP%` or in the drive root passes everything else in
    // this test.
    expect(roundTrip.path.startsWith(userDataPath)).toBe(true);
    expect(roundTrip.written).toBe(true);

    // And the negative half: nothing of the sort appeared in the working tree.
    expect(strayFilesInRepository).toEqual([]);

    // The borrowed slot is as it was — checked, not promised. This is the
    // Critical review of Task 17 found: the first version restored from the
    // test process's memory and said in prose that it did. A restore nothing
    // verifies is a restore that stops happening quietly.
    expect(aftermath.sha256After).toBe(ground.sha256Before);
    expect(aftermath.backupExists).toBe(false);
    // Including the directory: a machine that had never run the game is left
    // without an empty `saves` in its data directory.
    expect(aftermath.directoryExists).toBe(ground.directoryExisted);
  });

  test('the packaged renderer is the browser build this tree produced', async () => {
    // ADR-010's split, stated as a check rather than as a comment in
    // `main.ts`: what the packaged window loads is what Playwright drives in a
    // plain Chromium — the whole directory, file for file and byte for byte,
    // so a file only one side has is a difference too.
    expect(hashRendererBuild(packagedRendererDirectory)).toEqual(
      hashRendererBuild(rendererBuildDirectory)
    );
  });

  test('the packaged host entries are the ones this tree produced', async () => {
    // Read out of `app.asar` by the process that is running them. This is what
    // catches a package that disagrees with the last build — the failure Task
    // 16.6 left behind and Task 17 was handed — before any assertion about
    // behaviour has to explain itself.
    expect(await hashPackagedFiles(app, HOST_ENTRIES)).toEqual(hashHostBuild());
  });

  test('the packaged manifest names nothing the package does not carry', async () => {
    const declared = await readDeclaredEntryPoints(app);

    // Not vacuous: `main` is always there, so an empty result means the probe
    // failed to read the manifest rather than that the manifest is clean.
    expect(declared.map((claim) => claim.field)).toContain('main');

    // Measured at Task 17: the manifest carried `exports["./contract"] =
    // "./src/contract.ts"`, added in Task 16.6 so two architecture tests could
    // import the host's contract, while `files: [dist/**]` puts no `src/` in
    // the asar. Nothing resolved it — Electron loads `main` by path — so it
    // cost nothing until the day something did. The field is gone; this is
    // what keeps the next one from travelling.
    expect(declared.filter((claim) => !claim.present)).toEqual([]);
  });

  test('a refusing host drives the slots screen to its error state', async () => {
    // The one error path the desktop build has and the browser build does not,
    // executed in a packaged application for the first time. Task 16.8 reached
    // `Error` in Chromium by replacing `IDBFactory.prototype.open`; there is no
    // IndexedDB on this side, and until now nothing had ever made the host
    // itself refuse.
    saveScreenStateOnHostRefusal = await probeSaveScreenOnHostRefusal(app);

    expect(saveScreenStateOnHostRefusal).toBe('Error');

    // Not only the state: all three slots carry the refusal, which is what
    // "the storage is gone" means as opposed to "one file is broken".
    const page = await app.firstWindow();
    for (const slot of ['slot-a', 'slot-b', 'slot-c']) {
      await expect(page.getByTestId(`${slot}-error`)).toBeVisible();
    }
  });

  test('the four allowed IPC methods answer, and the run is recorded', async () => {
    const page = await app.firstWindow();

    const hostDescription = await page.evaluate(async () => {
      const api = (window as unknown as { desktop: DesktopBridge }).desktop;
      return api.describeHost();
    });

    expect(hostDescription).toMatchObject({ platform: 'win32', packaged: true });

    const metrics = await readProcessMetrics(app);
    const packagedManifest = fileSizes(packagedDirectory);

    // Measured here, in the run that writes the report, rather than assumed
    // from the tests above.
    const inlineScriptBlocked = await probeInlineScript(app);
    const openedExternally = await probeExternalOpen(app);
    const { roundTrip, strayFilesInRepository, ground, aftermath } = await probeSaveRoundTrip(app);

    const evidence: GateEvidence = {
      executable,
      // Derived from the listing rather than from a second walk of the same
      // directory: two traversals that disagree would be a defect in this file
      // reported as a defect in the package.
      packagedBytes: packagedManifest.reduce((total, file) => total + file.bytes, 0),
      packagedFiles: packagedManifest.length,
      // ADR-010's budget is the sum over the root process and all its
      // renderer/GPU/utility children, which is what getAppMetrics enumerates.
      rssBytes: metrics.reduce((total, metric) => total + metric.workingSetBytes, 0),
      processes: metrics,
      pageExposure: await readPageExposure(app),
      hostDescription,
      inlineScriptBlocked,
      openedExternally,
      userDataPath: await readUserDataPath(app),
      // What this repository produces itself, hashed. The packaged directory
      // as a whole is recorded below as a listing and a total, and is
      // deliberately not asserted to be reproducible: nobody has measured
      // whether electron-builder produces the same bytes twice, and a check
      // for a property nobody measured goes red on the day the tool is
      // updated and says nothing about this repository.
      rendererAssetHashes: hashRendererBuild(rendererBuildDirectory),
      hostEntryHashes: hashHostBuild(),
      packagedManifest,
      declaredEntryPoints: await readDeclaredEntryPoints(app),
      saveRoundTrip: roundTrip,
      strayFilesInRepository,
      saveSlotRestored:
        aftermath.sha256After === ground.sha256Before &&
        !aftermath.backupExists &&
        aftermath.directoryExists === ground.directoryExisted,
      // Measured by the test above, or here when that test did not run — a
      // `--grep` of this one alone still records a value it observed rather
      // than a hole.
      saveScreenStateOnHostRefusal: (saveScreenStateOnHostRefusal ??=
        await probeSaveScreenOnHostRefusal(app))
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
    // compared against anything. ADR-010 set 300 MB; Task 4 measured 304.2 MiB
    // for an application containing no game content at all, with Chromium's
    // locales already pruned from 55 files to two — that is the floor of a
    // packaged Electron on Windows, not a symptom of waste. The owner removed
    // the budget rather than trim GPU fallbacks to squeeze under a number the
    // first art asset would break anyway (ADR-011). Task 17's own run, with
    // the whole game and the save screen in the renderer: 307.9 MiB over 46
    // files.
    expect(evidence.packagedBytes).toBeGreaterThan(0);

    // The RSS budget stands, and the measurement fits it: Task 4 observed
    // 328.8 MiB, Task 17 observed 409-413 MiB across its runs and its review's,
    // all against 500 MB. A range rather than a number because this one is read
    // from four live processes and moves between runs — the first range written
    // here was 409-411 and the reviewer's own run came back 412.4, which is the
    // point; the exact value of the run that wrote the report is in the report.
    // This is a real gate — a leak or a second renderer would show up here, and
    // the ~80 MiB the game itself costs is exactly the kind of movement it
    // exists to keep visible.
    expect(evidence.rssBytes).toBeLessThanOrEqual(500 * 1024 * 1024);

    // The security probes and the save round trip are asserted against the
    // values written above, not re-run. That is what keeps the artifact and
    // the verdict from disagreeing: if any of them came back wrong, the file
    // on disk says so and this test is red for the same reason.
    expect(evidence.inlineScriptBlocked).toBe(true);
    expect(evidence.openedExternally).toEqual(['https://example.com/docs']);
    expect(evidence.saveRoundTrip.readBack).toBe(evidence.saveRoundTrip.wrote);
    expect(evidence.saveRoundTrip.written).toBe(true);
    expect(evidence.saveSlotRestored).toBe(true);
    expect(evidence.strayFilesInRepository).toEqual([]);
    expect(evidence.saveScreenStateOnHostRefusal).toBe('Error');
  });
});
