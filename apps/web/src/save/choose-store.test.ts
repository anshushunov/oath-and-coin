import { UNCHECKED_SLOT } from '@oath-and-coin/application';
import { afterEach, describe, expect, it } from 'vitest';

import { chooseSaveStore } from './choose-store.ts';

/**
 * `chooseSaveStore()`'s whole job is a presence check, and both branches are
 * proven by observable behaviour rather than by mocking either module it
 * wires together (this workspace does not use module mocking — see
 * `indexeddb-store.test.ts`'s own hand-rolled fakes for the established
 * shape): with `window.desktop` present and shaped right, a write reaches it;
 * with `window.desktop` absent, the store falls back to IndexedDB, which this
 * Vitest environment does not have — the same
 * `SAVE_STORAGE_UNAVAILABLE` `indexeddb-store.test.ts` pins for that case is
 * what proves the fallback happened, rather than the desktop bridge being
 * used by mistake.
 */

afterEach(() => {
  delete (globalThis as { desktop?: unknown }).desktop;
});

describe('chooseSaveStore', () => {
  it('delegates through window.desktop when it is present', async () => {
    const calls: Array<{ slot: string; bytes: Uint8Array }> = [];
    (globalThis as { desktop?: unknown }).desktop = {
      readSave: async () => null,
      writeSave: async (slot: string, bytes: Uint8Array) => {
        calls.push({ slot, bytes });
        return { ok: true };
      },
      listSaves: async () => []
    };

    const store = chooseSaveStore();
    await store.write('slot-a', Uint8Array.of(1, 2, 3), UNCHECKED_SLOT);

    expect(calls).toEqual([{ slot: 'slot-a', bytes: Uint8Array.of(1, 2, 3) }]);
  });

  it('falls back to the IndexedDB store when window.desktop is absent', async () => {
    const store = chooseSaveStore();

    // No indexedDB in this environment (see indexeddb-store.test.ts): this is
    // what proves the IndexedDB implementation was chosen, not the desktop one.
    await expect(store.read('slot-a')).rejects.toThrow(/SAVE_STORAGE_UNAVAILABLE/u);
  });
});
