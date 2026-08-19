import { type SaveSlot, type SaveStorePort } from '@oath-and-coin/application';
import { SaveErrorCodes, SaveReadError } from '@oath-and-coin/content';

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
 */
interface DesktopSaveApi {
  readSave(slot: SaveSlot): Promise<Uint8Array | null>;
  writeSave(slot: SaveSlot, bytes: Uint8Array): Promise<void>;
  listSaves(): Promise<readonly SaveSlot[]>;
}

/** Builds the desktop build's `SaveStorePort`, over `window.desktop`. */
export function desktopSaveStore(): SaveStorePort {
  return {
    read: (slot) => read(slot),
    write: (slot, bytes) => write(slot, bytes),
    list: () => list()
  };
}

async function read(slot: SaveSlot): Promise<Uint8Array | null> {
  try {
    return await desktopApi().readSave(slot);
  } catch (error) {
    throw storageUnavailable(
      `reading slot '${slot}' through window.desktop failed: ${describe(error)}`
    );
  }
}

async function write(slot: SaveSlot, bytes: Uint8Array): Promise<void> {
  try {
    await desktopApi().writeSave(slot, bytes);
  } catch (error) {
    throw storageUnavailable(
      `writing slot '${slot}' through window.desktop failed: ${describe(error)}`
    );
  }
}

async function list(): Promise<readonly SaveSlot[]> {
  try {
    return await desktopApi().listSaves();
  } catch (error) {
    throw storageUnavailable(
      `listing occupied slots through window.desktop failed: ${describe(error)}`
    );
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

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
