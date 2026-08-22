import type { SaveStorePort } from '@oath-and-coin/application';

import { desktopSaveStore } from './desktop-store.ts';
import { createIndexedDbSaveStore } from './indexeddb-store.ts';

/**
 * The save store's composition root (design spec §2.1, brief step 7): the
 * desktop build reads and writes through Electron's main process, the browser
 * build through IndexedDB, and one bundle runs as both — the choice is made
 * here, once, by what is actually running it, rather than by a build-time
 * flag baked into two separate bundles.
 *
 * `window.desktop` is exactly what `apps/desktop/src/preload.ts` puts there
 * through `contextBridge`, and its absence is exactly what a plain Chromium —
 * or a browser tab that opened this bundle directly — looks like. There is no
 * third case.
 */
export function chooseSaveStore(): SaveStorePort {
  return hasDesktopApi() ? desktopSaveStore() : createIndexedDbSaveStore();
}

function hasDesktopApi(): boolean {
  const candidate = (globalThis as { desktop?: unknown }).desktop;
  return typeof candidate === 'object' && candidate !== null;
}
