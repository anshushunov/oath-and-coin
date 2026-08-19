import { MAX_SAVE_BYTES, type SaveSlot } from '@oath-and-coin/application';
import { SaveErrorCodes, SaveReadError } from '@oath-and-coin/content';

/**
 * The size ceiling both `SaveStorePort` implementations in this app apply, before either
 * touches its storage.
 *
 * It is one function rather than one line copied into two `write`s because the whole
 * finding was that the two implementations disagreed. External review of Task 16
 * measured it: the IndexedDB store accepted any `Uint8Array` at all while the desktop
 * IPC refused past 8 MiB, so the identical call succeeded in a browser and failed in
 * Electron and nothing compared the two. `MAX_SAVE_BYTES` is imported from
 * `@oath-and-coin/application`, where the port and `buildSave` both state it, so neither
 * store carries a number of its own to drift.
 *
 * `SAVE_OUT_OF_BOUNDS` rather than `SAVE_STORAGE_UNAVAILABLE`, and the distinction is
 * the player's: the storage is perfectly available, the thing being handed to it is too
 * big. It is the same code `buildSave` refuses with when a campaign encodes past the
 * ceiling, so a screen sees one answer for one condition.
 */
export function requireStorableSize(slot: SaveSlot, bytes: Uint8Array): void {
  if (bytes.length > MAX_SAVE_BYTES) {
    throw new SaveReadError(
      SaveErrorCodes.OutOfBounds,
      `a save of ${String(bytes.length)} bytes was offered for slot '${slot}', past the ` +
        `${String(MAX_SAVE_BYTES)}-byte ceiling every slot store in this build is held to.`
    );
  }
}
