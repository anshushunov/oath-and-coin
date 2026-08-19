import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildSave, screenFor } from '@oath-and-coin/application';
import {
  computeContentVersion,
  loadAndRunScenario,
  loadLocaleCatalogue,
  loadUiTextCatalogue
} from '@oath-and-coin/content/node';
import { parseContentId } from '@oath-and-coin/simulation';
import { expect, test, type ConsoleMessage, type Page, type Request } from '@playwright/test';

/**
 * The save-slots screen in a live Chromium: five states, five artifacts, and the two
 * things no test below a browser can say anything about.
 *
 * The first is **atomicity**. `indexeddb-store.test.ts` proves the refusal protocol
 * against hand-rolled doubles and says so in its own doc comment — a fake transaction's
 * `onabort` is the test deciding the outcome, not a real transaction being interrupted.
 * The claim that a real, aborted `readwrite` transaction leaves a slot's previous bytes
 * untouched can only be made where there is a real one, and that is here (design spec
 * §5.6). The interruption goes *through* the shipped store rather than around it: the
 * page runs `indexedDbSaveStore` exactly as it ships, and `IDBObjectStore.prototype.put`
 * is replaced so that the transaction the store opened aborts itself mid-write.
 *
 * The second is **reachability of the two states nothing can be seeded into**. Spike A
 * measured that `indexedDB.open('')` opens happily, so an unusable storage cannot be
 * arranged by putting bad data anywhere; `error` and `loading` are reached by replacing
 * `IDBFactory.prototype.open` from the test side — with a refusal and with a delay the
 * test releases (design spec §3.3). No test entry point appears in production code, and
 * that is the point of doing it this way rather than with a query parameter the shipped
 * bundle would have to honour.
 *
 * Everything the page claims about itself is checked against something built here: the
 * texts against the two shipped catalogues read off the disk, the screen's state against
 * the state this file arranged, and the bytes in a slot against the bytes this file put
 * there.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = join(HERE, '..', '..');

/** Where this run's evidence lands, beside the contract screen's own. */
const EVIDENCE_ROOT = join(REPOSITORY_ROOT, 'artifacts', 'browser-evidence', 'saves');

/** The seed the corpus records and the scenario runner's CLI defaults to. */
const SEED = 424242n;
const LOCALE = 'ru';

/** The scenario the page runs behind the slots screen — a campaign there is to save. */
const SCENARIO = 'screen_normal';

/** The element the slots screen's texts and layout are collected from. */
const SCREEN = 'saves-screen';

/**
 * The database the browser store keeps, restated here because a test that seeded through
 * the store would be asking the code under test to arrange its own inputs.
 *
 * A drift between these three and `indexeddb-store.ts` shows up immediately and loudly:
 * every seeded state below would come out `Empty`.
 */
const DATABASE_NAME = 'oath-and-coin-saves';
const DATABASE_VERSION = 1;
const STORE_NAME = 'slots';

/** The moment stamped into the seeded save. Stated, so the screen can be checked for it. */
const CREATED_AT = '2026-08-19T09:41:00.000Z';

const catalogue = new Map([
  // §14.4: both loaders answer a `SortedMap`, whose `entries()` is an array and which has
  // no `Symbol.iterator`. `new Map(catalogue)` throws at runtime; this does not.
  ...loadLocaleCatalogue(join(REPOSITORY_ROOT, 'content', 'locale', `${LOCALE}.json`)).entries(),
  ...loadUiTextCatalogue(join(REPOSITORY_ROOT, 'ui-text', `${LOCALE}.json`)).entries()
]);

/** One text a player reads, resolved off the disk rather than off the page. */
function text(key: string): string {
  const resolved = catalogue.get(key);

  if (resolved === undefined) {
    throw new Error(`The two shipped catalogues answer nothing for '${key}'.`);
  }

  return resolved;
}

/**
 * A real save of the shipped campaign, built in this process.
 *
 * Through `buildSave` rather than by hand: a hand-written envelope would let this suite
 * seed a file the shipped build could never have produced, and every state below would
 * then be about that file rather than about a save.
 */
function shippedSave(): { readonly bytes: Uint8Array; readonly logicalTime: number } {
  const result = loadAndRunScenario({
    repositoryRoot: REPOSITORY_ROOT,
    scenario: SCENARIO,
    checkpoint: SCENARIO,
    seed: SEED
  });

  if (result.kind !== 'ran') {
    throw new Error(`'${SCENARIO}' must reach a campaign for there to be anything to save.`);
  }

  const contract = screenFor(result).contract;

  if (contract === null) {
    throw new Error(`'${SCENARIO}' must land on a contract, which is what a save's focus is.`);
  }

  const state = result.outcome.finalState;
  const shipped = computeContentVersion(join(REPOSITORY_ROOT, 'content'));

  // The page refuses a save written against another content tree
  // (`SAVE_CONTENT_MISMATCH`), so a scenario that ran on a fixture root would seed a file
  // every state below reports as unreadable — a suite failing for a reason that has
  // nothing to do with the screen. Named here instead.
  if (state.metadata.contentVersion !== shipped) {
    throw new Error(
      `'${SCENARIO}' ran on content '${state.metadata.contentVersion}' and the build ships ` +
        `'${shipped}', so a save of it is one the page would refuse.`
    );
  }

  return {
    bytes: buildSave({
      state,
      focusedContract: parseContentId(contract.definition),
      createdAt: CREATED_AT
    }),
    logicalTime: state.metadata.logicalTime
  };
}

const save = shippedSave();

/** Bytes that parse as UTF-8 and are not a save: the file a slot refuses on. */
const RUBBISH = new TextEncoder().encode('this is not a save');

/** The texts one slot line shows, in the order the screen renders them. */
function emptyLine(slot: string): readonly string[] {
  return [
    text(`save.slot.${slot}.name`),
    text('save.slot.status.empty'),
    text(`save.slot.${slot}.save`)
  ];
}

function occupiedLine(slot: string): readonly string[] {
  return [
    text(`save.slot.${slot}.name`),
    text('save.slot.status.occupied'),
    text('field.save.created_at'),
    CREATED_AT,
    text('field.save.logical_time'),
    String(save.logicalTime),
    text('field.save.contract'),
    text('contract.core.escort_the_caravan.name'),
    text(`save.slot.${slot}.save`),
    text(`save.slot.${slot}.load`)
  ];
}

function unreadableLine(slot: string, errorKey: string): readonly string[] {
  return [
    text(`save.slot.${slot}.name`),
    text('save.slot.status.unreadable'),
    text(errorKey),
    text(`save.slot.${slot}.save`),
    text(`save.slot.${slot}.load`)
  ];
}

function screenTexts(state: string, lines: readonly (readonly string[])[]): readonly string[] {
  return [text('screen.saves.title'), text(`screen.saves.state.${state}`), ...lines.flat()];
}

/**
 * What one state of this screen is, end to end: how it is arranged, what it must read,
 * and whether it puts the reachability question at all.
 *
 * `overflows` is stated per state for the reason `contract-offer.spec.ts` states it and
 * §15.5 requires: content that fits satisfies a reachability check trivially, so a state
 * with no record of whether it overflows turns "the content is reachable" into a claim
 * with no subject. All five are `false` here, and that is the honest answer rather than
 * an omission — measured at 1280x800 from the `report.json` each state writes, all five
 * report 452px of content inside a 452px viewport: the box is stretched to the window and
 * every state's content is shorter than it, so **this screen does not exercise
 * reachability at all**. Named rather than counted as
 * covered, on the same terms as the contract screen's horizontal assertion. The layout
 * that would trip it is a fourth slot or a much longer translation, and neither is in
 * this suite.
 */
interface SavesRun {
  /** The state the screen must report, as `ScreenState` spells it. */
  readonly state: string;
  readonly overflows: boolean;
  /** Arranges the storage and the browser *before* the page is opened. */
  prepare(page: Page): Promise<void>;
  /** The texts the screen owes, built here from the catalogues and the seeding. */
  readonly expected: readonly string[];
  /** What the state becomes once the test lets go, for the one state that is a wait. */
  release?(page: Page): Promise<void>;
}

const RUNS: readonly SavesRun[] = [
  {
    state: 'Loading',
    overflows: false,
    prepare: (page) => holdTheStorage(page),
    expected: screenTexts('loading', []),
    release: async (page) => {
      // The half that proves the state was a *wait* and not a broken page: the storage is
      // let go, and the same screen arrives at the answer it was waiting for.
      await page.evaluate(() => {
        (window as unknown as { releaseSaveStorage: () => void }).releaseSaveStorage();
      });
      await expect(page.getByTestId(SCREEN)).toHaveAttribute('data-state', 'Empty');
    }
  },
  {
    state: 'Empty',
    overflows: false,
    prepare: (page) => seed(page, {}),
    expected: screenTexts('empty', [emptyLine('slot_a'), emptyLine('slot_b'), emptyLine('slot_c')])
  },
  {
    state: 'Error',
    overflows: false,
    prepare: (page) => refuseTheStorage(page),
    expected: screenTexts('error', [
      unreadableLine('slot_a', 'error.save_storage_unavailable'),
      unreadableLine('slot_b', 'error.save_storage_unavailable'),
      unreadableLine('slot_c', 'error.save_storage_unavailable')
    ])
  },
  {
    state: 'Incomplete',
    overflows: false,
    prepare: (page) => seed(page, { 'slot-a': save.bytes, 'slot-b': RUBBISH }),
    expected: screenTexts('incomplete', [
      occupiedLine('slot_a'),
      unreadableLine('slot_b', 'error.save_malformed'),
      emptyLine('slot_c')
    ])
  },
  {
    state: 'Normal',
    overflows: false,
    prepare: (page) => seed(page, { 'slot-a': save.bytes }),
    expected: screenTexts('normal', [
      occupiedLine('slot_a'),
      emptyLine('slot_b'),
      emptyLine('slot_c')
    ])
  }
];

test.beforeAll(() => {
  // Cleared once per run, so a state that stops producing evidence leaves an empty
  // directory rather than last run's screenshot under this run's name.
  rmSync(EVIDENCE_ROOT, { recursive: true, force: true });
  mkdirSync(EVIDENCE_ROOT, { recursive: true });
});

test.describe('the save-slots screen, in a browser', () => {
  for (const run of RUNS) {
    test(`${run.state.toLowerCase()} shows what the storage holds, and all of it is reachable`, async ({
      page
    }) => {
      const events: string[] = [];
      recordEvents(page, events);

      await run.prepare(page);
      await page.goto(runUrl());

      await expect(page.getByTestId(SCREEN)).toBeVisible();
      // Waited for rather than slept on: the state is what the storage answered, and the
      // answer crosses an event queue. Every measurement below is taken after it.
      await expect(page.getByTestId(SCREEN)).toHaveAttribute('data-state', run.state);

      const reported = JSON.parse(
        (await page.getByTestId('run-report').textContent()) ?? ''
      ) as PageReport;
      const renderedTexts = await collectRenderedTexts(page);
      const layout = await measureLayout(page);

      const directory = join(EVIDENCE_ROOT, run.state.toLowerCase());
      mkdirSync(directory, { recursive: true });
      await page.screenshot({ path: join(directory, 'screenshot.png'), fullPage: false });
      writeFileSync(join(directory, 'events.jsonl'), events.map((line) => `${line}\n`).join(''));
      writeFileSync(
        join(directory, 'report.json'),
        `${JSON.stringify(
          {
            screen: 'saves',
            scenario: SCENARIO,
            checkpoint: SCENARIO,
            seed: SEED.toString(),
            locale: LOCALE,
            saves_screen_state: reported.saves_screen_state,
            screen_state: reported.screen_state,
            texts: renderedTexts.length,
            layout,
            events: events.length
          },
          null,
          2
        )}\n`
      );

      // The page must be on the screen the URL asked for, and in the state this test
      // arranged. Both, because either alone can be right about the wrong thing.
      expect(reported.screen).toBe('saves');
      expect(reported.saves_screen_state).toBe(run.state);

      // The list, not a hash of it: a hash says two screens differ and only the list says
      // where. Built here from the catalogues on disk and from the bytes this test seeded,
      // so nothing in it can know what the page rendered.
      expect(renderedTexts).toEqual(run.expected);

      // The run behind the screen is untouched by which screen is open: a player looking
      // at their slots has not changed what the scenario produced.
      expect(reported.screen_state).toBe('Normal');

      expect(
        layout.contentHeight > layout.viewportHeight,
        'three slots cannot fill this window; if they now do, the layout changed and this ' +
          'state has started asking the reachability question'
      ).toBe(run.overflows);
      expect(
        layout.reachableHeight,
        'content below the fold must be reachable by scrolling'
      ).toBeGreaterThanOrEqual(layout.contentHeight);

      if (run.release !== undefined) {
        await run.release(page);
      }

      // A page that logged an error rendered the right texts by accident at best. Last,
      // so the specific comparisons above name the failure first when both go.
      expect(events, 'the page must produce no error or failed request').toEqual([]);
    });
  }
});

test.describe('a write that is interrupted halfway', () => {
  test('leaves the save that was already in the slot whole', async ({ page }) => {
    // The promise `indexeddb-store.ts` makes and cannot keep on its own: "атомарность
    // даёт транзакция". The store runs exactly as it ships; what changes is that the
    // transaction it opens aborts itself after the write has been queued, which is what
    // a quota error or a crashing tab does to a real one.
    await seed(page, { 'slot-a': save.bytes });
    await abortTheWrite(page);
    await page.goto(runUrl());

    await expect(page.getByTestId(SCREEN)).toHaveAttribute('data-state', 'Normal');

    // The slot holds a campaign, so the screen asks before replacing it — and the
    // interrupted write is the one behind the confirmation.
    await page.getByTestId('slot-a-save').click();
    await page.getByTestId('slot-a-confirm').click();

    await expect(page.getByTestId('slot-a-error')).toBeVisible();
    await expect(page.getByTestId('slot-a-error')).toHaveText(
      text('error.save_storage_unavailable')
    );

    // And the bytes themselves, read straight out of the database rather than off the
    // screen: the line above says the page knows the write failed, and this says the
    // storage never moved.
    expect(await readSlot(page, 'slot-a')).toEqual([...save.bytes]);
  });
});

/** What the page reports about the run and the screen it is on. */
interface PageReport {
  readonly screen: string;
  readonly screen_state: string;
  readonly saves_screen_state: string | null;
}

/** The four numbers `ScreenLayoutMeasurement` carried, for the screen this suite is about. */
interface LayoutMeasurement {
  readonly contentHeight: number;
  readonly reachableHeight: number;
  readonly viewportHeight: number;
  readonly contentWidth: number;
  readonly viewportWidth: number;
}

/**
 * The URL a run declares itself with.
 *
 * Every input is stated, including the ones that equal the page's defaults: a run whose
 * evidence does not say which seed and which screen produced it is evidence about
 * whatever the source file last defaulted to.
 */
function runUrl(): string {
  const parameters = new URLSearchParams({
    scenario: SCENARIO,
    checkpoint: SCENARIO,
    seed: SEED.toString(),
    locale: LOCALE,
    screen: 'saves'
  });

  return `/?${parameters.toString()}`;
}

/**
 * Puts bytes into the browser's own database, before the page that reads them is opened.
 *
 * The first navigation is what gives this an origin to store anything under; the seeding
 * then happens in that document, and the page under test is opened afterwards. Written
 * through `indexedDB` directly rather than through the shipped store, so that the store
 * is never asked to arrange its own input.
 */
async function seed(page: Page, contents: Record<string, Uint8Array>): Promise<void> {
  await page.goto('/');

  await page.evaluate(
    async ({ database, version, store, entries }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(database, version);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains(store)) {
            request.result.createObjectStore(store);
          }
        };
        request.onsuccess = () => {
          resolve(request.result);
        };
        request.onerror = () => {
          reject(new Error('the seeding could not open the save database.'));
        };
      });

      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(store, 'readwrite');
        transaction.oncomplete = () => {
          resolve();
        };
        transaction.onabort = () => {
          reject(new Error('the seeding transaction aborted.'));
        };

        for (const [slot, bytes] of entries) {
          transaction.objectStore(store).put(new Uint8Array(bytes), slot);
        }
      });

      db.close();
    },
    {
      database: DATABASE_NAME,
      version: DATABASE_VERSION,
      store: STORE_NAME,
      // Structured clone carries a `Uint8Array` across, but a plain array is what makes
      // the boundary obvious and is what comes back from `readSlot` — so both sides of
      // the atomicity comparison are the same shape.
      entries: Object.entries(contents).map(([slot, bytes]) => [slot, [...bytes]] as const)
    }
  );
}

/** What a slot holds now, as plain bytes. */
async function readSlot(page: Page, slot: string): Promise<readonly number[] | null> {
  return page.evaluate(
    async ({ database, version, store, key }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(database, version);
        request.onsuccess = () => {
          resolve(request.result);
        };
        request.onerror = () => {
          reject(new Error('reading back could not open the save database.'));
        };
      });

      try {
        const value = await new Promise<unknown>((resolve, reject) => {
          const request = db.transaction(store, 'readonly').objectStore(store).get(key);
          request.onsuccess = () => {
            resolve(request.result);
          };
          request.onerror = () => {
            reject(new Error('reading back failed.'));
          };
        });

        return value instanceof Uint8Array ? [...value] : null;
      } finally {
        db.close();
      }
    },
    { database: DATABASE_NAME, version: DATABASE_VERSION, store: STORE_NAME, key: slot }
  );
}

/**
 * Makes every `indexedDB.open` fail, from the browser side.
 *
 * The `error` state has no other way in: spike A measured that `indexedDB.open('')`
 * opens perfectly well, so no arrangement of *data* can make a storage unavailable. The
 * replacement fires `onerror` asynchronously, which is the shape the shipped store
 * listens for — a synchronous throw would take a different branch and prove that one
 * instead.
 */
async function refuseTheStorage(page: Page): Promise<void> {
  await page.addInitScript(() => {
    IDBFactory.prototype.open = function refusingOpen(): IDBOpenDBRequest {
      const request = new EventTarget() as unknown as IDBOpenDBRequest;

      setTimeout(() => {
        request.onerror?.call(request, new Event('error') as Event & { target: IDBRequest });
      }, 0);

      return request;
    };
  });
}

/**
 * Holds every `indexedDB.open` until the test lets go.
 *
 * The `loading` state is a *wait*, and a wait cannot be seeded either. The held request
 * is a stand-in that forwards to a real one once released, so what the page finally sees
 * is the genuine database rather than a permanent fake — which is what lets the release
 * assert a real `Empty` afterwards.
 */
async function holdTheStorage(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const realOpen = IDBFactory.prototype.open;
    const held: (() => void)[] = [];

    IDBFactory.prototype.open = function holdingOpen(
      this: IDBFactory,
      name: string,
      version?: number
    ): IDBOpenDBRequest {
      const stub = new EventTarget() as unknown as IDBOpenDBRequest & { result: IDBDatabase };
      const factory = this;

      held.push(() => {
        const real =
          version === undefined
            ? realOpen.call(factory, name)
            : realOpen.call(factory, name, version);

        real.onupgradeneeded = (event) => {
          stub.result = real.result;
          stub.onupgradeneeded?.call(stub, event);
        };
        real.onsuccess = (event) => {
          stub.result = real.result;
          stub.onsuccess?.call(stub, event as Event & { target: IDBRequest });
        };
        real.onerror = (event) => {
          stub.onerror?.call(stub, event as Event & { target: IDBRequest });
        };
      });

      return stub;
    };

    (window as unknown as { releaseSaveStorage: () => void }).releaseSaveStorage = () => {
      for (const start of held.splice(0)) {
        start();
      }
    };
  });
}

/**
 * Makes the transaction of the next write abort itself, after the write is queued.
 *
 * Through the shipped store, not around it: `put` is called for real, so the record is
 * genuinely written into the transaction and the transaction is genuinely rolled back —
 * which is the only arrangement in which "the previous save survived" means anything. A
 * `put` that merely threw would prove the store's `try`/`catch` and nothing about
 * atomicity.
 */
async function abortTheWrite(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const realPut = IDBObjectStore.prototype.put;

    IDBObjectStore.prototype.put = function abortingPut(
      this: IDBObjectStore,
      value: unknown,
      key?: IDBValidKey
    ): IDBRequest<IDBValidKey> {
      const request =
        key === undefined ? realPut.call(this, value) : realPut.call(this, value, key);

      this.transaction.abort();

      return request;
    };
  });
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
 * `apps/web`, for the reason `contract-offer.spec.ts` records: the browser half of the
 * comparison has to be produced by code the page does not contain.
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
      const value = node.nodeValue ?? '';

      if (value.trim() !== '') {
        texts.push(value);
      }
    }

    return texts;
  }, SCREEN);
}

/**
 * How big the screen's content is and how much of it a person at this window can get to.
 *
 * The wheel-based measurement `contract-offer.spec.ts` documents at length is not
 * repeated here, and the reason is stated rather than assumed: this screen holds three
 * slots and never overflows, so there is nothing to scroll to and a wheel would measure
 * zero either way. What is worth measuring is the pair of numbers that says the question
 * was not asked — which is exactly what `overflows: false` above claims and what this
 * report records.
 */
async function measureLayout(page: Page): Promise<LayoutMeasurement> {
  return page.evaluate((testId: string) => {
    const element = document.querySelector(`[data-testid="${testId}"]`);

    if (element === null) {
      throw new Error(`The page has no [data-testid="${testId}"] to measure.`);
    }

    return {
      contentHeight: element.scrollHeight,
      reachableHeight: element.clientHeight,
      viewportHeight: element.clientHeight,
      contentWidth: element.scrollWidth,
      viewportWidth: element.clientWidth
    };
  }, SCREEN);
}
