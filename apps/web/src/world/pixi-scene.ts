import { Application, Container, Graphics, Text } from 'pixi.js';
// Confusingly named: this module is what a page uses when unsafe-eval is *not*
// allowed. PixiJS compiles its shader and uniform sync functions with `new Function`
// by default, and `index.html` declares `script-src 'self'` because `ADR-010` §80
// makes CSP part of the mandatory security boundary — so the default path is refused
// and Pixi logs "Current environment does not allow unsafe-eval". Importing this
// replaces the generated functions with polyfills that do the same work without eval.
//
// The alternative — adding `'unsafe-eval'` to the policy — would widen the boundary of
// the packaged host for the sake of one dependency's code generation, which is the
// trade `ADR-010` explicitly refuses.
//
// **This was invisible to every jsdom test.** All 65 of them were green while the page
// in Chromium logged the error, which is §14.4's third measured lesson arriving on its
// own: a claim about the bundle checked only in jsdom is a claim about the dev
// transform.
import 'pixi.js/unsafe-eval';

import type { BattlePopup } from './battle-scene-model.ts';
import type { SceneDescription, SceneShape } from './scene-model.ts';

/**
 * The only module in this repository that knows PixiJS exists.
 *
 * It applies a {@link SceneDescription} and decides nothing: no layout, no ordering, no
 * rule about which shape belongs on screen. Everything that could be wrong in a way
 * worth testing was moved into `scene-model.ts`, which is a pure function and is tested
 * as one.
 *
 * **This file is not tested in jsdom, on purpose.** jsdom has no WebGL, so the only test
 * available there would be against a mock of `Application`, and a green test over a mock
 * proves the mock behaves. What it would *not* prove is the one thing that can go wrong
 * here — that a canvas comes up and something lands on it — and `FULL_TYPESCRIPT_MIGRATION`
 * §14.4 already recorded the measured version of that trap: a mutant that stopped the
 * application mounting the screen left all 45 jsdom checks green and reddened only the
 * run in Chromium. So the check on this file is the browser evidence of Task 15, and
 * nothing here pretends otherwise.
 *
 * The colours are the schematic palette `DEC-007` asks for until the vertical slice —
 * a token, a marker, and the one distinction the scene draws. They are constants here
 * rather than CSS custom properties because nothing in a canvas reads CSS.
 */

/** The scene's own background, so the canvas is never a hole in the page. */
const BACKGROUND = 0x11131a;

/** The offered contract. */
const MARKER_FILL = 0xc8a04a;

/** A hero who has answered, and one still to. */
const TOKEN_ANSWERED = 0x4a7fc8;
const TOKEN_WAITING = 0x3a3f4b;

/** The battle board: a cell, the two sides, a man who is down, a bar and a status mark. */
const CELL_FILL = 0x1a1d26;
const TOKEN_CREW = 0x4a7fc8;
const TOKEN_FOE = 0xc85a4a;
/*
 * A man who is out of the fight. Far enough from the cell's own fill to read as a token
 * rather than as an empty cell — found by looking at the frame, where the first value
 * (`0x2a2d36`) was within a shade of `CELL_FILL` and four downed men looked like four
 * cells nobody had ever stood in.
 */
const TOKEN_DOWNED = 0x5a4a52;
const HEALTH_FILL = 0x6fbf73;
const HEALTH_EMPTY = 0x3a2a2a;
const STATUS_MARK = 0xd8c26a;

/**
 * The floating number and the outline under it (`COMBAT_SPEC` §10.2 п.4).
 *
 * The outline is near-black and three pixels wide, which is what makes the number readable
 * on the white flash the spike measured it disappearing into.
 */
const POPUP_DAMAGE = 0xffd8d0;
const POPUP_HEALING = 0xd0ffd8;
const POPUP_OUTLINE = 0x0a0b0f;
const POPUP_OUTLINE_WIDTH = 3;

/** Drawn on every shape, so a token on the background still has an edge. */
const OUTLINE = 0x8b93a7;
const OUTLINE_WIDTH = 2;

/** A mounted scene, and the two things its owner may do with it. */
export interface PixiScene {
  /** Draws a description, replacing whatever was drawn before. */
  apply(description: SceneDescription): void;
  /** Releases the renderer and its GPU resources. */
  destroy(): void;
}

/**
 * Brings up a renderer on `canvas` and draws `initial` onto it.
 *
 * Rejects rather than falling back when no renderer can be created. A scene that
 * silently degraded to nothing would be indistinguishable from a scene that is empty
 * because the model is, and Task 15's evidence is supposed to tell those apart.
 */
export async function mountPixiScene(
  canvas: HTMLCanvasElement,
  initial: SceneDescription
): Promise<PixiScene> {
  const application = new Application();

  await application.init({
    canvas,
    width: initial.width,
    height: initial.height,
    background: BACKGROUND,
    antialias: true,
    // What makes the drawn frame observable from outside the renderer. Without it the
    // WebGL back buffer is cleared after compositing, and reading the canvas back —
    // `drawImage` into a 2D context, `toDataURL`, `readPixels` — answers transparent
    // black. That reply is indistinguishable from "the scene drew nothing", which is
    // exactly the failure the browser evidence has to be able to see: external review
    // found that a `draw` reduced to a no-op left every check in this repository green.
    //
    // The cost is a second buffer that survives the frame, and here it is paid once:
    // this scene renders on demand and does not animate.
    preserveDrawingBuffer: true,
    // Nothing here animates: the scene is a projection of a model that does not move,
    // so a ticker running every frame would spend a core redrawing an identical image.
    // Each `apply` renders once, explicitly.
    autoStart: false,
    sharedTicker: false
  });

  // One layer of our own rather than drawing straight onto the stage, so `apply` can
  // clear exactly what it drew without assuming it owns everything on the stage.
  const layer = new Container();
  application.stage.addChild(layer);

  const scene: PixiScene = {
    apply(description: SceneDescription): void {
      application.renderer.resize(description.width, description.height);

      // Destroyed rather than merely removed: a `Graphics` holds GPU buffers, and
      // dropping the reference without destroying it leaks them for as long as the page
      // lives.
      for (const child of layer.removeChildren()) {
        child.destroy();
      }

      for (const shape of description.shapes) {
        layer.addChild(draw(shape));
      }

      application.render();
    },

    destroy(): void {
      // `false` — do **not** remove the canvas from the document. React created that
      // element and React removes it; a renderer that also removes it is a second owner
      // of one node, and the two disagree the moment an effect is torn down and set up
      // again. External review found the consequence: under `StrictMode` React replays
      // effects, and a `destroy(true, …)` from the first pass deletes the element the
      // second pass is already drawing into.
      application.destroy(false, { children: true });
    }
  };

  scene.apply(initial);

  return scene;
}

/** One shape, at the position and size the description states and at no other. */
function draw(shape: SceneShape): Container {
  // The id, verbatim. Labelling the display object is what lets a browser-side check
  // find a shape in the rendered tree instead of counting children in draw order.
  if (shape.kind === 'battle-popup') {
    return drawPopup(shape);
  }

  const graphics = new Graphics();

  graphics.label = shape.id;

  graphics
    .rect(shape.x, shape.y, shape.width, shape.height)
    .fill(fillFor(shape))
    .stroke({ color: OUTLINE, width: OUTLINE_WIDTH });

  // A health bar is the one shape whose *width* is the fact it carries. Drawn full above
  // like every other rectangle — that is the box — and then filled to the share that is
  // left. Without this second rectangle a man with nothing left reads as a man at full
  // health, which is what the frame of the finished battle showed: four downed foes with
  // four full green bars under them, every hash green, because a canvas has no texts.
  if (shape.kind === 'battle-health') {
    graphics.rect(shape.x, shape.y, shape.width * shape.filled, shape.height).fill(HEALTH_FILL);
  }

  return graphics;
}

/**
 * The floating number, with the outline `COMBAT_SPEC` §10.2 п.4 makes a requirement.
 *
 * A `Text` rather than a rectangle, because it is the one shape that *is* a number, and a
 * stroke on it is the whole reason the requirement exists: the spike drew a white number on
 * a white flash and it disappeared. The stroke is drawn under the fill by Pixi, so the
 * number reads on light and on dark alike without the scene having to know which it is on.
 */
function drawPopup(shape: BattlePopup): Container {
  const text = new Text({
    text: `${shape.healing ? '+' : '-'}${String(shape.amount)}`,
    style: {
      fontFamily: 'monospace',
      fontSize: shape.height,
      fill: shape.healing ? POPUP_HEALING : POPUP_DAMAGE,
      stroke: { color: POPUP_OUTLINE, width: POPUP_OUTLINE_WIDTH, join: 'round' }
    }
  });

  text.label = shape.id;
  text.x = shape.x;
  text.y = shape.y;
  // The second half of what `advance` reaches: the number rises and fades over the life of
  // its own event. A scene without it would draw one frame per event, and the two inputs of
  // §10.2 п.1 would be one input with a comment over it.
  text.alpha = Math.max(0, 1 - shape.age);

  return text;
}

function fillFor(shape: Exclude<SceneShape, BattlePopup>): number {
  switch (shape.kind) {
    case 'contract-marker':
      return MARKER_FILL;
    case 'hero-token':
      return shape.answered ? TOKEN_ANSWERED : TOKEN_WAITING;
    case 'battle-cell':
      return CELL_FILL;
    case 'battle-token':
      // Side by colour, and standing by whether there is any colour left in it. The *shape*
      // of a token is not this file's business: `battle-scene-model.ts` carries the role on
      // it, and what draws a role differently is the polish `MVP_PLAN` §6.6 puts after the
      // mechanics. What is here today is the one thing a schematic board must not get wrong
      // — a man who is down is not a man who is fighting.
      if (!shape.standing) {
        return TOKEN_DOWNED;
      }

      return shape.side === 'crew' ? TOKEN_CREW : TOKEN_FOE;
    case 'battle-health':
      // The empty part of the bar. What is left is drawn over it in `draw`.
      return HEALTH_EMPTY;
    case 'battle-status-mark':
      return STATUS_MARK;
  }
}
