import { SaveErrorCodes, SaveReadError } from '@oath-and-coin/content';

import type { SaveSlot } from './slots.ts';

/**
 * What a slot must still hold for a write to it to go through — see
 * {@link import('../ports.ts').SaveStorePort.write} for why a write needs one at all.
 *
 * **The guard is the bytes themselves, not a digest of them.** A generation counter is
 * what a database would issue and neither of this build's two stores has one: a file has
 * no version column and an IndexedDB record has no revision. A digest would mean a hash
 * function available in a renderer, in a Node main process and in whatever runs the
 * tests, agreeing byte for byte — three implementations of one identity, for a
 * comparison a `===` over bytes already answers exactly. What it costs is holding one
 * save per slot in memory, which `MAX_SAVE_BYTES` already bounds and a real campaign
 * makes about eleven kilobytes of.
 */
export type SlotGuard =
  { readonly kind: 'unchecked' } | { readonly kind: 'as-seen'; readonly seen: Uint8Array | null };

/** The guard a caller with nothing to compare against writes under. */
export const UNCHECKED_SLOT: SlotGuard = Object.freeze({ kind: 'unchecked' });

/** The guard for a caller that has looked: `null` means it saw an empty slot. */
export function asSeen(seen: Uint8Array | null): SlotGuard {
  return { kind: 'as-seen', seen };
}

/**
 * Whether a slot currently holding `held` may be written under `guard`.
 *
 * One function rather than the comparison written out in each store, because the whole
 * finding behind the guard was two stores disagreeing about a rule neither of them
 * stated in one place (`save-size.ts` records the same lesson about the size ceiling).
 * `apps/desktop` states it a third time for the reason it states the slot names and the
 * size ceiling a second time — it may not import this package at all.
 *
 * `held` is `unknown` because that is what a store actually has at the moment of
 * comparing: an IndexedDB record is whatever was put there, by this build or by
 * another. `undefined` and `null` both mean an empty slot — the two storages spell it
 * differently — and **anything else that is not `Uint8Array` refuses a checked write**:
 * a value nobody can read is certainly not the one the player was shown, and the point
 * of the guard is that a save never replaces something nobody saw. An unchecked write
 * still goes through, because its caller made no claim to be wrong about.
 */
export function slotMayBeWritten(guard: SlotGuard, held: unknown): boolean {
  if (guard.kind === 'unchecked') {
    return true;
  }

  if (held === undefined || held === null) {
    return guard.seen === null;
  }

  return held instanceof Uint8Array && sameBytes(guard.seen, held);
}

function sameBytes(left: Uint8Array | null, right: Uint8Array | null): boolean {
  if (left === null || right === null) {
    return left === right;
  }

  if (left.length !== right.length) {
    return false;
  }

  return left.every((byte, index) => byte === right[index]);
}

/**
 * The refusal a store answers a failed guard with — one message, so that a player reads
 * the same sentence whichever store refused.
 */
export function slotChanged(slot: SaveSlot): SaveReadError {
  return new SaveReadError(
    SaveErrorCodes.SlotChanged,
    `slot '${slot}' no longer holds what it held when it was last read, so this save would ` +
      'replace a campaign nobody was shown.'
  );
}
