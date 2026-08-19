import {
  DESCRIBE_HOST_CHANNEL,
  SAVE_LIST_CHANNEL,
  SAVE_READ_CHANNEL,
  SAVE_WRITE_CHANNEL,
  describeHostRequest,
  describeHostResponse,
  saveListRequest,
  saveListResponse,
  saveReadRequest,
  saveReadResponse,
  saveWriteRequest,
  saveWriteResponse,
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

/**
 * Registers every channel `apps/desktop` answers (`contract.ts`'s
 * `ALLOWED_CHANNELS`). `ipc.test.ts` checks the two lists against each other
 * from the outside — the allowlist and what this function actually
 * registers — because ADR-010 §80 asks for an allowlist that is one, not a
 * list beside the call sites that may or may not agree with them.
 *
 * **Both directions of every channel go through a schema, in this process.**
 * `ADR-010` §80 asks for Zod on every payload on the main-process side, and
 * until external review of Task 16 only the *requests* had it: `read` and
 * `list` returned whatever the store handed back, `write` returned an
 * unvalidated nothing, and `describeHostResponse` was applied inside `main.ts`
 * — outside this registrar, so the injected `describeHost` every test uses went
 * around it. `preload.ts` validates the replies too, and that does not satisfy
 * the requirement: preload runs in the renderer's process, on the far side of
 * the boundary the schema exists to guard, so a main process that answered
 * nonsense would be relying on the untrusted side to notice.
 */
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
    return describeHostResponse.parse(describeHost());
  });

  ipcMainLike.handle(SAVE_READ_CHANNEL, async (_event, ...args: unknown[]) => {
    const [slot] = saveReadRequest.parse(args);
    return saveReadResponse.parse(await store.read(slot));
  });

  ipcMainLike.handle(SAVE_WRITE_CHANNEL, async (_event, ...args: unknown[]) => {
    const [slot, bytes] = saveWriteRequest.parse(args);
    // The empty result is a result: `write` promises the renderer nothing came
    // back, and a store that started answering something would be changing the
    // channel's contract without the contract saying so.
    return saveWriteResponse.parse(await store.write(slot, bytes));
  });

  ipcMainLike.handle(SAVE_LIST_CHANNEL, async (_event, ...args: unknown[]) => {
    saveListRequest.parse(args);
    return saveListResponse.parse(await store.list());
  });
}
