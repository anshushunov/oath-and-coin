import {
  SAVE_SLOTS,
  createSessionController,
  type SaveSlot,
  type SaveSlotDescription,
  type SessionController,
  type SessionState
} from '@oath-and-coin/application';
import { RULESET_VERSION } from '@oath-and-coin/content';
import {
  SAVE_SLOTS_LOADING_SCREEN,
  ScreenKind,
  ScreenLinkKeys,
  contractBoardStateKey,
  readModelHash,
  saveSlotsScreenModel,
  type SaveSlotsScreenModel,
  type ScreenModel
} from '@oath-and-coin/presentation';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import {
  browserContentSource,
  browserLocaleCatalogue,
  browserUiTextCatalogue,
  shippedContentVersion
} from './content-source.ts';
import { parseRunRequest, type RunRequest, type ScreenName } from './run-request.ts';
import { chooseSaveStore } from './save/choose-store.ts';
import { AfterActionScreen } from './screens/after-action/after-action-screen.tsx';
import { ContractOfferScreen } from './screens/contract-offer/contract-offer-screen.tsx';
import { SavesScreen } from './screens/saves/saves-screen.tsx';
import { TextSource, useText } from './text.tsx';
import { WorldCanvas } from './world/world-canvas.tsx';

/**
 * The browser build's root: the port of `Main._Ready` minus Godot.
 *
 * Everything it shows comes from a session controller in `packages/application`, whose
 * run goes through the same `startSession` the oracle parity tool calls — so the screen
 * a player sees is produced by the same rule the frozen corpus measures, rather than by
 * a second copy of it that agrees by construction.
 *
 * **The run declares its own inputs** (`ADR-008` through `ADR-010` §157): scenario,
 * checkpoint, seed, locale and — since Task 16.8 — which of the two screens it opens on
 * arrive from the query string, so two runs of this page are comparable by reading their
 * URLs rather than by inspecting the source it was built from. Task 13 carried them as
 * three constants and said so; this is where they move.
 *
 * **The session arrives, it is not computed** (Task 16, design spec §4.2). Until that
 * task the whole of it was one `useMemo` during render, which was honest while a session
 * was a run and nothing else: content is in the bundle and a scenario is two files, so
 * the answer was already there. A save is not — IndexedDB answers through events and the
 * desktop store answers across an IPC boundary — so the session became a value that
 * moves, and the page subscribes to it instead of computing it.
 *
 * **What the page does hold, since the slots screen arrived.** Two things, and neither is
 * a copy of anything the session has: which of the two screens is open, and the last
 * answer the storage gave about the three slots. The second is state rather than a memo
 * for the same reason the controller is — it is an answer that arrived, not a value that
 * can be recomputed — and it is *not* on the session store on purpose: a slot's contents
 * belong to the storage, another tab can move them, and nothing notifies anybody. So the
 * screen re-reads after every operation rather than trusting what it drew last.
 *
 * **What that costs, and what it does not.** Every asynchronous answer this page waits
 * for is dropped if it arrives after the page is gone: React removes the store
 * subscription at unmount, and the slot read below is guarded by its own effect cleanup.
 * `App.test.tsx` unmounts mid-flight and checks both halves of that rather than asserting
 * it in a comment.
 */
export function App({ createController = browserSessionController }: AppProps = {}) {
  // Once per mount rather than once per render: the session reads and validates the
  // whole content tree, and a screen that recomputed it on every render would do that
  // work again for every state change React ever makes.
  const run = useMemo(() => parseRunRequest(window.location.search), []);
  const catalogue = useMemo(() => browserCatalogue(run.locale), [run.locale]);
  // `useState`, not `useMemo`, and the difference is the whole of what a session is.
  // A memo is a cache React is allowed to drop; dropping this one would build a second
  // controller with a second store, restart the run against it, and leave a `load()`
  // already in flight to land in the store nobody is subscribed to any more — a player's
  // load lost with nothing on screen to say so. A `useState` initializer runs once per
  // mounted component and its value is state, not a cache.
  const [controller] = useState(() => createController(run));
  const session = useSyncExternalStore(controller.store.subscribe, controller.store.snapshot);
  const [screen, setScreen] = useState<ScreenName>(run.screen);
  const slots = useSaveSlots(controller, screen === 'saves');

  useEffect(() => {
    // In an effect rather than in the memo above: `useMemo` may run during a render
    // React then throws away, and a run started there would be a scenario executed for
    // a page that never mounted. There is nothing to cancel in the cleanup — the
    // subscription is React's own and it removes it, and this component keeps no state
    // for a late answer to be written into.
    void controller.start();
  }, [controller]);

  return (
    <main data-testid="app-root">
      <TextSource catalogue={catalogue}>
        <ScreenLink screen={screen} onOpen={setScreen} />

        {screen === 'saves' ? (
          <SavesScreen
            model={slots.model}
            onSave={(slot) => {
              // The controller records a refusal rather than throwing one, so there is
              // nothing to catch here: what a failed write leaves behind is a code on
              // the session, which the re-read below puts back on the slot's own line.
              void controller.save(requireSaveSlot(slot)).then(slots.reread, slots.reread);
            }}
            onLoad={(slot) => {
              openLoaded(
                controller,
                requireSaveSlot(slot),
                () => {
                  setScreen('contract-offer');
                },
                slots.reread
              );
            }}
          />
        ) : (
          <CampaignScreen model={session.screen} controller={controller} />
        )}
      </TextSource>

      {/*
        The schematic world behind the screen (`DEC-007`, Task 14). Outside the
        `TextSource` because it renders no text at all — a canvas has no text nodes, so
        the rendered-UI hash collected from the screen above cannot see it either way,
        and putting it under a text provider would suggest otherwise.

        Drawn on both screens, and from the same model: it is the campaign behind the
        page rather than a decoration of one screen, and a canvas that blanked while the
        player looked at the slots would be claiming the campaign went away.
      */}
      <WorldCanvas model={session.screen} />

      {/*
        Not part of the screen, and deliberately after it: one fact worth reporting
        from inside the renderer. `ADR-010` §80 makes `nodeIntegration: false` and
        `contextIsolation: true` a mandatory boundary of the desktop host, and the only
        place that boundary can be observed is the page itself. Rendering it means the
        same assertion runs against the browser build and against the packaged Electron
        host, instead of the desktop one being checked by reading `BrowserWindow`
        options back out of the code that set them.
      */}
      <p data-testid="node-api-exposure">{describeNodeApiExposure()}</p>

      <RunReport run={run} session={session} screen={screen} slots={slots.model} />
    </main>
  );
}

/**
 * Whichever of the campaign's three screens the session is on.
 *
 * The `switch` is exhaustive and has no `default`, which is the whole point of the union's
 * discriminant: a fourth screen does not build until the page has been told what to draw
 * for it.
 *
 * **The board is still a placeholder, and deliberately named as such.** Its read model exists
 * and its component does not — that is the contract-loop UI plan's own task 8 — and until
 * then the honest thing for the page to draw is the screen's title beside which of the five
 * shapes it is in, under the `data-testid` the end-to-end run will look for. A page that
 * rendered nothing at all would be indistinguishable from a page whose routing sent the
 * player nowhere.
 */
function CampaignScreen({
  model,
  controller
}: {
  readonly model: ScreenModel;
  readonly controller: SessionController;
}) {
  const text = useText();

  switch (model.screen) {
    case ScreenKind.ContractOffer:
      return <ContractOfferScreen model={model} controller={controller} />;
    case ScreenKind.AfterAction:
      return <AfterActionScreen model={model} controller={controller} />;
    case ScreenKind.ContractBoard:
      return (
        <section data-testid="contract-board-screen">
          <h1>{text(model.titleKey)}</h1>
          <p>{text(contractBoardStateKey(model.state))}</p>
        </section>
      );
  }
}

export interface AppProps {
  /**
   * Builds the session controller this page drives, defaulting to the browser one.
   *
   * A seam rather than a setting: the page's own composition root is
   * {@link browserSessionController} and that is what ships, but "what does this page do
   * while a session is still arriving, and what does it do with one that arrives after
   * it is gone" are questions about timing, and timing is the one thing a test cannot
   * ask of a controller it does not hold.
   */
  readonly createController?: (run: RunRequest) => SessionController;
}

/**
 * The three slots as the storage last answered, and the way to ask again.
 *
 * Asked only while the slots screen is open (`active`), because the question costs a
 * storage round trip and a contract screen shows none of it. Re-asked whenever
 * {@link reread} is called rather than after a fixed delay: the moments the answer can
 * have changed are exactly the operations this page performs, and each of them calls it.
 *
 * The cleanup is what makes a late answer harmless — a read that lands after the screen
 * has closed or after a newer read was asked for is dropped rather than drawn.
 */
function useSaveSlots(
  controller: SessionController,
  active: boolean
): { readonly model: SaveSlotsScreenModel; readonly reread: () => void } {
  const [described, setDescribed] = useState<readonly SaveSlotDescription[] | null>(null);
  const [asked, setAsked] = useState(0);

  useEffect(() => {
    if (!active) {
      return;
    }

    let current = true;
    void controller.slots().then((answer) => {
      if (current) {
        setDescribed(answer);
      }
    });

    return () => {
      current = false;
    };
  }, [controller, active, asked]);

  return {
    // The loading screen until the first answer arrives, and never a set of empty slots:
    // "nothing has been read yet" and "all three slots are empty" are different claims,
    // and only one of them is true before the storage has spoken.
    model: described === null ? SAVE_SLOTS_LOADING_SCREEN : saveSlotsScreenModel(described),
    reread: () => {
      setAsked((count) => count + 1);
    }
  };
}

/**
 * Loads `slot` and leaves the slots screen only if the campaign actually arrived.
 *
 * The refusal is shown in place (design spec §3.1: "попытка загрузить нечитаемый слот →
 * отказ на месте, без ухода с экрана"). A page that navigated first and asked afterwards
 * would drop the player onto whatever screen the previous session was showing, with the
 * reason nowhere.
 *
 * **What says which happened is this call's own result, not the session.** It used to be
 * `store.snapshot().saveFailure`, read once the promise settled, and external review of
 * segment 5 was right about what that costs when the player clicks two slots in a row:
 * there is one `saveFailure` and both callbacks read it, so neither can tell whose answer
 * it is. `SessionLoadResult` belongs to the call that produced it — including the outcome
 * that only exists because loads overlap, where this call's campaign was superseded by a
 * later one and navigating on its behalf would move the player somewhere they did not ask
 * to go.
 */
function openLoaded(
  controller: SessionController,
  slot: SaveSlot,
  onLoaded: () => void,
  onRefused: () => void
): void {
  void controller.load(slot).then((result) => {
    if (result.outcome === 'loaded') {
      onLoaded();
      return;
    }

    onRefused();
  }, onRefused);
}

/** The one link between the two screens — the button design spec §3 asks for. */
function ScreenLink({
  screen,
  onOpen
}: {
  readonly screen: ScreenName;
  readonly onOpen: (screen: ScreenName) => void;
}) {
  const text = useText();
  const saves = screen === 'saves';

  return (
    <nav data-testid="screen-link">
      <button
        type="button"
        data-testid={saves ? 'open-contract-offer' : 'open-saves'}
        onClick={() => {
          onOpen(saves ? 'contract-offer' : 'saves');
        }}
      >
        {text(saves ? ScreenLinkKeys.OpenContractOffer : ScreenLinkKeys.OpenSaves)}
      </button>
    </nav>
  );
}

/**
 * The slot name a screen handed back, as one of the three this build has.
 *
 * The screen model carries slot names as plain strings — `packages/presentation` may not
 * import `SAVE_SLOTS` — so the string comes back untyped and is checked here rather than
 * cast. A cast would let a typo in a model reach a store as a key nobody declared.
 */
function requireSaveSlot(name: string): SaveSlot {
  const slot = SAVE_SLOTS.find((candidate) => candidate === name);

  if (slot === undefined) {
    throw new Error(
      `'${name}' is not one of this build's save slots (${SAVE_SLOTS.join(', ')}). The slots ` +
        'screen is built from those three and from nothing a player can type.'
    );
  }

  return slot;
}

/**
 * Everything the session needs that only a browser can answer, in one place.
 *
 * Four dependencies, and each is here because `packages/application` may not have it:
 * the content comes out of the bundle, the slot store is chosen by what is running the
 * page (`chooseSaveStore`), the clock is a clock — `AGENTS.md` §6 keeps wall-clock time
 * out of the layers below, so a save's `created_at` is stamped from here — and the
 * version pair is what this build says about itself, which is its ruleset and the digest
 * of the tree it ships.
 */
function browserSessionController(run: RunRequest): SessionController {
  return createSessionController({
    request: {
      content: browserContentSource(),
      scenario: run.scenario,
      checkpoint: run.checkpoint,
      seed: run.seed
    },
    saves: chooseSaveStore(),
    now: () => new Date().toISOString(),
    expected: {
      rulesetVersion: RULESET_VERSION,
      contentVersion: shippedContentVersion()
    }
  });
}

/**
 * Both catalogues as one lookup: the texts content authors and the texts the screens
 * invent (`ADR-012`).
 *
 * Merged rather than threaded as two providers because a screen resolves one key at a
 * time and does not know which side of the boundary a key came from — the contract
 * screen's are content's, the slots screen's are both. The merge is only safe because no
 * key may sit in both files, which is not an assumption: `tests/locale` asserts it over
 * the whole of both catalogues, including keys nothing reads yet.
 */
function browserCatalogue(locale: string): ReadonlyMap<string, string> {
  return new Map([...browserLocaleCatalogue(locale), ...browserUiTextCatalogue(locale)]);
}

/**
 * What this run says about itself, for the browser evidence to read.
 *
 * Deliberately only the facts the page is the sole source of — the inputs it parsed and
 * the four identifiers the session carries. It does **not** report the rendered-UI
 * hash: that one is about the markup, and a page computing a claim about its own markup
 * is a page marking its own work. The end-to-end run collects the texts out of the DOM
 * and hashes them itself, so the two sides of that comparison stay unrelated.
 *
 * Hidden rather than styled away, and outside `contract-offer-screen` rather than inside
 * it: `FULL_TYPESCRIPT_MIGRATION` §14.3 recorded why the rendered-UI hash is collected
 * from the screen element specifically, and a diagnostic that sat inside it would put its
 * own JSON into that hash.
 */
function RunReport({
  run,
  session,
  screen,
  slots
}: {
  readonly run: RunRequest;
  readonly session: SessionState;
  readonly screen: ScreenName;
  readonly slots: SaveSlotsScreenModel;
}) {
  const report = {
    scenario: run.scenario,
    checkpoint: run.checkpoint,
    seed: run.seed.toString(),
    locale: run.locale,
    // Which screen the page is actually on, beside the four run inputs. Not read off
    // `run.screen`: a load moves the player back to the contract offer, and a report
    // that echoed the URL would describe the run that was asked for rather than the one
    // the frame beside it shows.
    screen,
    // Which of the campaign's three screens is under that surface, and `null` on the slots
    // screen, where none of them is. Its own field rather than folded into `screen` above:
    // that one names the *surface* a run opened — the campaign or the saves — and it is an
    // input a URL declares, while this one is a fact about where the campaign's own
    // navigation (`RESOLUTION_SPEC` §6.4) has put the player since. A report that published
    // only the first would label a frame of the debrief as `contract-offer`.
    campaign_screen: screen === 'saves' ? null : session.screen.screen,
    // Reported exactly as the presentation layer spells it. The corpus writes the same
    // states lower-cased, and the verdict lower-cases when it compares — which is where
    // the parity tool does it too. Translating here would put the same convention in two
    // places, and two places is where conventions drift.
    screen_state: session.screen.state,
    // The slots screen's own state, and `null` when that screen is not the one on the
    // page. Its own field rather than folded into `screen_state`: that one is a fact
    // about the run, oracle parity reads it, and a run whose player happened to open the
    // slots screen has not changed what its scenario produced.
    saves_screen_state: screen === 'saves' ? slots.state : null,
    // Computed from the model this page is showing, by the same function the corpus is
    // measured with. What makes it evidence is that the verdict compares it against a
    // hash recomputed from the corpus entry rather than against anything this page says.
    read_model_hash: readModelHash(session.screen),
    content_version: session.contentVersion,
    // `null` for a session that arrived by loading a save, and that is the report being
    // accurate rather than incomplete (design spec §4.4): this hash is of a whole run,
    // a save carries no run, and oracle parity reads this field. `null` also means
    // `null` in the JSON — never `""`, never `0` — because "there was no run" and "the
    // run hashed to nothing" are different claims and a verdict compares this against a
    // corpus that records the same two nulls.
    canonical_hash: session.canonicalHash,
    // The other half of the pair, added by Task 16 for the same reason: the run hash
    // going `null` after a load would otherwise leave the page with nothing to say about
    // which campaign it is showing.
    saved_state_hash: session.savedStateHash
  };

  return (
    <div hidden data-testid="run-report">
      {JSON.stringify(report)}
    </div>
  );
}

/**
 * `absent` when nothing Node-shaped is reachable from the page.
 *
 * Both names are checked because they fail differently: `require` appears when
 * `nodeIntegration` is on, and `process` also appears when a preload script leaks it
 * onto the window without `contextIsolation` in between.
 */
function describeNodeApiExposure(): 'absent' | 'present' {
  const scope = window as unknown as Record<string, unknown>;
  const reachable = 'require' in scope || 'process' in scope;

  return reachable ? 'present' : 'absent';
}
