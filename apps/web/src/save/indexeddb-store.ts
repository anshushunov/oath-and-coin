import {
  SAVE_SLOTS,
  slotChanged,
  slotMayBeWritten,
  type SaveSlot,
  type SaveStorePort,
  type SlotGuard
} from '@oath-and-coin/application';
import { SaveErrorCodes, SaveReadError } from '@oath-and-coin/content';

import { requireStorableSize } from './save-size.ts';

/**
 * The browser's `SaveStorePort` — one database, one object store, keyed by slot name
 * (design spec §2.1: "атомарность даёт транзакция").
 *
 * **What jsdom can prove and what it cannot.** IndexedDB does not exist in either
 * Vitest environment this workspace uses — checked directly before writing this file:
 * `typeof globalThis.indexedDB` is `'undefined'` under both `environment: 'node'`
 * (the workspace default) and `environment: 'jsdom'` (what `apps/web`'s DOM-dependent
 * tests opt into per file). `indexeddb-store.test.ts` therefore proves two things with
 * real behaviour — the "no `indexedDB` at all" refusal, exercised directly against
 * this fact rather than a fake — and proves the rest (an empty slot answering `null`,
 * `open` erroring/blocked/throwing, a synchronous throw from `transaction`/`put`, a
 * write transaction's `onerror` and `onabort`) against hand-rolled doubles that
 * implement only the slice of the IndexedDB event protocol this module drives.
 * **Atomicity is not proven here.** A fake transaction's `oncomplete`/`onabort` is the
 * test deciding the outcome in advance, not a real transaction interrupted mid-write;
 * nothing in this package can show that a real, aborted `readwrite` transaction leaves
 * a slot's previous bytes untouched. That is `tests/e2e/save-slots.spec.ts`'s "a write
 * that is interrupted halfway" (Task 16.8), which exists: against a live Chromium, with
 * this module running exactly as it ships, and with `IDBObjectStore.prototype.put`
 * replaced so that the transaction opened below aborts itself after the write is queued.
 *
 * **Why the refusal never repeats `tx.error`.** Spike A (design spec §1.5) measured a
 * live Chromium after an explicit `abort()`: `tx.error` is `null`. There is nothing in
 * the transaction to quote, so every refusal below is `SaveErrorCodes.StorageUnavailable`
 * with a message this module writes itself, never one built from `tx.error` or
 * `request.error`.
 *
 * **Every IndexedDB call this module makes is guarded, not just `indexedDB.open`.**
 * `db.transaction(...)`, `.objectStore(...)` and a request method (`get`/`put`/
 * `getAllKeys`) are ordinary synchronous calls that can throw — a `NotFoundError` for
 * a store that isn't there, an `InvalidStateError` for a transaction that already
 * finished. A throw from inside a `new Promise` executor rejects with the raw
 * exception, bypassing `storageUnavailable()` entirely; every such call below is
 * wrapped in its own `try`/`catch` so that never happens.
 */

const DATABASE_NAME = 'oath-and-coin-saves';
const DATABASE_VERSION = 1;
const STORE_NAME = 'slots';

/** Builds the browser's `SaveStorePort`, backed by IndexedDB. */
export function createIndexedDbSaveStore(): SaveStorePort {
  return {
    read: (slot) => read(slot),
    write: (slot, bytes, guard) => write(slot, bytes, guard),
    list: () => list()
  };
}

async function read(slot: SaveSlot): Promise<Uint8Array | null> {
  const db = await openDatabase();
  try {
    return await new Promise<Uint8Array | null>((resolve, reject) => {
      let request: IDBRequest;
      try {
        request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(slot);
      } catch (error) {
        reject(storageUnavailable(`starting a read of slot '${slot}' failed: ${describe(error)}`));
        return;
      }

      request.onsuccess = () => {
        const value: unknown = request.result;
        if (value === undefined) {
          resolve(null);
          return;
        }
        // A key check stands over `list()`'s output for the same reason this
        // stands over a value: the object store's contents are not this
        // module's alone to answer for. A fixture seeded directly for a test
        // (Task 16.8 does exactly this) or a database opened by an older
        // build could hold anything under a valid slot key, and casting it to
        // `Uint8Array` without looking would hand a caller bytes that are not
        // bytes.
        if (!isSaveBytes(value)) {
          reject(storageUnavailable(`slot '${slot}' holds a value that is not save bytes.`));
          return;
        }
        resolve(value);
      };
      request.onerror = () => {
        reject(storageUnavailable(`reading slot '${slot}' failed.`));
      };
    });
  } finally {
    db.close();
  }
}

async function write(slot: SaveSlot, bytes: Uint8Array, guard: SlotGuard): Promise<void> {
  // Before the database is even opened: the ceiling is a property of the port
  // (`MAX_SAVE_BYTES` in `packages/application`), not of IndexedDB, and refusing here
  // means the browser and the desktop host answer the same call the same way. See
  // `save-size.ts` for the divergence external review measured.
  requireStorableSize(slot, bytes);

  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      let tx: IDBTransaction;
      try {
        tx = db.transaction(STORE_NAME, 'readwrite');
      } catch (error) {
        reject(
          storageUnavailable(
            `starting a write transaction for slot '${slot}' failed: ${describe(error)}`
          )
        );
        return;
      }

      // One `readwrite` transaction, and the slot's whole write happens inside it:
      // the transaction is what makes this atomic, not the order these lines run
      // in. `oncomplete`/`onabort`/`onerror` — not the `put` request's own
      // `onsuccess` — is what this waits on, because a request can succeed and its
      // transaction can still abort afterward (a later request in the same
      // transaction failing, a quota error at commit time); only the
      // transaction's own outcome is the one this port promises.
      //
      // `onerror` is not a defensive extra beside `onabort`: IndexedDB fires
      // `error` on the transaction *before* it aborts, for an unhandled request
      // error propagating up — that is the common case a failing `put` actually
      // takes. An explicit `abort()` with no failing request is the narrower
      // case, and fires only `onabort`. Both are wired, and because a settled
      // promise ignores every later `resolve`/`reject` call, whichever the real
      // browser fires first is the message this throws — no extra bookkeeping
      // needed to prefer one over the other.
      tx.oncomplete = () => {
        resolve();
      };
      tx.onerror = () => {
        reject(storageUnavailable(`writing slot '${slot}' failed.`));
      };
      tx.onabort = () => {
        reject(storageUnavailable(`writing slot '${slot}' was aborted.`));
      };

      // **The guard is read inside this same transaction**, and that is the whole
      // of what makes it a compare-and-swap rather than a check with a gap after
      // it. A `read()` here followed by a `write()` there would leave exactly the
      // window the guard exists to close — another tab writing between the two —
      // and IndexedDB's own isolation is what removes it: nothing else touches
      // this object store while this `readwrite` transaction is open.
      //
      // A refusal `abort()`s as well as rejecting: the abort is how the slot is
      // *left as it was found*, which is the other half of the promise, and the
      // rejection has to come first — `onabort` above would otherwise settle this
      // promise as an unavailable store, which is precisely the wrong thing to
      // tell a player about a store that answered perfectly.
      try {
        const store = tx.objectStore(STORE_NAME);
        const current = store.get(slot);

        current.onsuccess = () => {
          if (!slotMayBeWritten(guard, current.result)) {
            reject(slotChanged(slot));
            tx.abort();
            return;
          }

          try {
            store.put(bytes, slot);
          } catch (error) {
            reject(storageUnavailable(`writing slot '${slot}' failed: ${describe(error)}`));
          }
        };
        current.onerror = () => {
          reject(storageUnavailable(`reading slot '${slot}' before writing it failed.`));
        };
      } catch (error) {
        reject(storageUnavailable(`writing slot '${slot}' failed: ${describe(error)}`));
      }
    });
  } finally {
    db.close();
  }
}

async function list(): Promise<readonly SaveSlot[]> {
  const db = await openDatabase();
  try {
    const keys = await new Promise<readonly IDBValidKey[]>((resolve, reject) => {
      let request: IDBRequest<IDBValidKey[]>;
      try {
        request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAllKeys();
      } catch (error) {
        reject(storageUnavailable(`starting a list of occupied slots failed: ${describe(error)}`));
        return;
      }

      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        reject(storageUnavailable('listing occupied slots failed.'));
      };
    });

    return keys.filter(isSaveSlot);
  } finally {
    db.close();
  }
}

/**
 * A defensive filter, not a defect worked around: `write()` only ever keys a `put`
 * by a `SaveSlot`, so every key this store itself produced already satisfies this.
 * It stands here anyway because the object store's keys are not this module's alone
 * to answer for — a fixture seeded directly for a test, or a database opened by an
 * older build, is not something `list()` should hand a caller as if it were a
 * `SaveSlot` without having checked.
 */
function isSaveSlot(key: IDBValidKey): key is SaveSlot {
  return typeof key === 'string' && (SAVE_SLOTS as readonly string[]).includes(key);
}

/** The same defensive stance as {@link isSaveSlot}, over a slot's value rather than its key. */
function isSaveBytes(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array;
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof globalThis.indexedDB === 'undefined') {
    return Promise.reject(
      storageUnavailable("this environment's globalThis.indexedDB is not available.")
    );
  }

  const factory = globalThis.indexedDB;

  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(DATABASE_NAME, DATABASE_VERSION);
    } catch (error) {
      reject(
        storageUnavailable(`indexedDB.open threw before returning a request: ${describe(error)}`)
      );
      return;
    }

    // `onblocked` is not terminal: the connection blocking this `open` can still
    // close on its own, letting this same request go on to fire `onsuccess`
    // later. By then this promise has already rejected and its caller has moved
    // on, so a database arriving after that is closed here rather than resolved
    // into — leaving it open would hold every future `versionchange` hostage for
    // good.
    let settled = false;

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => {
      if (settled) {
        request.result.close();
        return;
      }
      settled = true;
      resolve(request.result);
    };
    request.onblocked = () => {
      settled = true;
      reject(
        storageUnavailable('indexedDB.open is blocked by another open connection to this database.')
      );
    };
    request.onerror = () => {
      if (settled) {
        return;
      }
      settled = true;
      reject(storageUnavailable('indexedDB.open failed to open the save database.'));
    };
  });
}

function storageUnavailable(detail: string): SaveReadError {
  return new SaveReadError(SaveErrorCodes.StorageUnavailable, detail);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
