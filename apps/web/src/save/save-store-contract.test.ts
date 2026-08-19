import { MAX_SAVE_BYTES, type SaveSlot, type SaveStorePort } from '@oath-and-coin/application';
import { SaveErrorCodes, SaveReadError } from '@oath-and-coin/content';
import { afterEach, describe, expect, it } from 'vitest';

import { desktopSaveStore } from './desktop-store.ts';
import { createIndexedDbSaveStore } from './indexeddb-store.ts';

/**
 * One set of checks, run against **both** `SaveStorePort` implementations.
 *
 * This file exists because of a finding external review of Task 16 made and because of
 * how it made it: the size ceiling was declared inside `apps/desktop/src/contract.ts`
 * and applied at the IPC boundary, while `indexeddb-store.ts` accepted any `Uint8Array`
 * at all — so `write(slot, tenMegabytes)` succeeded in a browser and failed in Electron,
 * and nothing in the repository compared the two answers. Every per-implementation suite
 * was green throughout, because each one only ever asked its own store.
 *
 * So the shape of the fix is not only "state the number once" (it is now
 * `MAX_SAVE_BYTES` in `packages/application`, which `buildSave` also refuses to exceed)
 * — it is a place where the port's promises are asked of every implementation of it. The
 * two below are exercised at the boundary and one byte past it, which is the pair that
 * catches an off-by-one in either direction; a test at 1 byte and at 100 MB would pass
 * against a ceiling anywhere between.
 *
 * The doubles are deliberately the thinnest thing that can answer: an IndexedDB fake
 * driving only `open → transaction → objectStore → put → oncomplete`, and a
 * `window.desktop` that records what it was handed. Everything about how each store
 * reacts to its own storage failing is its own suite's job
 * (`indexeddb-store.test.ts`, `desktop-store.test.ts`); this file is about the promises
 * they must answer identically.
 */

afterEach(() => {
  delete (globalThis as { indexedDB?: IDBFactory }).indexedDB;
  delete (globalThis as { desktop?: unknown }).desktop;
});

/** The written slots, whichever store wrote them. */
type Written = Map<SaveSlot, Uint8Array>;

/** Just enough IndexedDB for one successful `put`, and nothing else. */
function installWorkingIndexedDb(written: Written): void {
  const objectStore = {
    put(value: Uint8Array, key: SaveSlot) {
      written.set(key, value);
      return {};
    }
  };

  const transaction = {
    oncomplete: null as (() => void) | null,
    onerror: null as (() => void) | null,
    onabort: null as (() => void) | null,
    objectStore: () => objectStore
  };

  const database = {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => undefined,
    close: () => undefined,
    transaction: () => {
      queueMicrotask(() => transaction.oncomplete?.());
      return transaction;
    }
  };

  (globalThis as { indexedDB?: unknown }).indexedDB = {
    open() {
      const request = {
        result: database,
        onsuccess: null as (() => void) | null,
        onupgradeneeded: null as (() => void) | null,
        onerror: null as (() => void) | null,
        onblocked: null as (() => void) | null
      };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    }
  };
}

function installWorkingDesktopApi(written: Written): void {
  (globalThis as { desktop?: unknown }).desktop = {
    readSave: async (slot: SaveSlot) => written.get(slot) ?? null,
    writeSave: async (slot: SaveSlot, bytes: Uint8Array) => {
      written.set(slot, bytes);
    },
    listSaves: async () => [...written.keys()]
  };
}

const implementations: [string, (written: Written) => SaveStorePort][] = [
  [
    'IndexedDB (браузер)',
    (written) => {
      installWorkingIndexedDb(written);
      return createIndexedDbSaveStore();
    }
  ],
  [
    'window.desktop (Electron)',
    (written) => {
      installWorkingDesktopApi(written);
      return desktopSaveStore();
    }
  ]
];

describe.each(implementations)('%s — общий контракт SaveStorePort', (_name, build) => {
  it('принимает запись ровно на границе допустимого размера', async () => {
    const written: Written = new Map();
    const store = build(written);
    const atTheLimit = new Uint8Array(MAX_SAVE_BYTES);

    await expect(store.write('slot-a', atTheLimit)).resolves.toBeUndefined();

    expect(written.get('slot-a')?.length).toBe(MAX_SAVE_BYTES);
  });

  it('отказывает на один байт дальше — и одним и тем же кодом', async () => {
    const written: Written = new Map();
    const store = build(written);
    const oneTooMany = new Uint8Array(MAX_SAVE_BYTES + 1);

    await expect(store.write('slot-a', oneTooMany)).rejects.toBeInstanceOf(SaveReadError);
    await expect(store.write('slot-a', oneTooMany)).rejects.toThrow(
      new RegExp(SaveErrorCodes.OutOfBounds, 'u')
    );
    // И ничего не записано: отказ по размеру обязан оставить слот таким, каким он был.
    expect(written.size).toBe(0);
  });
});
