import { describe, expect, it } from 'vitest';

import { isArtifactSafeText } from '../canonical/artifact-domain.ts';
import { REASON_CODES } from '../decisions/reason-codes.ts';

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

  it('словарь исхода не пересекается со словарём решения', () => {
    // Граница, которую легко потерять: `REASON_CODES` — вокабуляр трассы решения героя,
    // и код исхода там бессмыслен. Пересечение означало бы, что одна строка означает
    // две разные вещи в зависимости от того, кто её прочитал, — а читают её и кодек
    // сейва, закрывающий поля трассы на своих множествах, и каталог локализации.
    const decisionCodes: readonly string[] = REASON_CODES;
    const shared = OUTCOME_REASON_CODES.filter((code) => decisionCodes.includes(code));

    expect(shared, `объявлены и как код исхода, и как код решения: ${shared.join(', ')}`).toEqual(
      []
    );
  });
});
