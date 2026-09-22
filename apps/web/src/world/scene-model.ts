import { ScreenKind, type ScreenModel } from '@oath-and-coin/presentation';

import { describeBattleScene, type BattleShape } from './battle-scene-model.ts';

/**
 * The scene a screen draws on its canvas, described as data.
 *
 * **This module never touches PixiJS.** That separation is the whole of Task 14's
 * proof: the migration corpus has no oracle for a scene — there was no scene in the
 * Godot tree to record one from — so nothing here can be checked against a frozen
 * expectation the way the read model and the rendered snapshot are. What can be checked
 * is a pure function, and what cannot is kept as small as possible: `pixi-scene.ts`
 * applies this description to a renderer and decides nothing.
 *
 * **Only the battle has a scene (`DEC-020`).** The schematic world that used to stand behind
 * the offer — a marker for the contract and a token per hero — is gone: once the offer's
 * count and its squad cards said the same thing in words, the box was a duplicate of the
 * screen above it. The debrief, the board and the saves drew an empty box already
 * (`DEC-015`, superseded by `DEC-020`), and the page no longer mounts a canvas for any of
 * them. The canvas is the battle board and nothing else (`DEC-007` asks for a schematic
 * *battle*, not a schematic world).
 */

/** The scene's logical width. Fixed: the adapter scales it to whatever canvas it gets. */
export const SCENE_WIDTH = 640;

/**
 * The height a scene never goes below, so an empty scene is still a box with a shape
 * rather than a degenerate strip.
 */
export const MIN_SCENE_HEIGHT = 240;

export type SceneShape = BattleShape;

/** Everything the renderer needs to draw the scene, and nothing it has to work out. */
export interface SceneDescription {
  readonly width: number;
  readonly height: number;
  readonly shapes: readonly SceneShape[];
}

/**
 * Projects one screen model onto the scene it draws.
 *
 * Total and deterministic: the same model gives the same description, down to the
 * numbers, which is what lets the description be compared rather than looked at.
 */
export function describeScene(model: ScreenModel, phase = 0): SceneDescription {
  // Written as an exhaustive `switch` and not as "everything that is not the battle": the
  // negative form compiles happily the day a fifth screen is added and answers for it
  // silently, which is the exact shape this repository has already paid for three times
  // (`heroNamedBy`'s own comment records the last one — seven new event kinds walked
  // through three `kind !== 'a'` readers). Written out, a fifth screen does not build
  // until somebody has decided what it draws.
  switch (model.screen) {
    case ScreenKind.ContractOffer:
    case ScreenKind.AfterAction:
    case ScreenKind.ContractBoard:
      // `DEC-020`: no scene behind these. The page mounts no canvas for them at all; the
      // empty box is what a caller that asks anyway gets, rather than a throw.
      return EMPTY_SCENE;
    case ScreenKind.Battle:
      // The phase defaults to nought — the instant the event landed — so everything holding
      // a `ScreenModel` and no clock (the evidence run, a snapshot, a test) gets a frame it
      // can compare, and only the screen that is actually playing a battle passes one.
      return describeBattleScene(model, phase);
  }
}

/** The box with nothing in it — see {@link describeScene}. */
const EMPTY_SCENE: SceneDescription = Object.freeze({
  width: SCENE_WIDTH,
  height: MIN_SCENE_HEIGHT,
  shapes: Object.freeze([])
});
