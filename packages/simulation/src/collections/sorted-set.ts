import type { Comparator } from './comparator.ts';

/**
 * A persistent set whose enumeration order is its member order — the stand-in
 * for `ImmutableSortedSet<T>`, and it exists for the same determinism reason as
 * {@link import('./sorted-map').SortedMap}.
 *
 * Unlike that type, a repeated value here is absorbed rather than refused: this
 * is a set, and `ImmutableSortedSet.CreateRange` absorbs too. The distinction is
 * load-bearing at exactly one call site — the engine builds a hero's trait set
 * from a list that content already guarantees is duplicate-free, so absorbing is
 * a no-op there, while a map built from duplicate ids is an authoring error the
 * map has to report.
 */
export class SortedSet<T> {
  // Explicit fields, not constructor parameter properties — see the note on
  // `SortedMap`: the shorthand is syntax Node's type stripping refuses.
  private readonly compare: Comparator<T>;
  private readonly sorted: readonly T[];

  private constructor(compare: Comparator<T>, sorted: readonly T[]) {
    this.compare = compare;
    this.sorted = sorted;
  }

  static empty<T>(compare: Comparator<T>): SortedSet<T> {
    return new SortedSet<T>(compare, []);
  }

  static from<T>(compare: Comparator<T>, values: Iterable<T>): SortedSet<T> {
    const collected = [...values];
    collected.sort(compare);

    const deduplicated: T[] = [];
    for (const value of collected) {
      const last = deduplicated.length - 1;
      if (last < 0 || compare(deduplicated[last]!, value) !== 0) {
        deduplicated.push(value);
      }
    }

    return new SortedSet<T>(compare, Object.freeze(deduplicated));
  }

  get size(): number {
    return this.sorted.length;
  }

  has(value: T): boolean {
    return this.indexOf(value) >= 0;
  }

  /** The set with `value` in it; this instance is untouched. */
  add(value: T): SortedSet<T> {
    const index = this.indexOf(value);
    if (index >= 0) {
      return this;
    }

    const next = [...this.sorted];
    next.splice(~index, 0, value);
    return new SortedSet<T>(this.compare, Object.freeze(next));
  }

  /** Members in order. */
  values(): readonly T[] {
    return this.sorted;
  }

  private indexOf(value: T): number {
    let low = 0;
    let high = this.sorted.length - 1;

    while (low <= high) {
      const middle = (low + high) >> 1;
      const order = this.compare(this.sorted[middle]!, value);

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
