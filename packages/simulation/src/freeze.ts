/**
 * Runtime immutability for the data campaign state is built from.
 *
 * External review found that persistence here existed only in the types, and the
 * reproduction is short: `withEvent` validated an event and then stored the caller's
 * object by reference, so mutating that object afterwards changed history *behind* the
 * checks. In one probe `history[0].logicalTime` became 99 while `metadata.logicalTime`
 * stayed 0 — a log no longer monotone in time — and a stored explanation, which
 * `withEvent` refuses to overwrite, gained a factor and a different `traceId` than the
 * key it sits under. Every one of those is an invariant the function had just
 * verified.
 *
 * C# had this for free: `ImmutableArray`, `ImmutableSortedDictionary` and records were
 * immutable at runtime, not only to the compiler. TypeScript's `readonly` is erased, so
 * the guarantee has to be bought back with `Object.freeze`.
 *
 * Frozen at the boundary rather than everywhere: the two places caller-supplied data
 * enters state are `withEvent` and the sorted collections. Freezing there is enough,
 * because everything reachable from state was put there through one of them.
 */

/**
 * Values this function has already walked. A memo, so a campaign that has been through
 * dozens of transitions is not re-walked on each one, and weak so it holds nothing
 * alive.
 *
 * It exists because `Object.isFrozen` is **not** a valid short-circuit, which is a
 * mistake this file made first and a test caught: `SortedMap` freezes each entry tuple
 * shallowly, so a tuple reports frozen while the hero state inside it is still mutable.
 * Skipping on `isFrozen` therefore stopped exactly one level above everything worth
 * freezing, and `Object.isFrozen(state.heroes.values()[0])` was false. "Frozen" and
 * "deeply frozen" are different facts, and only the second one can be memoised here.
 */
const deeplyFrozen = new WeakSet<object>();

/**
 * Freezes `value` and everything reachable from it, and returns it.
 *
 * Cycles are impossible in this domain — state is a tree of plain data — but the memo
 * would tolerate them anyway.
 */
export function freezeDeep<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (deeplyFrozen.has(value)) {
    return value;
  }

  deeplyFrozen.add(value);
  Object.freeze(value);

  for (const nested of Object.values(value)) {
    freezeDeep(nested);
  }

  return value;
}
