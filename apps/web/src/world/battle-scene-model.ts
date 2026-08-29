import type { BattleScreenModel, BattleUnitLine } from '@oath-and-coin/presentation';

/**
 * The board behind the battle screen, described as data (`COMBAT_SPEC` §10.2, `DEC-007`).
 *
 * **Never touches PixiJS**, for the reason `scene-model.ts` gives at length: everything that
 * can be wrong here is layout, and layout tested through a mock of a renderer is a test of
 * the mock. What cannot be checked outside a browser stays in `pixi-scene.ts` and decides
 * nothing.
 *
 * **Schematic, and that is `DEC-007` rather than a shortcut.** Two grids of nine cells, a
 * token per unit, a bar per unit, a mark per status and one floating number. No arena, no
 * characters — `MVP_PLAN` §6.6 puts those after the mechanics and the debrief, and a lab that
 * spent its budget on a background would be answering "is it pretty" instead of "does it
 * read".
 *
 * **The phase is a parameter, and it is the whole of what the feed's second input reaches.**
 * `apply` changes the model; `advance` changes this number. A scene drawn from the model
 * alone would show the same frame for the whole of an event, and §10.2 п.1's second input
 * would be decoration with a comment over it.
 */

/** Where the two boards sit, and how big a cell is. All logical units; the adapter scales. */
export const BATTLE_SCENE_WIDTH = 640;
export const BATTLE_SCENE_HEIGHT = 300;

const CELL = 56;
const CELL_GAP = 6;
const BOARD_WIDTH = 3 * CELL + 2 * CELL_GAP;

/** The gap between the two sides — the no-man's land the geometry of §4.2 reaches across. */
const BETWEEN_BOARDS = 72;

const BOARDS_LEFT = (BATTLE_SCENE_WIDTH - (2 * BOARD_WIDTH + BETWEEN_BOARDS)) / 2;
const BOARDS_TOP = 42;

/** The health bar under a token, and the status marks under that. */
const BAR_HEIGHT = 6;
const BAR_TOP = CELL - BAR_HEIGHT - 4;
const MARK = 8;
const MARK_GAP = 3;

/** How far a popup number drifts upward over the life of its event, and how big it is. */
const POPUP_RISE = 22;
const POPUP_SIZE = 24;

interface BattleShapeBase {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * One of the eighteen cells — nine a side (`COMBAT_SPEC` §3.1).
 *
 * Drawn whether or not anybody stands on it, because an empty cell is what §4.5's benefit is
 * *about*: a board that only drew occupied cells would hide the thing the formation is for.
 */
export interface BattleCellShape extends BattleShapeBase {
  readonly kind: 'battle-cell';
  readonly side: 'crew' | 'foe';
  readonly row: number;
  readonly column: number;
}

/** One combatant. */
export interface BattleToken extends BattleShapeBase {
  readonly kind: 'battle-token';
  readonly side: 'crew' | 'foe';
  /**
   * Still on the field.
   *
   * A flag rather than simply not drawing him: a man who went down leaves a hole in the
   * formation, and a board that removed the token would make "he is down" and "he was never
   * there" the same picture.
   */
  readonly standing: boolean;
  /**
   * Which of the four jobs he holds, so the token's *shape* carries what its colour does.
   *
   * §10.2 п.5 applied to the token itself: the spike's scene put side and status on one
   * colour channel, which is the case colour blindness breaks outright (`GDD` §16.6).
   */
  readonly role: string;
}

/** How much of a unit's health is left. `filled` is a share of `width`, from 0 to 1. */
export interface BattleHealthBar extends BattleShapeBase {
  readonly kind: 'battle-health';
  readonly filled: number;
}

/** A status, as a mark beside the token rather than as a tint on it (§10.2 п.5). */
export interface BattleStatusMark extends BattleShapeBase {
  readonly kind: 'battle-status-mark';
  readonly status: string;
}

/**
 * The number the last blow or heal produced, over the man it happened to.
 *
 * **With a contrasting outline, which is a requirement and not a flourish** (§10.2 п.4). The
 * spike's `paused.png` has a white number on a white flash, and the prediction
 * `DIRECTION_2026-08` §4.6 made about a light number on light ground was confirmed by a
 * frame rather than by an argument.
 *
 * `age` runs 0 → 1 across the event's own duration and is the one thing `advance` reaches.
 */
export interface BattlePopup extends BattleShapeBase {
  readonly kind: 'battle-popup';
  readonly amount: number;
  readonly healing: boolean;
  readonly age: number;
}

export type BattleShape =
  BattleCellShape | BattleToken | BattleHealthBar | BattleStatusMark | BattlePopup;

export interface BattleSceneDescription {
  readonly width: number;
  readonly height: number;
  readonly shapes: readonly BattleShape[];
}

/**
 * The board for `model`, at `phase` of the current event's life (0 → 1).
 *
 * Total and deterministic: the same model and the same phase give the same description, down
 * to the numbers, which is what lets it be compared rather than looked at.
 */
export function describeBattleScene(
  model: BattleScreenModel,
  phase: number
): BattleSceneDescription {
  const age = Math.min(1, Math.max(0, phase));
  const shapes: BattleShape[] = [];

  for (const side of ['crew', 'foe'] as const) {
    for (const row of [1, 2, 3] as const) {
      for (const column of [1, 2, 3] as const) {
        const { x, y } = cornerOf(side, row, column);

        shapes.push({
          kind: 'battle-cell',
          id: `cell:${side}:${String(row)}:${String(column)}`,
          side,
          row,
          column,
          x,
          y,
          width: CELL,
          height: CELL
        });
      }
    }
  }

  // The model's own order, never re-sorted here. Which token is drawn on top of which is a
  // fact about the board and the model already decided it; a scene that sorted by side or by
  // health would draw a line-up the screen beside it does not have.
  for (const unit of model.units) {
    shapes.push(...unitShapes(unit));
  }

  const popup = popupOf(model, age);

  if (popup !== null) {
    shapes.push(popup);
  }

  return { width: BATTLE_SCENE_WIDTH, height: BATTLE_SCENE_HEIGHT, shapes };
}

function unitShapes(unit: BattleUnitLine): readonly BattleShape[] {
  const side = unit.side === 'crew' ? 'crew' : 'foe';
  const { x, y } = cornerOf(side, unit.row, unit.column);

  const token: BattleToken = {
    kind: 'battle-token',
    id: `token:${unit.unit}`,
    side,
    standing: unit.standing,
    role: unit.roleKey,
    x: x + 4,
    y: y + 4,
    width: CELL - 8,
    height: CELL - 8
  };

  const bar: BattleHealthBar = {
    kind: 'battle-health',
    id: `health:${unit.unit}`,
    // Guarded against a unit whose maximum is nought — which no formula produces, and which
    // would put a division by zero on the one path a browser cannot be asked about cheaply.
    filled: unit.maxHealth <= 0 ? 0 : Math.min(1, Math.max(0, unit.health / unit.maxHealth)),
    x: x + 4,
    y: y + BAR_TOP,
    width: CELL - 8,
    height: BAR_HEIGHT
  };

  const marks = unit.statuses.map((status, index): BattleStatusMark => ({
    kind: 'battle-status-mark',
    id: `status:${unit.unit}:${status.key}`,
    status: status.key,
    x: x + 4 + index * (MARK + MARK_GAP),
    y: y + BAR_TOP - MARK - 2,
    width: MARK,
    height: MARK
  }));

  return [token, bar, ...marks];
}

/**
 * The floating number, taken from the last journal line that carried one.
 *
 * From the journal rather than from a field of its own, because the journal is already the
 * record of what has been applied and a second list would be a second answer to "what just
 * happened". `null` when nothing has, which is every frame of a round in which nobody
 * connected.
 */
function popupOf(model: BattleScreenModel, age: number): BattlePopup | null {
  const last = [...model.journal].reverse().find((line) => line.amount !== null);

  if (last === undefined || last.amount === null || last.unit === null) {
    return null;
  }

  const unit = model.units.find((one) => one.unit === last.unit);

  if (unit === undefined) {
    return null;
  }

  const { x, y } = cornerOf(unit.side === 'crew' ? 'crew' : 'foe', unit.row, unit.column);

  return {
    kind: 'battle-popup',
    id: `popup:${unit.unit}`,
    amount: last.amount,
    healing: last.key.endsWith('healing_done'),
    age,
    x: x + CELL / 2,
    // The one thing `advance` moves. Upward as the event ages, so a number that has been on
    // the screen for a while is visibly older than one that has just landed.
    y: y - age * POPUP_RISE,
    width: POPUP_SIZE,
    height: POPUP_SIZE
  };
}

/** The top-left corner of one cell, on the side that owns it. */
function cornerOf(
  side: 'crew' | 'foe',
  row: number,
  column: number
): { readonly x: number; readonly y: number } {
  const left = side === 'crew' ? BOARDS_LEFT : BOARDS_LEFT + BOARD_WIDTH + BETWEEN_BOARDS;

  // Row 1 faces the enemy on both sides, so the crew's rows run *up* the screen from the
  // gap and the foes' run down it. Drawing both the same way would put two front ranks at
  // opposite ends of the board and make "the front cell of that column" a different cell
  // depending on whose it was — the one thing §4.2's geometry cannot survive on a screen.
  const depth = side === 'crew' ? 3 - row : row - 1;

  return {
    x: left + (column - 1) * (CELL + CELL_GAP),
    y: BOARDS_TOP + depth * (CELL + CELL_GAP)
  };
}
