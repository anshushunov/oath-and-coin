import { startSession } from '@oath-and-coin/application';
import { useMemo } from 'react';

import { browserContentSource, browserLocaleCatalogue } from './content-source.ts';
import { ContractOfferScreen } from './screens/contract-offer/contract-offer-screen.tsx';
import { TextSource } from './text.tsx';

/**
 * The browser build's root: the port of `Main._Ready` minus Godot.
 *
 * Everything it does happens in `startSession`, which lives in
 * `packages/application` and is called by the oracle parity tool as well — so the
 * screen a player sees is produced by the same rule the frozen corpus measures,
 * rather than by a second copy of it that agrees by construction.
 *
 * **The run is fixed here, and that is Task 13's boundary rather than an oversight.**
 * `ADR-008` gives a visual run four declared inputs — scenario, checkpoint, seed and
 * locale — and Task 15 is where they arrive from the query string, together with the
 * evidence a run produces. Reading them here first would put the parsing in one task
 * and the thing that proves it works in another.
 *
 * There is no store yet either. `createStore` is written and tested and waits for
 * `useSyncExternalStore`, but nothing on this screen changes state: a session is
 * computed once from immutable inputs. A store around a value that never moves is a
 * shape guessed before its first caller, which is the same reason `packages/application`
 * has one port rather than three.
 */

/** The scenario the browser build shows until Task 15 lets a run declare its own. */
const DEFAULT_SCENARIO = 'screen_normal';

/**
 * The seed the scenario runner's CLI defaults to. The same one, so that what the page
 * shows can be reproduced from a command line without anyone having to know which
 * number the page picked.
 */
const DEFAULT_SEED = 424242n;

/** `project.godot` pinned the same one, and `content/locale/` ships only this catalogue. */
const DEFAULT_LOCALE = 'ru';

export function App() {
  // Once per mount rather than once per render: the session reads and validates the
  // whole content tree, and a screen that recomputed it on every render would do that
  // work again for every state change React ever makes.
  const catalogue = useMemo(() => browserLocaleCatalogue(DEFAULT_LOCALE), []);
  const session = useMemo(
    () =>
      startSession({
        content: browserContentSource(),
        scenario: DEFAULT_SCENARIO,
        // The manifest's last checkpoint. Naming one here would mean this file knew
        // something about the scenario that the scenario already states.
        checkpoint: null,
        seed: DEFAULT_SEED
      }),
    []
  );

  return (
    <main data-testid="app-root">
      <TextSource catalogue={catalogue}>
        <ContractOfferScreen model={session.screen} />
      </TextSource>

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
    </main>
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
