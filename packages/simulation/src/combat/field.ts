import {
  COLUMNS,
  ROWS,
  cellKey,
  opposing,
  type BattleSide,
  type Cell,
  type Column,
  type Row
} from '../domain/battle-cell.ts';

/**
 * The board and the one quantity every rule of the geometry is expressed through
 * (`COMBAT_SPEC` §3.1, §4.3).
 *
 * `DEC-011` accepted a 3×3 field and a crew of 4–6 and explicitly accepted no geometry;
 * §4 of the spec is that geometry, and this module is the half of it that is pure
 * arithmetic over positions. Nothing here knows what an action is or what damage means.
 *
 * The **shape** of a cell is not here but in `domain/battle-cell.ts`, and the split is the
 * one `RESOLUTION_SPEC` §2.7 already draws: a player's formation is stored on the
 * contract's package (`COMBAT_SPEC` §3.7), so `state/` has to be able to name a cell, and
 * `state/` may only reach `domain/`. The rules below stay here, where nothing outside the
 * combat core needs them.
 */

export { COLUMNS, ROWS, cellKey, opposing };
export type { BattleSide, Cell, Column, Row };

/** What the geometry needs to know about a unit, and nothing else. */
export interface Positioned {
  readonly side: BattleSide;
  readonly cell: Cell;
  readonly standing: boolean;
}

/**
 * Each obstructing element costs this many percentage points of effect
 * (`COMBAT_SPEC` §4.3).
 */
export const OBSTRUCTION_STEP = 30;

/** However much is in the way, an action never falls below this share of its effect. */
export const MIN_EFFECT_PERCENT = 25;

/** What one column of lateral distance costs a shot, in obstructing elements. */
export const LATERAL_BLOCKERS = 1;

/**
 * What stands between a shot and its target (`COMBAT_SPEC` §4.3).
 *
 * Three terms, and the third is why there are three at all: a rear unit may fire into a
 * *neighbouring* column, and for such a shot there is no shared vertical line to count
 * cells along. The obvious answer — "zero obstruction across columns" — would make
 * stepping one column sideways a free way around every screen, which is §4.3–§4.5
 * repealed. So the rule counts what is in front of the shooter on his own line, what is in
 * front of the target on hers, and charges for the angle.
 *
 * **Own cells count exactly like the enemy's**, and that single decision is where §4.5
 * comes from: the empty column in front of a rear unit is that unit's line of fire, and it
 * is the enemy's corridor to that unit at the same time. One rule, read from two sides.
 *
 * Degenerate case checked rather than assumed: with shooter and target in one column the
 * lateral term is nought and the answer is the naive "cells between", so this is a
 * generalisation of that rule and not a second one beside it.
 */
export function blockersBetween(
  shooter: Positioned,
  target: Positioned,
  units: readonly Positioned[]
): number {
  const ahead = (of: Positioned): number =>
    units.filter(
      (unit) =>
        unit.standing &&
        unit.side === of.side &&
        unit.cell.column === of.cell.column &&
        unit.cell.row < of.cell.row
    ).length;

  const lateral = Math.abs(shooter.cell.column - target.cell.column) * LATERAL_BLOCKERS;

  return ahead(shooter) + ahead(target) + lateral;
}

/**
 * What share of its effect an action keeps, given what is in the way and whether the actor
 * is chilled (`COMBAT_SPEC` §3.6).
 *
 * The floor is applied to the *combined* reduction rather than to each part, which is what
 * makes two chilled steps and one obstruction step add up the way a reader expects.
 */
export function effectPercent(blockers: number, chillPoints: number): number {
  return Math.max(MIN_EFFECT_PERCENT, 100 - chillPoints - OBSTRUCTION_STEP * blockers);
}

/** Whoever is standing on that cell, or `null` (`COMBAT_SPEC` §3.1: at most one). */
export function occupantOf<T extends Positioned>(
  side: BattleSide,
  cell: Cell,
  units: readonly T[]
): T | null {
  return (
    units.find(
      (unit) =>
        unit.standing &&
        unit.side === side &&
        unit.cell.row === cell.row &&
        unit.cell.column === cell.column
    ) ?? null
  );
}

/**
 * A column of a side is **open** when its front cell is empty, and **clear through** when
 * all three are (`COMBAT_SPEC` §4.4).
 *
 * Two predicates rather than one, because they have different consequences: an open column
 * lets melee reach depth 2 and 3 of that column, and a clear-through one sends melee into
 * the neighbour instead — a column that protects nobody and redirects the blow onto the
 * units beside it.
 */
export function isColumnOpen(
  side: BattleSide,
  column: Column,
  units: readonly Positioned[]
): boolean {
  return occupantOf(side, { row: 1, column }, units) === null;
}

export function isColumnClearThrough(
  side: BattleSide,
  column: Column,
  units: readonly Positioned[]
): boolean {
  return ROWS.every((row) => occupantOf(side, { row, column }, units) === null);
}

/**
 * Whether two cells of one side are one orthogonal step apart (`COMBAT_SPEC` §4.6).
 *
 * No diagonals, no path-finding, no collision order — `DEC-011` §4 refused all three, and
 * this is what refusing them looks like in one line.
 */
export function isAdjacent(from: Cell, to: Cell): boolean {
  const rows = Math.abs(from.row - to.row);
  const columns = Math.abs(from.column - to.column);

  return rows + columns === 1;
}
