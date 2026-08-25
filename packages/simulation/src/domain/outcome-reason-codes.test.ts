import { describe, expect, it } from 'vitest';

import { isArtifactSafeText } from '../canonical/artifact-domain.ts';

import { OUTCOME_REASON_CODES, OutcomeReasonCodes } from './outcome-reason-codes.ts';

/**
 * The outcome's own closed vocabulary, held to the same two properties
 * `vocabulary.test.ts` holds the decision's to — and to a third one it does not need.
 *
 * A code here names why a number in the outcome is what it is (`RESOLUTION_SPEC` §2.1),
 * it reaches a canonical artifact through the events the resolution produces, and it
 * becomes a localization key on the debrief screen. What it is *not* is a factor in a
 * hero's `CausalTrace`: `FACTOR_REASON_CODES` is the vocabulary of why a person answered
 * the way they did, and an outcome code there would claim a hero was moved by an event
 * that had not happened when he answered.
 *
 * That last property — the two vocabularies share no string — is asserted in
 * `decisions/vocabulary.test.ts` rather than here, and the placement is the boundary rule
 * doing its job: nothing under `domain/`, tests included, may import the rules
 * (`ADR-014` §4, `domain-vocabulary-imports-only-what-is-below-it`). The file that owns
 * the decision dictionary can see both vocabularies; this one cannot, and does not need to.
 */

describe('the outcome reason vocabulary', () => {
  it.each(OUTCOME_REASON_CODES)('каждый код причины исхода пригоден для артефакта: %s', (code) => {
    expect(isArtifactSafeText(code)).toBe(true);
  });

  it('перечисляет каждый объявленный код ровно один раз', () => {
    expect(OUTCOME_REASON_CODES).toEqual(Object.values(OutcomeReasonCodes));
    expect(new Set(OUTCOME_REASON_CODES).size).toBe(OUTCOME_REASON_CODES.length);
  });

  it('держит коды в собственном пространстве имён outcome.', () => {
    for (const code of OUTCOME_REASON_CODES) {
      expect(code.startsWith('outcome.')).toBe(true);
    }
  });
});
