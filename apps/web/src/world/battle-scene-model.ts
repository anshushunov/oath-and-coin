import type { BattleScreenModel, BattleUnitLine } from '@oath-and-coin/presentation';

import type { ResolveText } from '../text.tsx';

/**
 * The board behind the battle screen, described as data (`COMBAT_SPEC` §10.2, `DEC-007`).
 *
 * **Never touches PixiJS**, for the reason `scene-model.ts` gives at length: everything that
 * can be wrong here is layout, and layout tested through a mock of a renderer is a test of
 * the mock. What cannot be checked outside a browser stays in `pixi-scene.ts` and decides
 * nothing.
 *
 * **Schematic, and that is `DEC-007` rather than a shortcut.** Two grids of nine cells, a
 * token per unit, a word on every token, a bar per unit, a mark per status, one line of intent
 * and one floating number. No arena, no
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

/**
 * The word on a token: its size, where it starts, and how far a second one sits below it.
 *
 * Twelve logical pixels, because the spike measured what they become: at the old 420px
 * canvas the board is drawn at 0.66 and a word of eleven is seven screen pixels — smaller
 * than the kit's smallest step and unreadable; with the field across the whole screen and its
 * height held to half the window the board is drawn at 1.33, and twelve become sixteen
 * (`docs/research/BATTLE_LABEL_SPIKE_2026-09.md`).
 *
 * The pitch is what keeps two men in one cell apart. Two downed men do share a cell — the
 * combat loop's own `finished.png` has Брам and Кестрел in `1:2` — and a second word drawn at
 * the first one's place would be two correct names painted into one smudge. Two lines fit
 * between the top of the token and the status marks, and a third would sit on them; a cell
 * with more men than lines counts the rest on its last line (`labelsOf`).
 */
const LABEL_SIZE = 12;
const LABEL_TOP = 6;
const LABEL_PITCH = LABEL_SIZE + 2;
const LABEL_INSET = 5;
const LABEL_LINES = 2;

/** A token is the cell less four on every side, so its half-size is this. */
const TOKEN_INSET = 4;
const TOKEN_HALF = (CELL - 2 * TOKEN_INSET) / 2;

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

/**
 * The word on a token: a man's name, or — when he has none — the short word for his job.
 *
 * **Resolved before it reaches this shape, and that is the point of the field.** The token
 * carries `role` as a localization key, and a renderer printing that would put
 * `battle.role.vanguard` on the board. The scene is handed a resolver instead, and what lands
 * here is the text a player reads.
 *
 * A shape of its own rather than a field on the token, so it has an id of its own: every
 * statement about the scene names a shape, and "the word on Брам's token" is a different
 * statement from "Брам's token".
 */
export interface BattleLabel extends BattleShapeBase {
  readonly kind: 'battle-label';
  readonly side: 'crew' | 'foe';
  readonly label: string;
}

/**
 * Who is about to do something to whom — the line of intent, drawn (`COMBAT_SPEC` §10.2).
 *
 * The screen has named it in words since segment E; the board never drew it, and the owner's
 * first play asked «кто кого бьёт» looking at the board. One line, because an intent arrives
 * one event at a time and the model carries the last one.
 *
 * `from*` is on the edge of the actor's token and `to*` on the edge of the target's, so the
 * arrowhead lands beside the target's name rather than on it. The inherited box is the one
 * the two ends span.
 */
export interface BattleIntent extends BattleShapeBase {
  readonly kind: 'battle-intent';
  /** The unit that declared it. */
  readonly actor: string;
  /** The unit it is aimed at. */
  readonly target: string;
  readonly fromX: number;
  readonly fromY: number;
  readonly toX: number;
  readonly toY: number;
}

export type BattleShape =
  | BattleCellShape
  | BattleToken
  | BattleHealthBar
  | BattleStatusMark
  | BattlePopup
  | BattleLabel
  | BattleIntent;

export interface BattleSceneDescription {
  readonly width: number;
  readonly height: number;
  readonly shapes: readonly BattleShape[];
}

/**
 * The board for `model`, at `phase` of the current event's life (0 → 1).
 *
 * Total and deterministic: the same model, the same phase and the same catalogue give the
 * same description, down to the numbers, which is what lets it be compared rather than
 * looked at.
 *
 * `textOf` is the one thing this module knows about language, and it knows it only as a
 * function: every word on the board is resolved here, before the canvas, so the renderer is
 * handed text and never a key (`ADR-017`'s split — the scene decides, `pixi-scene.ts` draws).
 */
export function describeBattleScene(
  model: BattleScreenModel,
  phase: number,
  textOf: ResolveText
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

  // Under the words and over the tokens: a line that crosses a third man's token on its way
  // must not cover his name, and it must not be hidden by the token it crosses either.
  const intent = intentOf(model);

  if (intent !== null) {
    shapes.push(intent);
  }

  shapes.push(...labelsOf(model.units, textOf));

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
 * The word on every token, in the model's order.
 *
 * His name when he has one; the short word for his job when he has not — the owner's decision
 * of 2026-09-23, because the full word does not fit (`BattleUnitLine.roleShortKey`). The
 * branch is on a field being `null`, the one kind of branch this layer takes.
 *
 * Men who share a cell get one line each rather than one spot for all of them — the man still
 * standing first, the ones down after him in the model's order. A cell holds at most one man
 * standing and any number down (`COMBAT_SPEC` §3.1), and a token has room for {@link
 * LABEL_LINES} lines above its marks: when more share it, the first line names one of them and
 * the last counts the rest («+3»), and the list beside the board names every one. A third word
 * would sit on the marks and the bar, which is the smudge the lines are there to prevent.
 *
 * Cells are taken in the order the model first puts a man in them, so the words come out in
 * the model's order wherever nobody shares.
 */
function labelsOf(units: readonly BattleUnitLine[], textOf: ResolveText): readonly BattleLabel[] {
  const cells = new Map<string, BattleUnitLine[]>();

  for (const unit of units) {
    const key = `${sideOf(unit)}:${String(unit.row)}:${String(unit.column)}`;
    const men = cells.get(key);

    if (men === undefined) {
      cells.set(key, [unit]);
    } else {
      men.push(unit);
    }
  }

  return [...cells.entries()].flatMap(([cell, men]) => {
    const inLine = [
      ...men.filter((unit) => unit.standing),
      ...men.filter((unit) => !unit.standing)
    ];
    const named = inLine.length > LABEL_LINES ? inLine.slice(0, LABEL_LINES - 1) : inLine;
    const labels = named.map((unit, line): BattleLabel =>
      labelAt(unit, line, `label:${unit.unit}`, textOf(unit.displayNameKey ?? unit.roleShortKey))
    );

    if (named.length < inLine.length) {
      // A count rather than a word: the number is the whole of it, and it needs no catalogue.
      labels.push(
        labelAt(
          inLine[0]!,
          named.length,
          `label:more:${cell}`,
          `+${String(inLine.length - named.length)}`
        )
      );
    }

    return labels;
  });
}

/** One line of words on the token of `unit`'s cell. */
function labelAt(unit: BattleUnitLine, line: number, id: string, label: string): BattleLabel {
  const side = sideOf(unit);
  const { x, y } = cornerOf(side, unit.row, unit.column);

  return {
    kind: 'battle-label',
    id,
    side,
    label,
    x: x + LABEL_INSET,
    y: y + LABEL_TOP + line * LABEL_PITCH,
    width: CELL - 2 * LABEL_INSET,
    height: LABEL_SIZE
  };
}

function sideOf(unit: BattleUnitLine): 'crew' | 'foe' {
  return unit.side === 'crew' ? 'crew' : 'foe';
}

/**
 * The line from the man who declared the last intent to the man it is aimed at, or nothing.
 *
 * Nothing when the intent names no target, when either man is not on the board, and when the
 * two stand on one spot — each of those is a line with no direction, and a board that drew
 * one anyway would be pointing somewhere the fight is not.
 *
 * Nothing, too, once the fight is over (`outcomeKey` set) — the owner's decision of
 * 2026-09-23. An intent is about the blow *coming*, and after the last event there is none:
 * the last intent's target is as often as not the man who fell to it, and an arrow still
 * pointing at him reads as a blow about to land on a man already down. The line of words
 * under the field keeps it — there it reads as what was last declared, which is true; only
 * the arrow on the board, which reads as what is about to happen, goes.
 */
function intentOf(model: BattleScreenModel): BattleIntent | null {
  const intent = model.intent;

  if (model.outcomeKey !== null || intent === null || intent.targetUnit === null) {
    return null;
  }

  const actor = model.units.find((unit) => unit.unit === intent.unit);
  const target = model.units.find((unit) => unit.unit === intent.targetUnit);

  if (actor === undefined || target === undefined) {
    return null;
  }

  const from = centreOf(actor);
  const to = centreOf(target);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);

  if (length === 0) {
    return null;
  }

  // How far along the line its own token's edge is. A square's edge is where the larger of
  // the two components reaches the half-size, which is exact on the straight and on the
  // diagonal alike.
  const edge = TOKEN_HALF / Math.max(Math.abs(dx), Math.abs(dy));
  const fromX = from.x + dx * edge;
  const fromY = from.y + dy * edge;
  const toX = to.x - dx * edge;
  const toY = to.y - dy * edge;

  return {
    kind: 'battle-intent',
    id: `intent:${actor.unit}`,
    actor: actor.unit,
    target: target.unit,
    fromX,
    fromY,
    toX,
    toY,
    x: Math.min(fromX, toX),
    y: Math.min(fromY, toY),
    width: Math.abs(toX - fromX),
    height: Math.abs(toY - fromY)
  };
}

/** The middle of the token a unit stands on. */
function centreOf(unit: BattleUnitLine): { readonly x: number; readonly y: number } {
  const { x, y } = cornerOf(unit.side === 'crew' ? 'crew' : 'foe', unit.row, unit.column);

  return { x: x + CELL / 2, y: y + CELL / 2 };
}

/**
 * The floating number, over the man it happened to.
 *
 * From `model.effect` and not from the journal: a journal line names the *actor*, so a scene
 * reading it drew the number over whoever struck rather than over whoever was struck.
 * External review of segment E found it, and no hash could — a canvas has no text nodes.
 */
function popupOf(model: BattleScreenModel, age: number): BattlePopup | null {
  const effect = model.effect;

  if (effect === null) {
    return null;
  }

  const unit = model.units.find((one) => one.unit === effect.unit);

  if (unit === undefined) {
    return null;
  }

  const { x, y } = cornerOf(unit.side === 'crew' ? 'crew' : 'foe', unit.row, unit.column);

  return {
    kind: 'battle-popup',
    id: `popup:${unit.unit}`,
    amount: effect.amount,
    healing: effect.healing,
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
