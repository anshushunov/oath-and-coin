import {
  ScreenKind,
  type ContractOfferScreenModel,
  type ScreenModel
} from '@oath-and-coin/presentation';

import { describeBattleScene, type BattleShape } from './battle-scene-model.ts';

/**
 * The schematic world behind the contract-offer screen, described as data.
 *
 * **This module never touches PixiJS.** That separation is the whole of Task 14's
 * proof: the migration corpus has no oracle for a scene — there was no scene in the
 * Godot tree to record one from — so nothing here can be checked against a frozen
 * expectation the way the read model and the rendered snapshot are. What can be checked
 * is a pure function, and what cannot is kept as small as possible: `pixi-scene.ts`
 * applies this description to a renderer and decides nothing.
 *
 * The alternative — a component that builds sprites from the model directly — would put
 * every layout rule inside something that needs WebGL to run at all, and the only test
 * available for it in jsdom would be against a mock of Pixi. A green test over a mock
 * proves the mock behaves; it says nothing about the layout, which is the part that can
 * actually be wrong.
 *
 * **Deliberately narrow (`DEC-007`: UI-first, schematic combat until the vertical
 * slice).** The scene shows the roster as tokens and the offered contract as a marker,
 * and nothing else. It is not a battle view and does not try to be one: the shape of
 * that view is a Milestone 4 decision (`DEC-007` leaves the camera question open), and
 * inventing it here would mean maintaining a guess through three milestones.
 *
 * **No branch on {@link ContractOfferScreenModel.state}.** A screen with nothing to
 * offer carries no contract and an empty roster — `createContractOfferScreenModel`
 * refuses any other combination — so loading, empty and error all fall out of the same
 * two questions the projection already asks. Reading the state would add a second way to
 * decide the same thing, and two ways to decide one thing eventually disagree.
 */

/** The scene's logical width. Fixed: the adapter scales it to whatever canvas it gets. */
export const SCENE_WIDTH = 640;

/**
 * The height a scene never goes below, so an empty scene is still a box with a shape
 * rather than a degenerate strip whose aspect ratio depends on how many heroes answered.
 */
export const MIN_SCENE_HEIGHT = 240;

/** The offered contract's marker: one band across the top of the scene. */
const MARKER_WIDTH = 192;
const MARKER_HEIGHT = 48;
const MARKER_TOP = 24;

/** One hero's token, and the distance between two of them along either axis. */
const TOKEN_SIZE = 56;
const TOKEN_GAP = 16;
const TOKEN_PITCH = TOKEN_SIZE + TOKEN_GAP;

/**
 * Six, because a Milestone 1 roster is six heroes and they read as one line-up rather
 * than as a block. A seventh hero wraps onto a second row instead of being dropped or
 * squeezed — a scene that silently stopped drawing part of the roster would be worse
 * than an ugly one.
 */
const TOKENS_PER_ROW = 6;

/** Where the first token's top-left corner sits, with the full grid centred. */
const TOKEN_GRID_WIDTH = TOKENS_PER_ROW * TOKEN_PITCH - TOKEN_GAP;
const TOKEN_ORIGIN_X = (SCENE_WIDTH - TOKEN_GRID_WIDTH) / 2;
const TOKEN_ORIGIN_Y = 104;

/** Kept below the last row so a wrapped roster is not flush against the scene's edge. */
const BOTTOM_PADDING = 24;

/** What every shape carries, whatever it depicts. */
interface SceneShapeBase {
  /**
   * What a shape is called, in terms of the content that produced it rather than of
   * where it landed.
   *
   * This is what every assertion about the scene is written against — the tests here and
   * the browser-side evidence of Task 15 — and it is what the adapter labels its display
   * objects with, so a shape can be found in the rendered tree without counting
   * children. A position cannot serve either purpose: it is the thing under test.
   */
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The contract on offer. Present exactly when the model carries one. */
export interface ContractMarker extends SceneShapeBase {
  readonly kind: 'contract-marker';
}

/** One hero in the roster. */
export interface HeroToken extends SceneShapeBase {
  readonly kind: 'hero-token';
  /**
   * Whether this hero has answered the offer yet.
   *
   * The one fact the scene reads besides "who is in the roster", and it is here because
   * without it `Incomplete` and `Normal` — two of the five states `AGENTS.md` §7 requires
   * a UI task to show — produce byte-identical scenes. Joined on the hero's definition,
   * never on how many responses there are: the model already joins the two lists that
   * way for `heroDisplayNameKey`, and counting would call the first three heroes
   * answered whenever any three of them had.
   */
  readonly answered: boolean;
}

export type SceneShape = ContractMarker | HeroToken | BattleShape;

/** Everything the renderer needs to draw the scene, and nothing it has to work out. */
export interface SceneDescription {
  readonly width: number;
  readonly height: number;
  /** The contract marker first when there is one, then the roster in roster order. */
  readonly shapes: readonly SceneShape[];
}

/**
 * Projects one screen model onto the scene behind it.
 *
 * Total and deterministic: the same model gives the same description, down to the
 * numbers, which is what lets the description be compared rather than looked at.
 */
export function describeScene(model: ScreenModel, phase = 0): SceneDescription {
  // **What the debrief and the board draw is `DEC-015`, the owner's decision of
  // 2026-08-28, not a choice made here.** The scene is a line-up — a marker for the
  // contract on offer and a token per hero in the crew — and neither of those two models
  // carries a crew at all: the debrief names only the men an outcome named, the board
  // names no hero. Both therefore get the empty scene. The box keeps its shape and holds
  // nothing, which is the cost that record states in the open: the canvas goes blank on
  // those two screens, and a blank canvas there is the expected frame rather than a
  // failure to draw.
  //
  // Written as an exhaustive `switch` and not as "everything that is not the offer": the
  // negative form compiles happily the day a fourth screen is added and answers for it
  // silently, which is the exact shape this repository has already paid for three times
  // (`heroNamedBy`'s own comment records the last one — seven new event kinds walked
  // through three `kind !== 'a'` readers). Written out, a fourth screen does not build
  // until somebody has decided what it draws.
  switch (model.screen) {
    case ScreenKind.ContractOffer:
      return describeContractOfferScene(model);
    case ScreenKind.AfterAction:
    case ScreenKind.ContractBoard:
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

function describeContractOfferScene(model: ContractOfferScreenModel): SceneDescription {
  const shapes: SceneShape[] = [];

  if (model.contract !== null) {
    shapes.push({
      kind: 'contract-marker',
      id: `contract:${model.contract.definition}`,
      x: (SCENE_WIDTH - MARKER_WIDTH) / 2,
      y: MARKER_TOP,
      width: MARKER_WIDTH,
      height: MARKER_HEIGHT
    });
  }

  // The roster's own order, not the responses' and not the definitions' — the model
  // states who stands where, and a scene that re-sorted them would show a line-up the
  // screen beside it does not.
  const answered = new Set(model.responses.map((response) => response.heroDefinition));

  model.roster.forEach((hero, index) => {
    const column = index % TOKENS_PER_ROW;
    const row = Math.floor(index / TOKENS_PER_ROW);

    shapes.push({
      kind: 'hero-token',
      id: `hero:${hero.definition}`,
      x: TOKEN_ORIGIN_X + column * TOKEN_PITCH,
      y: TOKEN_ORIGIN_Y + row * TOKEN_PITCH,
      width: TOKEN_SIZE,
      height: TOKEN_SIZE,
      answered: answered.has(hero.definition)
    });
  });

  requireDistinctIds(shapes);

  return { width: SCENE_WIDTH, height: sceneHeight(model.roster.length), shapes };
}

/**
 * Tall enough to hold every row the roster needs.
 *
 * Computed rather than fixed so that a roster which outgrows one row grows the scene
 * instead of drawing outside it — the failure that would look like heroes vanishing.
 */
function sceneHeight(rosterSize: number): number {
  if (rosterSize === 0) {
    return MIN_SCENE_HEIGHT;
  }

  const rows = Math.ceil(rosterSize / TOKENS_PER_ROW);
  const used = TOKEN_ORIGIN_Y + (rows - 1) * TOKEN_PITCH + TOKEN_SIZE + BOTTOM_PADDING;

  return Math.max(MIN_SCENE_HEIGHT, used);
}

/**
 * Refuses a description whose shapes cannot be told apart.
 *
 * Every statement anyone makes about this scene names a shape by its id, so a repeated
 * one makes those statements ambiguous: "the token for `core:bram` is where it should
 * be" is satisfied by either of two tokens, and a roster showing one hero twice would
 * pass it. Loud here rather than quietly ambiguous later — the same reason `useText`
 * throws on a missing key instead of rendering the key.
 */
function requireDistinctIds(shapes: readonly SceneShape[]): void {
  const seen = new Set<string>();

  for (const shape of shapes) {
    if (seen.has(shape.id)) {
      throw new Error(
        `Scene shape id '${shape.id}' appears twice: a scene cannot draw two things as one, ` +
          'and the model that produced it names the same entity in two places.'
      );
    }

    seen.add(shape.id);
  }
}
