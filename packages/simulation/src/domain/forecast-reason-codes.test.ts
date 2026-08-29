import { describe, expect, it } from 'vitest';

import { isArtifactSafeText } from '../canonical/artifact-domain.ts';

import { FORECAST_REASON_CODES, ForecastReasonCodes } from './forecast-reason-codes.ts';

/**
 * The forecast's own closed vocabulary, held to the same properties the other two are
 * (`COMBAT_SPEC` §10.1, `DEC-006`).
 *
 * The third property — that no string is shared with the decision or outcome vocabularies —
 * is asserted in `decisions/vocabulary.test.ts` for the reason `outcome-reason-codes.test.ts`
 * gives beside its own: nothing under `domain/`, tests included, may import the rules
 * (`ADR-014` §4), and that file is the one allowed to see every dictionary at once.
 */

describe('the forecast reason vocabulary', () => {
  it.each(FORECAST_REASON_CODES)('каждый код прогноза пригоден для артефакта: %s', (code) => {
    expect(isArtifactSafeText(code)).toBe(true);
  });

  it('перечисляет каждый объявленный код ровно один раз', () => {
    expect(FORECAST_REASON_CODES).toEqual(Object.values(ForecastReasonCodes));
    expect(new Set(FORECAST_REASON_CODES).size).toBe(FORECAST_REASON_CODES.length);
  });

  it('держит коды в собственном пространстве имён forecast.', () => {
    for (const code of FORECAST_REASON_CODES) {
      expect(code.startsWith('forecast.')).toBe(true);
    }
  });

  it('объявляет порядок, потому что порядок и есть ранжирование (DEC-006)', () => {
    // `DEC-006` разрешает ранжированные причины и запрещает числа. Ранг здесь — позиция в
    // объявлении, а не вес: взвешенная сумма была бы вероятностью, у которой стёрли число.
    expect(FORECAST_REASON_CODES[0]).toBe(ForecastReasonCodes.ObjectiveUncovered);
    expect(FORECAST_REASON_CODES.at(-1)).toBe(ForecastReasonCodes.BondMayBreakTheDoctrine);
  });
});
