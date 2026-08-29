import {
  COLUMNS,
  CombatRole,
  ROWS,
  SortedMap,
  cellKey,
  compareHeroIds,
  type Cell,
  type Column,
  type HeroId,
  type Row
} from '@oath-and-coin/simulation';

/**
 * The three shapes every battle in the frozen set is fought in (`COMBAT_SPEC` §13.1).
 *
 * **Shapes, not fixed cells.** `formation-matrix.ts` names three formations of one
 * five-man roster, cell by cell, and that is right for a refuting check on one roster. A
 * balance run fights every legal crew of every shipped contract, and the crews differ in
 * how many of each role they hold — so a formation here has to be a *rule* that answers
 * for any crew, or the set would be three rosters rather than three shapes.
 *
 * **Everyone stands in his own row in all three.** §4.1 gives each row its own set of
 * actions, so a formation that parked an archer in the front rank would lose for a reason
 * that is not its shape — the mistake `2026-08-29-HANDOFF-combat-lab.md` records the
 * matrix's first version making. What differs between the three is only where the gaps are.
 */

/** Where each role belongs (`COMBAT_SPEC` §3.3). A `Breaker` prefers the front. */
const HOME_ROW: Readonly<Record<CombatRole, Row>> = Object.freeze({
  [CombatRole.Vanguard]: 1,
  [CombatRole.Support]: 2,
  [CombatRole.Rear]: 3,
  [CombatRole.Breaker]: 1
});

export const FormationShape = Object.freeze({
  /** Column 2 first: the middle carries whoever will fit, and the rear fires through them. */
  Stacked: 'stacked',
  /** The flanks first: column 2 is the last one filled, so it is usually the open one. */
  Corridor: 'corridor',
  /** Round robin over the whole crew, so no column carries more than it has to. */
  Spread: 'spread'
});

export type FormationShape = (typeof FormationShape)[keyof typeof FormationShape];

export const FORMATION_SHAPES: readonly FormationShape[] = Object.freeze(
  Object.values(FormationShape)
);

/** What a formation needs to know about a member of the crew. */
export interface Placeable {
  readonly hero: HeroId;
  readonly role: CombatRole;
}

/**
 * Where this crew stands in this shape, given whatever the contract already put on the
 * board.
 *
 * Deterministic and total: the crew is walked in hero-id order, each man takes the first
 * free cell of his own row in his shape's column order, and — if his row is full — the
 * nearest free cell of any row. The fallback is reachable: a crew of six with four rear
 * units has more archers than the rear row holds, and refusing to place them would silently
 * drop cases from the frozen set rather than measure them.
 */
export function formationOf(
  shape: FormationShape,
  crew: readonly Placeable[],
  taken: readonly Cell[] = []
): SortedMap<HeroId, Cell> {
  const used = new Set(taken.map(cellKey));
  const ordered = [...crew].sort((left, right) => compareHeroIds(left.hero, right.hero));
  const cells: (readonly [HeroId, Cell])[] = [];

  ordered.forEach((member, index) => {
    const home = HOME_ROW[member.role];
    const cell =
      firstFree(home, columnsFor(shape, index), used) ??
      // His row is full. The nearest row that is not, from his own outward, so a crew that
      // does not fit its rows still stands somewhere stated rather than nowhere.
      ROWS.map((row) => firstFree(row, columnsFor(shape, index), used)).find(
        (found) => found !== null
      ) ??
      null;

    if (cell === null) {
      throw new Error(
        `A crew of ${String(crew.length)} does not fit a board of nine with ` +
          `${String(taken.length)} cell(s) already taken. The frozen set is built from crews a ` +
          'contract actually asks for, so this means one asks for more than the board holds.'
      );
    }

    used.add(cellKey(cell));
    cells.push([member.hero, cell]);
  });

  return SortedMap.from<HeroId, Cell>(compareHeroIds, cells);
}

/**
 * The order this shape tries columns in.
 *
 * `spread` is the one that reads the crew's own index: the other two are a fixed preference
 * over the board, and this one is a preference over the *crew* — which is what makes it
 * spread rather than merely prefer a different column.
 */
function columnsFor(shape: FormationShape, index: number): readonly Column[] {
  switch (shape) {
    case FormationShape.Stacked:
      return [2, 1, 3];
    case FormationShape.Corridor:
      return [1, 3, 2];
    case FormationShape.Spread: {
      const first = COLUMNS[index % COLUMNS.length]!;
      return [first, ...COLUMNS.filter((column) => column !== first)];
    }
  }
}

function firstFree(row: Row, columns: readonly Column[], used: ReadonlySet<string>): Cell | null {
  for (const column of columns) {
    const cell: Cell = { row, column };

    if (!used.has(cellKey(cell))) {
      return cell;
    }
  }

  return null;
}
