import { describe, expect, it } from 'vitest';

import { aState, aTrace, anAcceptance, ids } from '../testing/fixtures.ts';

import { contractOf, heroOf, withEvent } from './game-state.ts';

/**
 * The campaign-transition invariants. `AGENTS.md` §8 names domain invariants as one of
 * the three areas where a mutant is obligatory, and every `it` here has one recorded in
 * the migration journal.
 *
 * The shape of these tests follows the shape of the rule: `withEvent` is the only place
 * five counters may move, and the four ways a trace and an event can be paired wrongly
 * are each their own case — a dangling reference, an unreachable trace, an overwritten
 * explanation and an id out of sequence. Three of the four produce a state that looks
 * perfectly valid afterwards, which is why they are refused at the door rather than
 * detected later.
 */

describe('withEvent advances exactly five counters', () => {
  it('moves the event id, the state version, logical time and the ordinal', () => {
    const before = aState();
    const after = withEvent(before, anAcceptance(), aTrace(), 1n);

    expect(after.metadata.nextEventId).toBe(1);
    expect(after.metadata.stateVersion).toBe(1);
    expect(after.metadata.logicalTime).toBe(0);
    expect(after.metadata.nextDecisionOrdinal).toBe(1n);
    expect(after.history).toHaveLength(1);
  });

  it('leaves the state it was given untouched', () => {
    const before = aState();
    withEvent(before, anAcceptance(), aTrace(), 1n);

    expect(before.metadata.nextEventId).toBe(0);
    expect(before.metadata.stateVersion).toBe(0);
    expect(before.history).toEqual([]);
  });

  it('follows the event when logical time moves forward', () => {
    const after = withEvent(aState(), anAcceptance({ logicalTime: 5 }), aTrace(), 0n);

    expect(after.metadata.logicalTime).toBe(5);
  });

  it('accepts an event at the current logical time, because answering an offer takes no time', () => {
    // Heroes answering the same offer all happen within the campaign's current logical
    // time; advancing the clock is a tick's job, not a proposal's.
    const first = withEvent(aState(), anAcceptance(), aTrace(), 1n);
    const second = withEvent(
      first,
      anAcceptance({ eventId: 1, causalTraceId: 1 }),
      aTrace({ traceId: 1 }),
      1n
    );

    expect(second.metadata.logicalTime).toBe(0);
    expect(second.metadata.nextDecisionOrdinal).toBe(2n);
  });

  it('adds what the transition spent to the ordinal rather than replacing it', () => {
    // A rejection-sampled draw costs more than one ordinal, and the count has to
    // accumulate: an assignment here would silently reset the campaign's randomness.
    const first = withEvent(aState(), anAcceptance(), aTrace(), 2n);
    const second = withEvent(
      first,
      anAcceptance({ eventId: 1, causalTraceId: 1 }),
      aTrace({ traceId: 1 }),
      3n
    );

    expect(second.metadata.nextDecisionOrdinal).toBe(5n);
  });

  it('does not move the ordinal for a transition that drew nothing', () => {
    const after = withEvent(aState(), anAcceptance(), aTrace(), 0n);

    expect(after.metadata.nextDecisionOrdinal).toBe(0n);
  });

  it('is not what an ordinary spread does', () => {
    // The hole this note guards: `{...state}` always compiles and always produces a new
    // state, so the rule "only withEvent advances the counters" is a convention that
    // needs a test rather than a type. The C# original had the same hole with `with`.
    const before = aState();
    const copied = { ...before, history: [anAcceptance()] };

    expect(copied.metadata.stateVersion).toBe(0);
    expect(copied.metadata.nextEventId).toBe(0);
  });
});

describe('withEvent refuses an event out of order', () => {
  it('rejects an event id that is not the next one', () => {
    expect(() => withEvent(aState(), anAcceptance({ eventId: 7 }), aTrace(), 0n)).toThrow(
      /Event id 7 is out of order; expected 0/
    );
  });

  it('rejects an event dated before the campaign', () => {
    // Without this the log was not monotone in time — an event at logical time -999
    // appended happily after one at 0 — and the campaign clock was a field nothing ever
    // moved or checked, so "when did this happen" had no answer history could confirm.
    const first = withEvent(aState(), anAcceptance({ logicalTime: 5 }), aTrace(), 0n);

    expect(() =>
      withEvent(first, anAcceptance({ eventId: 1, logicalTime: 4, causalTraceId: 0 }), null, 0n)
    ).toThrow(/is before the campaign's current logical time/);
  });
});

describe('withEvent and the trace it stores', () => {
  it('stores a new explanation and advances the trace id', () => {
    const after = withEvent(aState(), anAcceptance(), aTrace(), 1n);

    expect(after.metadata.nextTraceId).toBe(1);
    expect(after.traces.get(0)).toEqual(aTrace());
  });

  it('does not advance the trace id when no new trace was stored', () => {
    // The counter moves per *stored* trace, not per call. Two decisions in a row must
    // get two addressable explanations instead of the second overwriting the first.
    const first = withEvent(aState(), anAcceptance(), aTrace(), 1n);
    const second = withEvent(first, anAcceptance({ eventId: 1, causalTraceId: 0 }), null, 0n);

    expect(second.metadata.nextTraceId).toBe(1);
    expect(second.traces.size).toBe(1);
  });

  it('lets a later event reference an explanation already stored', () => {
    const first = withEvent(aState(), anAcceptance(), aTrace(), 1n);
    const second = withEvent(first, anAcceptance({ eventId: 1, causalTraceId: 0 }), aTrace(), 0n);

    expect(second.traces.size).toBe(1);
    expect(second.metadata.nextTraceId).toBe(1);
  });

  it('refuses a reference to an explanation nothing stored', () => {
    // The reference would dangle: the event claims to be explained and nothing explains
    // it, which is only discoverable when somebody tries to read the explanation.
    expect(() => withEvent(aState(), anAcceptance({ causalTraceId: 4 }), null, 0n)).toThrow(
      /the reference would dangle/
    );
  });

  it('refuses a trace no event points at', () => {
    // The mirror image: the explanation would sit in state unreachable from any event.
    expect(() => withEvent(aState(), anAcceptance({ causalTraceId: null }), aTrace(), 0n)).toThrow(
      /it would be stored unreachably/
    );
  });

  it('refuses a trace whose id disagrees with the event', () => {
    expect(() =>
      withEvent(aState(), anAcceptance({ causalTraceId: 0 }), aTrace({ traceId: 1 }), 0n)
    ).toThrow(/does not match the event's causalTraceId/);
  });

  it('refuses to overwrite a stored explanation with different content', () => {
    // A second decision must never erase what the first one already explained.
    const first = withEvent(aState(), anAcceptance(), aTrace(), 1n);

    expect(() =>
      withEvent(
        first,
        anAcceptance({ eventId: 1, causalTraceId: 0 }),
        aTrace({ tieBreak: 'hero.decision.no_reason_to_refuse' }),
        0n
      )
    ).toThrow(/already stored with different content/);
  });

  it('refuses a new explanation stored under any id but the next free one', () => {
    // Accepting an arbitrary id would let the counter point at an occupied id later:
    // store id 7 while it reads 0, then store 0..6, and it reads 7 again — over an
    // existing key.
    expect(() =>
      withEvent(aState(), anAcceptance({ causalTraceId: 7 }), aTrace({ traceId: 7 }), 0n)
    ).toThrow(/is not the campaign's next free trace id/);
  });

  it('compares a stored explanation by content, not by identity', () => {
    // Two independently built traces with the same factors are the same explanation.
    // This is what the C# port needed eight hand-written `Equals` overrides for; here
    // it is one rule, and this is the call site that depends on it.
    const first = withEvent(aState(), anAcceptance(), aTrace(), 1n);
    const rebuilt = {
      traceId: 0,
      positiveFactors: [],
      negativeFactors: [],
      blockedBy: [],
      tieBreak: null
    };

    expect(() =>
      withEvent(first, anAcceptance({ eventId: 1, causalTraceId: 0 }), rebuilt, 0n)
    ).not.toThrow();
  });
});

describe('lookups', () => {
  it('name the entity they could not find', () => {
    const state = aState();

    expect(heroOf(state, 0 as never)).toBe(state.heroes.get(0 as never));
    expect(() => heroOf(state, 9 as never)).toThrow(/Unknown hero 'hero#9'/);
    expect(contractOf(state, ids.crypt).id).toBe(ids.crypt);
    expect(() => contractOf(state, ids.bram)).toThrow(/Unknown contract 'core:bram'/);
  });
});
