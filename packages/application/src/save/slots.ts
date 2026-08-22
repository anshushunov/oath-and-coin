/**
 * The closed set of save slot names (design spec §0: "Число слотов — три именованных").
 *
 * A slot name never comes from the player — there is no "rename slot" and no "add a
 * slot" (spec §8) — so nothing downstream has to defend against a name it was not told
 * to expect: not the IPC allowlist (`ADR-010` §80), not an IndexedDB key, not a path on
 * disk. `SaveSlot` is the type a `SaveStorePort` (a later task) reads and writes by;
 * this module states the three values and the type before anything depends on them, so
 * neither can drift from whichever port arrives first.
 */
export const SAVE_SLOTS = ['slot-a', 'slot-b', 'slot-c'] as const;

export type SaveSlot = (typeof SAVE_SLOTS)[number];
