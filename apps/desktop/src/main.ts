import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { BrowserWindow, app, ipcMain, session, shell } from 'electron';

import {
  DESCRIBE_HOST_CHANNEL,
  SAVE_LIST_CHANNEL,
  SAVE_READ_CHANNEL,
  SAVE_WRITE_CHANNEL,
  describeHostRequest,
  describeHostResponse,
  mayOpenExternally,
  saveListRequest,
  saveReadRequest,
  saveWriteRequest,
  type HostDescription
} from './contract';
import { fileSaveStore, type DesktopSaveStore } from './save-store';

/**
 * The Electron main process: a window, a security boundary and one typed IPC
 * method. No game rules live here (ADR-010), and no storefront SDK is loaded —
 * ADR-011 removed that from the migration's scope entirely.
 */

/**
 * Sent as a response header rather than only as the meta element in
 * `index.html`. Two directives exist only as headers — a meta CSP cannot
 * refuse to be framed, and Chromium logs a console error if it tries — and a
 * header also covers responses that are not the document.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join('; ');

/**
 * The renderer is the browser build, byte for byte — packaged as a resource
 * next to the app rather than compiled into it, so the file loaded here is the
 * same one `pnpm test:e2e` drives in Chromium.
 */
function resolveRendererEntry(): string {
  const packaged = join(process.resourcesPath, 'web', 'index.html');
  if (app.isPackaged) {
    return packaged;
  }

  // Running from source: apps/web/dist, built by the same command that builds
  // this process. Missing means someone ran the host without building the
  // renderer, which is worth saying out loud — the alternative is a window
  // showing a file:// error page.
  const fromSource = join(app.getAppPath(), '..', 'web', 'dist', 'index.html');
  if (!existsSync(fromSource)) {
    throw new Error(
      `The renderer build is missing at ${fromSource}. Build @oath-and-coin/web before starting the desktop host.`
    );
  }
  return fromSource;
}

function describeHost(): HostDescription {
  return describeHostResponse.parse({
    platform: process.platform,
    appVersion: app.getVersion(),
    packaged: app.isPackaged
  });
}

/**
 * Where this build keeps its saves: a `saves` directory under Electron's own
 * per-application data directory. Read only after `app.setName` has run (see
 * the call site below) — `app.getPath('userData')` is derived from the
 * application name, and computing it earlier would answer with the name this
 * build never asked for.
 */
function resolveSaveDirectory(): string {
  return join(app.getPath('userData'), 'saves');
}

function registerIpc(store: DesktopSaveStore): void {
  ipcMain.handle(DESCRIBE_HOST_CHANNEL, (_event, ...args: unknown[]) => {
    // Validated even though the method takes nothing: a handler that ignores
    // its arguments accepts anything, and the day it grows a parameter is the
    // day nobody remembers this was the unchecked one.
    describeHostRequest.parse(args);
    return describeHost();
  });

  ipcMain.handle(SAVE_READ_CHANNEL, async (_event, ...args: unknown[]) => {
    const [slot] = saveReadRequest.parse(args);
    return store.read(slot);
  });

  ipcMain.handle(SAVE_WRITE_CHANNEL, async (_event, ...args: unknown[]) => {
    const [slot, bytes] = saveWriteRequest.parse(args);
    await store.write(slot, bytes);
  });

  ipcMain.handle(SAVE_LIST_CHANNEL, async (_event, ...args: unknown[]) => {
    saveListRequest.parse(args);
    return store.list();
  });
}

function hardenSession(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [CONTENT_SECURITY_POLICY]
      }
    });
  });

  // The renderer has no reason to ask for a camera, a microphone or a
  // notification, and a permission dialog is not a decision a game screen
  // should be able to provoke.
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    // Nothing is shown until the first paint: an empty frame flashing white
    // before the app renders is the kind of thing that gets "fixed" later with
    // a splash screen.
    show: false,
    backgroundColor: '#101014',
    webPreferences: {
      // ADR-010 §80, non-negotiable and repeated in ADR-011. The README of
      // steamworks.js asks for the opposite of the second and third; that
      // recommendation is not followed, and with ADR-011 the library is not
      // present at all.
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // Even with contextIsolation on, a renderer that could reach a remote
      // module would have a way out of the sandbox.
      webviewTag: false,
      preload: join(__dirname, 'preload.cjs')
    }
  });

  window.once('ready-to-show', () => {
    window.show();
  });

  // A local application has nowhere to navigate to. Both hooks are needed:
  // `will-navigate` covers a link replacing the page, `setWindowOpenHandler`
  // covers `window.open` and target=_blank, and each is silent about the other.
  window.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    // Opened in the user's browser rather than in a second, less constrained
    // Electron window — but only if it is a web URL. Handing an arbitrary
    // scheme to the OS is the hole external review found here: `file:` and
    // registered custom schemes go to whatever program claims them, and
    // Electron's security guidance names that as a path to arbitrary command
    // execution. Anything else is dropped, deliberately without a fallback:
    // there is no safer program to open an unknown scheme with.
    if (mayOpenExternally(url)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  void window.loadFile(resolveRendererEntry());
  return window;
}

// Spike B measured the packaged build's `app.getPath('userData')` without
// this call: `AppData\Roaming\@oath-and-coin\desktop`. `productName` in
// `electron-builder.yml` never reaches the packaged `package.json` — the
// name Electron actually reads is `name`, `@oath-and-coin/desktop`, and the
// slash in it becomes a spurious extra directory level. Set before
// `whenReady` (and before the single-instance lock, which touches the same
// per-application state) so every path this process derives from the app
// name — `resolveSaveDirectory` included — is already correct the first time
// anything asks.
app.setName('Oath and Coin');

// A second instance would fight the first over the save directory once Task 16
// exists. Cheap to state now, expensive to retrofit after a corrupted save.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  void app.whenReady().then(() => {
    hardenSession();
    registerIpc(fileSaveStore(resolveSaveDirectory()));
    createWindow();
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}
