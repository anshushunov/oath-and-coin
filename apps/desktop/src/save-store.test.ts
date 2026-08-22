import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { MAX_SAVE_BYTES, type DesktopSlotGuard } from './contract';
import {
  enqueueSlotWrite,
  fileSaveStore,
  listSaveFiles,
  readSaveFile,
  writeSaveFileAtomically
} from './save-store';

/**
 * The provably-red tests this module exists for (brief step 3, plus the
 * review findings that followed the first pass): a failure between the
 * temporary file being written and the `rename` that publishes it must not
 * touch a slot's previous contents; a leftover `.tmp` must never be reported
 * by `list()` as a slot, nor left behind after an ordinary failure; two
 * concurrent writes to the same slot must not corrupt it; a file that merely
 * matches the `.save` suffix without naming a real slot must not be reported
 * either; and a transient Windows read error must be retried, not surfaced
 * raw. Everything else here is the ordinary shape of the port.
 */

/**
 * Every directory this file made, in creation order, and the only list the
 * teardown below deletes from.
 *
 * Until Task 18 this file created around two dozen directories per run and
 * removed none of them; the workstation it was written on had accumulated
 * 2658 of them (7.4 MiB) by the end of the segment. That is not merely untidy:
 * a leak of this shape is the standing argument for going back to one fixed
 * path swept clean at startup, and Task 17 spent six review rounds and three
 * data-loss windows removing exactly that construction from the packaged gate.
 *
 * So the cure keeps `mkdtemp` and takes the same shape Task 17 arrived at: a
 * path that is *created* rather than computed cannot be anyone else's, and the
 * teardown removes the values `mkdtemp` returned rather than everything
 * matching a prefix. `rm -rf` over `tmpdir()/oath-and-coin-save-store-*` would
 * be one line shorter and would delete a concurrent run's directories with it.
 *
 * **The limit, stated as a limit.** This defends against a leak, not against an
 * edit. `push` here is the only writer, but nothing enforces that; an edit that
 * pushed some other path into this array would have it deleted recursively, and
 * no mechanism inside a test file goes further than saying so.
 */
const createdDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'oath-and-coin-save-store-'));
  createdDirectories.push(directory);
  return directory;
}

afterAll(async () => {
  const survivors: string[] = [];

  for (const directory of createdDirectories) {
    await rm(directory, { recursive: true, force: true });
    if (existsSync(directory)) {
      survivors.push(directory);
    }
  }

  // Not decoration. A teardown that silently stopped deleting is invisible —
  // the suite still passes and the directories pile up in a place nobody
  // looks, which is how the 2658 got there. This is the check that reddens on
  // that, and it reddens on a directory a live handle keeps alive too, which
  // is worth hearing about rather than swallowing.
  expect(
    survivors,
    `${String(survivors.length)} of ${String(createdDirectories.length)} temporary directories survived teardown`
  ).toEqual([]);
});

/**
 * The guard for a write that makes no claim about what the slot held. Most of this
 * file is about atomicity and cleanup rather than about lost updates, so it writes
 * unchecked; the compare-and-swap has its own block below.
 */
const UNCHECKED: DesktopSlotGuard = { kind: 'unchecked' };

function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/**
 * Byte equality for payloads too large to compare element by element — see the
 * ceiling test for the measurement that put this here. `null` answers a value no
 * digest can equal, so a read that came back empty fails the comparison rather
 * than throwing inside it.
 */
function sha256(bytes: Uint8Array | null): string {
  return bytes === null ? 'no bytes' : createHash('sha256').update(bytes).digest('hex');
}

/** A `.tmp` file this store never itself produced under this name — the
 * shape a crash between `close` and `rename` leaves behind (brief step 3,
 * spike B). */
async function writeStrayTmp(dir: string): Promise<void> {
  await writeFile(join(dir, 'slot-a.save.tmp'), bytesOf('МУСОР'));
}

function makeErrno(code: string, message: string): NodeJS.ErrnoException {
  const error = new Error(message) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

describe('reading a slot', () => {
  it('answers null for a slot nothing was ever written to', async () => {
    const dir = await temporaryDirectory();
    const store = fileSaveStore(dir);

    await expect(store.read('slot-a')).resolves.toBeNull();
  });

  it('refuses a file past the ceiling without reading it, and names the ceiling', async () => {
    // A real file rather than a seam, and it has to be: the whole finding is that
    // the bound belonged to the *host*, where the file is opened, and until
    // external review of segment 5 the only comparison against `MAX_SAVE_BYTES`
    // was in the renderer — after the main process had allocated the whole thing
    // and IPC had copied it across. A hook that answered bytes would prove
    // nothing about a file, because a hook has no file.
    //
    // `slot-a.save` is written directly, not through `write()`: the store refuses
    // to *produce* something this size, which is the other half of the same
    // ceiling and not the half under test. An old build or a hand-placed file is
    // exactly how one gets there.
    const dir = await temporaryDirectory();
    const store = fileSaveStore(dir);
    await writeFile(join(dir, 'slot-a.save'), Buffer.alloc(MAX_SAVE_BYTES + 1, 0x61));

    await expect(store.read('slot-a')).rejects.toThrow(/SAVE_OUT_OF_BOUNDS/u);
    await expect(store.read('slot-a')).rejects.toThrow(
      new RegExp(`${String(MAX_SAVE_BYTES)}-byte ceiling`, 'u')
    );
  });

  it('reads a file of exactly the ceiling — the bound is on more than a save, not on a save', async () => {
    // The other side of the same comparison. Without it, a mutant turning `>`
    // into `>=` stays green, and the file this build itself produces at the
    // maximum size would stop being readable.
    //
    // **Length and digest, not `toEqual`, and that is measured rather than
    // preferred.** `toEqual` over two equal 8 MiB typed arrays takes **12 828 ms**
    // on a free workstation — Vitest walks them element by element in JavaScript,
    // 8 388 608 times. Under a loaded runner that goes past `testTimeout: 30_000`,
    // which is exactly what happened: this test failed once in six local full runs
    // and once on CI, on a commit whose re-run was green, with
    // `Test timed out in 30000ms` and nothing about bytes. The identical claim as
    // a length plus a SHA-256 takes **5 ms** — the same two numbers, 2500× cheaper,
    // and a mismatch now reports two hex strings instead of asking Vitest to diff
    // eight million elements.
    const dir = await temporaryDirectory();
    const store = fileSaveStore(dir);
    const atTheCeiling = Buffer.alloc(MAX_SAVE_BYTES, 0x61);
    await writeFile(join(dir, 'slot-a.save'), atTheCeiling);

    const read = await store.read('slot-a');

    expect(read?.byteLength).toBe(MAX_SAVE_BYTES);
    expect(sha256(read)).toBe(sha256(atTheCeiling));
  });

  it('answers the bytes a previous write left behind', async () => {
    const dir = await temporaryDirectory();
    const store = fileSaveStore(dir);

    await store.write('slot-a', bytesOf('ПЕРВОЕ'), UNCHECKED);

    await expect(store.read('slot-a')).resolves.toEqual(bytesOf('ПЕРВОЕ'));
  });

  it('retries a transient EPERM/EBUSY rather than surfacing it raw', async () => {
    const dir = await temporaryDirectory();
    let attempts = 0;
    const flaky = async (): Promise<Buffer> => {
      attempts += 1;
      if (attempts < 3) {
        throw makeErrno('EPERM', 'operation not permitted');
      }
      return Buffer.from(bytesOf('ПЕРВОЕ'));
    };

    await expect(readSaveFile(dir, 'slot-a', { readFile: flaky })).resolves.toEqual(
      bytesOf('ПЕРВОЕ')
    );
    expect(attempts).toBe(3);
  });

  it('gives up and rethrows a persistent EBUSY rather than retrying forever', async () => {
    const dir = await temporaryDirectory();
    const alwaysBusy = async (): Promise<Buffer> => {
      throw makeErrno('EBUSY', 'EBUSY: resource busy or locked');
    };

    await expect(readSaveFile(dir, 'slot-a', { readFile: alwaysBusy })).rejects.toThrow(/EBUSY/u);
  });

  it('still answers null for a genuine ENOENT, not a retry candidate', async () => {
    const dir = await temporaryDirectory();
    let calls = 0;
    const missing = async (): Promise<Buffer> => {
      calls += 1;
      throw makeErrno('ENOENT', 'no such file');
    };

    await expect(readSaveFile(dir, 'slot-a', { readFile: missing })).resolves.toBeNull();
    expect(calls).toBe(1);
  });
});

describe('writing a slot', () => {
  it('replaces a slot wholesale', async () => {
    const dir = await temporaryDirectory();
    const store = fileSaveStore(dir);

    await store.write('slot-a', bytesOf('ПЕРВОЕ'), UNCHECKED);
    await store.write('slot-a', bytesOf('ВТОРОЕ'), UNCHECKED);

    await expect(store.read('slot-a')).resolves.toEqual(bytesOf('ВТОРОЕ'));
  });

  it('creates the save directory on the first write, rather than requiring it to exist', async () => {
    const parent = await temporaryDirectory();
    const dir = join(parent, 'saves');
    const store = fileSaveStore(dir);

    await store.write('slot-a', bytesOf('ПЕРВОЕ'), UNCHECKED);

    await expect(store.read('slot-a')).resolves.toEqual(bytesOf('ПЕРВОЕ'));
  });

  it('a failure before the rename leaves the previous save intact', async () => {
    const dir = await temporaryDirectory();
    const store = fileSaveStore(dir);

    await store.write('slot-a', bytesOf('ПЕРВОЕ'), UNCHECKED);

    await expect(
      writeSaveFileAtomically(dir, 'slot-a', bytesOf('ВТОРОЕ'), UNCHECKED, {
        beforeRename: () => {
          throw new Error('injected failure before rename');
        }
      })
    ).rejects.toThrow('injected failure before rename');

    expect(await store.read('slot-a')).toEqual(bytesOf('ПЕРВОЕ'));
  });

  it('does not leave its temporary file behind after a failure before the rename', async () => {
    const dir = await temporaryDirectory();

    await expect(
      writeSaveFileAtomically(dir, 'slot-a', bytesOf('ВТОРОЕ'), UNCHECKED, {
        beforeRename: () => {
          throw new Error('injected failure before rename');
        }
      })
    ).rejects.toThrow('injected failure before rename');

    const entries = await readdir(dir);
    expect(entries.some((entry) => entry.includes('.tmp'))).toBe(false);
  });

  it.each([
    ['a write that fails the way a full disk fails it', 'beforeWrite'],
    ['an fsync that fails on its own', 'beforeSync']
  ] as const)('does not leave its temporary file behind after %s', async (_name, hook) => {
    // External review of segment 5 named both of these as the branch
    // `beforeRename` could not reach: the exception left the function through
    // the `finally` that closes the handle, before the `catch` that deleted
    // the temporary file ever ran, so every failed save left one uniquely
    // named file behind for good.
    const dir = await temporaryDirectory();

    await expect(
      writeSaveFileAtomically(dir, 'slot-a', bytesOf('ВТОРОЕ'), UNCHECKED, {
        [hook]: () => {
          throw new Error(`injected failure at ${hook}`);
        }
      })
    ).rejects.toThrow(`injected failure at ${hook}`);

    const entries = await readdir(dir);
    expect(entries).toEqual([]);
  });

  it.each([['beforeWrite'], ['beforeSync']] as const)(
    'a failure at %s leaves the previous save intact',
    async (hook) => {
      const dir = await temporaryDirectory();
      const store = fileSaveStore(dir);

      await store.write('slot-a', bytesOf('ПЕРВОЕ'), UNCHECKED);

      await expect(
        writeSaveFileAtomically(dir, 'slot-a', bytesOf('ВТОРОЕ'), UNCHECKED, {
          [hook]: () => {
            throw new Error(`injected failure at ${hook}`);
          }
        })
      ).rejects.toThrow(`injected failure at ${hook}`);

      expect(await store.read('slot-a')).toEqual(bytesOf('ПЕРВОЕ'));
    }
  );

  it('retries a transient EPERM/EBUSY on rename before publishing', async () => {
    // The module header comment records what this proves: two `rename`s onto
    // the same target — no shared temporary file needed — can still make
    // Windows answer one of them with a raw EPERM, measured directly by
    // external review (2 of 3 runs of a 5-writer × 25-round × 12-repetition
    // probe). This is that failure, simulated rather than raced.
    const dir = await temporaryDirectory();
    let attempts = 0;
    const flakyRename = async (from: string, to: string): Promise<void> => {
      attempts += 1;
      if (attempts < 3) {
        throw makeErrno('EPERM', 'operation not permitted');
      }
      await rename(from, to);
    };

    await writeSaveFileAtomically(dir, 'slot-a', bytesOf('ПЕРВОЕ'), UNCHECKED, {
      rename: flakyRename
    });

    await expect(readSaveFile(dir, 'slot-a')).resolves.toEqual(bytesOf('ПЕРВОЕ'));
    expect(attempts).toBe(3);
  });

  it('gives up and rethrows a persistent EBUSY on rename, and still cleans up its temporary file', async () => {
    const dir = await temporaryDirectory();
    const alwaysBusy = async (): Promise<void> => {
      throw makeErrno('EBUSY', 'EBUSY: resource busy or locked');
    };

    await expect(
      writeSaveFileAtomically(dir, 'slot-a', bytesOf('ПЕРВОЕ'), UNCHECKED, { rename: alwaysBusy })
    ).rejects.toThrow(/EBUSY/u);

    const entries = await readdir(dir);
    expect(entries.some((entry) => entry.includes('.tmp'))).toBe(false);
  });

  it('two concurrent writes to the same slot never publish a mix of both payloads', async () => {
    // External review reproduced real corruption from a version of this
    // module that used one fixed temporary filename per slot: 12 runs, two
    // of them published a byte-for-byte mix of both payloads while still
    // telling the caller "saved". Unique temporary filenames plus per-slot
    // serialization (this module's header comment) are what this proves.
    const dir = await temporaryDirectory();
    const store = fileSaveStore(dir);

    const long = bytesOf('Д'.repeat(200_000));
    const short = bytesOf('К');

    await Promise.all([
      store.write('slot-a', long, UNCHECKED),
      store.write('slot-a', short, UNCHECKED)
    ]);

    const result = await store.read('slot-a');
    expect(result).not.toBeNull();
    const isWhollyLong = result !== null && bytesEqual(result, long);
    const isWhollyShort = result !== null && bytesEqual(result, short);
    expect(
      isWhollyLong || isWhollyShort,
      `read back ${String(result?.length)} bytes matching neither payload whole`
    ).toBe(true);
  });

  it('publishes writes to the same slot in call order, even when the first write is the slower one', async () => {
    // Distinct from the corruption test above: unique temporary filenames
    // alone stop a byte mix, but without serialization a slower *first* call
    // could still publish *after* a faster second call — the caller who
    // asked second would silently lose. `enqueueSlotWrite` (not `store.write`,
    // which hides the hook) lets this delay specifically the first call's
    // publish, isolating the serialization from the no-shared-tmp-file fix
    // next to it.
    const dir = await temporaryDirectory();
    const store = fileSaveStore(dir);

    const first = enqueueSlotWrite(dir, 'slot-a', bytesOf('ПЕРВЫЙ ВЫЗОВ'), UNCHECKED, {
      beforeRename: () => new Promise((resolve) => setTimeout(resolve, 30))
    });
    const second = enqueueSlotWrite(dir, 'slot-a', bytesOf('ВТОРОЙ ВЫЗОВ'), UNCHECKED);

    await Promise.all([first, second]);

    // Under serialization the second call's whole write does not even start
    // until the first (including its 30 ms delay) has finished, so the
    // second — called later — is deterministically what ends up on disk.
    await expect(store.read('slot-a')).resolves.toEqual(bytesOf('ВТОРОЙ ВЫЗОВ'));
  });
});

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) {
      return false;
    }
  }
  return true;
}

describe('writing under a guard', () => {
  // Атомарность обещает, что байты не перемешаются; она ничего не обещает про то, что
  // слот не заняли между чтением экрана и нажатием кнопки. Сравнение живёт внутри
  // очереди записи этого слота — только так «проверить и записать» становится одной
  // неделимой операцией.

  it('refuses a slot that filled up since it was last seen, and leaves it alone', async () => {
    const dir = await temporaryDirectory();
    const store = fileSaveStore(dir);
    await store.write('slot-a', bytesOf('ЧУЖОЕ'), UNCHECKED);

    await expect(
      store.write('slot-a', bytesOf('МОЁ'), { kind: 'as-seen', seen: null })
    ).rejects.toThrow(/SAVE_SLOT_CHANGED/u);

    await expect(store.read('slot-a')).resolves.toEqual(bytesOf('ЧУЖОЕ'));
  });

  it('refuses a slot whose contents were replaced since it was last seen', async () => {
    const dir = await temporaryDirectory();
    const store = fileSaveStore(dir);
    await store.write('slot-a', bytesOf('НОВОЕ'), UNCHECKED);

    await expect(
      store.write('slot-a', bytesOf('МОЁ'), { kind: 'as-seen', seen: bytesOf('СТАРОЕ') })
    ).rejects.toThrow(/SAVE_SLOT_CHANGED/u);

    await expect(store.read('slot-a')).resolves.toEqual(bytesOf('НОВОЕ'));
  });

  it('publishes when the slot holds exactly what was seen', async () => {
    const dir = await temporaryDirectory();
    const store = fileSaveStore(dir);
    await store.write('slot-a', bytesOf('СТАРОЕ'), UNCHECKED);

    await store.write('slot-a', bytesOf('НОВОЕ'), { kind: 'as-seen', seen: bytesOf('СТАРОЕ') });

    await expect(store.read('slot-a')).resolves.toEqual(bytesOf('НОВОЕ'));
  });

  it('and when the slot is empty and empty is what was seen', async () => {
    const dir = await temporaryDirectory();
    const store = fileSaveStore(dir);

    await store.write('slot-a', bytesOf('ПЕРВОЕ'), { kind: 'as-seen', seen: null });

    await expect(store.read('slot-a')).resolves.toEqual(bytesOf('ПЕРВОЕ'));
  });

  it('a refused write creates no save directory it then leaves empty', async () => {
    const parent = await temporaryDirectory();
    const dir = join(parent, 'saves');

    await expect(
      fileSaveStore(dir).write('slot-a', bytesOf('МОЁ'), {
        kind: 'as-seen',
        seen: bytesOf('НИЧЕГО ПОДОБНОГО')
      })
    ).rejects.toThrow(/SAVE_SLOT_CHANGED/u);

    await expect(readdir(parent)).resolves.toEqual([]);
  });

  it('compares against what the write ahead of it in the queue published', async () => {
    // Очередь слота — это и есть «неделимо». Первая запись ещё не опубликована, когда
    // вторая уже поставлена в очередь; сторож второй обязан увидеть результат первой, а
    // не то, что лежало до неё.
    const dir = await temporaryDirectory();
    const store = fileSaveStore(dir);

    const first = store.write('slot-a', bytesOf('ПЕРВОЕ'), UNCHECKED);
    const second = store.write('slot-a', bytesOf('ВТОРОЕ'), { kind: 'as-seen', seen: null });

    await first;
    await expect(second).rejects.toThrow(/SAVE_SLOT_CHANGED/u);
    await expect(store.read('slot-a')).resolves.toEqual(bytesOf('ПЕРВОЕ'));
  });
});

describe('listing occupied slots', () => {
  it('answers an empty list when the save directory holds nothing, or does not exist yet', async () => {
    const parent = await temporaryDirectory();
    const store = fileSaveStore(join(parent, 'never-written'));

    await expect(store.list()).resolves.toEqual([]);
  });

  it('answers every slot a write reached, in no particular pinned order', async () => {
    const dir = await temporaryDirectory();
    const store = fileSaveStore(dir);

    await store.write('slot-b', bytesOf('B'), UNCHECKED);
    await store.write('slot-a', bytesOf('A'), UNCHECKED);

    const slots = await store.list();
    expect(new Set(slots)).toEqual(new Set(['slot-a', 'slot-b']));
    expect(slots).toHaveLength(2);
  });

  it('does not show a temporary file left behind by an interrupted write as a slot', async () => {
    const dir = await temporaryDirectory();
    const store = fileSaveStore(dir);

    await store.write('slot-a', bytesOf('ПЕРВОЕ'), UNCHECKED);
    await writeStrayTmp(dir);

    await expect(store.list()).resolves.toEqual(['slot-a']);
  });

  it('does not show a file that matches the .save suffix but does not name a real slot', async () => {
    // Isolates the membership check (`isDesktopSaveSlot`) from the suffix
    // filter next to it: this file passes the suffix filter outright, so
    // only the membership check stands between it and being reported as an
    // occupied slot.
    const dir = await temporaryDirectory();
    const store = fileSaveStore(dir);

    await store.write('slot-a', bytesOf('ПЕРВОЕ'), UNCHECKED);
    await writeFile(join(dir, 'slot-z.save'), bytesOf('НЕ СЛОТ'));

    await expect(store.list()).resolves.toEqual(['slot-a']);
  });

  it('retries a transient EPERM/EBUSY on readdir before answering', async () => {
    const dir = await temporaryDirectory();
    const store = fileSaveStore(dir);
    await store.write('slot-a', bytesOf('ПЕРВОЕ'), UNCHECKED);

    let attempts = 0;
    const flakyReaddir = async (path: string): Promise<readonly string[]> => {
      attempts += 1;
      if (attempts < 3) {
        throw makeErrno('EPERM', 'operation not permitted');
      }
      return readdir(path);
    };

    await expect(listSaveFiles(dir, { readdir: flakyReaddir })).resolves.toEqual(['slot-a']);
    expect(attempts).toBe(3);
  });

  it('gives up and rethrows a persistent EBUSY on readdir', async () => {
    const dir = await temporaryDirectory();
    const alwaysBusy = async (): Promise<readonly string[]> => {
      throw makeErrno('EBUSY', 'EBUSY: resource busy or locked');
    };

    await expect(listSaveFiles(dir, { readdir: alwaysBusy })).rejects.toThrow(/EBUSY/u);
  });

  it('still answers an empty list for a genuine ENOENT directory, not a retry candidate', async () => {
    const parent = await temporaryDirectory();
    let calls = 0;
    const missing = async (): Promise<readonly string[]> => {
      calls += 1;
      throw makeErrno('ENOENT', 'no such directory');
    };

    await expect(listSaveFiles(join(parent, 'nope'), { readdir: missing })).resolves.toEqual([]);
    expect(calls).toBe(1);
  });
});
