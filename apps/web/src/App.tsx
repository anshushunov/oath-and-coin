import { startSession, type SessionState } from '@oath-and-coin/application';
import { readModelHash } from '@oath-and-coin/presentation';
import { useMemo } from 'react';

import { browserContentSource, browserLocaleCatalogue } from './content-source.ts';
import { parseRunRequest, type RunRequest } from './run-request.ts';
import { ContractOfferScreen } from './screens/contract-offer/contract-offer-screen.tsx';
import { TextSource } from './text.tsx';
import { WorldCanvas } from './world/world-canvas.tsx';

/**
 * The browser build's root: the port of `Main._Ready` minus Godot.
 *
 * Everything it does happens in `startSession`, which lives in
 * `packages/application` and is called by the oracle parity tool as well — so the
 * screen a player sees is produced by the same rule the frozen corpus measures,
 * rather than by a second copy of it that agrees by construction.
 *
 * **The run declares its own inputs** (`ADR-008` through `ADR-010` §157): scenario,
 * checkpoint, seed and locale arrive from the query string, so two runs of this page are
 * comparable by reading their URLs rather than by inspecting the source it was built
 * from. Task 13 carried them as three constants and said so; this is where they move.
 *
 * There is no store yet either. `createStore` is written and tested and waits for
 * `useSyncExternalStore`, but nothing on this screen changes state: a session is
 * computed once from immutable inputs. A store around a value that never moves is a
 * shape guessed before its first caller, which is the same reason `packages/application`
 * has one port rather than three.
 */
export function App() {
  // Once per mount rather than once per render: the session reads and validates the
  // whole content tree, and a screen that recomputed it on every render would do that
  // work again for every state change React ever makes.
  const run = useMemo(() => parseRunRequest(window.location.search), []);
  const catalogue = useMemo(() => browserLocaleCatalogue(run.locale), [run.locale]);
  const session = useMemo(
    () =>
      startSession({
        content: browserContentSource(),
        scenario: run.scenario,
        checkpoint: run.checkpoint,
        seed: run.seed
      }),
    [run]
  );

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

/**
 * What this run says about itself, for the browser evidence to read.
 *
 * Deliberately only the facts the page is the sole source of — the inputs it parsed and
 * the three identifiers the session produced. It does **not** report the rendered-UI
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
    canonical_hash: session.canonicalHash
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
