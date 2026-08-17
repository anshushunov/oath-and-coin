import { describe, expect, it } from 'vitest';

import { divideTowardZero } from './integer-division.ts';

/**
 * The rounding the port has to get right and the corpus cannot check.
 *
 * `Math.floor` and `Math.trunc` differ only on negative dividends, and every dividend
 * the decision rule forms on shipped content is non-negative — so a mutant swapping one
 * for the other passes all 54 frozen entries. That is the whole reason this table
 * exists: the pairs below are the ones where C#'s `/` and JavaScript's `Math.floor`
 * disagree, stated as data rather than inferred from a decision that happens not to
 * reach them today.
 */

describe('divideTowardZero rounds the way C# integer division does', () => {
  it.each([
    [7, 2, 3],
    [-7, 2, -3],
    [7, -2, -3],
    [-7, -2, 3],
    [-3150, 100, -31],
    [3150, 100, 31],
    [-1, 100, 0],
    [-99, 100, 0],
    [-100, 100, -1],
    [0, 100, 0]
  ])('%i / %i is %i', (dividend, divisor, expected) => {
    expect(divideTowardZero(dividend, divisor)).toBe(expected);
  });

  it('never answers negative zero, a value C# integer division cannot produce', () => {
    // `Math.trunc(-1 / 100)` is `-0`. It compares equal to `0` under `===`, `<` and `>`,
    // so it would travel through a factor magnitude and into an artifact unnoticed.
    for (const dividend of [-1, -50, -99]) {
      expect(Object.is(divideTowardZero(dividend, 100), 0)).toBe(true);
    }
  });

  it('disagrees with flooring on exactly the negative, non-exact cases', () => {
    // Stated as a property rather than as more rows: the point is not that these five
    // numbers round this way, it is that the two roundings are the same function
    // everywhere else — which is why the corpus cannot separate them.
    for (let dividend = -250; dividend <= 250; dividend++) {
      const truncated = divideTowardZero(dividend, 100);
      const floored = Math.floor(dividend / 100);
      const differ = dividend < 0 && dividend % 100 !== 0;

      expect(truncated === floored).toBe(!differ);
    }
  });
});
