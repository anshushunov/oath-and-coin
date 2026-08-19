import { mkdtemp, readdir, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

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

async function temporaryDirectory(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'oath-and-coin-save-store-'));
}

function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
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

  it('answers the bytes a previous write left behind', async () => {
    const dir = await temporaryDirectory();
    const store = fileSaveStore(dir);

    await store.write('slot-a', bytesOf('ПЕРВОЕ'));

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

    await store.write('slot-a', bytesOf('ПЕРВОЕ'));
    await store.write('slot-a', bytesOf('ВТОРОЕ'));

    await expect(store.read('slot-a')).resolves.toEqual(bytesOf('ВТОРОЕ'));
  });

  it('creates the save directory on the first write, rather than requiring it to exist', async () => {
    const parent = await temporaryDirectory();
    const dir = join(parent, 'saves');
    const store = fileSaveStore(dir);

    await store.write('slot-a', bytesOf('ПЕРВОЕ'));

    await expect(store.read('slot-a')).resolves.toEqual(bytesOf('ПЕРВОЕ'));
  });

  it('a failure before the rename leaves the previous save intact', async () => {
    const dir = await temporaryDirectory();
    const store = fileSaveStore(dir);

    await store.write('slot-a', bytesOf('ПЕРВОЕ'));

    await expect(
      writeSaveFileAtomically(dir, 'slot-a', bytesOf('ВТОРОЕ'), {
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
      writeSaveFileAtomically(dir, 'slot-a', bytesOf('ВТОРОЕ'), {
        beforeRename: () => {
          throw new Error('injected failure before rename');
        }
      })
    ).rejects.toThrow('injected failure before rename');

    const entries = await readdir(dir);
    expect(entries.some((entry) => entry.includes('.tmp'))).toBe(false);
  });

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

    await writeSaveFileAtomically(dir, 'slot-a', bytesOf('ПЕРВОЕ'), { rename: flakyRename });

    await expect(readSaveFile(dir, 'slot-a')).resolves.toEqual(bytesOf('ПЕРВОЕ'));
    expect(attempts).toBe(3);
  });

  it('gives up and rethrows a persistent EBUSY on rename, and still cleans up its temporary file', async () => {
    const dir = await temporaryDirectory();
    const alwaysBusy = async (): Promise<void> => {
      throw makeErrno('EBUSY', 'EBUSY: resource busy or locked');
    };

    await expect(
      writeSaveFileAtomically(dir, 'slot-a', bytesOf('ПЕРВОЕ'), { rename: alwaysBusy })
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

    await Promise.all([store.write('slot-a', long), store.write('slot-a', short)]);

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

    const first = enqueueSlotWrite(dir, 'slot-a', bytesOf('ПЕРВЫЙ ВЫЗОВ'), {
      beforeRename: () => new Promise((resolve) => setTimeout(resolve, 30))
    });
    const second = enqueueSlotWrite(dir, 'slot-a', bytesOf('ВТОРОЙ ВЫЗОВ'));

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

describe('listing occupied slots', () => {
  it('answers an empty list when the save directory holds nothing, or does not exist yet', async () => {
    const parent = await temporaryDirectory();
    const store = fileSaveStore(join(parent, 'never-written'));

    await expect(store.list()).resolves.toEqual([]);
  });

  it('answers every slot a write reached, in no particular pinned order', async () => {
    const dir = await temporaryDirectory();
    const store = fileSaveStore(dir);

    await store.write('slot-b', bytesOf('B'));
    await store.write('slot-a', bytesOf('A'));

    const slots = await store.list();
    expect(new Set(slots)).toEqual(new Set(['slot-a', 'slot-b']));
    expect(slots).toHaveLength(2);
  });

  it('does not show a temporary file left behind by an interrupted write as a slot', async () => {
    const dir = await temporaryDirectory();
    const store = fileSaveStore(dir);

    await store.write('slot-a', bytesOf('ПЕРВОЕ'));
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

    await store.write('slot-a', bytesOf('ПЕРВОЕ'));
    await writeFile(join(dir, 'slot-z.save'), bytesOf('НЕ СЛОТ'));

    await expect(store.list()).resolves.toEqual(['slot-a']);
  });

  it('retries a transient EPERM/EBUSY on readdir before answering', async () => {
    const dir = await temporaryDirectory();
    const store = fileSaveStore(dir);
    await store.write('slot-a', bytesOf('ПЕРВОЕ'));

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
