import { describe, expect, it } from 'vitest';

import { SortedMap } from '../collections/sorted-map.ts';
import { Actions } from '../decisions/actions.ts';
import { proposeContractToHero } from '../engine.ts';
import type { DomainEvent } from '../events/domain-event.ts';
import { heroId } from '../ids/hero-id.ts';
import {
  aContract,
  aState,
  anAcceptance,
  anOffer,
  compareContentIds,
  ids
} from '../testing/fixtures.ts';

import type { ProposeContractToHero } from './propose-contract-to-hero.ts';
import { fromDecisions, fromEvents } from './command-result.ts';

/**
 * `CommandResult.decisions` carries every decision a command produced, not one — the
 * property `pollCrew` (Tasks 6, 10-14) will need several of at once, and the shape has
 * to hold that shape from the day the field exists rather than being widened later under
 * a command already relying on "at most one".
 */

function aProposal(overrides: Partial<ProposeContractToHero> = {}): ProposeContractToHero {
  return {
    commandId: 1,
    heroId: heroId(0),
    contractId: ids.crypt,
    expectedStateVersion: 0,
    ...overrides
  };
}

describe('a command result carries every decision it produced', () => {
  it('carries every decision a command produced, in event order', () => {
    // `aState()`'s default contract carries no advance (`DEC-008` Tasks 10-14 are what
    // wire a command that would compose one), so this test states one itself — the
    // same 70 the default `patronFee` used to contribute before `NEGOTIATION_SPEC` §4
    // moved the benefit term onto `offer.advance` — to keep the hero accepting, which
    // is the only thing this test is about.
    const contract = aContract({ offer: anOffer({ keyHero: heroId(0), advance: 70 }) });
    const state = aState({
      contracts: SortedMap.from(compareContentIds, [[contract.id, contract]])
    });

    const result = proposeContractToHero(state, aProposal());

    expect(result.decisions).toHaveLength(1);
    expect(result.decisions[0]!.selectedAction).toBe(Actions.Accept);
  });

  it('carries no decisions at all when the command was refused', () => {
    const state = aState();
    const result = proposeContractToHero(state, aProposal({ expectedStateVersion: 99 }));

    expect(result.decisions).toEqual([]);
    expect(result.state).toBe(state);
  });

  it('refuses a result whose decisions and events disagree in number', () => {
    expect(() => fromDecisions(aState(), [anAcceptance()], [])).toThrow(/one decision per event/);
  });
});

describe('a command whose several events explain themselves (`RESOLUTION_SPEC` §3.3)', () => {
  const anOutcomeEvent = (eventId: number, causalTraceId: number | null = null): DomainEvent => ({
    kind: 'objective_taken',
    eventId,
    logicalTime: 0,
    causalTraceId,
    contractId: ids.crypt
  });

  it('carries all of them, with no decisions to pair', () => {
    // The shape neither other constructor can build: `fromEvent` takes exactly one, and
    // `fromDecisions` demands a `DecisionResult` per event. A resolution has as many
    // events as the outcome had things to say and nobody chose any of them.
    const state = aState();
    const events = [anOutcomeEvent(0), anOutcomeEvent(1), anOutcomeEvent(2)];
    const result = fromEvents(state, events);

    expect(result.applied).toBe(true);
    expect(result.rejectionCode).toBeNull();
    expect(result.events).toEqual(events);
    expect(result.decisions).toEqual([]);
    expect(Object.is(result.state, state)).toBe(true);
  });

  it('refuses an event that carries an explanation', () => {
    // A traced event is a decision, and a decision belongs in `fromDecisions` paired with
    // what explains it. Checked on every event, not only the first — a list where the
    // third one carries a trace is exactly what a loop testing `events[0]` would admit.
    expect(() =>
      fromEvents(aState(), [anOutcomeEvent(0), anOutcomeEvent(1), anOutcomeEvent(2, 7)])
    ).toThrow(/causalTraceId/u);
  });

  it('refuses an empty list', () => {
    // A command that applied and produced nothing would grow `appliedCommandIds` without
    // growing `history` — the counter invariant `validate-game-state.ts` holds, and the
    // failure `pollCrew`'s own `NobodyLeftToPoll` exists to prevent one command earlier.
    expect(() => fromEvents(aState(), [])).toThrow(/no events/u);
  });
});
