import type { SpikeBattleEvent, SpikeBattleState, SpikeUnit } from '@oath-and-coin/simulation';
import { Application, Container, Graphics, Text, TextStyle } from 'pixi.js';
import 'pixi.js/unsafe-eval';

/**
 * THROWAWAY SPIKE. The presentation half: two 3×3 grids, a token per unit, and the four
 * feedback effects `DIRECTION_2026-08` §4.6 calls "cheap, done in code" — a tint for a
 * status, a flash and a lunge on a hit, a floating number, a fade on death.
 *
 * Split from the orchestrator on purpose: `apply` is discrete and `advance` is continuous,
 * and the cost measurement wants to know how much of the work sits on each side.
 */

const CELL = 64;
const GAP = 10;
const GRID = 3 * CELL + 2 * GAP;
const SIDE_GAP = 96;
export const SCENE_WIDTH = GRID * 2 + SIDE_GAP + 48;
export const SCENE_HEIGHT = GRID + 96;

const BACKGROUND = 0x11131a;
const CELL_EMPTY = 0x1b1e27;
const CREW = 0x4a7fc8;
const FOE = 0xc8584a;
const CHILLED = 0x6fd0e8;
const OUTLINE = 0x8b93a7;
const HP_BACK = 0x2a2e38;
const HP_FILL = 0x6fc86f;

interface Token {
  readonly root: Container;
  readonly body: Graphics;
  readonly bar: Graphics;
  hp: number;
  maxHp: number;
  chilled: boolean;
  alive: boolean;
  /** Milliseconds left on the white flash. */
  flash: number;
  /** Milliseconds left on the lunge toward the enemy. */
  lunge: number;
  /** Milliseconds left of the fade-out. */
  dying: number;
  readonly homeX: number;
  readonly homeY: number;
  readonly facing: number;
}

interface Popup {
  readonly text: Text;
  life: number;
}

export interface BattleScene {
  apply(event: SpikeBattleEvent): void;
  advance(deltaMs: number): void;
  reset(): void;
  /** What the scene is showing, for the evidence to read without touching pixels. */
  describe(): { readonly alive: number; readonly chilled: number; readonly effects: number };
  destroy(): void;
}

export async function mountBattleScene(
  canvas: HTMLCanvasElement,
  initial: SpikeBattleState
): Promise<BattleScene> {
  const application = new Application();

  await application.init({
    canvas,
    width: SCENE_WIDTH,
    height: SCENE_HEIGHT,
    background: BACKGROUND,
    antialias: true,
    preserveDrawingBuffer: true,
    autoStart: false,
    sharedTicker: false
  });

  const board = new Container();
  const effects = new Container();
  application.stage.addChild(board, effects);

  const tokens = new Map<string, Token>();
  const popups: Popup[] = [];

  drawGrid(board);

  for (const one of initial.units) {
    const token = createToken(one);
    tokens.set(one.id, token);
    board.addChild(token.root);
  }

  const style = new TextStyle({ fill: 0xffffff, fontSize: 18, fontWeight: 'bold' });

  const render = (): void => {
    application.render();
  };

  const scene: BattleScene = {
    apply(event: SpikeBattleEvent): void {
      switch (event.kind) {
        case 'intent': {
          const actor = tokens.get(event.actor);

          if (actor !== undefined && event.action !== 'skip') {
            actor.lunge = 220;
          }

          break;
        }
        case 'hit': {
          const target = tokens.get(event.target);

          if (target !== undefined) {
            target.hp = Math.max(0, target.hp - event.amount);
            target.flash = 140;
            popups.push(popupFor(effects, style, target, event.amount));
          }

          break;
        }
        case 'status_applied': {
          const target = tokens.get(event.target);

          if (target !== undefined) {
            target.chilled = true;
          }

          break;
        }
        case 'unit_died': {
          const target = tokens.get(event.unit);

          if (target !== undefined) {
            target.alive = false;
            target.dying = 360;
          }

          break;
        }
        case 'tick_ended':
          break;
      }

      redraw(tokens);
      render();
    },

    advance(deltaMs: number): void {
      let moved = false;

      for (const token of tokens.values()) {
        moved = decay(token, deltaMs) || moved;
      }

      for (let index = popups.length - 1; index >= 0; index -= 1) {
        const popup = popups[index];

        if (popup === undefined) {
          continue;
        }

        popup.life -= deltaMs;
        popup.text.y -= deltaMs * 0.03;
        popup.text.alpha = Math.max(0, popup.life / 600);
        moved = true;

        if (popup.life <= 0) {
          popup.text.destroy();
          popups.splice(index, 1);
        }
      }

      if (moved) {
        redraw(tokens);
        render();
      }
    },

    reset(): void {
      for (const popup of popups.splice(0)) {
        popup.text.destroy();
      }

      for (const one of initial.units) {
        const token = tokens.get(one.id);

        if (token === undefined) {
          continue;
        }

        token.hp = one.hp;
        token.chilled = false;
        token.alive = true;
        token.flash = 0;
        token.lunge = 0;
        token.dying = 0;
        token.root.alpha = 1;
      }

      redraw(tokens);
      render();
    },

    describe() {
      let alive = 0;
      let chilled = 0;

      for (const token of tokens.values()) {
        if (token.alive) {
          alive += 1;
        }

        if (token.chilled) {
          chilled += 1;
        }
      }

      return { alive, chilled, effects: popups.length };
    },

    destroy(): void {
      application.destroy(false, { children: true });
    }
  };

  redraw(tokens);
  render();

  return scene;
}

function drawGrid(board: Container): void {
  for (const side of [0, 1]) {
    for (let cell = 0; cell < 9; cell += 1) {
      const { x, y } = cellOrigin(side === 0 ? 'crew' : 'foe', cell);
      const square = new Graphics();
      square
        .rect(x, y, CELL, CELL)
        .fill(CELL_EMPTY)
        .stroke({ color: OUTLINE, width: 1, alpha: 0.4 });
      board.addChild(square);
    }
  }
}

/**
 * Where a cell sits. The crew's rear row is on the far left and the foe's on the far
 * right, so row 0 of both sides meets in the middle — the layout `DIRECTION` §4.4 says a
 * three-row board needs if a frame is to be readable at all.
 */
function cellOrigin(side: SpikeUnit['side'], cell: number): { x: number; y: number } {
  const row = Math.floor(cell / 3);
  const column = cell % 3;
  const band = side === 'crew' ? 2 - row : row;
  const left = side === 'crew' ? 24 : 24 + GRID + SIDE_GAP;

  return { x: left + band * (CELL + GAP), y: 48 + column * (CELL + GAP) };
}

function createToken(one: SpikeUnit): Token {
  const root = new Container();
  const { x, y } = cellOrigin(one.side, one.cell);
  root.x = x;
  root.y = y;

  const body = new Graphics();
  const bar = new Graphics();
  root.addChild(body, bar);

  return {
    root,
    body,
    bar,
    hp: one.hp,
    maxHp: one.maxHp,
    chilled: false,
    alive: true,
    flash: 0,
    lunge: 0,
    dying: 0,
    homeX: x,
    homeY: y,
    facing: one.side === 'crew' ? 1 : -1
  };
}

function decay(token: Token, deltaMs: number): boolean {
  let moved = false;

  if (token.flash > 0) {
    token.flash = Math.max(0, token.flash - deltaMs);
    moved = true;
  }

  if (token.lunge > 0) {
    token.lunge = Math.max(0, token.lunge - deltaMs);
    // Out and back, so the token ends where it started.
    const phase = Math.sin((1 - token.lunge / 220) * Math.PI);
    token.root.x = token.homeX + token.facing * phase * 14;
    moved = true;
  }

  if (token.dying > 0) {
    token.dying = Math.max(0, token.dying - deltaMs);
    token.root.alpha = Math.max(0.15, token.dying / 360);
    moved = true;
  }

  return moved;
}

function redraw(tokens: ReadonlyMap<string, Token>): void {
  for (const token of tokens.values()) {
    const fill = token.flash > 0 ? 0xffffff : token.chilled ? CHILLED : baseFill(token);

    token.body
      .clear()
      .roundRect(8, 8, CELL - 16, CELL - 16, 6)
      .fill(fill)
      .stroke({ color: OUTLINE, width: 2 });

    const width = (CELL - 16) * (token.maxHp === 0 ? 0 : token.hp / token.maxHp);

    token.bar
      .clear()
      .rect(8, CELL - 14, CELL - 16, 5)
      .fill(HP_BACK)
      .rect(8, CELL - 14, width, 5)
      .fill(HP_FILL);
  }
}

function baseFill(token: Token): number {
  return token.facing === 1 ? CREW : FOE;
}

function popupFor(
  effects: Container,
  style: TextStyle,
  token: Token,
  amount: number
): Popup {
  const text = new Text({ text: String(amount), style });
  text.x = token.homeX + CELL / 2 - 8;
  text.y = token.homeY;
  effects.addChild(text);

  return { text, life: 600 };
}
