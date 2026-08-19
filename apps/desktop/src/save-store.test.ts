import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { fileSaveStore, writeSaveFileAtomically } from './save-store';

/**
 * The two provably-red tests this module exists for (brief step 3): a failure
 * between the temporary file being written and the `rename` that publishes it
 * must not touch a slot's previous contents, and a leftover `.tmp` from such a
 * failure must never be reported by `list()` as a slot. Everything else here
 * is the ordinary shape of the port: `read` answers `null` for an empty slot,
 * `write` replaces a slot wholesale, `list` answers the occupied set.
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
});
