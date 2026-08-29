/**
 * Where a combatant stands (`COMBAT_SPEC` §3.1).
 *
 * **Vocabulary, not geometry.** The rules that read a cell — obstruction, reach,
 * repositioning — live in `combat/field.ts` and are not here. What is here is the shape a
 * cell *is*, and it is here for the reason `RESOLUTION_SPEC` §2.7 gives about the rest of
 * the outcome vocabulary: a player's formation is stored on the contract's package
 * (`COMBAT_SPEC` §3.7) and a battle record is stored on its resolution (§6.4), so
 * `state/` has to be able to name a cell — and `domain/` is the one directory `state/` is
 * allowed to depend on.
 */

export type Row = 1 | 2 | 3;
export type Column = 1 | 2 | 3;

/** Rows nearest the enemy first: `1` столкновение, `2` опора, `3` тыл. */
export const ROWS: readonly Row[] = Object.freeze([1, 2, 3]);
export const COLUMNS: readonly Column[] = Object.freeze([1, 2, 3]);

export interface Cell {
  readonly row: Row;
  readonly column: Column;
}

export type BattleSide = 'crew' | 'foe';

/** The two sides, so a reader can name "the other one" without an `if`. */
export function opposing(side: BattleSide): BattleSide {
  return side === 'crew' ? 'foe' : 'crew';
}

/**
 * A cell as one comparable string, in the order a reader reads a board: row, then column.
 *
 * Exists so a formation can be keyed and sorted without every caller inventing its own
 * spelling — two spellings of one key is where a placement stored under one and looked up
 * under the other becomes an empty cell nobody placed anybody on.
 */
export function cellKey(cell: Cell): string {
  return `${String(cell.row)}:${String(cell.column)}`;
}
