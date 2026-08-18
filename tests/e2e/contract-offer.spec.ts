import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { screenFor } from '@oath-and-coin/application';
import { loadAndRunScenario, loadLocaleCatalogue } from '@oath-and-coin/content/node';
import { expectedSnapshot, snapshotHash } from '@oath-and-coin/presentation';
import { canonicalSha256, type CanonicalValue } from '@oath-and-coin/simulation';
import { expect, test, type ConsoleMessage, type Page, type Request } from '@playwright/test';

/**
 * The browser evidence that replaces the Godot runtime harness.
 *
 * `ADR-008` asked a visual run for three things: declared inputs, a named checkpoint to
 * stop at, and an artifact — a frame, a log and a report — that a third party can read
 * without rerunning anything. `ADR-010` §157 keeps all three and drops what was
 * Godot-specific: the process launch and the frame protocol. So this file is the port by
 * intent rather than by mechanism, and what it produces per state is exactly what
 * `run-smoke` produced: `screenshot.png`, `events.jsonl`, `report.json`.
 *
 * **Nothing here is verified against what the page says about itself.** That is the whole
 * design of the verdict, and it is why the imports above exist:
 *
 * - the read-model hash is recomputed here from the frozen corpus entry — canonicalizing
 *   the recorded `read_model` without its own `sha256`, exactly as the parity tool does —
 *   and compared with the one the page printed. Comparing the page against its own
 *   printed number would be a check that a string equals itself;
 * - the rendered-UI hash is built from two unrelated halves: `expectedSnapshot` computes
 *   the texts a correctly bound screen owes from a model this process builds off the
 *   disk, and the texts the page actually rendered are walked out of its DOM. Neither
 *   half can see the other;
 * - the screen state is compared with what the scenario's *manifest* declares, read out
 *   of the corpus, not with what the run produced;
 * - reachability is measured, and it is the one question neither hash can ask.
 *
 * That last one is the direct port of `ScreenLayoutMeasurement`, and it is here because
 * review of the Godot screen caught a roster that had walked off the bottom of the window
 * while both hashes were green. A hash says the right texts exist in the right order; it
 * says nothing about whether a person can get to them.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = join(HERE, '..', '..');
const ORACLE_ROOT = join(REPOSITORY_ROOT, 'migration', 'oracle', 'v1');

/** Where the run's evidence lands. The CI job publishes this directory with `if: always()`. */
const EVIDENCE_ROOT = join(REPOSITORY_ROOT, 'artifacts', 'browser-evidence');

/** The seed the corpus records and the scenario runner's CLI defaults to. */
const SEED = 424242n;

/** The only catalogue `content/locale/` ships. */
const LOCALE = 'ru';

/** The element the rendered-UI hash is collected from. */
const SCREEN = 'contract-offer-screen';

/**
 * The five scenarios whose manifests declare the five states `AGENTS.md` §7 requires.
 *
 * The checkpoint is not listed: it is read from the corpus manifest, which is the
 * document that decides it. A list here would be a fourth place the same five names are
 * written, and the one place nothing checks.
 *
 * `overflows` is stated per state because reachability is satisfied trivially by content
 * that fits, and three of these five states hold two or three texts and can never fill a
 * 1280x800 window. Measured at 1280x800: loading, empty and error are 494px tall inside a
 * 494px viewport; incomplete is 696 and normal is 1011. So the check is real on exactly
 * two of them, and saying which turns "the reachability check passed" into a claim with
 * a subject — a layout change that stops the roster overflowing would otherwise leave the
 * whole measurement green and meaningless, which is `FULL_TYPESCRIPT_MIGRATION` §14.3's
 * warning arriving from the other direction.
 *
 * It says nothing about the *horizontal* question, and that one is not exercised at all:
 * measured, no shipped state overflows 1280px sideways, so the width assertion below is a
 * guard that has never been observed to redden. Named rather than counted as covered —
 * the layout that would trip it is a longer translation or a narrower window, and neither
 * is in this suite.
 */
const SCENARIOS = [
  { scenario: 'screen_loading', overflows: false },
  { scenario: 'screen_empty', overflows: false },
  { scenario: 'screen_error', overflows: false },
  { scenario: 'screen_incomplete', overflows: true },
  { scenario: 'screen_normal', overflows: true }
] as const;

/** What one corpus entry states about the screen its run produced. */
interface OracleEntry {
  readonly canonical_sha256: string | null;
  readonly outcome: { readonly screen_state: string };
  readonly inputs: {
    readonly content_version: string | null;
    readonly manifest: { readonly expected_screen_state: string | null };
  };
  readonly read_model: Record<string, unknown> & { readonly sha256: string };
}

/** The corpus manifest, down to the fields this file addresses an entry by. */
interface OracleManifest {
  readonly scenarios: readonly {
    readonly scenario: string;
    readonly expected_screen_state: string | null;
    readonly checkpoints: readonly { readonly checkpoint: string }[];
  }[];
}

/** What the page reports about the run it performed. */
interface PageReport {
  readonly scenario: string;
  readonly checkpoint: string | null;
  readonly seed: string;
  readonly locale: string;
  readonly screen_state: string;
  readonly read_model_hash: string;
  readonly content_version: string | null;
  readonly canonical_hash: string | null;
}

/**
 * The four numbers `ScreenLayoutMeasurement` carried, measured in a browser.
 *
 * `content*` is the content's natural size before clipping. `reachable*` is the window
 * plus however far a *person* can scroll it — measured with the mouse wheel, for the
 * reason {@link measureLayout} records: neither `scrollWidth - clientWidth` nor an
 * assignment to `scrollTop` can tell a scrolling box from one whose overflow is `hidden`.
 */
interface LayoutMeasurement {
  readonly contentWidth: number;
  readonly contentHeight: number;
  readonly reachableWidth: number;
  readonly reachableHeight: number;
  /**
   * How much of it is on screen at once, which is what says whether the reachability
   * question was even asked. Content that fits satisfies the verdict trivially, so a
   * report without these two numbers cannot be told apart from one where the check was
   * vacuous.
   */
  readonly viewportWidth: number;
  readonly viewportHeight: number;
}

const manifest = readJson<OracleManifest>(join(ORACLE_ROOT, 'manifest.json'));

const catalogue = new Map(
  // §14.4: `loadLocaleCatalogue` answers a `SortedMap`, whose `entries()` is an array and
  // which has no `Symbol.iterator`. `new Map(catalogue)` throws at runtime; this does not.
  loadLocaleCatalogue(join(REPOSITORY_ROOT, 'content', 'locale', `${LOCALE}.json`)).entries()
);

test.beforeAll(() => {
  // Cleared once per run, so a state that stops producing evidence leaves an empty
  // directory rather than last run's screenshot under this run's name.
  rmSync(EVIDENCE_ROOT, { recursive: true, force: true });
  mkdirSync(EVIDENCE_ROOT, { recursive: true });
});

test.describe('contract-offer screen, in a browser', () => {
  for (const { scenario, overflows } of SCENARIOS) {
    test(`${scenario} renders what the corpus recorded, and all of it is reachable`, async ({
      page
    }) => {
      const checkpoint = checkpointOf(scenario);
      const entry = readJson<OracleEntry>(
        join(ORACLE_ROOT, 'scenarios', scenario, checkpoint, `seed-${SEED.toString()}.json`)
      );

      // The corpus hashed the projection without the hash it stores beside it. Recomputed
      // rather than read, so an entry that disagrees with itself is caught here instead of
      // silently deciding which half the page is measured against — the same discipline
      // the parity tool applies for the reason §3.6 recorded.
      const { sha256: recordedHash, ...recorded } = entry.read_model;
      const expectedReadModelHash = canonicalSha256(recorded as CanonicalValue);
      expect(
        expectedReadModelHash,
        'the corpus entry must agree with the hash it carries, or it is an oracle for nothing'
      ).toBe(recordedHash);

      // The other side of the second hash, built in this process off the disk. Nothing in
      // it can know what the page rendered, which is exactly what makes agreement mean
      // something.
      const expectedTexts = expectedSnapshot(
        screenFor(
          loadAndRunScenario({ repositoryRoot: REPOSITORY_ROOT, scenario, checkpoint, seed: SEED })
        ),
        catalogue
      );

      const events: string[] = [];
      recordEvents(page, events);

      await page.goto(runUrl(scenario, checkpoint));
      await expect(page.getByTestId(SCREEN)).toBeVisible();

      const reported = JSON.parse(
        (await page.getByTestId('run-report').textContent()) ?? ''
      ) as PageReport;
      const renderedTexts = await collectRenderedTexts(page);
      const layout = await measureLayout(page);

      const directory = join(EVIDENCE_ROOT, scenario);
      mkdirSync(directory, { recursive: true });
      await page.screenshot({ path: join(directory, 'screenshot.png'), fullPage: false });
      writeFileSync(join(directory, 'events.jsonl'), events.map((line) => `${line}\n`).join(''));

      const report = {
        scenario,
        checkpoint,
        seed: SEED.toString(),
        locale: LOCALE,
        screen_state: reported.screen_state,
        read_model_hash: reported.read_model_hash,
        rendered_ui_hash: snapshotHash(renderedTexts),
        content_version: reported.content_version,
        canonical_hash: reported.canonical_hash,
        texts: renderedTexts.length,
        layout,
        events: events.length
      };
      writeFileSync(join(directory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);

      // The page must have run what the URL asked for. Without this the four comparisons
      // below could all pass about some other run — the failure that looks like success.
      expect(reported.scenario).toBe(scenario);
      expect(reported.checkpoint).toBe(checkpoint);
      expect(reported.seed).toBe(SEED.toString());
      expect(reported.locale).toBe(LOCALE);

      // Against the manifest's declared state, not against what the run produced. The
      // parity tool lower-cases at exactly this point, and this is the same comparison.
      expect(reported.screen_state.toLowerCase()).toBe(expectedScreenStateOf(scenario));
      expect(reported.screen_state.toLowerCase()).toBe(entry.outcome.screen_state);

      expect(reported.read_model_hash).toBe(expectedReadModelHash);

      // The list, not only its hash: a hash says two screens differ and only the lists say
      // where, and "where" is the whole difference between a gate someone can act on and
      // one they have to re-derive.
      expect(renderedTexts).toEqual(expectedTexts);
      expect(report.rendered_ui_hash).toBe(snapshotHash(expectedTexts));

      // `null` on both sides exactly when the run produced no artifact — a loading screen
      // read no content and a failed one produced none. The corpus records the same two
      // nulls, so this compares two independent statements rather than restating one.
      expect(reported.content_version).toBe(entry.inputs.content_version);
      expect(reported.canonical_hash).toBe(entry.canonical_sha256);

      // Whether this state puts the question at all, asserted before the answer. Without
      // it a layout change that stopped the roster overflowing would turn the two
      // assertions below into `411 >= 411` on all five states — green, and about nothing.
      expect(
        layout.contentHeight > layout.viewportHeight,
        overflows
          ? 'this state must hold more than one window of content, or reachability is not being tested'
          : 'this state holds two or three texts and cannot overflow; if it now does, the layout changed'
      ).toBe(overflows);

      // The port of `ScreenLayoutMeasurement`'s verdict. Its own assertion rather than a
      // clause of another, so a screen whose content has walked off the edge is reported
      // as that and not as a hash mismatch.
      expect(
        layout.reachableHeight,
        'content below the fold must be reachable by scrolling'
      ).toBeGreaterThanOrEqual(layout.contentHeight);
      expect(
        layout.reachableWidth,
        'content past the right edge must be reachable by scrolling'
      ).toBeGreaterThanOrEqual(layout.contentWidth);

      // A page that logged an error rendered the right texts by accident at best. Last,
      // so the specific comparisons above name the failure first when both go.
      expect(events, 'the page must produce no error or failed request').toEqual([]);
    });
  }
});

/**
 * The URL a run declares itself with.
 *
 * Every one of the four inputs is stated, including the two that happen to equal the
 * page's defaults: a run whose evidence does not say which seed produced it is evidence
 * about whatever the source file last defaulted to.
 */
function runUrl(scenario: string, checkpoint: string): string {
  const parameters = new URLSearchParams({
    scenario,
    checkpoint,
    seed: SEED.toString(),
    locale: LOCALE
  });

  return `/?${parameters.toString()}`;
}

/** The checkpoint the corpus manifest records for this scenario. */
function checkpointOf(scenario: string): string {
  const entry = manifest.scenarios.find((candidate) => candidate.scenario === scenario);

  if (entry === undefined || entry.checkpoints.length !== 1) {
    throw new Error(
      `The corpus manifest must record '${scenario}' with exactly one checkpoint; a screen ` +
        'scenario stops at the state it is named after.'
    );
  }

  return entry.checkpoints[0]?.checkpoint ?? '';
}

/** The state this scenario's manifest declares it will land on. */
function expectedScreenStateOf(scenario: string): string {
  const declared = manifest.scenarios.find(
    (candidate) => candidate.scenario === scenario
  )?.expected_screen_state;

  if (declared === null || declared === undefined) {
    throw new Error(
      `The corpus manifest records no expected screen state for '${scenario}', so there is ` +
        'nothing independent to compare the page against.'
    );
  }

  return declared;
}

/**
 * Console output and failed requests, one JSON object per line.
 *
 * Both, because they fail differently and neither implies the other: a bundle that threw
 * shows up in the console, and an asset the page could not fetch shows up only as a
 * failed request — with a page that renders perfectly around the hole.
 */
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
    events.push(
      JSON.stringify({
        kind: 'requestfailed',
        url: request.url(),
        text: request.failure()?.errorText ?? 'unknown'
      })
    );
  });
}

/**
 * Every text the screen actually shows, in document order.
 *
 * Walked here rather than asked of the page, and written out rather than imported from
 * `apps/web`: the browser half of this comparison has to be produced by code the page
 * does not contain, or a screen that rendered nothing could still agree with a collector
 * it shipped itself. `collectRenderedTexts` in `apps/web` states the same rule for the
 * jsdom tests, and the two agreeing on five states is itself a check — a drift between
 * them turns this suite red rather than hiding anywhere.
 *
 * Whitespace-only nodes are skipped for the reason that file gives: they are an artefact
 * of how JSX is laid out on the page, so counting them would make the list a property of
 * source formatting.
 */
async function collectRenderedTexts(page: Page): Promise<readonly string[]> {
  return page.evaluate((testId: string) => {
    const root = document.querySelector(`[data-testid="${testId}"]`);

    if (root === null) {
      throw new Error(`The page has no [data-testid="${testId}"] to collect texts from.`);
    }

    const texts: string[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);

    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const text = node.nodeValue ?? '';

      if (text.trim() !== '') {
        texts.push(text);
      }
    }

    return texts;
  }, SCREEN);
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
async function measureLayout(page: Page): Promise<LayoutMeasurement> {
  const box = await page.getByTestId(SCREEN).boundingBox();

  if (box === null) {
    throw new Error(`The page has no visible [data-testid="${SCREEN}"] to measure.`);
  }

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

  // One delta far larger than any screen here, so a scrollable box lands at its end in a
  // single step and an unscrollable one stays where it was. The size of the delta is not
  // a threshold — the position is read back, never assumed.
  const FAR = 100_000;

  await page.mouse.wheel(0, FAR);
  const maxTop = await settledScroll(page, 'scrollTop');

  await page.mouse.wheel(FAR, 0);
  const maxLeft = await settledScroll(page, 'scrollLeft');

  return page.evaluate(
    ({ testId, top, left }) => {
      const element = document.querySelector(`[data-testid="${testId}"]`);

      if (element === null) {
        throw new Error(`The page has no [data-testid="${testId}"] to measure.`);
      }

      // The screen is meant to be the only scrolling box on the page: `html`, `body` and
      // `#root` are pinned to the window's height, so nothing else can take the wheel.
      // Asserted rather than assumed, because if the document ever did scroll, content
      // this function called unreachable might be reachable by scrolling the page — and
      // the measurement would be wrong in the direction that fails a working screen.
      const document_ = document.documentElement;
      if (document_.scrollHeight > document_.clientHeight) {
        throw new Error(
          'The document itself scrolls, so the screen element is no longer the only place ' +
            'content can be reached from and this measurement no longer answers the question.'
        );
      }

      return {
        contentWidth: element.scrollWidth,
        contentHeight: element.scrollHeight,
        reachableWidth: element.clientWidth + left,
        reachableHeight: element.clientHeight + top,
        viewportWidth: element.clientWidth,
        viewportHeight: element.clientHeight
      };
    },
    { testId: SCREEN, top: maxTop, left: maxLeft }
  );
}

/** Where the screen ended up once it stopped moving. */
async function settledScroll(page: Page, axis: 'scrollTop' | 'scrollLeft'): Promise<number> {
  let previous = -1;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const now = await page.evaluate(
      ({ testId, property }) =>
        document.querySelector(`[data-testid="${testId}"]`)?.[
          property as 'scrollTop' | 'scrollLeft'
        ] ?? -1,
      { testId: SCREEN, property: axis }
    );

    if (now === previous) {
      return now;
    }

    previous = now;
    await page.waitForTimeout(25);
  }

  throw new Error(`The screen's ${axis} never settled; it is still moving after 20 reads.`);
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}
