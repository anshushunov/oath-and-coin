import { SAVE_SLOTS, type SaveSlot } from '@oath-and-coin/application';
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
 *   `oncomplete`/`onabort`/`onerror`, and a store's `get`/`put`/`getAllKeys`. They are
 *   hand-rolled test doubles, not a spec-compliant IndexedDB, and they prove how this
 *   module reacts to each event the real one can fire — not that the real one fires
 *   them the way these fakes choose to.
 *
 * What is proven here: the shape of refusal when the store is unavailable (no
 * `indexedDB`, `open` erroring, `open` blocked, `open` throwing synchronously, a write
 * transaction aborting), and that reading an unoccupied slot answers `null` rather than
 * throwing.
 *
 * What is **not** proven here: atomicity. A fake transaction's `oncomplete`/`onabort`
 * is this test file deciding the outcome up front, not two writers racing and one
 * losing — nothing here can show that a real, interrupted `readwrite` transaction
 * leaves a slot's previous bytes intact. That is Task 16.8, step 6, in a live
 * Chromium, interrupting a real transaction by monkey-patching
 * `IDBObjectStore.prototype.put`.
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
}

class FakeObjectStore {
  private readonly values: Map<SaveSlot, Uint8Array>;
  private readonly onWrite: ((value: Uint8Array, key: SaveSlot) => void) | null;

  constructor(
    values: Map<SaveSlot, Uint8Array>,
    onWrite: ((value: Uint8Array, key: SaveSlot) => void) | null
  ) {
    this.values = values;
    this.onWrite = onWrite;
  }

  get(key: SaveSlot): FakeRequest<Uint8Array | undefined> {
    const request = new FakeRequest<Uint8Array | undefined>();
    queueMicrotask(() => request.succeed(this.values.get(key)));
    return request;
  }

  put(value: Uint8Array, key: SaveSlot): FakeRequest<SaveSlot> {
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
    queueMicrotask(() => request.succeed([...this.values.keys()]));
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
  private readonly writeOutcome: 'complete' | 'abort';

  constructor(
    values: Map<SaveSlot, Uint8Array>,
    mode: 'readonly' | 'readwrite',
    writeOutcome: 'complete' | 'abort'
  ) {
    this.values = values;
    this.writable = mode === 'readwrite';
    this.writeOutcome = writeOutcome;
  }

  objectStore(): FakeObjectStore {
    return new FakeObjectStore(
      this.values,
      this.writable ? (value, key) => this.settleWrite(value, key) : null
    );
  }

  private settleWrite(value: Uint8Array, key: SaveSlot): void {
    queueMicrotask(() => {
      if (this.writeOutcome === 'complete') {
        // A real, committed transaction is what makes a put durable; an aborted
        // one leaves the store exactly as it was, which is why this only
        // happens on the 'complete' branch.
        this.values.set(key, value);
        this.oncomplete?.();
      } else {
        this.onabort?.();
      }
    });
  }
}

class FakeDatabase {
  readonly objectStoreNames = { contains: (): boolean => true };

  private readonly values: Map<SaveSlot, Uint8Array>;
  private readonly writeOutcome: 'complete' | 'abort';

  constructor(values: Map<SaveSlot, Uint8Array>, writeOutcome: 'complete' | 'abort') {
    this.values = values;
    this.writeOutcome = writeOutcome;
  }

  createObjectStore(): void {
    // Nothing to build: `values` already exists.
  }

  close(): void {
    // Nothing held open by a fake.
  }

  transaction(_storeName: string, mode: 'readonly' | 'readwrite'): FakeTransaction {
    return new FakeTransaction(this.values, mode, this.writeOutcome);
  }
}

type OpenOutcome = 'success' | 'error' | 'blocked' | 'throw';

function installFakeIndexedDb(options: {
  readonly open: OpenOutcome;
  readonly values?: Map<SaveSlot, Uint8Array>;
  readonly writeOutcome?: 'complete' | 'abort';
}): void {
  const values = options.values ?? new Map<SaveSlot, Uint8Array>();
  const writeOutcome = options.writeOutcome ?? 'complete';

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
        request.result = new FakeDatabase(values, writeOutcome);
        request.onupgradeneeded?.();
        request.onsuccess?.();
      });

      return request as unknown as IDBOpenDBRequest;
    }
  };

  (globalThis as { indexedDB?: IDBFactory }).indexedDB = fakeFactory as IDBFactory;
}

describe('when this environment has no indexedDB at all', () => {
  it('refuses read, write and list with SAVE_STORAGE_UNAVAILABLE', async () => {
    const store = createIndexedDbSaveStore();

    await expect(store.read('slot-a')).rejects.toThrow(/SAVE_STORAGE_UNAVAILABLE/u);
    await expect(store.write('slot-a', Uint8Array.of(1))).rejects.toThrow(
      /SAVE_STORAGE_UNAVAILABLE/u
    );
    await expect(store.list()).rejects.toThrow(/SAVE_STORAGE_UNAVAILABLE/u);
  });

  it('rejects with SaveReadError, not a plain Error', async () => {
    const store = createIndexedDbSaveStore();

    await expect(store.read('slot-a')).rejects.toBeInstanceOf(SaveReadError);
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

    await expect(store.write('slot-a', Uint8Array.of(1))).rejects.toThrow(
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

    await expect(store.list()).resolves.toEqual(['slot-b', 'slot-a']);
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
});

describe('write()', () => {
  it('resolves once the transaction reports complete', async () => {
    installFakeIndexedDb({ open: 'success', writeOutcome: 'complete' });
    const store = createIndexedDbSaveStore();

    await expect(store.write('slot-a', Uint8Array.of(1))).resolves.toBeUndefined();
  });

  it('reports SAVE_STORAGE_UNAVAILABLE, not a re-telling of tx.error, when the transaction aborts', async () => {
    // The fake transaction's `error` field is `null`, matching spike A exactly.
    // If this module ever started reading `tx.error` for its message, the
    // rejection would carry the string "null" instead of a real explanation.
    installFakeIndexedDb({ open: 'success', writeOutcome: 'abort' });
    const store = createIndexedDbSaveStore();

    const failure = store.write('slot-a', Uint8Array.of(1));
    await expect(failure).rejects.toThrow(/SAVE_STORAGE_UNAVAILABLE/u);
    await expect(failure).rejects.not.toThrow(/\bnull\b/u);
  });
});
