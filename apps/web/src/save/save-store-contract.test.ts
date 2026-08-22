import {
  MAX_SAVE_BYTES,
  UNCHECKED_SLOT,
  asSeen,
  slotMayBeWritten,
  type SaveSlot,
  type SaveStorePort,
  type SlotGuard
} from '@oath-and-coin/application';
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

/**
 * Just enough IndexedDB for one `get` followed by one `put`, and nothing else.
 *
 * The `get` is not decoration: since the guard, a write *is* a read and a write inside
 * one transaction, and a double that answered a `put` without ever being asked what the
 * slot held could not tell a compare-and-swap from an unconditional overwrite.
 *
 * `oncomplete` fires only if the transaction was not aborted, which is what makes "a
 * refused write leaves the slot as it was" observable here rather than assumed.
 */
function installWorkingIndexedDb(written: Written): void {
  const objectStore = {
    get(key: SaveSlot) {
      const request = { result: written.get(key), onsuccess: null as (() => void) | null };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
    put(value: Uint8Array, key: SaveSlot) {
      written.set(key, value);
      return {};
    }
  };

  const transaction = {
    aborted: false,
    oncomplete: null as (() => void) | null,
    onerror: null as (() => void) | null,
    onabort: null as (() => void) | null,
    objectStore: () => objectStore,
    abort() {
      transaction.aborted = true;
      queueMicrotask(() => transaction.onabort?.());
    }
  };

  const database = {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => undefined,
    close: () => undefined,
    transaction: () => {
      transaction.aborted = false;
      // Two turns behind the `get` this transaction is about to be handed, so the
      // guard has been compared and the `put` queued before the commit is claimed.
      queueMicrotask(() => {
        queueMicrotask(() => {
          if (!transaction.aborted) {
            transaction.oncomplete?.();
          }
        });
      });
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

/**
 * A `window.desktop` that answers the two save channels the way the real host does —
 * including the guard, which the *host* compares (`apps/desktop/src/save-store.ts`) and
 * reports as a named refusal rather than as a rejection.
 */
function installWorkingDesktopApi(written: Written): void {
  (globalThis as { desktop?: unknown }).desktop = {
    readSave: async (slot: SaveSlot) => ({ ok: true, bytes: written.get(slot) ?? null }),
    writeSave: async (slot: SaveSlot, bytes: Uint8Array, guard: SlotGuard) => {
      if (!slotMayBeWritten(guard, written.get(slot) ?? null)) {
        return { ok: false, code: SaveErrorCodes.SlotChanged };
      }
      written.set(slot, bytes);
      return { ok: true };
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

    await expect(store.write('slot-a', atTheLimit, UNCHECKED_SLOT)).resolves.toBeUndefined();

    expect(written.get('slot-a')?.length).toBe(MAX_SAVE_BYTES);
  });

  it('отказывает на один байт дальше — и одним и тем же кодом', async () => {
    const written: Written = new Map();
    const store = build(written);
    const oneTooMany = new Uint8Array(MAX_SAVE_BYTES + 1);

    await expect(store.write('slot-a', oneTooMany, UNCHECKED_SLOT)).rejects.toBeInstanceOf(
      SaveReadError
    );
    await expect(store.write('slot-a', oneTooMany, UNCHECKED_SLOT)).rejects.toThrow(
      new RegExp(SaveErrorCodes.OutOfBounds, 'u')
    );
    // И ничего не записано: отказ по размеру обязан оставить слот таким, каким он был.
    expect(written.size).toBe(0);
  });

  // Потерянное обновление — второй общий контракт, заведённый внешним ревью сегмента 5.
  // Атомарность обещает, что байты не перемешаются; она ничего не обещает про то, что
  // слот не заняли между чтением экрана и нажатием кнопки. Оба хранилища обязаны
  // отвечать на это одинаково, и раньше «одинаково» проверять было негде — ровно та же
  // дыра, из-за которой появился этот файл.

  it('отказывает записи в слот, который заняли после того, как его увидели пустым', async () => {
    // Сценарий из ревью дословно: вкладка A видит слот пустым, вкладка B успевает его
    // занять, A жмёт «Сохранить». Подтверждения A не спрашивала — пустой слот его не
    // требует, — поэтому без этого отказа кампания B исчезает молча.
    const written: Written = new Map();
    const store = build(written);
    const fromAnotherTab = Uint8Array.of(2, 2, 2);
    written.set('slot-a', fromAnotherTab);

    await expect(store.write('slot-a', Uint8Array.of(1), asSeen(null))).rejects.toThrow(
      new RegExp(SaveErrorCodes.SlotChanged, 'u')
    );

    expect(written.get('slot-a')).toEqual(fromAnotherTab);
  });

  it('отказывает и тогда, когда слот подменили на другое сохранение', async () => {
    // Подтверждённая перезапись — тоже потерянное обновление: игрок соглашался
    // заменить то сохранение, которое ему показали, а не то, которое приехало с тех пор.
    const written: Written = new Map();
    const store = build(written);
    const shown = Uint8Array.of(1, 1, 1);
    const nowThere = Uint8Array.of(3, 3, 3);
    written.set('slot-a', nowThere);

    await expect(store.write('slot-a', Uint8Array.of(9), asSeen(shown))).rejects.toThrow(
      new RegExp(SaveErrorCodes.SlotChanged, 'u')
    );

    expect(written.get('slot-a')).toEqual(nowThere);
  });

  it('пропускает запись, когда слот держит ровно то, что видели', async () => {
    // Обратная сторона той же проверки: без неё сторож, отказывающий всегда, был бы
    // зелёным на двух случаях выше и не давал бы сохраниться никому.
    const written: Written = new Map();
    const store = build(written);
    const shown = Uint8Array.of(1, 1, 1);
    written.set('slot-a', shown);

    await expect(
      store.write('slot-a', Uint8Array.of(9), asSeen(Uint8Array.of(1, 1, 1)))
    ).resolves.toBeUndefined();

    expect(written.get('slot-a')).toEqual(Uint8Array.of(9));
  });

  it('и когда слот пуст, а пустым его и видели', async () => {
    const written: Written = new Map();
    const store = build(written);

    await expect(store.write('slot-a', Uint8Array.of(9), asSeen(null))).resolves.toBeUndefined();

    expect(written.get('slot-a')).toEqual(Uint8Array.of(9));
  });
});
