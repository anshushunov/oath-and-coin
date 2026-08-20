import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
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
 * The slot the save round trip writes — in a data directory of this gate's
 * own, never in a player's.
 *
 * **This is the third design, and the first two were the same defect twice.**
 * The gate used to borrow `slot-c` in the real per-user directory, because the
 * set of slots is closed at three and there is no service slot to take
 * instead. Each round of review then found a way that borrowing loses a
 * player's save, and each fix introduced the next: bytes held in the test
 * process's memory died with the process; a copy on disk was adopted
 * unconditionally and overwrote a save made after it; the file moved aside for
 * a staged case was overwritten by the next run's `renameSync`, silently,
 * with the staging test green. Three temporary files, three windows, one
 * cause — a gate writing into a directory that is not its own.
 *
 * So it does not write there any more. The application under test is launched
 * with `--user-data-dir` pointing at {@link scratchUserDataDirectory}, and the
 * whole apparatus that existed to make borrowing survivable — the copy, the
 * adoption rule, the refusal, the staging and unstaging — is gone with the
 * borrowing. What the real directory is called is still asserted, by a second
 * launch that only reads (see the test of that name).
 */
const PROBE_SLOT = 'slot-c';

/**
 * Where the application under test keeps its data for the duration of the
 * gate — **created by this gate, not computed by it**, and therefore the only
 * directory it ever deletes.
 *
 * Outside the repository as a consequence of living under `tmpdir()`, which
 * also matters for a second reason: `findSaveFilesInRepository` would
 * otherwise find this gate's own probe and report it as a save escaping into
 * the source tree, which is the very thing that check is for.
 *
 * **Why `mkdtemp` and not a fixed path with a guard.** The previous version
 * computed `tmpdir()/oath-and-coin-packaged-gate` and defended it with a
 * predicate: refuse if the path is the application's own directory, contains
 * it, is contained by it, or lies inside the repository. The predicate compares
 * strings, and one directory on Windows has many names — a short 8.3 form
 * (`OATHAN~1`), any other casing of the drive or of the whole path, a `\\?\`
 * device path, an administrative share. Review of Task 17 made the gate erase a
 * player's real data directory, with a save in it, at 14 checks out of 14
 * green, by naming the same directory differently; and the repository branch of
 * the predicate had no equality case at all, so a path *equal to* the
 * repository root passed it and the recursive delete would have taken the
 * working tree.
 *
 * **And creating it is not enough on its own.** `mkdtempSync` on the right of a
 * `let` says something about one line; it says nothing about the value the
 * variable holds when `afterAll` deletes it recursively. Review of Task 17
 * demonstrated exactly that against the first version of this: four real
 * directories erased — a short 8.3 name, a `\\?\` path, a lower-cased path, a
 * copy of the working tree — each time at 14 checks of 14 green, by assigning
 * the variable. So creation now leaves {@link GATE_DIRECTORY_MARKER} behind,
 * and the delete is conditioned on finding it.
 *
 * Enumerating spellings is a losing game — the next one gets invented for us.
 * `mkdtempSync` returns a directory that did not exist a moment ago, so it is
 * nobody else's by construction, and the value it returns is the only thing
 * `afterAll` removes. There is no path to guard, so there is no guard.
 */
let scratchUserDataDirectory = '';

/**
 * The file this gate writes into the directory it creates, and the only thing
 * that lets it delete that directory again.
 *
 * Not in `saves/`, so the host's `list()` never sees it, and named after the
 * gate so that a human finding one in `%TEMP%` knows what left it.
 */
const GATE_DIRECTORY_MARKER = '.oath-and-coin-gate-directory';

/**
 * A value this run invents and nobody else has, written into the marker and
 * required back out of it before anything is deleted.
 *
 * **Presence of the marker is not enough, measured.** The first version of this
 * mechanism deleted a directory whose marker merely existed, and an earlier,
 * mis-ordered mutant of this very file had planted one in the application's
 * real data directory. The next run then found the marker, deleted the whole
 * directory, and stayed green — the mechanism did exactly what it was written
 * to do, and what it was written to do was too weak: a marker from any run
 * unlocked any directory forever.
 *
 * With a token, the evidence has to have been made by *this* run. A marker left
 * anywhere by anything else carries a different one and unlocks nothing.
 *
 * **Where this stops, and it stops sooner than it reads.** What the marker and
 * the token hold is a *mistake*: a variable reassigned by accident, a marker
 * left in some directory by another run or by an older version of this file, a
 * path that was never created here. What they do not hold, and cannot, is an
 * *edit to this file*: a change that assigns the variable and then writes this
 * run's token into that directory deletes it recursively, and review of Task 17
 * demonstrated exactly that on a decoy. A test cannot defend itself against
 * being rewritten — the check and the thing checked are the same file. Anyone
 * moving the two statements below apart, or adding a third that writes the
 * marker somewhere else, is past every mechanism this file has.
 */
const gateDirectoryToken = randomUUID();

/**
 * All 256 byte values. A save is bytes, and a probe of printable ASCII would
 * survive a bridge that quietly decoded and re-encoded the payload as text —
 * which is exactly the failure "byte for byte" is a claim about.
 */
const PROBE_BYTES = Array.from({ length: 256 }, (_unused, value) => value);

/**
 * The probe payload's own digest, computed here rather than asked of the
 * application: it is what the bytes at the host's write path are compared
 * against, so it has to come from the side that decided what to write.
 */
const PROBE_SHA256 = createHash('sha256').update(Buffer.from(PROBE_BYTES)).digest('hex');

/**
 * A second payload, for the one thing a single write cannot show: that writing
 * a slot that already holds a save *replaces* it.
 *
 * Shorter as well as different, and that is the point of the length: a store
 * that appended, or that replaced the leading bytes and left the tail, would
 * produce a file this digest does not match while a same-length payload might
 * still be read back whole by a reader that stops at the expected length.
 *
 * Until round 3 the packaged build said nothing about this, and it said nothing
 * for a bad reason: the claim used to arrive as a side effect of borrowing an
 * occupied slot from a player. Borrowing is gone; the claim is cheap to make
 * honestly, in a directory of this gate's own, and review of Task 17 was right
 * that round 3 gave it away for nothing.
 */
const SECOND_PROBE_BYTES = PROBE_BYTES.slice(0, 100).reverse();

const SECOND_PROBE_SHA256 = createHash('sha256')
  .update(Buffer.from(SECOND_PROBE_BYTES))
  .digest('hex');

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
   * repository root.
   *
   * **A digest and not a boolean.** The first version of this field asked
   * whether a file existed at the path, and review measured what that is worth:
   * with a save already in the slot, the `%TEMP%` mutant passed the whole gate,
   * because the player's own file answered the question. Comparing the bytes is
   * what ties "wrote here" to "wrote this" — and it is what holds the path this
   * gate derives against the convention `main.ts` and `save-store.ts` own.
   */
  path: string;
  writtenSha256: string | null;
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
  /**
   * What a player's copy of this application would use, read from a launch
   * that overrode nothing and wrote nothing.
   */
  userDataPath: string;
  /**
   * What the application under test used instead — this gate's own directory,
   * outside the repository and outside anyone's saves.
   */
  probeUserDataPath: string;
  rendererAssetHashes: FileHash[];
  hostEntryHashes: FileHash[];
  packagedManifest: FileSize[];
  declaredEntryPoints: DeclaredEntryPoint[];
  saveRoundTrip: SaveRoundTrip;
  strayFilesInRepository: string[];
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
 * Everything this file asks the packaged main process to do with files.
 *
 * All three are reads. Nothing here writes, moves or deletes anything: after
 * round 3 the gate has no reason to, because the application under test keeps
 * its data in a directory the gate created for it.
 */
type MainProcessRequest =
  | { kind: 'hash-packaged'; paths: readonly string[] }
  | { kind: 'declared-entry-points' }
  | { kind: 'measure-save'; slot: string };

/** Where the host put a slot, and the digest of what is there. */
interface WrittenSave {
  path: string;
  sha256: string | null;
}

/**
 * The one place this file reaches the packaged application's filesystem.
 *
 * **Why it is one place.** The route in is `process.mainModule.require`, and
 * that is a choice with an expiry date: Playwright evaluates these callbacks in
 * a scope of its own inside the main process, where `require` is not defined
 * (`typeof require === 'undefined'`, measured) and a dynamic `import()` fails
 * with "A dynamic import callback was not specified" because the scope belongs
 * to no module. `process.mainModule` is deprecated in Node and absent from an
 * ESM module, so the day the host stops being CommonJS this stops working —
 * and review of Task 17 counted five copies of the same three lines by then.
 * There is no way to share a *function* with these callbacks: Playwright
 * serialises them, so an outer identifier is not there at run time. Sharing the
 * whole callback is what is left, and it is what this is.
 *
 * **Why `app.getAppPath()` matters here.** In a packaged build it is the
 * `app.asar` archive, and only Electron's own patched `fs` reads through it —
 * which is the point of asking the running process rather than reading a copy
 * of the file lying next to it.
 */
async function mainProcess(
  app: ElectronApplication,
  request: { kind: 'hash-packaged'; paths: readonly string[] }
): Promise<FileHash[]>;
async function mainProcess(
  app: ElectronApplication,
  request: { kind: 'declared-entry-points' }
): Promise<DeclaredEntryPoint[]>;
async function mainProcess(
  app: ElectronApplication,
  request: { kind: 'measure-save'; slot: string }
): Promise<WrittenSave>;
async function mainProcess(
  app: ElectronApplication,
  request: MainProcessRequest
): Promise<unknown> {
  return app.evaluate(({ app: electronApp }, message) => {
    const load = process.mainModule?.require as ((id: string) => unknown) | undefined;
    if (!load) {
      throw new Error(
        'The packaged main process exposes no `process.mainModule.require`. That is the only route this gate has to the filesystem of the running application — see the doc comment on `mainProcess` — so every check that reads a packaged file is out of action until it is replaced.'
      );
    }
    const fs = load('node:fs') as typeof import('node:fs');
    const nodePath = load('node:path') as typeof import('node:path');
    const { createHash } = load('node:crypto') as typeof import('node:crypto');

    const sha256Of = (file: string): string | null =>
      fs.existsSync(file) ? createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null;

    switch (message.kind) {
      case 'hash-packaged':
        return message.paths.map((entry) => ({
          path: entry,
          sha256: createHash('sha256')
            .update(fs.readFileSync(nodePath.join(electronApp.getAppPath(), ...entry.split('/'))))
            .digest('hex')
        }));

      case 'declared-entry-points': {
        const appPath = electronApp.getAppPath();
        const manifest = JSON.parse(
          fs.readFileSync(nodePath.join(appPath, 'package.json'), 'utf8')
        ) as Record<string, unknown>;

        const claims: DeclaredEntryPoint[] = [];

        // `exports` is a tree of conditions, so every string leaf under it is a
        // path claim, whatever nesting it arrived at.
        const collect = (field: string, value: unknown): void => {
          if (typeof value === 'string') {
            claims.push({
              field,
              target: value,
              present: fs.existsSync(nodePath.join(appPath, ...value.split('/')))
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
      }

      case 'measure-save': {
        // The path is derived here, from `app.getPath('userData')` of the very
        // process that did the writing, and the bytes at it are hashed. That
        // pair is what ties "the host wrote where this gate says" to "the host
        // wrote what this gate sent"; a check that only asked whether a file
        // exists there was measured passing against a host writing into
        // `%TEMP%` (Task 17, round 2).
        const path = nodePath.join(
          electronApp.getPath('userData'),
          'saves',
          `${message.slot}.save`
        );
        return { path, sha256: sha256Of(path) };
      }
    }
  }, request);
}

async function hashPackagedFiles(
  app: ElectronApplication,
  paths: readonly string[]
): Promise<FileHash[]> {
  return mainProcess(app, { kind: 'hash-packaged', paths });
}

/**
 * Every path the packaged `package.json` names in `main` or `exports`, with
 * whether the package contains it — resolved from inside the application, so
 * "contains" means "is in the asar", not "is somewhere in the repository".
 */
async function readDeclaredEntryPoints(app: ElectronApplication): Promise<DeclaredEntryPoint[]> {
  return mainProcess(app, { kind: 'declared-entry-points' });
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
 * Writes a save through the packaged bridge, reads it back, and looks at where
 * the write landed and what it left in the repository.
 *
 * The three belong to one probe because the last two are only meaningful after
 * the first: scanning a tree, or a data directory, before anything has been
 * written proves nothing.
 *
 * **Nothing is put back, because nothing was borrowed.** The application under
 * test runs on {@link scratchUserDataDirectory}, so this writes into a slot
 * that only this gate has ever touched. Two earlier designs wrote into the
 * player's own directory and carried a copy-and-restore apparatus to make that
 * survivable; three rounds of review found three different ways it lost a
 * save. The apparatus is gone, and so is every window it had.
 */
/**
 * Refuses to write unless the application under test is on this gate's own
 * data directory.
 *
 * Checked here, and not only by the test that reports it: a test can say the
 * override failed, but only this can stop the write that would then land in a
 * player's directory. Tests are not run in a guaranteed order, and a reported
 * failure does not prevent the next one.
 */
async function requireScratchDataDirectory(app: ElectronApplication): Promise<void> {
  const inUse = await readUserDataPath(app);
  if (inUse !== scratchUserDataDirectory) {
    throw new Error(
      `The application under test is using ${inUse} as its data directory, not ${scratchUserDataDirectory}. Refusing to write a probe save: without the override this writes into a real player's slot, which is the defect three rounds of review of Task 17 were about.`
    );
  }
}

/** Writes `hex` into the probe slot through the bridge and reads it back. */
async function writeAndReadBack(app: ElectronApplication, hex: string): Promise<string> {
  await requireScratchDataDirectory(app);
  const page = await app.firstWindow();

  return page.evaluate(
    async ({ slot, payload }) => {
      const api = (window as unknown as { desktop: DesktopBridge }).desktop;
      const bytes = new Uint8Array(
        (payload.match(/../g) ?? []).map((pair) => Number.parseInt(pair, 16))
      );
      await api.writeSave(slot, bytes);
      const back = await api.readSave(slot);
      return back === null
        ? ''
        : [...back].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    },
    { slot: PROBE_SLOT, payload: hex }
  );
}

async function probeSaveRoundTrip(app: ElectronApplication): Promise<{
  roundTrip: SaveRoundTrip;
  strayFilesInRepository: string[];
}> {
  const wrote = toHex(PROBE_BYTES);
  const readBack = await writeAndReadBack(app, wrote);
  const strayFilesInRepository = findSaveFilesInRepository();
  const written = await mainProcess(app, { kind: 'measure-save', slot: PROBE_SLOT });

  return {
    roundTrip: { wrote, readBack, path: written.path, writtenSha256: written.sha256 },
    strayFilesInRepository
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

  /**
   * What a player's copy would use, taken once from a launch that overrides
   * nothing — the one thing the overridden launch below cannot tell anyone.
   */
  let shippedUserDataPath: string;

  /**
   * Set by the test that breaks `desktop:save-list`, and checked by the tests
   * that must run before it.
   *
   * Their order used to be held by the order of lines in this file and by a
   * comment saying so. This is the mechanism: a test moved below the refusal
   * probe now fails saying why, instead of failing at a storage call for a
   * reason that reads like a defect in the host.
   */
  let hostSaveListBroken = false;

  test.beforeAll(async () => {
    if (!existsSync(executable)) {
      throw new Error(
        `No packaged application at ${executable}. Run "pnpm package:desktop" before "pnpm test:desktop" — this gate measures the packaged build, not a run from source.`
      );
    }

    // One launch as shipped, only to read where a player's data would go. It
    // is closed before the real one starts, and it writes no save: the whole
    // reason this gate has two launches is that the run which *writes* must
    // not be pointed at that directory.
    //
    // The `catch` is about a diagnosis, not about a recovery. `main.ts` takes a
    // single-instance lock, and that lock is per data directory — so if a copy
    // of the game is already running, or if two gate runs overlap, this launch
    // quits immediately and Playwright reports `WebSocket error: read
    // ECONNRESET`, which names neither the cause nor the fix. Measured by
    // review of Task 17.
    let asShipped: ElectronApplication;
    try {
      asShipped = await electron.launch({ executablePath: executable });
    } catch (cause) {
      // Only when it *is* the lock. Review of Task 17 measured a corrupted
      // `app.asar` producing this same rewrite, with the real reason visible
      // only inside `cause` — a message that explains the wrong thing is worse
      // than the raw one. The lock says `WebSocket error: read ECONNRESET`
      // because the application quits before Playwright can attach; anything
      // else goes up untouched.
      if (cause instanceof Error && cause.message.includes('read ECONNRESET')) {
        throw new Error(
          'Could not launch the packaged application to read its data directory. Playwright reports "WebSocket error: read ECONNRESET", which for this application means the single-instance lock in main.ts: a copy of the game already running, or a second run of this gate, makes this launch quit before Playwright can attach. Close the other instance and run again.',
          { cause }
        );
      }
      throw cause;
    }
    try {
      shippedUserDataPath = await readUserDataPath(asShipped);
    } finally {
      await asShipped.close();
    }

    // Created, not computed — see the doc comment on the variable. Nothing is
    // deleted here because there is nothing here yet: this directory did not
    // exist a moment ago.
    scratchUserDataDirectory = mkdtempSync(join(tmpdir(), 'oath-and-coin-gate-'));

    // And the creation leaves evidence, because "this path was created here" is
    // otherwise a property of the line above and of nothing else: the variable
    // is a `let`, and `afterAll` deletes whatever is in it recursively. Review
    // of Task 17 erased four different real directories that way — a short 8.3
    // name, a `\\?\` path, a lower-cased path, a copy of the working tree —
    // every time at 14 checks of 14 green, by putting another value in the
    // variable. The marker is what `afterAll` requires before deleting, so a
    // reassigned variable meets a refusal instead of a recursive delete — and
    // what it requires is this run's own token, for the reason recorded on
    // `gateDirectoryToken`.
    writeFileSync(
      join(scratchUserDataDirectory, GATE_DIRECTORY_MARKER),
      gateDirectoryToken,
      'utf8'
    );

    app = await electron.launch({
      executablePath: executable,
      args: [`--user-data-dir=${scratchUserDataDirectory}`]
    });
  });

  test.afterAll(async () => {
    // Both guarded, and for the same reason: a `beforeAll` that threw leaves
    // one or both unset, and an `afterAll` that then throws
    // `Cannot read properties of undefined (reading 'close')` puts a second,
    // empty error in the log directly under the one that was written to be
    // read.
    //
    // Closing first, and closing even when the run failed: the application
    // holds files in the directory below, and on Windows a delete over a live
    // process answers `EPERM`.
    if (app !== undefined) {
      await app.close();
    }

    if (scratchUserDataDirectory === '') {
      return;
    }

    // The deletion is conditioned on the evidence creation left, not on the
    // value in the variable — and on evidence *this run* left, not any run.
    // See `gateDirectoryToken` for the measurement that made the difference.
    const marker = join(scratchUserDataDirectory, GATE_DIRECTORY_MARKER);
    const token = existsSync(marker) ? readFileSync(marker, 'utf8') : null;
    if (token !== gateDirectoryToken) {
      throw new Error(
        `Refusing to delete ${scratchUserDataDirectory}: ${GATE_DIRECTORY_MARKER} there does not carry this run's token${token === null ? ' (the file is not there at all)' : ''}. Only the directory this run created may be removed here, and this is not it.`
      );
    }

    try {
      rmSync(scratchUserDataDirectory, { recursive: true, force: true });
    } catch (cause) {
      // A process still holding files in there — the application, or one left
      // by an earlier run that was killed. Reported rather than retried: what
      // is left behind is a directory under `tmpdir()`, and a delete that
      // fights a live process is how a gate starts killing things it did not
      // start.
      throw new Error(
        `Could not remove ${scratchUserDataDirectory}. A process is most likely still holding files in it — an "Oath and Coin.exe" left by a run that was killed will do this. The directory is under the system temporary directory and can be removed by hand.`,
        { cause }
      );
    }
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
    // Read in `beforeAll` from a launch that overrode nothing — this is the one
    // claim about the *player's* directory, and the only safe way to make it is
    // to look and write nothing.
    //
    // Spike B measured this exact call on a packaged build without
    // `app.setName`: `AppData\Roaming\@oath-and-coin/desktop`, where the slash
    // in the package name became part of the path. `main.ts` sets the name
    // before anything derives a path from it (Task 16.6); this is the assertion
    // that says so, on the packaged build rather than on the source.
    expect(shippedUserDataPath).toContain('Oath and Coin');
    expect(shippedUserDataPath).not.toContain('@oath-and-coin');
  });

  test('the run that writes uses the data directory this gate created', async () => {
    // That the switch took effect, which is all this needs to say now. It used
    // to carry the safety of the delete as well, and that was the wrong place
    // for it: the delete is safe because the gate removes the directory it
    // made, not because a check somewhere agreed the path looked unfamiliar.
    //
    // What it still buys: if `--user-data-dir` stopped taking effect — a rename
    // in Electron, a typo, a build that parses arguments differently — the
    // probe below would go into the player's real directory, and this is what
    // says so out loud.
    expect(await readUserDataPath(app)).toBe(scratchUserDataDirectory);
    expect(shippedUserDataPath).not.toBe(scratchUserDataDirectory);
  });

  test('a save survives the packaged bridge byte for byte and goes to the data directory', async () => {
    expect(hostSaveListBroken, 'this test must run before the host refusal probe').toBe(false);

    const { roundTrip, strayFilesInRepository } = await probeSaveRoundTrip(app);
    const userDataPath = await readUserDataPath(app);

    // Through `contextBridge`, Electron IPC, the main process's Zod schemas
    // and the atomic file write — and back.
    expect(roundTrip.readBack).toBe(roundTrip.wrote);

    // Where it went, positively: *these bytes* were at the path derived from
    // `app.getPath('userData')`. Without this pair, a store rooted in `%TEMP%`
    // or in the drive root passes everything else in this test — and a version
    // of this check that only asks whether a file is there was measured passing
    // against exactly that.
    expect(roundTrip.path.startsWith(userDataPath)).toBe(true);
    expect(roundTrip.writtenSha256).toBe(PROBE_SHA256);

    // And the negative half: nothing of the sort appeared in the working tree.
    expect(strayFilesInRepository).toEqual([]);
  });

  test('a second save replaces the first in the same slot', async () => {
    expect(hostSaveListBroken, 'this test must run before the host refusal probe').toBe(false);

    // The claim `write()` makes in its own doc comment — "replaces a slot's
    // contents wholesale" — on the packaged build. Everything below the host
    // proves it against doubles or a browser; here it goes through
    // `contextBridge`, the main process's schemas, the temporary file and the
    // `rename`, twice.
    const first = toHex(PROBE_BYTES);
    const second = toHex(SECOND_PROBE_BYTES);

    // Not vacuous, and this is the assertion that says so: with two equal
    // payloads the check below would pass against a host that ignored the
    // second write entirely.
    expect(second).not.toBe(first);

    expect(await writeAndReadBack(app, first)).toBe(first);
    expect(await writeAndReadBack(app, second)).toBe(second);

    // Read from the file rather than from the bridge, so a reader that stopped
    // at the expected length would not hide a tail the first payload left.
    const written = await mainProcess(app, { kind: 'measure-save', slot: PROBE_SLOT });
    expect(written.sha256).toBe(SECOND_PROBE_SHA256);
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
    // ORDER MATTERS. This test leaves the host's `desktop:save-list` channel
    // refusing for the rest of the application's life (see
    // `probeSaveScreenOnHostRefusal`), so it must stay second to last.
    //
    // What holds that is not this comment: `hostSaveListBroken` is set here and
    // asserted false by every test above that touches saves, so moving one of
    // them below this point fails with a sentence about the order instead of a
    // storage error that reads like a defect in the host. Review offered
    // `test.describe.serial` for the job, and it is the wrong tool twice over —
    // Playwright runs a file in declaration order with or without it, so it
    // enforces no order at all, and its actual effect is to skip the remaining
    // tests after a failure, which here means skipping the run that writes
    // `gate-report.json`.
    //
    // The one error path the desktop build has and the browser build does not,
    // executed in a packaged application for the first time. Task 16.8 reached
    // `Error` in Chromium by replacing `IDBFactory.prototype.open`; there is no
    // IndexedDB on this side, and until now nothing had ever made the host
    // itself refuse.
    hostSaveListBroken = true;
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
    // Last, and it has to be: the test above leaves `desktop:save-list`
    // refusing, and this one records the state that produced.
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
    const { roundTrip, strayFilesInRepository } = await probeSaveRoundTrip(app);

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
      userDataPath: shippedUserDataPath,
      probeUserDataPath: await readUserDataPath(app),
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
    const reportPath = join(reportDirectory, 'gate-report.json');
    mkdirSync(reportDirectory, { recursive: true });
    writeFileSync(reportPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');

    // Read back off the disk, and this is not belt-and-braces. External review of
    // segment 5 measured what the write was held by: every assertion below runs
    // against `evidence`, an object this test still holds, so deleting the
    // `writeFileSync` above left the whole suite green. The CI step that summarises
    // the report answered a missing file with `::warning::` and exit 0, and the
    // upload's `if-no-files-found: error` was satisfied by the two other directories
    // in its path. The obligatory artifact of the packaged build could disappear
    // through three mechanisms in a row without one red.
    //
    // Compared against the JSON round trip of `evidence` rather than against
    // `evidence` itself: what is on disk is what a reader gets, and `undefined`
    // fields and anything else `JSON.stringify` drops are legitimately not in it.
    expect(JSON.parse(readFileSync(reportPath, 'utf8'))).toEqual(
      JSON.parse(JSON.stringify(evidence))
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

    // The RSS budget stands, and the measurement fits it with room. No number
    // is quoted here and none is predicted: this one is summed over four live
    // processes and moves from run to run, and the range this comment used to
    // carry was widened twice and overtaken both times — the second time by the
    // reviewer's own first run. A comment that guesses at the next measurement
    // is a claim nobody took, which is exactly what AGENTS.md §11 refuses. What
    // the number was on the run that wrote the report is in the report.
    //
    // The check itself is real — a leak or a second renderer shows up here —
    // and the budget is ADR-010's 500 MB, kept when ADR-011 dropped the size
    // one.
    expect(evidence.rssBytes).toBeLessThanOrEqual(500 * 1024 * 1024);

    // The security probes and the save round trip are asserted against the
    // values written above, not re-run. That is what keeps the artifact and
    // the verdict from disagreeing: if any of them came back wrong, the file
    // on disk says so and this test is red for the same reason.
    expect(evidence.inlineScriptBlocked).toBe(true);
    expect(evidence.openedExternally).toEqual(['https://example.com/docs']);
    expect(evidence.saveRoundTrip.readBack).toBe(evidence.saveRoundTrip.wrote);
    expect(evidence.saveRoundTrip.writtenSha256).toBe(PROBE_SHA256);
    expect(evidence.strayFilesInRepository).toEqual([]);
    expect(evidence.saveScreenStateOnHostRefusal).toBe('Error');
  });
});
