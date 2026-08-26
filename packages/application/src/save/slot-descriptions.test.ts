import {
  RULESET_VERSION,
  SaveErrorCodes,
  SaveReadError,
  createInitialState,
  encodeUtf8,
  loadContentSet,
  memoryFileSource
} from '@oath-and-coin/content';
import { parseContentId, type GameState } from '@oath-and-coin/simulation';
import { describe, expect, it } from 'vitest';

import type { SaveStorePort } from '../ports.ts';

import { buildSave } from './envelope.ts';
import { SAVE_SLOTS, type SaveSlot } from './slots.ts';
import { describeSaveSlots } from './slot-descriptions.ts';

/**
 * What the slots screen is shown, built from what the storage answers.
 *
 * Every question this file asks is one the screen model cannot ask for itself: it is
 * handed five scalars per slot and classifies them, and *these* are the rules that
 * decide what those scalars are — which slot a file belongs to, which refusal a
 * broken one produces, and what "the storage is gone" looks like when it is the
 * listing itself that failed.
 *
 * The saves are real ones, built by `buildSave` from a real campaign. A hand-written
 * envelope would let this file agree with a descriptor no save can actually carry.
 */

const HERO = {
  schema_version: 4,
  id: 'core:bram',
  display_name_key: 'hero.core.bram.name',
  greed: 60,
  caution: 30,
  pride: 45,
  trust_in_guild: 50,
  capability: { grade: 50, expertise: { frontline: 50, wilderness: 50 } },
  traits: [],
  relationships: []
};

const CONTRACT = {
  schema_version: 4,
  id: 'core:escort',
  display_name_key: 'contract.core.escort.name',
  patron_fee: 70,
  risk: 30,
  required_crew: 1,
  needs: { frontline: 10, wilderness: 10 },
  tags: []
};

/** Nobody holds it. A content root with no `traits/` directory is refused outright. */
const TRAIT = {
  schema_version: 4,
  id: 'core:greedy',
  display_name_key: 'trait.core.greedy.name',
  kind: 'inclination',
  tag: 'method:escort',
  weight: 20
};

const CREATED_AT = '2026-08-19T09:41:00.000Z';
const FOCUS = parseContentId('core:escort');

function campaign(rulesetVersion: string = RULESET_VERSION): GameState {
  const content = loadContentSet(
    memoryFileSource({
      'heroes/bram.json': JSON.stringify(HERO),
      'contracts/escort.json': JSON.stringify(CONTRACT),
      'traits/greedy.json': JSON.stringify(TRAIT)
    })
  );

  return createInitialState(content, 424242n, rulesetVersion);
}

const EXPECTED = {
  rulesetVersion: RULESET_VERSION,
  contentVersion: campaign().metadata.contentVersion
};

function aSave(rulesetVersion: string = RULESET_VERSION): Uint8Array {
  return buildSave({
    state: campaign(rulesetVersion),
    focusedContract: FOCUS,
    createdAt: CREATED_AT
  });
}

/**
 * A store over a map, answering `list()` in an order of the caller's choosing.
 *
 * The order is a parameter because the port promises none: "which slots are occupied,
 * in no particular order". A caller that read the answer positionally would work
 * against the map-backed store here and against IndexedDB's key order, and fail against
 * the desktop store's `readdir` on a machine that returns files in another order.
 */
function storeOver(
  contents: Partial<Record<SaveSlot, Uint8Array>>,
  order: readonly SaveSlot[] = SAVE_SLOTS
): SaveStorePort {
  return {
    read: (slot) => Promise.resolve(contents[slot] ?? null),
    write: () => Promise.resolve(),
    list: () => Promise.resolve(order.filter((slot) => contents[slot] !== undefined))
  };
}

describe('the three slots as the screen is shown them', () => {
  it('answers one line per slot, in the order the slots are declared', async () => {
    // Positional identity is what the screen joins on, so the order has to be the
    // declared one rather than the storage's — which the port explicitly does not
    // promise.
    const described = await describeSaveSlots(storeOver({}), EXPECTED);

    expect(described.map((slot) => slot.slot)).toEqual([...SAVE_SLOTS]);
  });

  it('describes an empty slot as empty rather than as a refusal', async () => {
    // Design spec §2.4, first row: an empty slot is a state the screen shows, not
    // something that went wrong, and there is no code for it.
    const [first] = await describeSaveSlots(storeOver({}), EXPECTED);

    expect(first).toEqual({
      slot: 'slot-a',
      createdAt: null,
      logicalTime: null,
      focusedContract: null,
      errorCode: null
    });
  });

  it('describes an occupied slot from the save it holds', async () => {
    const described = await describeSaveSlots(storeOver({ 'slot-b': aSave() }), EXPECTED);

    expect(described[1]).toEqual({
      slot: 'slot-b',
      createdAt: CREATED_AT,
      logicalTime: 0,
      focusedContract: FOCUS,
      errorCode: null
    });
    expect(described[0]?.createdAt).toBeNull();
    expect(described[2]?.createdAt).toBeNull();
  });

  it('matches a listed slot by its name and never by its position', async () => {
    // The port answers `list()` in no particular order, and a save descriptor carries
    // no slot of its own (`SaveDescriptor`'s doc comment). Zipping the two lists would
    // put slot C's campaign on slot A's line the day a store answers in another order —
    // and the screen would offer to overwrite the wrong file.
    const described = await describeSaveSlots(
      storeOver({ 'slot-a': aSave(), 'slot-c': aSave() }, ['slot-c', 'slot-a']),
      EXPECTED
    );

    expect(described.map((slot) => slot.createdAt)).toEqual([CREATED_AT, null, CREATED_AT]);
  });
});

describe('a slot this build cannot read', () => {
  it('carries the code the file itself produced', async () => {
    const described = await describeSaveSlots(
      storeOver({ 'slot-a': encodeUtf8('not a save at all') }),
      EXPECTED
    );

    expect(described[0]?.errorCode).toBe(SaveErrorCodes.Malformed);
    expect(described[0]?.createdAt).toBeNull();
  });

  it('carries the version refusal for a campaign from another ruleset', async () => {
    // Not "unreadable" in the abstract: the screen shows the player *why*, and the
    // reasons are different enough to act on differently.
    const described = await describeSaveSlots(
      storeOver({ 'slot-a': aSave('some-other-ruleset/9') }),
      EXPECTED
    );

    expect(described[0]?.errorCode).toBe(SaveErrorCodes.RulesetMismatch);
  });

  it('leaves the other two slots alone', async () => {
    const described = await describeSaveSlots(
      storeOver({ 'slot-a': encodeUtf8('{'), 'slot-b': aSave() }),
      EXPECTED
    );

    expect(described.map((slot) => slot.errorCode)).toEqual([SaveErrorCodes.Malformed, null, null]);
    expect(described[1]?.createdAt).toBe(CREATED_AT);
  });
});

describe('a storage that cannot answer at all', () => {
  it('refuses every slot when the listing itself fails', async () => {
    // The `error` state of the screen, and the only way to reach it: with no listing
    // there is nothing to read slot by slot, so the honest answer about each of the
    // three is the same one.
    const described = await describeSaveSlots(
      {
        read: () => Promise.reject(new Error('never asked')),
        write: () => Promise.reject(new Error('never asked')),
        list: () =>
          Promise.reject(new SaveReadError(SaveErrorCodes.StorageUnavailable, 'no database.'))
      },
      EXPECTED
    );

    expect(described.map((slot) => slot.errorCode)).toEqual([
      SaveErrorCodes.StorageUnavailable,
      SaveErrorCodes.StorageUnavailable,
      SaveErrorCodes.StorageUnavailable
    ]);
  });

  it('reports a listing that threw something it never named as an unavailable store', async () => {
    const described = await describeSaveSlots(
      {
        read: () => Promise.resolve(null),
        write: () => Promise.resolve(),
        list: () => Promise.reject('a string, from a store that promised an error')
      },
      EXPECTED
    );

    expect(described.every((slot) => slot.errorCode === SaveErrorCodes.StorageUnavailable)).toBe(
      true
    );
  });

  it('refuses only the slot whose read failed', async () => {
    const described = await describeSaveSlots(
      {
        read: (slot) =>
          slot === 'slot-a'
            ? Promise.reject(new SaveReadError(SaveErrorCodes.StorageUnavailable, 'gone.'))
            : Promise.resolve(null),
        write: () => Promise.resolve(),
        list: () => Promise.resolve(['slot-a'])
      },
      EXPECTED
    );

    expect(described.map((slot) => slot.errorCode)).toEqual([
      SaveErrorCodes.StorageUnavailable,
      null,
      null
    ]);
  });

  it('treats a listed slot that reads back empty as empty, not as a refusal', async () => {
    // Two answers from one storage with a gap between them: the slot can have been
    // emptied in between. Nothing went wrong, and a screen that showed a refusal there
    // would be reporting a race as a broken file.
    const described = await describeSaveSlots(
      {
        read: () => Promise.resolve(null),
        write: () => Promise.resolve(),
        list: () => Promise.resolve(['slot-a'])
      },
      EXPECTED
    );

    expect(described[0]).toEqual({
      slot: 'slot-a',
      createdAt: null,
      logicalTime: null,
      focusedContract: null,
      errorCode: null
    });
  });
});
