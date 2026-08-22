import type { SaveStorePort } from '@oath-and-coin/application';
import { SaveReadError } from '@oath-and-coin/content';
import { afterEach, describe, expect, it } from 'vitest';

import { desktopSaveStore } from './desktop-store.ts';

/**
 * What this file proves: `desktopSaveStore()` delegates to `window.desktop`
 * when it looks like the desktop save API, and turns every kind of failure —
 * `window.desktop` missing or shaped wrong, a rejection from the bridge
 * itself — into `SAVE_STORAGE_UNAVAILABLE`, the same code
 * `indexeddb-store.ts` reports for its own unavailable-store cases.
 */

afterEach(() => {
  delete (globalThis as { desktop?: unknown }).desktop;
});

/**
 * The read channel's reply as `apps/desktop/src/contract.ts` declares it: bytes, or a
 * refusal the host made deliberately and named. Restated structurally here for the
 * reason `desktop-store.ts` restates the API itself — `apps/web` may not import
 * `apps/desktop`.
 */
type FakeReadReply = { ok: true; bytes: Uint8Array | null } | { ok: false; code: string };

function installFakeDesktopApi(overrides: {
  readSave?: (slot: string) => Promise<FakeReadReply>;
  writeSave?: (slot: string, bytes: Uint8Array) => Promise<void>;
  listSaves?: () => Promise<readonly string[]>;
}): void {
  (globalThis as { desktop?: unknown }).desktop = {
    readSave: overrides.readSave ?? (async () => ({ ok: true, bytes: null })),
    writeSave: overrides.writeSave ?? (async () => undefined),
    listSaves: overrides.listSaves ?? (async () => [])
  };
}

describe('when window.desktop is absent or not the expected shape', () => {
  it('refuses read, write and list with SAVE_STORAGE_UNAVAILABLE', async () => {
    const store = desktopSaveStore();

    await expect(store.read('slot-a')).rejects.toThrow(/SAVE_STORAGE_UNAVAILABLE/u);
    await expect(store.write('slot-a', Uint8Array.of(1))).rejects.toThrow(
      /SAVE_STORAGE_UNAVAILABLE/u
    );
    await expect(store.list()).rejects.toThrow(/SAVE_STORAGE_UNAVAILABLE/u);
  });

  it('rejects with SaveReadError, not a plain Error', async () => {
    const store = desktopSaveStore();

    await expect(store.read('slot-a')).rejects.toBeInstanceOf(SaveReadError);
  });

  it('refuses a window.desktop that is missing one of the three methods', async () => {
    (globalThis as { desktop?: unknown }).desktop = { readSave: async () => null };
    const store = desktopSaveStore();

    await expect(store.list()).rejects.toThrow(/SAVE_STORAGE_UNAVAILABLE/u);
  });
});

describe('delegating to window.desktop', () => {
  it('read() returns exactly what readSave answers', async () => {
    const bytes = Uint8Array.of(9, 8, 7);
    let requestedSlot: string | undefined;
    installFakeDesktopApi({
      readSave: async (slot) => {
        requestedSlot = slot;
        return { ok: true, bytes };
      }
    });
    const store = desktopSaveStore();

    await expect(store.read('slot-a')).resolves.toEqual(bytes);
    expect(requestedSlot).toBe('slot-a');
  });

  it('carries the host’s own refusal code instead of blaming the storage', async () => {
    // The host is the only process that can see an oversized file, and until
    // external review of segment 5 it had no way of saying so: every failure in
    // the main process arrived here as a rejection, and this module reports the
    // whole class as `SAVE_STORAGE_UNAVAILABLE` — the storage blamed for a file's
    // size, on a storage that was perfectly reachable.
    installFakeDesktopApi({
      readSave: async () => ({ ok: false, code: 'SAVE_OUT_OF_BOUNDS' })
    });
    const store = desktopSaveStore();

    await expect(store.read('slot-a')).rejects.toBeInstanceOf(SaveReadError);
    await expect(store.read('slot-a')).rejects.toThrow(/SAVE_OUT_OF_BOUNDS/u);
  });

  it('write() forwards the slot and the bytes to writeSave', async () => {
    const calls: Array<{ slot: string; bytes: Uint8Array }> = [];
    installFakeDesktopApi({
      writeSave: async (slot, bytes) => {
        calls.push({ slot, bytes });
      }
    });
    const store = desktopSaveStore();

    await store.write('slot-b', Uint8Array.of(1, 2));

    expect(calls).toEqual([{ slot: 'slot-b', bytes: Uint8Array.of(1, 2) }]);
  });

  it('list() returns exactly what listSaves answers', async () => {
    installFakeDesktopApi({ listSaves: async () => ['slot-a', 'slot-c'] });
    const store = desktopSaveStore();

    await expect(store.list()).resolves.toEqual(['slot-a', 'slot-c']);
  });

  it('wraps a rejection from readSave as SAVE_STORAGE_UNAVAILABLE rather than the raw error', async () => {
    installFakeDesktopApi({
      readSave: async () => {
        throw new Error('ipc invoke failed');
      }
    });
    const store = desktopSaveStore();

    await expect(store.read('slot-a')).rejects.toBeInstanceOf(SaveReadError);
    await expect(store.read('slot-a')).rejects.toThrow(/SAVE_STORAGE_UNAVAILABLE/u);
  });

  it('wraps a rejection from writeSave the same way', async () => {
    installFakeDesktopApi({
      writeSave: async () => {
        throw new Error('ipc invoke failed');
      }
    });
    const store = desktopSaveStore();

    await expect(store.write('slot-a', Uint8Array.of(1))).rejects.toThrow(
      /SAVE_STORAGE_UNAVAILABLE/u
    );
  });

  it('wraps a rejection from listSaves the same way', async () => {
    installFakeDesktopApi({
      listSaves: async () => {
        throw new Error('ipc invoke failed');
      }
    });
    const store = desktopSaveStore();

    await expect(store.list()).rejects.toThrow(/SAVE_STORAGE_UNAVAILABLE/u);
  });

  describe('none of the three wraps repeat the underlying error message', () => {
    // Docblock claim, and previously proven for `read()` alone — external
    // review pinned the gap directly: reintroducing the interpolation in
    // `write()` left this file at 124/124 green, because nothing exercised
    // that branch. Parametrized over all three methods so a future
    // regression in any one of them is a red test, not a claim resting on a
    // sample of one.
    const leakyMessage =
      "ENOENT: no such file or directory, open 'C:\\Users\\Alice\\AppData\\Roaming\\Oath and Coin\\saves\\slot-a.save'";

    const cases: ReadonlyArray<{
      readonly label: string;
      readonly install: () => void;
      readonly invoke: (store: SaveStorePort) => Promise<unknown>;
    }> = [
      {
        label: 'read()',
        install: () =>
          installFakeDesktopApi({
            readSave: async () => {
              throw new Error(leakyMessage);
            }
          }),
        invoke: (store) => store.read('slot-a')
      },
      {
        label: 'write()',
        install: () =>
          installFakeDesktopApi({
            writeSave: async () => {
              throw new Error(leakyMessage);
            }
          }),
        invoke: (store) => store.write('slot-a', Uint8Array.of(1))
      },
      {
        label: 'list()',
        install: () =>
          installFakeDesktopApi({
            listSaves: async () => {
              throw new Error(leakyMessage);
            }
          }),
        invoke: (store) => store.list()
      }
    ];

    it.each(cases)(
      '$label drops a message that could carry a local filesystem path',
      async ({ install, invoke }) => {
        install();
        const store = desktopSaveStore();

        let caught: unknown;
        try {
          await invoke(store);
        } catch (error) {
          caught = error;
        }

        expect(caught).toBeInstanceOf(Error);
        expect((caught as Error).message).not.toContain('Alice');
        expect((caught as Error).message).not.toContain('AppData');
      }
    );
  });
});
