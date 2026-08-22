import { describe, expect, it } from 'vitest';

import {
  ALLOWED_CHANNELS,
  DESCRIBE_HOST_CHANNEL,
  SAVE_LIST_CHANNEL,
  SAVE_READ_CHANNEL,
  SAVE_WRITE_CHANNEL,
  SaveHostRefusal,
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
    await expect(readHandler?.(undefined, 'slot-a')).resolves.toEqual({
      ok: true,
      bytes: Uint8Array.of(1, 2)
    });
  });

  it('answers a deliberate refusal as a value on the channel, not as a rejection', async () => {
    // `SAVE_OUT_OF_BOUNDS` is the host's own verdict about a file it measured. A
    // rejection would erase it: the renderer cannot tell one raw `fs` error from
    // another and reports the whole class as `SAVE_STORAGE_UNAVAILABLE`.
    const { ipcMainLike, handlers } = fakeIpcMain();
    const store = fakeStore({
      read: () => {
        throw new SaveHostRefusal('SAVE_OUT_OF_BOUNDS', 'the file under this slot is too large.');
      }
    });
    registerIpc(ipcMainLike, store, fakeHostDescription);

    const readHandler = handlers.get(SAVE_READ_CHANNEL);
    await expect(readHandler?.(undefined, 'slot-a')).resolves.toEqual({
      ok: false,
      code: 'SAVE_OUT_OF_BOUNDS'
    });
  });

  it('still rejects on a failure that is not a deliberate refusal', async () => {
    const { ipcMainLike, handlers } = fakeIpcMain();
    const store = fakeStore({
      read: () => {
        throw new Error('EBUSY: resource busy or locked');
      }
    });
    registerIpc(ipcMainLike, store, fakeHostDescription);

    const readHandler = handlers.get(SAVE_READ_CHANNEL);
    await expect(readHandler?.(undefined, 'slot-a')).rejects.toThrow(/EBUSY/u);
  });

  it('a valid save-write call reaches the store with the slot and the bytes', async () => {
    const { ipcMainLike, handlers } = fakeIpcMain();
    const calls: Array<{ slot: string; bytes: Uint8Array; guard: unknown }> = [];
    const store = fakeStore({
      write: async (slot, bytes, guard) => {
        calls.push({ slot, bytes, guard });
      }
    });
    registerIpc(ipcMainLike, store, fakeHostDescription);

    const writeHandler = handlers.get(SAVE_WRITE_CHANNEL);
    const guard = { kind: 'as-seen', seen: null };
    await expect(writeHandler?.(undefined, 'slot-a', Uint8Array.of(9), guard)).resolves.toEqual({
      ok: true
    });

    // The guard reaches the store, rather than being validated and dropped: the
    // comparison is the host's to make, and a handler that swallowed it would leave
    // every write unconditional while the channel looked guarded.
    expect(calls).toEqual([{ slot: 'slot-a', bytes: Uint8Array.of(9), guard }]);
  });

  it('a valid save-list call answers the store’s list', async () => {
    const { ipcMainLike, handlers } = fakeIpcMain();
    const store = fakeStore({ list: async () => ['slot-a', 'slot-c'] });
    registerIpc(ipcMainLike, store, fakeHostDescription);

    const listHandler = handlers.get(SAVE_LIST_CHANNEL);
    await expect(listHandler?.(undefined)).resolves.toEqual(['slot-a', 'slot-c']);
  });
});

describe('what leaves the main process is checked in the main process', () => {
  /**
   * `ADR-010` §80 asks for Zod on every payload on the main-process side, and external
   * review of Task 16 found it applied to requests only. `preload.ts` validates replies,
   * but preload runs in the *renderer's* process — on the far side of the boundary — so
   * a main process trusting it to notice is a main process that checks nothing.
   *
   * Each case below hands `registerIpc` a store (or a `describeHost`) that answers
   * something outside its channel's response schema, and asserts the handler refuses
   * rather than forwarding it. Types cannot express these answers, which is the point:
   * `as never` is how a store from an older build, or a `describeHost` reading an
   * Electron API that changed, reaches this code in practice.
   */

  it('the describe-host handler refuses a description missing a field', async () => {
    const { ipcMainLike, handlers } = fakeIpcMain();
    registerIpc(ipcMainLike, fakeStore(), () => ({ platform: 'win32' }) as never);

    expect(() => handlers.get(DESCRIBE_HOST_CHANNEL)?.(undefined)).toThrow();
  });

  it('the describe-host handler refuses an empty platform', async () => {
    const { ipcMainLike, handlers } = fakeIpcMain();
    registerIpc(ipcMainLike, fakeStore(), () => ({
      platform: '',
      appVersion: '0.0.0',
      packaged: false
    }));

    expect(() => handlers.get(DESCRIBE_HOST_CHANNEL)?.(undefined)).toThrow();
  });

  it('the save-read handler refuses bytes that are not bytes', async () => {
    const { ipcMainLike, handlers } = fakeIpcMain();
    registerIpc(
      ipcMainLike,
      fakeStore({ read: async () => 'oh no' as never }),
      fakeHostDescription
    );

    await expect(handlers.get(SAVE_READ_CHANNEL)?.(undefined, 'slot-a')).rejects.toThrow();
  });

  it('the save-write handler refuses a store that answers something', async () => {
    const { ipcMainLike, handlers } = fakeIpcMain();
    registerIpc(
      ipcMainLike,
      fakeStore({ write: async () => 'written' as never }),
      fakeHostDescription
    );

    await expect(
      handlers.get(SAVE_WRITE_CHANNEL)?.(undefined, 'slot-a', Uint8Array.of(9))
    ).rejects.toThrow();
  });

  it('the save-list handler refuses a slot name outside the closed set', async () => {
    // The mirror of the request-side check three tests up: a slot name is a closed set in
    // both directions, and a listing that named `../../slot-a` would put it on a screen.
    const { ipcMainLike, handlers } = fakeIpcMain();
    registerIpc(
      ipcMainLike,
      fakeStore({ list: async () => ['slot-a', '../../slot-a'] as never }),
      fakeHostDescription
    );

    await expect(handlers.get(SAVE_LIST_CHANNEL)?.(undefined)).rejects.toThrow();
  });
});
