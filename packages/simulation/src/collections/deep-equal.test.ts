import { describe, expect, it } from 'vitest';

import { compareNumbers, compareStrings } from './comparator.ts';
import { deepEqual } from './deep-equal.ts';
import { SortedMap } from './sorted-map.ts';
import { SortedSet } from './sorted-set.ts';

/**
 * One equality rule replacing eight hand-written `Equals` overrides. The cases that
 * matter are the ones the C# arrangement got wrong before it was fixed: two
 * independently built values with identical contents, and two values that were "equal"
 * only because both held the same empty singleton.
 */

describe('deepEqual', () => {
  it('answers true for two independently built values with the same contents', () => {
    // The failure the C# records had by default: this returned false, so a save/load
    // round-trip test only broke once state carried real data.
    const left = { traceId: 1, factors: [{ code: 'a', magnitude: 2 }] };
    const right = { traceId: 1, factors: [{ code: 'a', magnitude: 2 }] };

    expect(deepEqual(left, right)).toBe(true);
  });

  it('is not fooled by two empty collections of different kinds', () => {
    // The other half of that failure: everything empty compared equal, which is exactly
    // the fixture a first test is written against.
    expect(deepEqual(SortedSet.empty(compareNumbers), SortedMap.empty(compareNumbers))).toBe(false);
    expect(deepEqual([], {})).toBe(false);
  });

  it('compares a sorted map entry by entry', () => {
    const left = SortedMap.from(compareStrings, [
      ['a', 1],
      ['b', 2]
    ]);

    expect(
      deepEqual(
        left,
        SortedMap.from(compareStrings, [
          ['b', 2],
          ['a', 1]
        ])
      )
    ).toBe(true);
    expect(
      deepEqual(
        left,
        SortedMap.from(compareStrings, [
          ['a', 1],
          ['b', 3]
        ])
      )
    ).toBe(false);
    expect(deepEqual(left, SortedMap.from(compareStrings, [['a', 1]]))).toBe(false);
  });

  it('compares a sorted set by members', () => {
    expect(
      deepEqual(SortedSet.from(compareNumbers, [1, 2]), SortedSet.from(compareNumbers, [2, 1]))
    ).toBe(true);
    expect(
      deepEqual(SortedSet.from(compareNumbers, [1, 2]), SortedSet.from(compareNumbers, [1, 3]))
    ).toBe(false);
  });

  it('keeps array order significant, because a history is a sequence', () => {
    // The order commands ran in and the order decisions happened are data. Two
    // histories holding the same events in a different order are not the same history.
    expect(deepEqual([1, 2], [2, 1])).toBe(false);
    expect(deepEqual([1, 2], [1, 2])).toBe(true);
  });

  it('distinguishes bigint from number, which state depends on', () => {
    // The campaign seed and the decision ordinal are `bigint`; every counter beside them
    // is a `number`. An equality that coerced would call two different states the same.
    expect(deepEqual(7n, 7)).toBe(false);
    expect(deepEqual(7n, 7n)).toBe(true);
  });

  it('treats negative zero as zero, which the canonicalizer also does', () => {
    // Not an oversight and not a claim about IEEE 754: state is an integer domain —
    // counters, scores, magnitudes, weights — where `-0` does not arise, and the
    // canonical writer emits both as `0`. Distinguishing them here would make equality
    // stricter than the bytes, which is the wrong direction: two states that serialize
    // identically would compare unequal.
    expect(deepEqual(-0, 0)).toBe(true);
  });

  it('answers false when one side is null and the other an object', () => {
    expect(deepEqual(null, {})).toBe(false);
    expect(deepEqual(undefined, null)).toBe(false);
    expect(deepEqual(null, null)).toBe(true);
  });

  it('answers false when an object has an extra key', () => {
    expect(deepEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
  });
});
