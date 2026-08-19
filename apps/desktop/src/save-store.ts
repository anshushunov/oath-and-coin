import { mkdir, open, readdir, readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

import { DESKTOP_SAVE_SLOTS, type DesktopSaveSlot } from './contract';

/**
 * The file-backed save store, the desktop half of `SaveStorePort` (design
 * spec §2.1: "файл через IPC в Electron"). `apps/desktop` cannot import
 * `@oath-and-coin/application` (ADR-010, see `contract.ts`'s own comment on
 * {@link DESKTOP_SAVE_SLOTS}), so `DesktopSaveStore` below is this module's
 * own minimal structural form of the port rather than an implementation of
 * an imported type — the same shape `packages/presentation` already uses for
 * input from the layers above it.
 *
 * A slot lives as two files: `<slot>.save`, the file a reader sees, and
 * `<slot>.save.tmp`, the file a write lands in first. `write()` never opens
 * `<slot>.save` for writing — it writes the temporary file whole, `fsync`s
 * it, closes it, and only then `rename`s it over the target. `rename` on the
 * same filesystem is atomic, so a reader never observes a partially written
 * slot: it sees either the old file or the new one, never bytes in between.
 *
 * **The containing directory is deliberately never `fsync`ed.** Spike B
 * (design spec) measured `fsync` on a directory file descriptor failing with
 * `EPERM` on Windows — Windows has no equivalent of the POSIX "fsync the
 * directory so the rename survives a crash" step. The durability this module
 * promises rests on `rename`'s own atomicity, not on a directory sync this
 * platform refuses to perform; `ADR-006` (Task 16.9) records the same
 * decision for readers who never see this file.
 *
 * **A crash between the temporary file's `close` and its `rename` leaves the
 * temporary file on disk.** `list()` filters by the `.save` suffix rather
 * than reading the directory as-is, precisely so a leftover `.tmp` from an
 * interrupted write is never reported as an occupied slot.
 */

const SAVE_FILE_SUFFIX = '.save';
const TEMP_FILE_SUFFIX = '.save.tmp';

export interface DesktopSaveStore {
  /** A slot's bytes, or `null` if it is empty. */
  read(slot: DesktopSaveSlot): Promise<Uint8Array | null>;
  /** Replaces a slot's contents wholesale and atomically. */
  write(slot: DesktopSaveSlot, bytes: Uint8Array): Promise<void>;
  /** Which slots are occupied, in no particular order. */
  list(): Promise<readonly DesktopSaveSlot[]>;
}

/** Builds the desktop's file-backed save store, rooted at `dir`. */
export function fileSaveStore(dir: string): DesktopSaveStore {
  return {
    read: (slot) => readSaveFile(dir, slot),
    write: (slot, bytes) => writeSaveFileAtomically(dir, slot, bytes),
    list: () => listSaveFiles(dir)
  };
}

async function readSaveFile(dir: string, slot: DesktopSaveSlot): Promise<Uint8Array | null> {
  try {
    const buffer = await readFile(targetPath(dir, slot));
    // A view over the buffer's own bytes, not a `Buffer` subclass instance:
    // callers compare what they read against a plain `Uint8Array`, and a
    // `Buffer`'s extra prototype is not part of what a save's bytes are.
    return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/**
 * A test-only seam, not part of {@link DesktopSaveStore}: the port is what a
 * screen sees, and a screen never needs to fail a write on purpose midway
 * through. `save-store.test.ts` uses this to prove what a failure between the
 * temporary file being written and the `rename` that publishes it leaves
 * behind, without adding a fault-injection hook to the interface every real
 * caller also sees.
 */
export interface WriteHooks {
  /**
   * Called after the temporary file has been written, `fsync`ed and closed,
   * immediately before the `rename` that makes its bytes visible under the
   * slot's name. A hook that throws stops the write there: the `rename`
   * never runs, and the slot's previous contents (if any) are untouched.
   */
  readonly beforeRename?: () => void | Promise<void>;
}

/**
 * Writes `bytes` under `slot`, atomically: `open(tmp,'w')` → `writeFile` →
 * `fsync(fd)` → `close` → `rename(tmp, target)` (design spec §2.1, brief step
 * 4). Exported, rather than kept private to {@link fileSaveStore}, only so
 * `save-store.test.ts` can pass {@link WriteHooks} — the production factory
 * above never does.
 */
export async function writeSaveFileAtomically(
  dir: string,
  slot: DesktopSaveSlot,
  bytes: Uint8Array,
  hooks: WriteHooks = {}
): Promise<void> {
  // The save directory is not guaranteed to exist yet: `list()` and `read()`
  // both tolerate a missing directory (an ENOENT reads as "no saves"), and a
  // fresh install's save directory is exactly that case for its first write.
  await mkdir(dir, { recursive: true });

  const tmp = tempPath(dir, slot);
  const handle = await open(tmp, 'w');
  try {
    await handle.writeFile(bytes);
    // The file's own descriptor, not the directory's — see this module's
    // header comment for why the directory is never `fsync`ed.
    await handle.sync();
  } finally {
    await handle.close();
  }

  await hooks.beforeRename?.();

  await rename(tmp, targetPath(dir, slot));
}

async function listSaveFiles(dir: string): Promise<readonly DesktopSaveSlot[]> {
  let entries: readonly string[];
  try {
    entries = await readdir(dir);
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  const slots: DesktopSaveSlot[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(SAVE_FILE_SUFFIX)) {
      // Skips `<slot>.save.tmp` — a crash-interrupted write's leftover — and
      // anything else this store did not itself produce.
      continue;
    }

    const candidate = entry.slice(0, -SAVE_FILE_SUFFIX.length);
    if (isDesktopSaveSlot(candidate)) {
      slots.push(candidate);
    }
  }

  return slots;
}

/**
 * The same defensive stance `apps/web/src/save/indexeddb-store.ts` takes over
 * an IndexedDB key: a file in this directory that this store did not itself
 * write — a fixture seeded directly for a test, a stray file a player placed
 * by hand — is not something `list()` should hand back as a slot without
 * having checked.
 */
function isDesktopSaveSlot(value: string): value is DesktopSaveSlot {
  return (DESKTOP_SAVE_SLOTS as readonly string[]).includes(value);
}

function targetPath(dir: string, slot: DesktopSaveSlot): string {
  return join(dir, `${slot}${SAVE_FILE_SUFFIX}`);
}

function tempPath(dir: string, slot: DesktopSaveSlot): string {
  return join(dir, `${slot}${TEMP_FILE_SUFFIX}`);
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
