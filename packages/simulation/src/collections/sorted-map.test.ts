import { describe, expect, it } from 'vitest';

import { compareNumbers, compareStrings } from './comparator.ts';
import { SortedMap } from './sorted-map.ts';
import { SortedSet } from './sorted-set.ts';

/**
 * These two types exist so that enumeration order is a property of the data
 * rather than of how it was built, because the canonical artifact walks state's
 * collections in order. The tests are shaped around that: the load-bearing
 * assertion is not "get returns what was set", it is "two maps built in different
 * orders enumerate identically".
 */

describe('SortedMap', () => {
  it('enumerates in key order whatever order it was built in', () => {
    const forwards = SortedMap.from(compareStrings, [
      ['a', 1],
      ['b', 2],
      ['c', 3]
    ]);
    const backwards = SortedMap.from(compareStrings, [
      ['c', 3],
      ['b', 2],
      ['a', 1]
    ]);

    expect(forwards.keys()).toEqual(['a', 'b', 'c']);
    expect(backwards.keys()).toEqual(['a', 'b', 'c']);
    expect(backwards.values()).toEqual([1, 2, 3]);
  });

  it('enumerates a map grown by set in key order too', () => {
    // The insertion path and the bulk path have to agree; a `Map` would answer
    // insertion order here and key order above, and only one of the two would be
    // exercised by any given test.
    const grown = ['zara', 'bram', 'mira', 'ilsa'].reduce(
      (map, name, index) => map.set(name, index),
      SortedMap.empty<string, number>(compareStrings)
    );

    expect(grown.keys()).toEqual(['bram', 'ilsa', 'mira', 'zara']);
  });

  it('finds every key it holds, and none it does not', () => {
    const map = SortedMap.from(compareNumbers, [
      [3, 'c'],
      [1, 'a'],
      [2, 'b']
    ]);

    expect(map.get(1)).toBe('a');
    expect(map.get(2)).toBe('b');
    expect(map.get(3)).toBe('c');
    expect(map.get(4)).toBeUndefined();
    expect(map.has(2)).toBe(true);
    expect(map.has(0)).toBe(false);
    expect(map.size).toBe(3);
  });

  it('leaves the map it was derived from untouched', () => {
    // Persistence is what lets a rejected command return the state it was handed
    // by reference. A `set` that mutated in place would make that claim false
    // without changing any call site.
    const before = SortedMap.from(compareStrings, [['a', 1]]);
    const after = before.set('b', 2);

    expect(before.keys()).toEqual(['a']);
    expect(after.keys()).toEqual(['a', 'b']);
  });

  it('replaces a value without moving the key', () => {
    const map = SortedMap.from(compareStrings, [
      ['a', 1],
      ['b', 2]
    ]).set('a', 9);

    expect(map.entries()).toEqual([
      ['a', 9],
      ['b', 2]
    ]);
    expect(map.size).toBe(2);
  });

  it('refuses a repeated key rather than picking one of the two values', () => {
    // `ImmutableSortedDictionary.CreateRange`'s own behaviour, and the reason the
    // C# loader could rely on it: a duplicate id in content is an authoring
    // error, and "last one wins" is how it becomes an invisible one.
    expect(() =>
      SortedMap.from(compareStrings, [
        ['a', 1],
        ['a', 2]
      ])
    ).toThrow(/Duplicate key a/);
  });

  it('holds its order across many keys, where a bad binary search shows up', () => {
    const keys = Array.from({ length: 200 }, (_, index) => (index * 37) % 200);
    const map = keys.reduce(
      (accumulated, key) => accumulated.set(key, key * 2),
      SortedMap.empty<number, number>(compareNumbers)
    );

    expect(map.size).toBe(200);
    expect(map.keys()).toEqual([...keys].sort(compareNumbers));
    for (const key of keys) {
      expect(map.get(key)).toBe(key * 2);
    }
  });
});

describe('SortedSet', () => {
  it('enumerates in member order whatever order it was built in', () => {
    expect(SortedSet.from(compareNumbers, [3, 1, 2]).values()).toEqual([1, 2, 3]);
  });

  it('absorbs a repeated member instead of refusing it', () => {
    // A set, unlike the map above. `ImmutableSortedSet.CreateRange` absorbs too,
    // and the engine builds a hero's trait set from a list content already
    // guarantees is duplicate-free — so absorbing is a no-op there, while a map
    // built from duplicate ids is an error the map has to report.
    const set = SortedSet.from(compareStrings, ['b', 'a', 'b', 'a']);

    expect(set.values()).toEqual(['a', 'b']);
    expect(set.size).toBe(2);
  });

  it('returns itself when adding a member it already holds', () => {
    const set = SortedSet.from(compareNumbers, [1, 2]);
    expect(set.add(2)).toBe(set);
    expect(set.add(3).values()).toEqual([1, 2, 3]);
  });

  it('leaves the set it was derived from untouched', () => {
    const before = SortedSet.from(compareNumbers, [1]);
    const after = before.add(2);

    expect(before.values()).toEqual([1]);
    expect(after.values()).toEqual([1, 2]);
  });

  it('answers membership over many values', () => {
    const values = Array.from({ length: 200 }, (_, index) => (index * 91) % 200);
    const set = SortedSet.from(compareNumbers, values);

    for (const value of values) {
      expect(set.has(value)).toBe(true);
    }
    expect(set.has(200)).toBe(false);
    expect(set.has(-1)).toBe(false);
  });
});

describe('comparators', () => {
  it('compareStrings orders by code unit, not by locale', () => {
    // `localeCompare` answers differently on two machines with the same data,
    // which is the trap this comparator exists to avoid (TDD §7.3). Under a
    // typical locale collation 'a' sorts before 'B'; under code units it does not.
    expect(['B', 'a'].sort(compareStrings)).toEqual(['B', 'a']);
    expect(compareStrings('a', 'a')).toBe(0);
  });

  it('compareNumbers orders numerically, not as text', () => {
    // The default `Array.prototype.sort` compares stringified values, which puts
    // 10 before 9. Hero ids are numbers, and their order reaches the artifact.
    expect([10, 9, 1].sort(compareNumbers)).toEqual([1, 9, 10]);
  });
});
