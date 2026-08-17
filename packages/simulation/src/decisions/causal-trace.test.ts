import { describe, expect, it } from 'vitest';

import { parseContentId } from '../ids/content-id.ts';
import { aTrace, ids } from '../testing/fixtures.ts';

import { createDecisionResult } from './causal-trace.ts';

const accept = parseContentId('action:accept');
const decline = parseContentId('action:decline');

/**
 * The two cross-field invariants a decision has to satisfy, and the reason each one is
 * refused at construction rather than checked by whoever reads the result.
 */

describe('createDecisionResult', () => {
  it('accepts a scored decision', () => {
    const result = createDecisionResult({
      selectedAction: accept,
      consideredActions: [accept, decline],
      selectedScore: 24,
      trace: aTrace()
    });

    expect(result.selectedScore).toBe(24);
  });

  it('accepts a blocked decision with no score', () => {
    const result = createDecisionResult({
      selectedAction: decline,
      consideredActions: [accept, decline],
      selectedScore: null,
      trace: aTrace({
        blockedBy: [
          { reasonCode: 'hero.decision.principle_forbids', sourceEntity: ids.refusesTemples }
        ]
      })
    });

    expect(result.selectedScore).toBeNull();
    expect(result.trace.blockedBy).toHaveLength(1);
  });

  it('refuses a selection that was never considered', () => {
    // `TDD` §8: the chosen action is among the allowed ones. A result that selected
    // something absent from its own list would make the list decorative.
    expect(() =>
      createDecisionResult({
        selectedAction: parseContentId('action:flee'),
        consideredActions: [accept, decline],
        selectedScore: 0,
        trace: aTrace()
      })
    ).toThrow(/must be among consideredActions/);
  });

  it('refuses a score alongside a block', () => {
    // A red line closes the decision *before* any score exists (HERO_DECISION_SPEC
    // §2.2). Carrying both would say money was weighed against a principle, which is
    // the reading this model exists to rule out.
    expect(() =>
      createDecisionResult({
        selectedAction: decline,
        consideredActions: [accept, decline],
        selectedScore: -12,
        trace: aTrace({
          blockedBy: [
            { reasonCode: 'hero.decision.principle_forbids', sourceEntity: ids.refusesTemples }
          ]
        })
      })
    ).toThrow(/must be null when trace.blockedBy is non-empty/);
  });

  it('refuses a missing score without a block', () => {
    // The other half, and it is not symmetry for its own sake: the equivalence "no score
    // ⟺ there is a block" is checked from both sides, so an absent score cannot become
    // a quiet way of saying nothing at all.
    expect(() =>
      createDecisionResult({
        selectedAction: accept,
        consideredActions: [accept, decline],
        selectedScore: null,
        trace: aTrace()
      })
    ).toThrow(/must not be null when trace.blockedBy is empty/);
  });

  it('accepts an honest zero, which is not the same as an absent score', () => {
    // Zero is why the absence has to be `null` and never a placeholder: under the
    // "accept at score ≥ 0" rule a zero placeholder would read as consent, and the
    // check "the factors sum to the result" would pass for the wrong reason.
    const result = createDecisionResult({
      selectedAction: accept,
      consideredActions: [accept, decline],
      selectedScore: 0,
      trace: aTrace({ tieBreak: 'hero.decision.no_reason_to_refuse' })
    });

    expect(result.selectedScore).toBe(0);
  });
});
