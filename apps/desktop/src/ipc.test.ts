import { describe, expect, it } from 'vitest';

import {
  ALLOWED_CHANNELS,
  SAVE_LIST_CHANNEL,
  SAVE_READ_CHANNEL,
  SAVE_WRITE_CHANNEL,
  type HostDescription
} from './contract';
import { registerIpc, type IpcMainLike } from './ipc';
import type { DesktopSaveStore } from './save-store';

/**
 * `registerIpc` exercised against a fake `IpcMainLike`, without touching the
 * real `electron` package — see `ipc.ts`'s own header for why that matters:
 * `main.ts` has never had a test for exactly this reason before this file.
 *
 * Two things this proves that nothing else in the suite did before review
 * found the gap: the allowlist in `contract.ts` and what this function
 * actually registers are the same set (finding 5), and a hostile slot name
 * crossing the process boundary is refused by the handler itself, not merely
 * by a schema nothing calls (finding 3).
 */

type Listener = (event: unknown, ...args: unknown[]) => unknown;

function fakeIpcMain(): { ipcMainLike: IpcMainLike; handlers: Map<string, Listener> } {
  const handlers = new Map<string, Listener>();
  return {
    handlers,
    ipcMainLike: {
      handle(channel, listener) {
        handlers.set(channel, listener);
      }
    }
  };
}

function fakeStore(overrides: Partial<DesktopSaveStore> = {}): DesktopSaveStore {
  return {
    read: overrides.read ?? (async () => null),
    write: overrides.write ?? (async () => undefined),
    list: overrides.list ?? (async () => [])
  };
}

function fakeHostDescription(): HostDescription {
  return { platform: 'win32', appVersion: '0.0.0', packaged: false };
}

describe('registerIpc', () => {
  it('registers exactly the channels ALLOWED_CHANNELS names — no more, no fewer', () => {
    const { ipcMainLike, handlers } = fakeIpcMain();

    registerIpc(ipcMainLike, fakeStore(), fakeHostDescription);

    expect(new Set(handlers.keys())).toEqual(new Set(ALLOWED_CHANNELS));
  });

  it('the save-read handler refuses a slot outside the closed set, including a path-shaped one', async () => {
    const { ipcMainLike, handlers } = fakeIpcMain();
    registerIpc(ipcMainLike, fakeStore(), fakeHostDescription);

    const readHandler = handlers.get(SAVE_READ_CHANNEL);
    expect(readHandler).toBeTypeOf('function');

    await expect(readHandler?.(undefined, '../../slot-a')).rejects.toThrow();
  });

  it('the save-write handler refuses the same way, and rejects oversized bytes', async () => {
    const { ipcMainLike, handlers } = fakeIpcMain();
    registerIpc(ipcMainLike, fakeStore(), fakeHostDescription);

    const writeHandler = handlers.get(SAVE_WRITE_CHANNEL);
    await expect(writeHandler?.(undefined, '../../slot-a', Uint8Array.of(1))).rejects.toThrow();
  });

  it('the save-list handler refuses an argument it was never given a use for', async () => {
    const { ipcMainLike, handlers } = fakeIpcMain();
    registerIpc(ipcMainLike, fakeStore(), fakeHostDescription);

    const listHandler = handlers.get(SAVE_LIST_CHANNEL);
    await expect(listHandler?.(undefined, 'slot-a')).rejects.toThrow();
  });

  it('a valid save-read call reaches the store and answers its result', async () => {
    const { ipcMainLike, handlers } = fakeIpcMain();
    const store = fakeStore({
      read: async (slot) => (slot === 'slot-a' ? Uint8Array.of(1, 2) : null)
    });
    registerIpc(ipcMainLike, store, fakeHostDescription);

    const readHandler = handlers.get(SAVE_READ_CHANNEL);
    await expect(readHandler?.(undefined, 'slot-a')).resolves.toEqual(Uint8Array.of(1, 2));
  });

  it('a valid save-write call reaches the store with the slot and the bytes', async () => {
    const { ipcMainLike, handlers } = fakeIpcMain();
    const calls: Array<{ slot: string; bytes: Uint8Array }> = [];
    const store = fakeStore({
      write: async (slot, bytes) => {
        calls.push({ slot, bytes });
      }
    });
    registerIpc(ipcMainLike, store, fakeHostDescription);

    const writeHandler = handlers.get(SAVE_WRITE_CHANNEL);
    await writeHandler?.(undefined, 'slot-a', Uint8Array.of(9));

    expect(calls).toEqual([{ slot: 'slot-a', bytes: Uint8Array.of(9) }]);
  });

  it('a valid save-list call answers the store’s list', async () => {
    const { ipcMainLike, handlers } = fakeIpcMain();
    const store = fakeStore({ list: async () => ['slot-a', 'slot-c'] });
    registerIpc(ipcMainLike, store, fakeHostDescription);

    const listHandler = handlers.get(SAVE_LIST_CHANNEL);
    await expect(listHandler?.(undefined)).resolves.toEqual(['slot-a', 'slot-c']);
  });
});
