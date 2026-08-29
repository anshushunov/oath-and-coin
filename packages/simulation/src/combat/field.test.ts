import { describe, expect, it } from 'vitest';

import {
  MIN_EFFECT_PERCENT,
  blockersBetween,
  effectPercent,
  isAdjacent,
  isColumnClearThrough,
  isColumnOpen,
  occupantOf,
  type BattleSide,
  type Cell,
  type Column,
  type Positioned,
  type Row
} from './field.ts';

/**
 * The arithmetic `COMBAT_SPEC` §4.5 rests on, on coordinates rather than in prose.
 *
 * The table in that section is the argument for why an empty cell is worth anything at
 * all; it was **wrong** in the spec's first edition — it claimed a filled front row cost
 * the rear two steps of obstruction when it costs one — and the error made the case look
 * stronger than it is. These are the numbers, checked.
 */

const at = (side: BattleSide, row: Row, column: Column): Positioned => ({
  side,
  cell: { row, column },
  standing: true
});

const cell = (row: Row, column: Column): Cell => ({ row, column });

describe('obstruction counts what is in front of the shooter and what is in front of the target', () => {
  it('is nought down an empty column', () => {
    const shooter = at('crew', 3, 2);
    const target = at('foe', 1, 2);

    expect(blockersBetween(shooter, target, [shooter, target])).toBe(0);
    expect(effectPercent(0, 0)).toBe(100);
  });

  it("counts the shooter's own cells — which is where §4.5's benefit comes from", () => {
    const shooter = at('crew', 3, 2);
    const target = at('foe', 1, 2);
    const ownFront = at('crew', 1, 2);
    const ownSupport = at('crew', 2, 2);

    expect(blockersBetween(shooter, target, [shooter, target, ownFront])).toBe(1);
    expect(effectPercent(1, 0)).toBe(70);

    expect(blockersBetween(shooter, target, [shooter, target, ownFront, ownSupport])).toBe(2);
    expect(effectPercent(2, 0)).toBe(40);
  });

  it("counts the target's own cover the same way", () => {
    const shooter = at('crew', 3, 2);
    const target = at('foe', 3, 2);
    const theirFront = at('foe', 1, 2);
    const theirSupport = at('foe', 2, 2);

    expect(blockersBetween(shooter, target, [shooter, target, theirFront, theirSupport])).toBe(2);
  });

  it('charges for the angle, so a straight shot stays the better one', () => {
    const shooter = at('crew', 3, 2);
    const across = at('foe', 1, 3);
    const straight = at('foe', 1, 2);

    expect(blockersBetween(shooter, across, [shooter, across, straight])).toBe(1);
    expect(blockersBetween(shooter, straight, [shooter, across, straight])).toBe(0);
  });

  it('is the naive rule when both are in one column — a generalisation, not a second rule', () => {
    const shooter = at('crew', 3, 1);
    const target = at('foe', 2, 1);
    const between = [at('crew', 2, 1), at('foe', 1, 1)];

    // One of the shooter's own and one of the target's: exactly the cells a reader would
    // point at on the board, and no lateral term because the columns agree.
    expect(blockersBetween(shooter, target, [shooter, target, ...between])).toBe(2);
  });

  it('ignores the fallen, who block nothing', () => {
    const shooter = at('crew', 3, 2);
    const target = at('foe', 1, 2);
    const fallen: Positioned = { ...at('crew', 1, 2), standing: false };

    expect(blockersBetween(shooter, target, [shooter, target, fallen])).toBe(0);
  });

  it.each([
    [0, 100],
    [1, 70],
    [2, 40],
    [3, MIN_EFFECT_PERCENT],
    [4, MIN_EFFECT_PERCENT]
  ])('%i blockers leave %i%% of the effect', (blockers, percent) => {
    expect(effectPercent(blockers, 0)).toBe(percent);
  });

  it('cannot be told apart by where the blockers came from — which is what the mutant needs', () => {
    // Two of the shooter's own, two of the target's, and one of each plus one column of
    // angle: three different boards, the same count, the same effect. A rule that counted
    // only the enemy's cells would answer 40, 40 and 70 to these three instead of 40
    // throughout, and the first of them is the case that reddens it.
    const shooter = at('crew', 3, 2);

    const ownTwo = [at('crew', 1, 2), at('crew', 2, 2)];
    const targetInFront = at('foe', 1, 2);
    const targetBehindTwo = at('foe', 3, 2);
    const theirTwo = [at('foe', 1, 2), at('foe', 2, 2)];
    const acrossOne = at('foe', 2, 3);
    const oneOwn = at('crew', 1, 2);
    const oneTheirs = at('foe', 1, 3);

    expect(blockersBetween(shooter, targetInFront, [shooter, targetInFront, ...ownTwo])).toBe(2);
    expect(blockersBetween(shooter, targetBehindTwo, [shooter, targetBehindTwo, ...theirTwo])).toBe(
      2
    );
    expect(blockersBetween(shooter, acrossOne, [shooter, acrossOne, oneOwn, oneTheirs])).toBe(3);
  });

  it('never falls below the floor, however crowded the line', () => {
    expect(effectPercent(10, 0)).toBe(MIN_EFFECT_PERCENT);
  });

  it('adds a chilled actor to the same reduction rather than flooring twice', () => {
    // One blocker and a chilled actor: 100 − 30 − 30 = 40. Applied separately with a floor
    // each time the answer would be 70% of 70%, which is 49 — a different number, and the
    // reason the floor is stated over the combined reduction.
    expect(effectPercent(1, 30)).toBe(40);
  });
});

describe('a column is described by what stands in it', () => {
  const front = at('crew', 1, 1);
  const rear = at('crew', 3, 1);

  it('is open when its front cell is empty, whatever is behind', () => {
    expect(isColumnOpen('crew', 1, [rear])).toBe(true);
    expect(isColumnOpen('crew', 1, [front, rear])).toBe(false);
  });

  it('is clear through only when all three cells are empty', () => {
    expect(isColumnClearThrough('crew', 1, [rear])).toBe(false);
    expect(isColumnClearThrough('crew', 1, [])).toBe(true);
  });

  it('names its occupant, or nobody', () => {
    expect(occupantOf('crew', cell(1, 1), [front, rear])).toBe(front);
    expect(occupantOf('crew', cell(2, 1), [front, rear])).toBeNull();
    expect(occupantOf('foe', cell(1, 1), [front, rear])).toBeNull();
  });
});

describe('one orthogonal step, and no other kind', () => {
  it.each([
    [cell(1, 1), cell(2, 1), true],
    [cell(1, 1), cell(1, 2), true],
    [cell(1, 1), cell(2, 2), false],
    [cell(1, 1), cell(3, 1), false],
    [cell(1, 1), cell(1, 1), false]
  ])('%o → %o is %s', (from, to, adjacent) => {
    expect(isAdjacent(from, to)).toBe(adjacent);
  });
});
