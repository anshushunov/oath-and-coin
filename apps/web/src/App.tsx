/**
 * The bootstrap surface of the browser build.
 *
 * It carries no game text on purpose. The contract-offer screen and its five
 * states are Task 13, localisation of player-facing strings is a rule of its
 * own (AGENTS.md §6), and a placeholder written in Russian here would be the
 * first game string in the new stack with no localisation behind it.
 *
 * What it does carry is one fact worth reporting from inside the renderer:
 * whether Node APIs are reachable from page scripts. ADR-010 §80 makes
 * `nodeIntegration: false` and `contextIsolation: true` a mandatory boundary of
 * the desktop host, and the only place that boundary can be observed is the
 * page itself. Rendering it means the same assertion runs against the browser
 * build and against the packaged Electron host, instead of the desktop one
 * being checked by reading `BrowserWindow` options back out of the code that
 * set them.
 */
export function App() {
  return (
    <main data-testid="app-root">
      <h1>Oath &amp; Coin</h1>
      <p data-testid="node-api-exposure">{describeNodeApiExposure()}</p>
    </main>
  );
}

/**
 * `absent` when nothing Node-shaped is reachable from the page.
 *
 * Both names are checked because they fail differently: `require` appears when
 * `nodeIntegration` is on, and `process` also appears when a preload script
 * leaks it onto the window without `contextIsolation` in between.
 */
function describeNodeApiExposure(): 'absent' | 'present' {
  const scope = window as unknown as Record<string, unknown>;
  const reachable = 'require' in scope || 'process' in scope;
  return reachable ? 'present' : 'absent';
}
