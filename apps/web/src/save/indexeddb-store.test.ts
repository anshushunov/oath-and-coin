import { SAVE_SLOTS, UNCHECKED_SLOT, type SaveSlot } from '@oath-and-coin/application';
import { SaveReadError } from '@oath-and-coin/content';
import { afterEach, describe, expect, it } from 'vitest';

import { createIndexedDbSaveStore } from './indexeddb-store.ts';

/**
 * What this file proves and what it deliberately does not (Task 16.5, brief step 2).
 *
 * jsdom has no IndexedDB at all — `typeof globalThis.indexedDB` is `'undefined'` in
 * both the `node` and the `jsdom` Vitest environments this workspace has (checked by
 * hand before writing this file; `indexeddb-store.ts`'s own header records the same
 * fact). So there is no live IndexedDB here to exercise, and two things follow:
 *
 * - the "no `indexedDB` at all" branch is not a fake, it is simply this environment,
 *   exercised directly;
 * - everything past that branch needs a stand-in, so the fakes below (`FakeRequest`,
 *   `FakeObjectStore`, `FakeTransaction`, `FakeDatabase`) implement only the sliver of
 *   the IndexedDB event protocol `indexeddb-store.ts` actually drives — `open` and its
 *   `onupgradeneeded`/`onsuccess`/`onerror`/`onblocked`, a transaction's
 *   `oncomplete`/`onabort`/`onerror`, a store's `get`/`put`/`getAllKeys`, and a
 *   synchronous throw from `transaction`/`objectStore`/`put`. They are hand-rolled
 *   test doubles, not a spec-compliant IndexedDB, and they prove how this module
 *   reacts to each event the real one can fire — not that the real one fires them the
 *   way these fakes choose to.
 *
 * What is proven here: the shape of refusal when the store is unavailable (no
 * `indexedDB`, `open` erroring/blocked/throwing, a synchronous throw from
 * `transaction`/`put`, a write transaction's `onerror` and `onabort`), that reading an
 * unoccupied slot answers `null` rather than throwing, that a value under an occupied
 * key that is not save bytes is refused rather than cast blindly, and that a
 * connection arriving after `onblocked` already rejected is closed rather than leaked.
 *
 * What is **not** proven here: atomicity. A fake transaction's `oncomplete`/`onabort`
 * is this test file deciding the outcome up front, not two writers racing and one
 * losing — nothing here can show that a real, interrupted `readwrite` transaction
 * leaves a slot's previous bytes intact. That is `tests/e2e/save-slots.spec.ts`'s "a
 * write that is interrupted halfway" (Task 16.8), which exists: in a live Chromium, with
 * this store running exactly as it ships, `IDBObjectStore.prototype.put` is replaced so
 * the transaction the store opened aborts itself after the write is queued, and the
 * seeded save is read back byte for byte afterwards.
 */

afterEach(() => {
  delete (globalThis as { indexedDB?: IDBFactory }).indexedDB;
});

class FakeRequest<T> {
  result: T | undefined;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;

  succeed(result: T): void {
    this.result = result;
    this.onsuccess?.();
  }

  fail(): void {
    this.onerror?.();
  }
}

/** Everything about a fake's behaviour that varies from test to test, in one place. */
interface FakeBehavior {
  readonly writeOutcome: 'complete' | 'abort' | 'error-then-abort';
  readonly readOutcome: 'success' | 'error';
  readonly transactionThrows: boolean;
  readonly putThrows: boolean;
}

const DEFAULT_BEHAVIOR: FakeBehavior = {
  writeOutcome: 'complete',
  readOutcome: 'success',
  transactionThrows: false,
  putThrows: false
};

class FakeObjectStore {
  private readonly values: Map<SaveSlot, Uint8Array>;
  private readonly onWrite: ((value: Uint8Array, key: SaveSlot) => void) | null;
  private readonly behavior: FakeBehavior;

  constructor(
    values: Map<SaveSlot, Uint8Array>,
    onWrite: ((value: Uint8Array, key: SaveSlot) => void) | null,
    behavior: FakeBehavior
  ) {
    this.values = values;
    this.onWrite = onWrite;
    this.behavior = behavior;
  }

  get(key: SaveSlot): FakeRequest<Uint8Array | undefined> {
    const request = new FakeRequest<Uint8Array | undefined>();
    queueMicrotask(() => {
      if (this.behavior.readOutcome === 'error') {
        request.fail();
      } else {
        request.succeed(this.values.get(key));
      }
    });
    return request;
  }

  put(value: Uint8Array, key: SaveSlot): FakeRequest<SaveSlot> {
    if (this.behavior.putThrows) {
      // Real cause: `put` called after its transaction already finished
      // (`InvalidStateError`), or a value that fails structured clone.
      throw new DOMException("failed to execute 'put' on 'IDBObjectStore'", 'InvalidStateError');
    }
    // A real store's `put` lands inside its transaction; whether the transaction
    // as a whole completes or aborts is `FakeTransaction`'s call, made below,
    // exactly like the real thing (spike A: `abort()` is the transaction's).
    this.onWrite?.(value, key);
    const request = new FakeRequest<SaveSlot>();
    queueMicrotask(() => request.succeed(key));
    return request;
  }

  getAllKeys(): FakeRequest<readonly SaveSlot[]> {
    const request = new FakeRequest<readonly SaveSlot[]>();
    queueMicrotask(() => {
      if (this.behavior.readOutcome === 'error') {
        request.fail();
      } else {
        request.succeed([...this.values.keys()]);
      }
    });
    return request;
  }
}

class FakeTransaction {
  oncomplete: (() => void) | null = null;
  onabort: (() => void) | null = null;
  onerror: (() => void) | null = null;

  /**
   * Spike A (design spec §1.5): a live Chromium's `tx.error` is `null` after an
   * explicit `abort()`. Set here, not left `undefined`, so a test can prove
   * `indexeddb-store.ts` never reads this field for its rejection message.
   */
  readonly error: null = null;

  private readonly values: Map<SaveSlot, Uint8Array>;
  private readonly writable: boolean;
  private readonly behavior: FakeBehavior;

  constructor(
    values: Map<SaveSlot, Uint8Array>,
    mode: 'readonly' | 'readwrite',
    behavior: FakeBehavior
  ) {
    this.values = values;
    this.writable = mode === 'readwrite';
    this.behavior = behavior;
  }

  objectStore(): FakeObjectStore {
    return new FakeObjectStore(
      this.values,
      this.writable ? (value, key) => this.settleWrite(value, key) : null,
      this.behavior
    );
  }

  private settleWrite(value: Uint8Array, key: SaveSlot): void {
    queueMicrotask(() => {
      if (this.behavior.writeOutcome === 'complete') {
        // A real, committed transaction is what makes a put durable; an aborted
        // one leaves the store exactly as it was, which is why this only
        // happens on the 'complete' branch.
        this.values.set(key, value);
        this.oncomplete?.();
      } else if (this.behavior.writeOutcome === 'abort') {
        this.onabort?.();
      } else {
        // IndexedDB fires `error` on the transaction *before* it aborts, for an
        // unhandled request error propagating up — the common case, and the one
        // `onabort` alone (the 'abort' outcome above, which models an explicit
        // `abort()` call with no failing request) does not reproduce.
        this.onerror?.();
        this.onabort?.();
      }
    });
  }
}

class FakeDatabase {
  readonly objectStoreNames = { contains: (): boolean => true };
  closeCalls = 0;

  private readonly values: Map<SaveSlot, Uint8Array>;
  private readonly behavior: FakeBehavior;

  constructor(values: Map<SaveSlot, Uint8Array>, behavior: FakeBehavior) {
    this.values = values;
    this.behavior = behavior;
  }

  createObjectStore(): void {
    // Nothing to build: `values` already exists.
  }

  close(): void {
    this.closeCalls += 1;
  }

  transaction(_storeName: string, mode: 'readonly' | 'readwrite'): FakeTransaction {
    if (this.behavior.transactionThrows) {
      // Real cause: the named object store doesn't exist, or the connection was
      // closed after a `versionchange` completed elsewhere.
      throw new DOMException("no such object store: 'slots'", 'NotFoundError');
    }
    return new FakeTransaction(this.values, mode, this.behavior);
  }
}

type OpenOutcome = 'success' | 'error' | 'blocked' | 'blocked-then-success' | 'throw';

function installFakeIndexedDb(
  options: {
    readonly open: OpenOutcome;
    readonly values?: Map<SaveSlot, Uint8Array>;
  } & Partial<FakeBehavior>
): { database: () => FakeDatabase | undefined } {
  const values = options.values ?? new Map<SaveSlot, Uint8Array>();
  const behavior: FakeBehavior = {
    writeOutcome: options.writeOutcome ?? DEFAULT_BEHAVIOR.writeOutcome,
    readOutcome: options.readOutcome ?? DEFAULT_BEHAVIOR.readOutcome,
    transactionThrows: options.transactionThrows ?? DEFAULT_BEHAVIOR.transactionThrows,
    putThrows: options.putThrows ?? DEFAULT_BEHAVIOR.putThrows
  };

  let lastDatabase: FakeDatabase | undefined;

  const succeed = (request: {
    result: FakeDatabase | undefined;
    onupgradeneeded: (() => void) | null;
    onsuccess: (() => void) | null;
  }): void => {
    const db = new FakeDatabase(values, behavior);
    lastDatabase = db;
    request.result = db;
    request.onupgradeneeded?.();
    request.onsuccess?.();
  };

  const fakeFactory: Pick<IDBFactory, 'open'> = {
    open(): IDBOpenDBRequest {
      if (options.open === 'throw') {
        throw new Error('fake: indexedDB.open threw synchronously');
      }

      const request = {
        result: undefined as FakeDatabase | undefined,
        onupgradeneeded: null as (() => void) | null,
        onsuccess: null as (() => void) | null,
        onerror: null as (() => void) | null,
        onblocked: null as (() => void) | null
      };

      queueMicrotask(() => {
        if (options.open === 'error') {
          request.onerror?.();
          return;
        }
        if (options.open === 'blocked') {
          request.onblocked?.();
          return;
        }
        if (options.open === 'blocked-then-success') {
          // `onblocked` is not terminal (finding 3): the same request can still
          // go on to fire `onsuccess` later, once whatever blocked it closes.
          request.onblocked?.();
          queueMicrotask(() => succeed(request));
          return;
        }
        succeed(request);
      });

      return request as unknown as IDBOpenDBRequest;
    }
  };

  (globalThis as { indexedDB?: IDBFactory }).indexedDB = fakeFactory as IDBFactory;

  return { database: () => lastDatabase };
}

/** Lets every currently-queued microtask (including ones a fake schedules from
 * inside another microtask, e.g. the deferred `onsuccess` after `onblocked`)
 * run before the test inspects a side effect. A macrotask boundary, not another
 * microtask, so it is guaranteed to run after the whole microtask queue drains. */
async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('when this environment has no indexedDB at all', () => {
  it('refuses read, write and list with SAVE_STORAGE_UNAVAILABLE', async () => {
    const store = createIndexedDbSaveStore();

    await expect(store.read('slot-a')).rejects.toThrow(/SAVE_STORAGE_UNAVAILABLE/u);
    await expect(store.write('slot-a', Uint8Array.of(1), UNCHECKED_SLOT)).rejects.toThrow(
      /SAVE_STORAGE_UNAVAILABLE/u
    );
    await expect(store.list()).rejects.toThrow(/SAVE_STORAGE_UNAVAILABLE/u);
  });

  it('rejects with SaveReadError, not a plain Error', async () => {
    const store = createIndexedDbSaveStore();

    await expect(store.read('slot-a')).rejects.toBeInstanceOf(SaveReadError);
  });

  it('names the missing global itself, rather than letting `factory.open` fail on it', async () => {
    // Pins the specific message this branch produces, not just the code: without
    // this, deleting the early `typeof globalThis.indexedDB === 'undefined'` check
    // in `openDatabase` is a green mutant — the `try`/`catch` around `factory.open`
    // still turns the resulting `TypeError` (reading `.open` of `undefined`) into
    // the same `SAVE_STORAGE_UNAVAILABLE` code, just with a message that names a
    // property read this module never chose to make part of its contract.
    const store = createIndexedDbSaveStore();

    await expect(store.read('slot-a')).rejects.toThrow(/globalThis\.indexedDB is not available/u);
  });
});

describe('when indexedDB.open itself refuses', () => {
  it('reports SAVE_STORAGE_UNAVAILABLE when the open request errors', async () => {
    installFakeIndexedDb({ open: 'error' });
    const store = createIndexedDbSaveStore();

    await expect(store.read('slot-a')).rejects.toThrow(/SAVE_STORAGE_UNAVAILABLE/u);
  });

  it('reports SAVE_STORAGE_UNAVAILABLE when the open request is blocked', () => {
    installFakeIndexedDb({ open: 'blocked' });
    const store = createIndexedDbSaveStore();

    return expect(store.list()).rejects.toThrow(/SAVE_STORAGE_UNAVAILABLE/u);
  });

  it('reports SAVE_STORAGE_UNAVAILABLE when open throws synchronously', async () => {
    installFakeIndexedDb({ open: 'throw' });
    const store = createIndexedDbSaveStore();

    await expect(store.write('slot-a', Uint8Array.of(1), UNCHECKED_SLOT)).rejects.toThrow(
      /SAVE_STORAGE_UNAVAILABLE/u
    );
  });

  it('closes a connection that arrives after `onblocked` already rejected, instead of leaking it', async () => {
    const { database } = installFakeIndexedDb({ open: 'blocked-then-success' });
    const store = createIndexedDbSaveStore();

    await expect(store.read('slot-a')).rejects.toThrow(/SAVE_STORAGE_UNAVAILABLE/u);
    await flushMicrotasks();

    expect(database()?.closeCalls).toBe(1);
  });
});

describe('when the database itself throws synchronously (a missing object store, a dead connection)', () => {
  // Reproduces the shape review measured directly: a fake whose `db.transaction()`
  // throws `DOMException('NotFoundError')` — what a real IndexedDB does for a
  // missing store or a connection closed after `versionchange` — must not let that
  // exception past `storageUnavailable()` in any of the three methods.
  it('read() reports SAVE_STORAGE_UNAVAILABLE rather than the raw DOMException', async () => {
    installFakeIndexedDb({ open: 'success', transactionThrows: true });
    const store = createIndexedDbSaveStore();

    await expect(store.read('slot-a')).rejects.toBeInstanceOf(SaveReadError);
    await expect(store.read('slot-a')).rejects.toThrow(/SAVE_STORAGE_UNAVAILABLE/u);
  });

  it('write() reports SAVE_STORAGE_UNAVAILABLE rather than the raw DOMException', async () => {
    installFakeIndexedDb({ open: 'success', transactionThrows: true });
    const store = createIndexedDbSaveStore();

    await expect(store.write('slot-a', Uint8Array.of(1), UNCHECKED_SLOT)).rejects.toBeInstanceOf(
      SaveReadError
    );
    await expect(store.write('slot-a', Uint8Array.of(1), UNCHECKED_SLOT)).rejects.toThrow(
      /SAVE_STORAGE_UNAVAILABLE/u
    );
  });

  it('list() reports SAVE_STORAGE_UNAVAILABLE rather than the raw DOMException', async () => {
    installFakeIndexedDb({ open: 'success', transactionThrows: true });
    const store = createIndexedDbSaveStore();

    await expect(store.list()).rejects.toBeInstanceOf(SaveReadError);
    await expect(store.list()).rejects.toThrow(/SAVE_STORAGE_UNAVAILABLE/u);
  });

  it('write() also reports SAVE_STORAGE_UNAVAILABLE when the put call itself throws synchronously', async () => {
    // A second, distinct call site inside write(): the transaction was created
    // fine, but the `put` call on its object store is the one that throws.
    installFakeIndexedDb({ open: 'success', putThrows: true });
    const store = createIndexedDbSaveStore();

    await expect(store.write('slot-a', Uint8Array.of(1), UNCHECKED_SLOT)).rejects.toBeInstanceOf(
      SaveReadError
    );
    await expect(store.write('slot-a', Uint8Array.of(1), UNCHECKED_SLOT)).rejects.toThrow(
      /SAVE_STORAGE_UNAVAILABLE/u
    );
  });
});

describe('reading a slot', () => {
  it('answers null for a slot the database holds nothing under, rather than throwing', async () => {
    installFakeIndexedDb({ open: 'success' });
    const store = createIndexedDbSaveStore();

    await expect(store.read('slot-b')).resolves.toBeNull();
  });

  it('answers the stored bytes for an occupied slot', async () => {
    const bytes = Uint8Array.of(9, 8, 7);
    installFakeIndexedDb({ open: 'success', values: new Map([['slot-a', bytes]]) });
    const store = createIndexedDbSaveStore();

    await expect(store.read('slot-a')).resolves.toEqual(bytes);
  });

  it('reports SAVE_STORAGE_UNAVAILABLE when the database opens but the get request itself errors', async () => {
    // Distinct from the `indexedDB.open` failures above: the database is open,
    // the transaction started, and it is the `get` request specifically that
    // fails (a real cause: the store was deleted from under an in-flight
    // transaction). `read()`'s own `request.onerror` is what this pins.
    installFakeIndexedDb({ open: 'success', readOutcome: 'error' });
    const store = createIndexedDbSaveStore();

    await expect(store.read('slot-a')).rejects.toThrow(/SAVE_STORAGE_UNAVAILABLE/u);
  });

  it('reports SAVE_STORAGE_UNAVAILABLE when the stored value under a real slot is not save bytes', async () => {
    // The same defensive stance as the key filter in `list()` below, applied to
    // a value: a fixture seeded directly for a test (Task 16.8 does this) could
    // put anything under a valid key, and this module must not hand it back
    // cast to `Uint8Array` without having checked.
    installFakeIndexedDb({
      open: 'success',
      values: new Map([['slot-a', 'not bytes' as unknown as Uint8Array]])
    });
    const store = createIndexedDbSaveStore();

    await expect(store.read('slot-a')).rejects.toThrow(/SAVE_STORAGE_UNAVAILABLE/u);
  });
});

describe('list()', () => {
  it('answers which slots are occupied and ignores a key that is not a real slot', async () => {
    installFakeIndexedDb({
      open: 'success',
      values: new Map([
        ['slot-b', Uint8Array.of(1)],
        // Not a value `write()` could ever have produced (it only ever keys by
        // `SaveSlot`) — a defensive case for whatever else might land in the
        // object store, e.g. a hand-seeded fixture in a later task's tests.
        ['not-a-real-slot' as SaveSlot, Uint8Array.of(2)],
        ['slot-a', Uint8Array.of(3)]
      ])
    });
    const store = createIndexedDbSaveStore();

    // Compared as a set, not pinned to this fake's insertion order: a real
    // `getAllKeys()` answers keys in ascending order, which this fake's `Map`
    // does not necessarily reproduce, and `SaveStorePort.list()`'s own doc
    // comment states the order is unspecified.
    const slots = await store.list();
    expect(new Set(slots)).toEqual(new Set(['slot-b', 'slot-a']));
    expect(slots).toHaveLength(2);
  });

  it('answers an empty list when every slot is empty', async () => {
    installFakeIndexedDb({ open: 'success' });
    const store = createIndexedDbSaveStore();

    await expect(store.list()).resolves.toEqual([]);
  });

  it('only ever answers names from the closed slot set', async () => {
    installFakeIndexedDb({
      open: 'success',
      values: new Map(SAVE_SLOTS.map((slot) => [slot, Uint8Array.of(0)]))
    });
    const store = createIndexedDbSaveStore();

    const slots = await store.list();
    for (const slot of slots) {
      expect(SAVE_SLOTS).toContain(slot);
    }
  });

  it('reports SAVE_STORAGE_UNAVAILABLE when the database opens but the getAllKeys request itself errors', async () => {
    installFakeIndexedDb({ open: 'success', readOutcome: 'error' });
    const store = createIndexedDbSaveStore();

    await expect(store.list()).rejects.toThrow(/SAVE_STORAGE_UNAVAILABLE/u);
  });
});

describe('write()', () => {
  it('resolves once the transaction reports complete', async () => {
    installFakeIndexedDb({ open: 'success', writeOutcome: 'complete' });
    const store = createIndexedDbSaveStore();

    await expect(store.write('slot-a', Uint8Array.of(1), UNCHECKED_SLOT)).resolves.toBeUndefined();
  });

  it('reports SAVE_STORAGE_UNAVAILABLE, not a re-telling of tx.error, when the transaction aborts', async () => {
    // The fake transaction's `error` field is `null`, matching spike A exactly.
    // If this module ever started reading `tx.error` for its message, the
    // rejection would carry the string "null" instead of a real explanation.
    installFakeIndexedDb({ open: 'success', writeOutcome: 'abort' });
    const store = createIndexedDbSaveStore();

    const failure = store.write('slot-a', Uint8Array.of(1), UNCHECKED_SLOT);
    await expect(failure).rejects.toThrow(/SAVE_STORAGE_UNAVAILABLE/u);
    await expect(failure).rejects.toThrow(/was aborted/u);
    await expect(failure).rejects.not.toThrow(/\bnull\b/u);
  });

  it("reports the transaction's own error, not the abort message, when both fire (real order: error before abort)", async () => {
    // IndexedDB fires `error` on the transaction before it aborts for an
    // unhandled request error — the common real-world case, unlike the explicit
    // `abort()` the test above models. Both handlers reject, so whichever fires
    // first is what a settled promise keeps; this pins that it is `onerror`'s
    // message, not `onabort`'s.
    installFakeIndexedDb({ open: 'success', writeOutcome: 'error-then-abort' });
    const store = createIndexedDbSaveStore();

    const failure = store.write('slot-a', Uint8Array.of(1), UNCHECKED_SLOT);
    await expect(failure).rejects.toThrow(/SAVE_STORAGE_UNAVAILABLE/u);
    await expect(failure).rejects.toThrow(/writing slot 'slot-a' failed\./u);
    await expect(failure).rejects.not.toThrow(/was aborted/u);
  });
});
