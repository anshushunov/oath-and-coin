import { SaveErrorCodes, SaveReadError, type SaveErrorCode } from '@oath-and-coin/content';
import type { ContentId } from '@oath-and-coin/simulation';

import type { SaveStorePort } from '../ports.ts';

import { readSave } from './envelope.ts';
import { SAVE_SLOTS, type SaveSlot } from './slots.ts';

/**
 * What the save-slots screen is shown about each of the three slots.
 *
 * The pair `SaveStorePort` deliberately does not answer in one call — `list()` says
 * which slots are occupied and nothing about what is in them, because a descriptor
 * comes from decoding a slot's bytes and `SaveDescriptor` does not know its own slot
 * (both doc comments say so). This is the caller that builds the pair, and it is here
 * rather than in `apps/web` for the reason every other rule in this package is: reading
 * a save is `readSave`'s business, and a second caller of it in the UI would be a second
 * answer to "what does this build accept".
 *
 * The shape below is assignable to `packages/presentation`'s `SaveSlotInput` — five
 * scalars, no type of this layer's own — which is what makes this the structural
 * assignment point the boundary needs. The compiler checks the two agree where the
 * screen model is called, not here.
 */
export interface SaveSlotDescription {
  readonly slot: SaveSlot;
  /** When the save in this slot was taken, or `null` when the slot is empty. */
  readonly createdAt: string | null;
  readonly logicalTime: number | null;
  readonly focusedContract: ContentId | null;
  /** Why this slot could not be read, or `null` when nothing refused. */
  readonly errorCode: SaveErrorCode | null;
}

/**
 * A description together with the bytes it was built from — what the *session* needs and
 * a screen does not.
 *
 * The bytes are the guard a later write to this slot is held to (`SlotGuard`): "replace
 * exactly what the player was shown". `undefined` where the storage never answered with
 * bytes at all — a slot that failed to list, or failed to read — because "there was
 * nothing to see" and "the slot is empty" are different claims and only one of them is
 * something to hold a write to.
 *
 * Kept off {@link SaveSlotDescription} deliberately: that shape is assignable to
 * `packages/presentation`'s `SaveSlotInput`, which is five scalars and nothing more, and
 * a screen has no business carrying a save's bytes through a render.
 */
export interface ObservedSaveSlot {
  readonly description: SaveSlotDescription;
  readonly seen: Uint8Array | null | undefined;
}

/** An empty slot: no campaign in it, and nothing wrong with it either. */
function empty(slot: SaveSlot): SaveSlotDescription {
  return { slot, createdAt: null, logicalTime: null, focusedContract: null, errorCode: null };
}

function refused(slot: SaveSlot, errorCode: SaveErrorCode): SaveSlotDescription {
  return { ...empty(slot), errorCode };
}

/**
 * The code an exception carries, or `fallback` when it is not one this build named.
 *
 * One rule for the whole layer rather than one per caller: both shipped stores promise
 * that every refusal arrives as a `SaveReadError`, and the fallback is the second
 * echelon behind that promise — for a third store that breaks it, or for a throw from
 * somewhere no code was assigned.
 */
export function saveErrorCodeOf(cause: unknown, fallback: SaveErrorCode): SaveErrorCode {
  return cause instanceof SaveReadError ? cause.code : fallback;
}

/**
 * Describes all three slots, in the order {@link SAVE_SLOTS} declares them.
 *
 * **Matched by name, never by position.** `list()` answers "in no particular order"
 * (its own doc comment), so the occupied set is turned into a lookup and each declared
 * slot asks it about itself. Zipping the two lists would put one slot's campaign on
 * another's line the first time a store answered in a different order — and the screen
 * would then offer to overwrite the wrong file.
 *
 * **A failed listing refuses everything.** With no listing there is nothing to read slot
 * by slot, so each of the three gets the same honest answer, and that is exactly the
 * `error` state of the screen (design spec §3.2: "хранилище недоступно целиком").
 *
 * **A slot that lists as occupied and reads back empty is empty.** Two answers from one
 * storage have a gap between them; a screen that called that a broken file would be
 * reporting a race as damage.
 *
 * Nothing here throws. Every refusal is a code on a line, for the reason the session
 * controller's own doc comment gives: a screen shows codes, and an exception is the one
 * shape it cannot show.
 */
export async function describeSaveSlots(
  saves: SaveStorePort,
  expected: { readonly rulesetVersion: string; readonly contentVersion: string }
): Promise<readonly SaveSlotDescription[]> {
  return (await observeSaveSlots(saves, expected)).map((observed) => observed.description);
}

/**
 * {@link describeSaveSlots}, plus the bytes each description was built from.
 *
 * Two functions over one walk rather than two walks, because the walk *is* a pair of
 * storage round trips per slot and a second one would answer about a different moment.
 * The session controller takes this one because a save it later writes has to be held to
 * what the player was shown (`SlotGuard`); everything that only draws a screen takes the
 * one above.
 */
export async function observeSaveSlots(
  saves: SaveStorePort,
  expected: { readonly rulesetVersion: string; readonly contentVersion: string }
): Promise<readonly ObservedSaveSlot[]> {
  let occupied: ReadonlySet<SaveSlot>;

  try {
    occupied = new Set(await saves.list());
  } catch (cause) {
    const code = saveErrorCodeOf(cause, SaveErrorCodes.StorageUnavailable);

    // Nothing was seen, of any slot: the listing is what failed, so there is no
    // observation to hold a later write to.
    return SAVE_SLOTS.map((slot) => ({ description: refused(slot, code), seen: undefined }));
  }

  return Promise.all(
    SAVE_SLOTS.map(async (slot) =>
      occupied.has(slot)
        ? await describeOne(saves, expected, slot)
        : { description: empty(slot), seen: null }
    )
  );
}

async function describeOne(
  saves: SaveStorePort,
  expected: { readonly rulesetVersion: string; readonly contentVersion: string },
  slot: SaveSlot
): Promise<ObservedSaveSlot> {
  let bytes: Uint8Array | null;

  try {
    bytes = await saves.read(slot);
  } catch (cause) {
    return {
      description: refused(slot, saveErrorCodeOf(cause, SaveErrorCodes.StorageUnavailable)),
      seen: undefined
    };
  }

  if (bytes === null) {
    return { description: empty(slot), seen: null };
  }

  try {
    const { descriptor } = readSave(bytes, expected);

    return {
      description: {
        slot,
        createdAt: descriptor.createdAt,
        logicalTime: descriptor.logicalTime,
        focusedContract: descriptor.focusedContract,
        errorCode: null
      },
      seen: bytes
    };
  } catch (cause) {
    // `SAVE_INCONSISTENT` as the fallback for the same reason the session controller
    // uses it when a file it has already accepted cannot be turned into a screen: what
    // is left for the fallback is a file that disagrees with itself in a way the
    // envelope cannot name from where it stands, and that is what the code says.
    //
    // The bytes are still an observation — the storage answered them and they are what
    // a write here would replace — even though nothing could be read out of them.
    return {
      description: refused(slot, saveErrorCodeOf(cause, SaveErrorCodes.Inconsistent)),
      seen: bytes
    };
  }
}
