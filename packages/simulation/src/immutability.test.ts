import { describe, expect, it } from 'vitest';

import { compareStrings } from './collections/comparator.ts';
import { SortedMap } from './collections/sorted-map.ts';
import { withEvent } from './state/game-state.ts';
import { aState } from './testing/fixtures.ts';

/**
 * The reproductions external review supplied, turned into tests.
 *
 * Every one of these passed *before* the fix, which is the point: the invariants
 * `withEvent` verifies were verified against objects the caller could still edit
 * afterwards, so a state that had been checked could be walked into one that would have
 * been refused. C# had runtime immutability for free through `ImmutableArray` and
 * records; `readonly` is erased, so it has to be bought with `Object.freeze`.
 */

const anEvent = () => ({
  kind: 'hero_accepted_contract' as const,
  eventId: 0,
  logicalTime: 0,
  causalTraceId: 0,
  heroId: 0 as never,
  contractId: 'core:cleanse_the_crypt' as never
});

const aTraceWith = (factors: unknown[]) => ({
  traceId: 0,
  positiveFactors: factors as never,
  negativeFactors: [],
  blockedBy: [],
  tieBreak: null
});

describe('SortedMap does not hand out the caller a way back in', () => {
  it('keeps its own copy of an entry rather than the tuple it was given', () => {
    // Reproduction: `from` froze the outer array and kept the caller's tuples, so
    // `tuple[1] = 999` changed what `get` returned.
    const tuple: [string, number] = ['a', 1];
    const map = SortedMap.from(compareStrings, [tuple]);

    tuple[1] = 999;

    expect(map.get('a')).toBe(1);
  });

  it('freezes the entries it exposes', () => {
    const map = SortedMap.from(compareStrings, [['a', 1]]).set('b', 2);

    for (const entry of map.entries()) {
      expect(Object.isFrozen(entry)).toBe(true);
    }
  });
});

describe('withEvent stores data nothing can rewrite afterwards', () => {
  it('does not let the caller re-date an event already in history', () => {
    // Reproduction: `history[0].logicalTime` became 99 while `metadata.logicalTime`
    // stayed 0 — a log no longer monotone in the very field the function checks.
    const event = anEvent();
    const after = withEvent(aState(), event, aTraceWith([]), 1n);

    expect(() => {
      (event as { logicalTime: number }).logicalTime = 99;
    }).toThrow(TypeError);
    expect(after.history[0]?.logicalTime).toBe(0);
    expect(after.metadata.logicalTime).toBe(0);
  });

  it('does not let the caller change the id a stored explanation reports', () => {
    // Reproduction: the trace under map key 0 reported `traceId: 7`, so the key and the
    // explanation disagreed about which decision it explained.
    const trace = aTraceWith([]);
    const after = withEvent(aState(), anEvent(), trace, 1n);

    expect(() => {
      (trace as { traceId: number }).traceId = 7;
    }).toThrow(TypeError);
    expect(after.traces.get(0)?.traceId).toBe(0);
  });

  it('does not let the caller add a factor to a stored explanation', () => {
    // Reproduction: a factor was pushed into an explanation `withEvent` refuses to
    // overwrite, so the trace changed without any transition having happened.
    const factors: unknown[] = [];
    const after = withEvent(aState(), anEvent(), aTraceWith(factors), 1n);

    expect(() => factors.push({ reasonCode: 'injected' })).toThrow(TypeError);
    expect(after.traces.get(0)?.positiveFactors).toHaveLength(0);
  });

  it('freezes the state it returns, down to the metadata', () => {
    const after = withEvent(aState(), anEvent(), aTraceWith([]), 1n);

    expect(Object.isFrozen(after)).toBe(true);
    expect(Object.isFrozen(after.metadata)).toBe(true);
    expect(Object.isFrozen(after.history)).toBe(true);
  });

  it('still allows a second transition on a frozen state', () => {
    // Freezing must not turn persistence into paralysis: every transition builds a new
    // state, so the frozen one it was derived from stays usable as an input.
    const first = withEvent(aState(), anEvent(), aTraceWith([]), 1n);
    const second = withEvent(
      first,
      { ...anEvent(), eventId: 1, causalTraceId: 1 },
      { ...aTraceWith([]), traceId: 1 },
      1n
    );

    expect(second.metadata.stateVersion).toBe(2);
    expect(second.history).toHaveLength(2);
    expect(first.history).toHaveLength(1);
  });
});

describe('withEvent bounds what it adds to the ordinal', () => {
  it.each([-1n, -100n])('refuses drawsConsumed %s', (drawsConsumed) => {
    // The floor `bigint` lost. `-1n` produced `nextDecisionOrdinal === -1n`, which the
    // RNG then masked into a huge valid-looking unsigned ordinal — the campaign's
    // randomness walking backwards into an alias of a legitimate value.
    expect(() => withEvent(aState(), anEvent(), aTraceWith([]), drawsConsumed)).toThrow(
      /drawsConsumed is -\d+, outside the 64-bit unsigned range/
    );
  });

  it('refuses a total that would leave the 64-bit range', () => {
    // The ceiling C# enforced with `checked` and the journal admitted was lost.
    const state = aState();
    const nearTheTop = {
      ...state,
      metadata: { ...state.metadata, nextDecisionOrdinal: 2n ** 64n - 2n }
    };

    expect(() => withEvent(nearTheTop, anEvent(), aTraceWith([]), 5n)).toThrow(
      /nextDecisionOrdinal is \d+, outside the 64-bit unsigned range/
    );
  });

  it('accepts a total that lands exactly on the top of the range', () => {
    const state = aState();
    const nearTheTop = {
      ...state,
      metadata: { ...state.metadata, nextDecisionOrdinal: 2n ** 64n - 2n }
    };

    expect(withEvent(nearTheTop, anEvent(), aTraceWith([]), 1n).metadata.nextDecisionOrdinal).toBe(
      2n ** 64n - 1n
    );
  });
});
