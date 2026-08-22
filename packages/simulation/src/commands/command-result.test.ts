import { describe, expect, it } from 'vitest';

import { Actions } from '../decisions/actions.ts';
import { proposeContractToHero } from '../engine.ts';
import { heroId } from '../ids/hero-id.ts';
import { aState, anAcceptance, ids } from '../testing/fixtures.ts';

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
    const result = proposeContractToHero(aState(), aProposal());

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
