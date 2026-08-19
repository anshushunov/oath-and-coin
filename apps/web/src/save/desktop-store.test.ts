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

function installFakeDesktopApi(overrides: {
  readSave?: (slot: string) => Promise<Uint8Array | null>;
  writeSave?: (slot: string, bytes: Uint8Array) => Promise<void>;
  listSaves?: () => Promise<readonly string[]>;
}): void {
  (globalThis as { desktop?: unknown }).desktop = {
    readSave: overrides.readSave ?? (async () => null),
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
        return bytes;
      }
    });
    const store = desktopSaveStore();

    await expect(store.read('slot-a')).resolves.toEqual(bytes);
    expect(requestedSlot).toBe('slot-a');
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

  it('does not repeat the underlying error message, which can carry a local filesystem path', async () => {
    // A real rejection from `apps/desktop/src/save-store.ts` is a raw Node
    // `fs` error, and those always embed the absolute path involved — here
    // stood in for one that would spell out a Windows username under
    // `AppData\Roaming`. This module must write its own description rather
    // than echo it into whatever a screen shows for a refusal.
    const leakyMessage =
      "ENOENT: no such file or directory, open 'C:\\Users\\Alice\\AppData\\Roaming\\Oath and Coin\\saves\\slot-a.save'";
    installFakeDesktopApi({
      readSave: async () => {
        throw new Error(leakyMessage);
      }
    });
    const store = desktopSaveStore();

    let caught: unknown;
    try {
      await store.read('slot-a');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).not.toContain('Alice');
    expect((caught as Error).message).not.toContain('AppData');
  });
});
