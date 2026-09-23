import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { screenFor } from '@oath-and-coin/application';
import { artifactHash } from '@oath-and-coin/content';
import {
  loadAndRunScenario,
  loadLocaleCatalogue,
  loadUiTextCatalogue
} from '@oath-and-coin/content/node';
import {
  ScreenKind,
  expectedSnapshot,
  readModelHash,
  snapshotHash
} from '@oath-and-coin/presentation';
import { canonicalSha256, type CanonicalValue } from '@oath-and-coin/simulation';
import { expect, test, type ConsoleMessage, type Page, type Request } from '@playwright/test';

import { expectWindowBoundedScreen, measureLayout } from './layout.ts';

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
 * - the read-model hash is recomputed here, off a model this process builds fresh from the
 *   scenario on disk, and compared with the one the page printed. Comparing the page
 *   against its own printed number would be a check that a string equals itself. **Not
 *   against the frozen corpus entry's own recorded `read_model` any more** — `DEC-008`
 *   Task 3 renamed the contract's fee field in the read-model projection, which moved this
 *   hash on every scenario that shows a contract, and the corpus that recorded the old one
 *   is frozen and cannot be rewritten. That was already a remnant of the byte-for-byte C#
 *   parity `ADR-013` retired; see the comment beside `expectedReadModelHash` below;
 * - the rendered-UI hash is built from two unrelated halves: `expectedSnapshot` computes
 *   the texts a correctly bound screen owes from a model this process builds off the
 *   disk, and the texts the page actually rendered are walked out of its DOM. Neither
 *   half can see the other;
 * - the screen state is compared with what the scenario's own manifest declares
 *   (`scenarios/<scenario>.manifest.json`), never `migration/oracle/v1` — DEC-008 Task 21
 *   decoupled both this and the checkpoint below from the frozen corpus, which cannot gain
 *   the negotiation-phase scenarios this file now also runs — not with what the run
 *   produced;
 * - reachability is measured, and it is the one question neither hash can ask.
 *
 * That last one is the direct port of `ScreenLayoutMeasurement`, and it is here because
 * review of the Godot screen caught a roster that had walked off the bottom of the window
 * while both hashes were green. A hash says the right texts exist in the right order; it
 * says nothing about whether a person can get to them.
 *
 * **What Task 21 removed rather than decoupled.** This file used to open the frozen
 * corpus's own per-scenario record (`migration/oracle/v1/scenarios/<scenario>/…`) and
 * assert it agreed with the SHA-256 it carries beside its own `read_model` — a
 * self-consistency check on the corpus entry alone, unrelated to anything the browser
 * rendered. Nothing downstream still read that entry once the checkpoint and the expected
 * screen state moved to each scenario's own manifest above, and a scenario `DEC-008` adds
 * after the corpus was frozen has no such entry to open at all — gating the assertion on
 * `entry !== null` would have kept a check that runs on five scenarios and skips the four
 * this task exists to add.
 *
 * Not relocated to `tests/oracle`, and not because it would be homeless there: measured
 * (checked every entry the original five scenarios could reach, `canonicalSha256` of the
 * `read_model` against its own carried hash, all five agree). It is a fact about data that
 * cannot change — `migration/oracle/v1` is frozen and read-only, and its own README says
 * so — so the only two things that could ever move it are already gated elsewhere:
 * `tests/oracle/canonical.test.ts`'s JCS-vector suite fixes this port's canonicalization
 * against the corpus's own recorded agreement/disagreement with the old C# writer, and its
 * "sha256 against the frozen corpus" block fixes every one of the 57 files' bytes against
 * `manifest.json`. A third check re-deriving the same already-proven-stable number from
 * one live entry would be a fact restated, not a fact guarded.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = join(HERE, '..', '..');
const SCENARIO_ROOT = join(REPOSITORY_ROOT, 'scenarios');

/** Where the run's evidence lands. The CI job publishes this directory with `if: always()`. */
const EVIDENCE_ROOT = join(REPOSITORY_ROOT, 'artifacts', 'browser-evidence');

/** The seed the corpus records and the scenario runner's CLI defaults to. */
const SEED = 424242n;

/** The only catalogue `content/locale/` ships. */
const LOCALE = 'ru';

/** The element the rendered-UI hash is collected from. */
const SCREEN = 'contract-offer-screen';

/**
 * The PixiJS canvas, which this screen no longer has (`DEC-020`). Named so that its absence
 * is asserted by the same id the battle board's presence is.
 */
const CANVAS = 'world-canvas';

/** The narrow row pinned to the top of the screen while the squad scrolls (spec §4). */
const SUMMARY = 'offer-summary';

/**
 * How far below the screen box's top edge a pinned row may stand: the screen's own 1px
 * border and a pixel of rounding. A row that scrolled away stands hundreds of pixels above
 * it; one pinned with a gap over it (`top` not offsetting the screen's padding) stands 12
 * below it, with the squad showing through the gap.
 */
const PINNED_TOLERANCE = 2;

/**
 * The most of the screen the pinned row may take. The owner's decision is that the squad
 * keeps most of the window; the band that was pinned before it took 426 of 691px (0.62). A
 * quarter leaves the squad three quarters of the window. Measured on 2026-09-23 by this run
 * (`summary_box` in each state's `report.json`): 59px of a 689px screen on every state with a
 * contract, one line; the row wraps to a second line when the count reads "Отряд ещё не
 * спрашивали", and is still far under the bound.
 */
const SUMMARY_SHARE = 0.25;

/** A box on the page in viewport pixels, rounded to whole ones. */
interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The five scenarios whose manifests declare the five states `AGENTS.md` §7 requires,
 * plus the four negotiation-phase scenarios `DEC-008` Task 21 adds — `draft`, `locked`,
 * a locked-and-crewed offer waiting on `settleContract`, and a settled one whose promise
 * was broken. The third of those waits on `resolveContract` once the resolution engine
 * ships (`RESOLUTION_SPEC` §3.2): under `m1-resolution/1` there is still nothing between a
 * filled crew and the settlement. None of the nine can be recorded in `migration/oracle/v1`: that corpus is
 * frozen at the Godot/.NET baseline and predates the negotiation protocol entirely
 * (`ADR-013`).
 *
 * The checkpoint is not listed: it is read from each scenario's own manifest
 * (`scenarios/<scenario>.manifest.json`), which is the document that decides it. A list
 * here would be a fourth place the same names are written, and the one place nothing
 * checks.
 *
 * `overflows` is stated per state because reachability is satisfied trivially by content
 * that fits, and several of these states hold few enough texts that they can never fill a
 * 1280x800 window. Measured from the `report.json` each state writes under
 * `artifacts/browser-evidence`: at a window of 800 the screen's box is 689, and loading,
 * empty and error report 689px of content inside it — a box stretched to the window with
 * shorter content reads its own height — while incomplete and the four negotiation-phase
 * states hold enough offer, promise and settlement detail to overflow, and normal does
 * too. Three things moved the original five numbers: in Task 16.8 the screen link took a
 * row above the screen, and the project's viewport was repaired from the 720
 * `devices['Desktop Chrome']` had been quietly imposing to the 800 the record asks for;
 * with `DEC-020` the canvas under the screen left the page, and the box grew from 532 to
 * 689. None of the five flags moved with it — the squad cards and the package band still
 * overflow the taller box on every state that has a contract.
 *
 * So the check is real on most of these, and saying which turns "the reachability check
 * passed" into a claim with a subject — a layout change that stops the roster overflowing
 * would otherwise leave the whole measurement green and meaningless, which is
 * `FULL_TYPESCRIPT_MIGRATION` §14.3's warning arriving from the other direction.
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
  { scenario: 'screen_normal', overflows: true },
  { scenario: 'screen_draft', overflows: true },
  { scenario: 'screen_locked', overflows: true },
  { scenario: 'screen_settlement_due', overflows: true }
] as const;

/**
 * **`screen_word_broken` is not in that list any more, and that is a named debt.**
 *
 * The scenario settles its contract with the word broken, and since `RESOLUTION_SPEC`
 * §6.4 routes a settled campaign to the board, the offer screen is not what that run
 * puts on the page — the game no longer shows it, so a matrix about the offer screen
 * cannot be evidence for it. The run itself is untouched and still measured everywhere
 * else it was: the canonical snapshot, the restored read model and the scenario
 * runner's own suite all cover it.
 *
 * It comes back with the board's own component (contract-loop UI plan, tasks 8 and 10),
 * against `contract-board-screen` and the board's snapshot. Until then the broken
 * promise is exercised in the browser by nothing, and `screen_settlement_due` — which
 * stops at `lock_offer` and stays on the offer — is what still covers the settlement
 * block a player reads before deciding.
 */

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

// Both catalogues, merged the same way the page itself merges them
// (`apps/web/src/App.tsx`'s `browserCatalogue`, `ADR-012`): since Task 17 the screen
// resolves interface-invented keys — the offer's own captions, the treasury, the
// settlement — as well as content's, and comparing against the content half alone
// throws on the first one `expectedSnapshot` asks for.
//
// §14.4: `loadLocaleCatalogue`/`loadUiTextCatalogue` answer a `SortedMap`, whose
// `entries()` is an array and which has no `Symbol.iterator`. `new Map(catalogue)`
// throws at runtime; spreading each `entries()` array does not.
const catalogue = new Map([
  ...loadLocaleCatalogue(join(REPOSITORY_ROOT, 'content', 'locale', `${LOCALE}.json`)).entries(),
  ...loadUiTextCatalogue(join(REPOSITORY_ROOT, 'ui-text', `${LOCALE}.json`)).entries()
]);

test.beforeAll(() => {
  // Cleared once per run, so a state that stops producing evidence leaves an empty
  // directory rather than last run's screenshot under this run's name.
  //
  // This file's own five directories, never the whole evidence root, and that changed in
  // Task 16.8 for a reason worth stating: `save-slots.spec.ts` writes under
  // `browser-evidence/saves/`, Playwright runs the two files in parallel workers, and a
  // blanket `rmSync` of the parent would delete the other suite's artifacts partway
  // through its run — nondeterministically, and only ever in the direction of "the
  // evidence is missing" long after the tests themselves were green.
  for (const { scenario } of SCENARIOS) {
    rmSync(join(EVIDENCE_ROOT, scenario), { recursive: true, force: true });
  }

  mkdirSync(EVIDENCE_ROOT, { recursive: true });
});

test.describe('contract-offer screen, in a browser', () => {
  for (const { scenario, overflows } of SCENARIOS) {
    test(`${scenario} renders what its own manifest declares, and all of it is reachable`, async ({
      page
    }) => {
      const checkpoint = checkpointOf(scenario);

      // The other side of the second hash, built in this process off the disk. Nothing in
      // it can know what the page rendered, which is exactly what makes agreement mean
      // something.
      const runResult = loadAndRunScenario({
        repositoryRoot: REPOSITORY_ROOT,
        scenario,
        checkpoint,
        seed: SEED
      });
      const expectedModel = screenFor(runResult);
      const expectedTexts = expectedSnapshot(expectedModel, catalogue);

      // `content_version` and `canonical_hash` below are held to the same values,
      // computed the same way `packages/application/src/session.ts`'s own run-request
      // builder computes them for the page — `null` for a run that never reached
      // content, otherwise read off `runResult.outcome`. Not against
      // `entry.inputs.content_version`/`entry.canonical_sha256` any more: `DEC-008`
      // Task 3 moved the shipped content's bytes and, with them, both of these, on
      // every scenario that reaches a state — `screen_incomplete` and `screen_normal`
      // among these five — away from what the frozen corpus recorded, forever:
      // `migration/oracle/v1` cannot be rewritten. That frozen comparison was already a
      // remnant of the byte-for-byte parity `ADR-013` retired.
      const expectedContentVersion =
        runResult.kind === 'ran' ? runResult.outcome.finalState.metadata.contentVersion : null;
      const expectedCanonicalHash =
        runResult.kind === 'ran' ? artifactHash(runResult.outcome) : null;

      // The external comparison `DEC-008` Task 20 restores: `scenarios/*.canonical.json`
      // rebuilt under the new field name, read off disk and hashed independently of
      // `expectedCanonicalHash` above — which this same process just computed and would
      // agree with itself about no matter what broke. `screen_incomplete` and
      // `screen_normal` are the two of these five that reach a state and ship a
      // snapshot; the other three have none to compare (`canonical-snapshots.test.ts`
      // reads the same absence the same way).
      const shippedCanonicalPath = join(REPOSITORY_ROOT, 'scenarios', `${scenario}.canonical.json`);
      const shippedCanonicalHash = existsSync(shippedCanonicalPath)
        ? canonicalSha256(JSON.parse(readFileSync(shippedCanonicalPath, 'utf8')) as CanonicalValue)
        : null;

      // The page's own read-model hash is compared against this, not against
      // `corpusReadModelHash` above. `DEC-008` Task 3 renamed the contract's fee field in
      // the read-model projection (`describeContract` in
      // `contract-offer-screen-model-factory.ts`), which moved the hash on every scenario
      // that shows a contract — `screen_incomplete` and `screen_normal` among these five —
      // away from what the frozen corpus recorded, forever: `migration/oracle/v1` cannot be
      // rewritten. That frozen comparison was already a remnant of the byte-for-byte parity
      // `ADR-013` retired, so this hash is now held to the same discipline the rendered-UI
      // hash beside it already uses — a value this same process just computed off the disk,
      // never the one the page prints about itself.
      //
      // **This one stays internal, and that is a fact worth stating rather than leaving
      // implicit.** `scenarios/*.canonical.json` — the external value `canonical_hash`
      // now checks against, above — records the simulation's own artifact, not the
      // screen's read model; the two are different projections of the same run, and
      // nothing this repository ships is an external record of the second one. What
      // makes this comparison worth running regardless is the same reason stated at the
      // top of this file: `expectedReadModelHash` and the page's own reported hash come
      // from two code paths that share no data, even though neither is external to it.
      const expectedReadModelHash = readModelHash(expectedModel);

      // The matrix's own invariant, enforced rather than assumed: every scenario in it is a
      // negotiation. Since §6.4 routes a resolved or settled campaign elsewhere, a scenario
      // that has moved past the offer belongs in another matrix — against another
      // `data-testid` and another snapshot — and measuring it here would compare the page
      // against a model of a screen it is not showing.
      if (expectedModel.screen !== ScreenKind.ContractOffer) {
        throw new Error(
          `'${scenario}' landed on '${expectedModel.screen}', so it is no longer a scenario ` +
            'about the contract-offer screen; it belongs in the matrix for that screen.'
        );
      }

      const events: string[] = [];
      recordEvents(page, events);

      await page.goto(runUrl(scenario, checkpoint));
      await expect(page.getByTestId(SCREEN)).toBeVisible();

      // No scene behind the offer (`DEC-020`): the page mounts no canvas for it at all. The
      // proof that a canvas redraws, which this file's pixel checks used to carry, stands on
      // the battle board now (`battle-redraw.spec.ts`).
      await expect(page.getByTestId(CANVAS)).toHaveCount(0);

      const reported = JSON.parse(
        (await page.getByTestId('run-report').textContent()) ?? ''
      ) as PageReport;
      const renderedTexts = await collectRenderedTexts(page);
      const layout = await measureLayout(page, SCREEN);
      // Taken here, with the screen wheeled to its end by the measurement above — the moment
      // the summary row is for: the squad read to its last card, and the score still on top.
      const screenBox = await boxOf(page, `[data-testid="${SCREEN}"]`);
      const summaryBox = await boxOf(page, `[data-testid="${SUMMARY}"]`);

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
        screen_box: screenBox,
        summary_box: summaryBox,
        events: events.length
      };
      writeFileSync(join(directory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);

      // The evidence `AGENTS.md` §11 asks for, present on disk — not merely "the write
      // call did not throw". A CI job that published an empty `artifacts/browser-evidence`
      // directory would still reach this line if any of the three writes above were
      // quietly skipped; this is what turns that into a red assertion instead of a
      // missing file discovered only by the workflow's own summary step, days later, in
      // a different job.
      expect(existsSync(join(directory, 'screenshot.png')), 'screenshot.png').toBe(true);
      expect(existsSync(join(directory, 'events.jsonl')), 'events.jsonl').toBe(true);
      expect(existsSync(join(directory, 'report.json')), 'report.json').toBe(true);

      // The page must have run what the URL asked for. Without this the four comparisons
      // below could all pass about some other run — the failure that looks like success.
      expect(reported.scenario).toBe(scenario);
      expect(reported.checkpoint).toBe(checkpoint);
      expect(reported.seed).toBe(SEED.toString());
      expect(reported.locale).toBe(LOCALE);

      // Against the scenario's own manifest, not against what the run produced and not
      // against `migration/oracle/v1` — the frozen corpus predates the negotiation
      // protocol and cannot record any of these nine scenarios (DEC-008 Task 21). The
      // parity tool lower-cases at exactly this point, and this is the same comparison.
      expect(reported.screen_state.toLowerCase()).toBe(expectedScreenStateOf(scenario));

      expect(reported.read_model_hash).toBe(expectedReadModelHash);

      // The list, not its hash: a hash says two screens differ and only the lists say
      // where, and "where" is the whole difference between a gate someone can act on and
      // one they have to re-derive. `report.rendered_ui_hash` is a field of the artifact
      // and not a second check — external review pointed out that asserting it here after
      // this line is green by construction, since it is the same function of the same two
      // lists that were just compared.
      expect(renderedTexts).toEqual(expectedTexts);

      // `null` on both sides exactly when the run produced no artifact — a loading screen
      // read no content and a failed one produced none.
      expect(reported.content_version).toBe(expectedContentVersion);
      expect(reported.canonical_hash).toBe(expectedCanonicalHash);

      // The genuinely external half: the page's own hash against the file this
      // repository ships, not against a value this same test run just computed. Skipped
      // rather than compared against `null` for the three states with no snapshot at
      // all — `screen_loading` and `screen_error` produce no artifact to hash in the
      // first place, and `screen_empty` does (it reaches `kind: 'ran'` with zero steps)
      // but ships no `.canonical.json`, a pre-existing gap this task's scope does not
      // extend to closing (`canonical-snapshots.test.ts` reads that same absence the
      // same way, off the directory rather than off a hand-picked list).
      if (shippedCanonicalHash !== null) {
        expect(reported.canonical_hash).toBe(shippedCanonicalHash);
      }

      // Whether this state puts the question at all, asserted before the answer. Without
      // it a layout change that stopped the roster overflowing would turn the two
      // assertions below into `411 >= 411` on all five states — green, and about nothing.
      expect(
        layout.contentHeight > layout.viewportHeight,
        overflows
          ? 'this state must hold more than one window of content, or reachability is not being tested'
          : 'this state holds two or three texts and cannot overflow; if it now does, the layout changed'
      ).toBe(overflows);

      // Before either reachability assertion: both of them compare content against a box,
      // and a box sized by its own content satisfies them whatever the layout does. This
      // is what says the box is the window's (see `layout.ts` — it is the check the 73px
      // regression got past).
      await expectWindowBoundedScreen(page, SCREEN, layout);

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

      // The summary row is pinned, and it is narrow (spec §4, owner's decision of
      // 2026-09-23). Asked of every state with a contract that overflows — the states where
      // there is somewhere to scroll to — at the end of the scroll, where a row that was
      // merely at the top of the page would have left the window long ago.
      if (expectedModel.contract !== null && overflows) {
        expect(summaryBox, 'a screen with a contract draws the summary row').not.toBeNull();

        if (summaryBox !== null && screenBox !== null) {
          // Both bounds, each with the boxes in its message: a row that scrolled away stands
          // above the screen's top edge, one pinned with a gap stands below it.
          const pinned =
            `scrolled to the end, the summary row must still stand at the top of the screen: ` +
            `row ${describe(summaryBox)} against screen ${describe(screenBox)}`;

          expect(summaryBox.y, pinned).toBeGreaterThanOrEqual(screenBox.y);
          expect(summaryBox.y - screenBox.y, pinned).toBeLessThanOrEqual(PINNED_TOLERANCE);
          expect(
            summaryBox.height,
            `the pinned row must leave the squad most of the window: row ${describe(summaryBox)} ` +
              `in a screen ${String(layout.viewportHeight)}px tall`
          ).toBeLessThanOrEqual(layout.viewportHeight * SUMMARY_SHARE);
        }
      }

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

/**
 * The manifest fields this file addresses a scenario by — `scenarios/<scenario>.manifest.json`,
 * read directly rather than through `loadScenarioManifest`: this process only ever needs
 * two of its fields, and importing the full domain type would pull the content package's
 * validation in for a read this file already validates by construction (the four checks
 * below throw on exactly what would otherwise be silently wrong).
 */
interface ScenarioManifestFile {
  readonly expected_screen_state: string | null;
  readonly checkpoints: readonly { readonly name: string }[];
}

function scenarioManifestOf(scenario: string): ScenarioManifestFile {
  return readJson<ScenarioManifestFile>(join(SCENARIO_ROOT, `${scenario}.manifest.json`));
}

/**
 * The checkpoint this scenario's own manifest records — never `migration/oracle/v1`,
 * which cannot record any scenario `DEC-008` added after the corpus was frozen
 * (`ADR-013`). DEC-008 Task 21 decoupled this from the corpus manifest that answered it
 * before.
 */
function checkpointOf(scenario: string): string {
  const file = scenarioManifestOf(scenario);

  if (file.checkpoints.length !== 1) {
    throw new Error(
      `Scenario manifest 'scenarios/${scenario}.manifest.json' must declare exactly one ` +
        'checkpoint; a screen scenario stops at the state it is named after.'
    );
  }

  return file.checkpoints[0]?.name ?? '';
}

/** The state this scenario's own manifest declares it will land on. */
function expectedScreenStateOf(scenario: string): string {
  const declared = scenarioManifestOf(scenario).expected_screen_state;

  if (declared === null || declared === undefined) {
    throw new Error(
      `Scenario manifest 'scenarios/${scenario}.manifest.json' declares no ` +
        'expected_screen_state, so there is nothing independent to compare the page against.'
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
 * The visible box of the first element `selector` matches, or `null` when the page has no
 * such element — a screen with no contract draws no summary row, and the report says so
 * rather than the run waiting for one. The same measurement `offer-refusal.spec.ts` takes:
 * viewport-relative, after layout and after scrolling.
 */
async function boxOf(page: Page, selector: string): Promise<Box | null> {
  const element = page.locator(selector).first();

  if ((await element.count()) === 0) {
    return null;
  }

  const box = await element.boundingBox();

  return box === null
    ? null
    : {
        x: Math.round(box.x),
        y: Math.round(box.y),
        width: Math.round(box.width),
        height: Math.round(box.height)
      };
}

function describe(box: Box): string {
  return `[x ${String(box.x)}, y ${String(box.y)}, w ${String(box.width)}, h ${String(box.height)}]`;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}
