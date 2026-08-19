import { randomUUID } from 'node:crypto';
import { mkdir, open, readdir, readFile, rename, unlink } from 'node:fs/promises';
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
 * A slot lives as one file the reader sees, `<slot>.save`. `write()` never
 * opens that file for writing: it writes a *uniquely named* temporary file
 * whole, `fsync`s it, closes it, and only then `rename`s it over the target.
 * `rename` on the same filesystem is atomic, so a reader never observes a
 * partially written slot: it sees either the old file or the new one, never
 * bytes in between.
 *
 * **The temporary file's name is unique per write, not per slot.** An
 * external review of an earlier version of this module — which used a fixed
 * `<slot>.save.tmp` name — reproduced real corruption from it directly: two
 * concurrent writes to the same slot both `open(tmp,'w')` the *same* path,
 * which truncates whatever the other write had already put there, and the
 * measured outcome across 12 runs was 10 raw `ENOENT`s (the second `rename`
 * finding its own temporary file already moved away by the first) and, twice,
 * **a caller told "saved" while the file on disk held a byte-for-byte mix of
 * both payloads** — exactly the corruption this module's docblock promises
 * cannot happen. `tempPath` below now includes the process id and a random
 * UUID, so two writes never share a temporary file regardless of timing.
 *
 * **Writes to the same slot are also serialized**, through
 * {@link enqueueSlotWrite}. Unique temporary names alone stop corruption, but
 * two truly concurrent writes to one slot would still let an older write's
 * `rename` land after a newer one's — the caller that asked second would
 * silently lose. Serializing per slot makes call order and publish order the
 * same thing.
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
 * interrupted write is never reported as an occupied slot; `write()` also
 * makes a best-effort attempt to delete its own temporary file if anything
 * after it fails, so the ordinary failure path does not leave litter behind
 * even though a hard crash still can.
 */

const SAVE_FILE_SUFFIX = '.save';

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
    write: (slot, bytes) => enqueueSlotWrite(dir, slot, bytes),
    list: () => listSaveFiles(dir)
  };
}

/**
 * A test-only seam, the read-side equivalent of {@link WriteHooks}: lets
 * `save-store.test.ts` simulate the transient `EPERM`/`EBUSY` a read can hit
 * on Windows when it lands during another process's `rename`, without an
 * actual race — nothing in `fileSaveStore` ever supplies this.
 */
export interface ReadHooks {
  readonly readFile?: (path: string) => Promise<Buffer>;
}

/**
 * The Windows error codes a read can transiently see when it overlaps a
 * `rename` in flight — measured to be worth naming rather than folded into a
 * generic retry-on-anything, because `ENOENT` (the file genuinely does not
 * exist) is handled separately, on purpose, as "no save here" rather than
 * retried.
 */
const TRANSIENT_READ_CODES: ReadonlySet<string> = new Set(['EPERM', 'EBUSY']);
const READ_RETRY_ATTEMPTS = 5;
const READ_RETRY_DELAY_MS = 10;

export async function readSaveFile(
  dir: string,
  slot: DesktopSaveSlot,
  hooks: ReadHooks = {}
): Promise<Uint8Array | null> {
  const readImpl = hooks.readFile ?? ((path: string) => readFile(path));
  const path = targetPath(dir, slot);

  for (let attempt = 1; ; attempt += 1) {
    try {
      const buffer = await readImpl(path);
      // A view over the buffer's own bytes, not a `Buffer` subclass instance:
      // callers compare what they read against a plain `Uint8Array`, and a
      // `Buffer`'s extra prototype is not part of what a save's bytes are.
      return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    } catch (error) {
      if (isErrnoException(error) && error.code === 'ENOENT') {
        return null;
      }

      const transient = isErrnoException(error) && TRANSIENT_READ_CODES.has(error.code ?? '');
      if (!transient || attempt >= READ_RETRY_ATTEMPTS) {
        throw error;
      }
      await delay(READ_RETRY_DELAY_MS);
    }
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
 * One promise chain per `(dir, slot)` pair, so that two writes to the same
 * slot run one after the other rather than racing — see this module's
 * header comment. Keyed on the pair rather than on `slot` alone because two
 * `fileSaveStore` instances rooted at different directories (as the test
 * suite's temporary directories are) must not serialize against each other.
 */
const slotWriteQueues = new Map<string, Promise<unknown>>();

/**
 * Exported, unlike most of this module's internals, so `save-store.test.ts`
 * can prove the serialization itself: called with {@link WriteHooks} on one
 * write and not the other, it can force which write's disk work finishes
 * first while still going through the same queue every real `write()` call
 * does — `fileSaveStore`'s own `write` calls this with no hooks, exactly as
 * it always has.
 */
export function enqueueSlotWrite(
  dir: string,
  slot: DesktopSaveSlot,
  bytes: Uint8Array,
  hooks: WriteHooks = {}
): Promise<void> {
  const key = `${dir} ${slot}`;
  const previous = slotWriteQueues.get(key) ?? Promise.resolve();

  // The queue itself must never stop just because one write in it failed —
  // only that write's own caller should see the rejection. `.catch` here
  // swallows a previous failure for the sake of *sequencing* the next write;
  // `result` below is the promise this call's own caller receives, and it is
  // never swallowed.
  const result = previous
    .catch(() => undefined)
    .then(() => writeSaveFileAtomically(dir, slot, bytes, hooks));

  slotWriteQueues.set(
    key,
    result.catch(() => undefined)
  );

  return result;
}

/**
 * Writes `bytes` under `slot`, atomically: `open(tmp,'w')` → `writeFile` →
 * `fsync(fd)` → `close` → `rename(tmp, target)` (design spec §2.1, brief step
 * 4). Exported, rather than kept private to {@link fileSaveStore}, only so
 * `save-store.test.ts` can pass {@link WriteHooks} — the production factory
 * above never does, and always goes through {@link enqueueSlotWrite} instead
 * of calling this directly, so a test exercising this function alone is
 * exercising one write in isolation rather than the serialization above it.
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

  try {
    await hooks.beforeRename?.();
    await rename(tmp, targetPath(dir, slot));
  } catch (error) {
    // Best-effort: the ordinary failure path (the hook throwing in a test, a
    // `rename` that fails) should not leave a temporary file behind for
    // `list()` to have to filter out forever. A failure here — the file
    // already gone, a second concurrent cleanup — is not this write's own
    // failure and must not replace it.
    await unlink(tmp).catch(() => undefined);
    throw error;
  }
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
      // Skips a leftover temporary file — its name never ends in `.save`,
      // unique suffix or not — and anything else this store did not itself
      // produce.
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
 * having checked. `save-store.test.ts` proves this independently of the
 * suffix filter above: a file named `slot-z.save` matches the suffix and
 * still must not be reported, because `slot-z` is not in
 * `DESKTOP_SAVE_SLOTS`.
 */
function isDesktopSaveSlot(value: string): value is DesktopSaveSlot {
  return (DESKTOP_SAVE_SLOTS as readonly string[]).includes(value);
}

function targetPath(dir: string, slot: DesktopSaveSlot): string {
  return join(dir, `${slot}${SAVE_FILE_SUFFIX}`);
}

/**
 * A name no other write, in this process or another, will ever also pick:
 * this process's own pid plus a random UUID, alongside the slot for a
 * human reading the directory. See this module's header comment for the
 * corruption a shared, deterministic name produced under review.
 */
function tempPath(dir: string, slot: DesktopSaveSlot): string {
  return join(dir, `${slot}.${String(process.pid)}.${randomUUID()}${SAVE_FILE_SUFFIX}.tmp`);
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
