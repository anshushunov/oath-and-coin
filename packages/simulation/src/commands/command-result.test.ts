import { describe, expect, it } from 'vitest';

import { SortedMap } from '../collections/sorted-map.ts';
import { Actions } from '../decisions/actions.ts';
import { proposeContractToHero } from '../engine.ts';
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
import { fromDecisions } from './command-result.ts';

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
    const contract = aContract({ offer: anOffer({ advance: 70 }) });
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
