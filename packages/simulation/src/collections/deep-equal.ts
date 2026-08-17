import { SortedMap } from './sorted-map.ts';
import { SortedSet } from './sorted-set.ts';

/**
 * Content equality over the immutable data campaign state is built from.
 *
 * This replaces eight hand-written `Equals`/`GetHashCode` pairs. In C# every record
 * holding a collection had to override both, because none of the BCL immutable
 * collections override `Equals`: `ImmutableArray<T>` compares its *backing array* by
 * reference, and the sorted dictionaries and sets inherit plain reference equality.
 * The compiler-generated equality therefore said "not equal" for two independently
 * built values with identical contents and — worse — "equal" when both happened to
 * hold the shared `Empty` singleton, so a save/load round-trip test written on an
 * empty fixture passed and only broke on the first state carrying real data.
 *
 * One rule instead of eight is possible here because JavaScript has no
 * compiler-generated equality to fight: nothing compares these values unless asked.
 * And nothing needs hashing, which is the other half of the C# obligation gone —
 * `GetHashCode` existed to satisfy a contract, not because any collection in state
 * was ever keyed by a state object.
 */
export function deepEqual(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }

  // `===` above already answered for identical primitives, including `-0` and `0`,
  // and that is left alone deliberately: state is an integer domain — counters,
  // scores, magnitudes, weights — where `-0` does not arise, and the canonicalizer
  // writes both as `0` anyway, so the two rules agree. `NaN` cannot reach state for
  // the same reason.
  //
  // What this branch is really for is the mixed case: a `bigint` and a `number`
  // holding the same value must not compare equal, since the campaign seed and the
  // decision ordinal are `bigint` and every counter beside them is not.
  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) {
    return Object.is(left, right);
  }

  if (left instanceof SortedMap || right instanceof SortedMap) {
    if (!(left instanceof SortedMap) || !(right instanceof SortedMap)) {
      return false;
    }

    // Entry by entry in key order. Both sides enumerate in their comparator's order,
    // which is the whole point of the type — so a pairwise walk is safe here in a
    // way it would not be over a `Map`.
    const leftEntries = left.entries();
    const rightEntries = right.entries();
    if (leftEntries.length !== rightEntries.length) {
      return false;
    }

    return leftEntries.every((entry, index) => {
      const other = rightEntries[index]!;
      return deepEqual(entry[0], other[0]) && deepEqual(entry[1], other[1]);
    });
  }

  if (left instanceof SortedSet || right instanceof SortedSet) {
    if (!(left instanceof SortedSet) || !(right instanceof SortedSet)) {
      return false;
    }

    return elementsEqual(left.values(), right.values());
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) {
      return false;
    }

    return elementsEqual(left, right);
  }

  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  return leftKeys.every(
    (key, index) =>
      key === rightKeys[index] &&
      deepEqual((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key])
  );
}

/**
 * Element by element, in order — deliberately order-sensitive. An array in state is a
 * sequence: the order commands ran in, the order decisions happened. Two histories
 * holding the same events in a different order are not the same history.
 */
function elementsEqual(left: readonly unknown[], right: readonly unknown[]): boolean {
  return (
    left.length === right.length && left.every((value, index) => deepEqual(value, right[index]))
  );
}
