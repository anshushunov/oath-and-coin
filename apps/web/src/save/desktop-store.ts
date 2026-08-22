import { type SaveSlot, type SaveStorePort, type SlotGuard } from '@oath-and-coin/application';
import { SaveErrorCodes, SaveReadError, type SaveErrorCode } from '@oath-and-coin/content';

import { requireStorableSize } from './save-size.ts';

/**
 * The renderer's `SaveStorePort` for the desktop build — a thin, validating
 * wrapper over `window.desktop`, the surface `apps/desktop/src/preload.ts`
 * exposes through `contextBridge` (design spec §2.1: "файл через IPC в
 * Electron").
 *
 * `apps/web` may not import `apps/desktop` — `renderer-must-not-import-the-host`
 * in `.dependency-cruiser.cjs` exists precisely because an import that way would
 * pull Electron into a bundle that also has to run in a plain Chromium. So
 * {@link DesktopSaveApi} below is this module's own minimal structural form of
 * the three methods it actually calls, not a copy of `preload.ts`'s own
 * `DesktopApi` type — the same stance `packages/presentation`'s doc comment
 * already states for input arriving from the layers above it.
 *
 * Every failure below — `window.desktop` missing or shaped wrong, an IPC call
 * itself rejecting — surfaces as `SaveErrorCodes.StorageUnavailable`, the same
 * code `indexeddb-store.ts` uses for its own unavailable-store cases: from a
 * save-slots screen's point of view, "the desktop store could not be reached"
 * and "the browser store could not be reached" are the same kind of failure,
 * and there is no more specific code in the refusal table for either.
 *
 * **None of the three wraps repeat the underlying error's own message.** An
 * IPC rejection from `apps/desktop/src/save-store.ts` carries a raw Node `fs`
 * error, and that message always embeds the absolute path involved — under
 * `AppData\Roaming`, which spells out the local Windows username. This module
 * writes its own, fixed description instead, the same stance
 * `indexeddb-store.ts` already takes toward `tx.error` (see that module's own
 * comment): a message this module did not write itself is not one it repeats
 * to whatever shows a screen's refusal text.
 */
interface DesktopSaveApi {
  readSave(slot: SaveSlot): Promise<DesktopReadReply>;
  writeSave(slot: SaveSlot, bytes: Uint8Array, guard: SlotGuard): Promise<DesktopWriteReply>;
  listSaves(): Promise<readonly SaveSlot[]>;
}

/**
 * What the two save channels answer — the result, or a refusal the host made on purpose.
 *
 * The second arm exists because "the store could not be reached" is the wrong thing
 * to tell a player about a file the host read the size of perfectly well and declined
 * to load, or a slot it found holding a campaign nobody was shown.
 * `apps/desktop/src/contract.ts` declares the codes; this module states the
 * shape structurally for the reason its header gives, and
 * `tests/architecture/save-refusal-codes-agreement.test.ts` holds the two lists
 * together.
 */
type DesktopRefused = { readonly ok: false; readonly code: SaveErrorCode };

type DesktopReadReply = { readonly ok: true; readonly bytes: Uint8Array | null } | DesktopRefused;

type DesktopWriteReply = { readonly ok: true } | DesktopRefused;

/** Builds the desktop build's `SaveStorePort`, over `window.desktop`. */
export function desktopSaveStore(): SaveStorePort {
  return {
    read: (slot) => read(slot),
    write: (slot, bytes, guard) => write(slot, bytes, guard),
    list: () => list()
  };
}

async function read(slot: SaveSlot): Promise<Uint8Array | null> {
  let reply: DesktopReadReply;

  try {
    reply = await desktopApi().readSave(slot);
  } catch {
    throw storageUnavailable(`reading slot '${slot}' through window.desktop failed.`);
  }

  if (!reply.ok) {
    throw hostRefusal(slot, 'read', reply.code);
  }

  return reply.bytes;
}

async function write(slot: SaveSlot, bytes: Uint8Array, guard: SlotGuard): Promise<void> {
  // The same ceiling the IndexedDB store applies, and applied here for a second reason
  // beyond symmetry: past it, `apps/desktop`'s own Zod schema rejects the payload in the
  // main process, and the rejection arrives back here as a bare IPC failure that the
  // `catch` below would report as `SAVE_STORAGE_UNAVAILABLE` — the storage blamed for a
  // payload's size. Refusing first gives the same `SAVE_OUT_OF_BOUNDS` a browser gives.
  requireStorableSize(slot, bytes);

  let reply: DesktopWriteReply;

  try {
    reply = await desktopApi().writeSave(slot, bytes, guard);
  } catch {
    throw storageUnavailable(`writing slot '${slot}' through window.desktop failed.`);
  }

  if (!reply.ok) {
    throw hostRefusal(slot, 'write', reply.code);
  }
}

/**
 * The host's own code, kept rather than folded into the `catch` beside it. The detail is
 * this module's own text, for the reason its header gives — but the *code* is the host's
 * answer, and it is the one thing the renderer could not have worked out for itself.
 */
function hostRefusal(slot: SaveSlot, action: 'read' | 'write', code: SaveErrorCode): SaveReadError {
  return new SaveReadError(code, `the desktop host refused to ${action} slot '${slot}'.`);
}

async function list(): Promise<readonly SaveSlot[]> {
  try {
    return await desktopApi().listSaves();
  } catch {
    throw storageUnavailable('listing occupied slots through window.desktop failed.');
  }
}

/**
 * `window.desktop`, checked rather than assumed. `choose-store.ts` already
 * decides between this store and the IndexedDB one by the same presence
 * check, so a caller reaching this module should always find it — this guard
 * is what turns "reached anyway, from a build where it should not be
 * possible" into the same `SAVE_STORAGE_UNAVAILABLE` a real IPC failure
 * produces, rather than a raw `TypeError` from calling a method a stray value
 * does not have.
 */
function desktopApi(): DesktopSaveApi {
  const candidate = (globalThis as { desktop?: unknown }).desktop;
  if (!isDesktopSaveApi(candidate)) {
    throw storageUnavailable('window.desktop is not the desktop save API this build expects.');
  }
  return candidate;
}

function isDesktopSaveApi(value: unknown): value is DesktopSaveApi {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<DesktopSaveApi>;
  return (
    typeof candidate.readSave === 'function' &&
    typeof candidate.writeSave === 'function' &&
    typeof candidate.listSaves === 'function'
  );
}

function storageUnavailable(detail: string): SaveReadError {
  return new SaveReadError(SaveErrorCodes.StorageUnavailable, detail);
}
