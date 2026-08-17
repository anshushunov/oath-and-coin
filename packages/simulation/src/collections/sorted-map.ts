import type { Comparator } from './comparator.ts';

/**
 * A persistent map whose enumeration order is its key order, not its insertion
 * order — the TypeScript stand-in for
 * `ImmutableSortedDictionary<TKey, TValue>`.
 *
 * `Map` is the obvious alternative and is the wrong one. It enumerates in
 * insertion order, so `metadata`, the canonical artifact and every hash built
 * over them would become functions of the order the loader happened to read
 * files in — the exact property `ContentSet` goes out of its way to destroy by
 * sorting paths ordinally before reading them. With `Map`, "same content, same
 * bytes" would hold on one machine and quietly stop holding on another; with
 * this type it is not expressible.
 *
 * Backed by a frozen sorted array of entries with binary search. The campaign's
 * collections hold single digits of entries (six heroes, four contracts, eight
 * traits), so `set` copying the array is cheaper than any tree would be, and it
 * is a few lines instead of a few hundred.
 */
export class SortedMap<K, V> {
  // Fields declared and assigned rather than written as constructor parameter
  // properties. That shorthand is TypeScript-only syntax with a runtime effect, so
  // Node's type stripping refuses it outright (ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX) —
  // which would make this package unusable by the schema generator and by the
  // scenario-runner CLI, both of which are plain `node` invocations.
  // `erasableSyntaxOnly` in the base tsconfig is what stops the shorthand coming
  // back; this comment is why it is set.
  private readonly compare: Comparator<K>;
  private readonly sorted: readonly (readonly [K, V])[];

  private constructor(compare: Comparator<K>, sorted: readonly (readonly [K, V])[]) {
    this.compare = compare;
    this.sorted = sorted;
  }

  static empty<K, V>(compare: Comparator<K>): SortedMap<K, V> {
    return new SortedMap<K, V>(compare, []);
  }

  /**
   * Builds a map from `entries`, sorted by key.
   *
   * A repeated key throws rather than being resolved to one of the two values,
   * which is `ImmutableSortedDictionary.CreateRange`'s own behaviour and the
   * reason the C# loader could rely on it: a duplicate id in content is an
   * authoring error, and "last one wins" is how it becomes an invisible one.
   */
  static from<K, V>(compare: Comparator<K>, entries: Iterable<readonly [K, V]>): SortedMap<K, V> {
    // Copied and frozen, never the caller's tuples. External review found that freezing
    // only the outer array left every entry mutable through the reference the caller
    // still held: `SortedMap.from(compare, [tuple])` followed by `tuple[1] = 999`
    // changed what `get` returned. The type said `readonly`; the runtime did not.
    const collected = [...entries].map((entry) => Object.freeze([entry[0], entry[1]] as const));
    collected.sort((left, right) => compare(left[0], right[0]));

    for (let index = 1; index < collected.length; index++) {
      const previous = collected[index - 1]!;
      const current = collected[index]!;
      if (compare(previous[0], current[0]) === 0) {
        throw new Error(`Duplicate key ${String(current[0])} in SortedMap.from.`);
      }
    }

    return new SortedMap<K, V>(compare, Object.freeze(collected));
  }

  get size(): number {
    return this.sorted.length;
  }

  get(key: K): V | undefined {
    const index = this.indexOf(key);
    return index < 0 ? undefined : this.sorted[index]![1];
  }

  has(key: K): boolean {
    return this.indexOf(key) >= 0;
  }

  /** The map with `key` bound to `value`; this instance is untouched. */
  set(key: K, value: V): SortedMap<K, V> {
    const index = this.indexOf(key);
    const next = [...this.sorted];
    const entry = Object.freeze([key, value] as const);

    if (index >= 0) {
      next[index] = entry;
    } else {
      next.splice(~index, 0, entry);
    }

    return new SortedMap<K, V>(this.compare, Object.freeze(next));
  }

  /** Keys in order. */
  keys(): readonly K[] {
    return this.sorted.map((entry) => entry[0]);
  }

  /** Values in key order — what the canonical artifact projects. */
  values(): readonly V[] {
    return this.sorted.map((entry) => entry[1]);
  }

  /** Entries in key order. */
  entries(): readonly (readonly [K, V])[] {
    return this.sorted;
  }

  /**
   * The index of `key`, or the bitwise complement of the index it would be
   * inserted at. One search serves `get`, `has` and `set`, so an off-by-one here
   * cannot affect one of them and not the others.
   */
  private indexOf(key: K): number {
    let low = 0;
    let high = this.sorted.length - 1;

    while (low <= high) {
      const middle = (low + high) >> 1;
      // In range by the loop's own bounds; `noUncheckedIndexedAccess` cannot
      // see that.
      const order = this.compare(this.sorted[middle]![0], key);

      if (order < 0) {
        low = middle + 1;
      } else if (order > 0) {
        high = middle - 1;
      } else {
        return middle;
      }
    }

    return ~low;
  }
}
