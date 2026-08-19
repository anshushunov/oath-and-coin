import {
  DESCRIBE_HOST_CHANNEL,
  SAVE_LIST_CHANNEL,
  SAVE_READ_CHANNEL,
  SAVE_WRITE_CHANNEL,
  describeHostRequest,
  saveListRequest,
  saveReadRequest,
  saveWriteRequest,
  type HostDescription
} from './contract';
import type { DesktopSaveStore } from './save-store';

/**
 * The four IPC handlers, pulled out of `main.ts` so they can be exercised in
 * Vitest at all.
 *
 * `electron` resolves to a bare string outside a running Electron process —
 * there is no `app`, no `ipcMain`, nothing this module could import and call
 * at load time without crashing under Vitest, which is exactly why `main.ts`
 * itself has never had a test. {@link IpcMainLike} and the injected
 * `describeHost` below are this module's whole answer to that: neither
 * `registerIpc` nor anything it calls ever touches the real `electron`
 * package, so a fake satisfying {@link IpcMainLike} is enough to exercise
 * every handler exactly as `main.ts` registers them.
 */

/**
 * The slice of Electron's `ipcMain` this module actually calls. Declared
 * locally rather than imported from `electron`'s own types, for the reason
 * this file's header gives.
 */
export interface IpcMainLike {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void;
}

/** Registers every channel `apps/desktop` answers (`contract.ts`'s
 * `ALLOWED_CHANNELS`). `ipc.test.ts` checks the two lists against each other
 * from the outside — the allowlist and what this function actually
 * registers — because ADR-010 §80 asks for an allowlist that is one, not a
 * list beside the call sites that may or may not agree with them. */
export function registerIpc(
  ipcMainLike: IpcMainLike,
  store: DesktopSaveStore,
  describeHost: () => HostDescription
): void {
  ipcMainLike.handle(DESCRIBE_HOST_CHANNEL, (_event, ...args: unknown[]) => {
    // Validated even though the method takes nothing: a handler that ignores
    // its arguments accepts anything, and the day it grows a parameter is the
    // day nobody remembers this was the unchecked one.
    describeHostRequest.parse(args);
    return describeHost();
  });

  ipcMainLike.handle(SAVE_READ_CHANNEL, async (_event, ...args: unknown[]) => {
    const [slot] = saveReadRequest.parse(args);
    return store.read(slot);
  });

  ipcMainLike.handle(SAVE_WRITE_CHANNEL, async (_event, ...args: unknown[]) => {
    const [slot, bytes] = saveWriteRequest.parse(args);
    await store.write(slot, bytes);
  });

  ipcMainLike.handle(SAVE_LIST_CHANNEL, async (_event, ...args: unknown[]) => {
    saveListRequest.parse(args);
    return store.list();
  });
}
