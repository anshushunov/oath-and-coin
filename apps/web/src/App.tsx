import {
  createSessionController,
  type SessionController,
  type SessionState
} from '@oath-and-coin/application';
import { RULESET_VERSION } from '@oath-and-coin/content';
import { readModelHash } from '@oath-and-coin/presentation';
import { useEffect, useMemo, useSyncExternalStore } from 'react';

import {
  browserContentSource,
  browserLocaleCatalogue,
  shippedContentVersion
} from './content-source.ts';
import { parseRunRequest, type RunRequest } from './run-request.ts';
import { chooseSaveStore } from './save/choose-store.ts';
import { ContractOfferScreen } from './screens/contract-offer/contract-offer-screen.tsx';
import { TextSource } from './text.tsx';
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
 * checkpoint, seed and locale arrive from the query string, so two runs of this page are
 * comparable by reading their URLs rather than by inspecting the source it was built
 * from. Task 13 carried them as three constants and said so; this is where they move.
 *
 * **The session arrives, it is not computed** (Task 16, design spec §4.2). Until this
 * task the whole of it was one `useMemo` during render, which was honest while a session
 * was a run and nothing else: content is in the bundle and a scenario is two files, so
 * the answer was already there. A save is not — IndexedDB answers through events and the
 * desktop store answers across an IPC boundary — so the session became a value that
 * moves, and the page subscribes to it instead of computing it.
 *
 * **What that costs, and what it does not.** The page holds no state of its own: there
 * is no `useState` here, and everything on screen is a projection of one store snapshot.
 * That is what makes an answer landing after the page is gone harmless — React removes
 * the subscription at unmount, so a late write goes into a store nobody is reading, and
 * `App.test.tsx` unmounts mid-flight and checks both halves of that rather than
 * asserting it in a comment.
 */
export function App({ createController = browserSessionController }: AppProps = {}) {
  // Once per mount rather than once per render: the session reads and validates the
  // whole content tree, and a screen that recomputed it on every render would do that
  // work again for every state change React ever makes.
  const run = useMemo(() => parseRunRequest(window.location.search), []);
  const catalogue = useMemo(() => browserLocaleCatalogue(run.locale), [run.locale]);
  const controller = useMemo(() => createController(run), [createController, run]);
  const session = useSyncExternalStore(controller.store.subscribe, controller.store.snapshot);

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
        <ContractOfferScreen model={session.screen} />
      </TextSource>

      {/*
        The schematic world behind the screen (`DEC-007`, Task 14). Outside the
        `TextSource` because it renders no text at all — a canvas has no text nodes, so
        the rendered-UI hash collected from the screen above cannot see it either way,
        and putting it under a text provider would suggest otherwise.
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

      <RunReport run={run} session={session} />
    </main>
  );
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
function RunReport({ run, session }: { readonly run: RunRequest; readonly session: SessionState }) {
  const report = {
    scenario: run.scenario,
    checkpoint: run.checkpoint,
    seed: run.seed.toString(),
    locale: run.locale,
    // Reported exactly as the presentation layer spells it. The corpus writes the same
    // states lower-cased, and the verdict lower-cases when it compares — which is where
    // the parity tool does it too. Translating here would put the same convention in two
    // places, and two places is where conventions drift.
    screen_state: session.screen.state,
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
