import {
  createSessionController,
  startSession,
  type SaveStorePort
} from '@oath-and-coin/application';
import { RULESET_VERSION } from '@oath-and-coin/content';
import {
  AFTER_ACTION_LOADING_SCREEN,
  BATTLE_LOADING_SCREEN,
  CONTRACT_BOARD_LOADING_SCREEN,
  SCREEN_KINDS,
  ScreenKind,
  type BattleScreenModel,
  type ContractOfferScreenModel
} from '@oath-and-coin/presentation';
import { describe, expect, it } from 'vitest';

import { browserContentSource, shippedContentVersion } from '../content-source.ts';

import { MIN_SCENE_HEIGHT, SCENE_WIDTH, describeScene } from './scene-model.ts';

/**
 * Which screens have a scene at all — since `DEC-020`, only the battle.
 *
 * What the battle draws is `battle-scene-model.test.ts`'s subject, shape by shape. This file
 * asks the question one level up: that the projection answers for every screen the union
 * declares, that the four screens without a scene get the same empty box, and that the one
 * with a scene still gets it. The offer's line-up — a marker and a token per hero, with the
 * tests of its layout that stood here — left with the offer's canvas.
 */

/** The seed the scenario runner's CLI defaults to, and the one the corpus records. */
const SEED = 424242n;

/**
 * A battle board with a nameless man per id, and nothing else that matters here.
 *
 * Hand-built, and it says so: the two questions it poses — a unit listed twice, and a board
 * drawn with no catalogue — are not ones a shipped scenario reaches, which is the point of
 * asking them.
 */
function aBoardOf(units: readonly string[]): BattleScreenModel {
  return {
    ...BATTLE_LOADING_SCREEN,
    units: units.map((unit) => ({
      unit,
      side: 'crew',
      heroDefinition: null,
      displayNameKey: null,
      roleKey: 'battle.role.vanguard',
      roleShortKey: 'battle.role.vanguard.short',
      row: 1,
      column: 1,
      health: 10,
      maxHealth: 10,
      standing: true,
      leftKey: null,
      statuses: []
    }))
  } as unknown as BattleScreenModel;
}

function offerFor(scenario: string): ContractOfferScreenModel {
  const { screen } = startSession({
    content: browserContentSource(),
    scenario,
    checkpoint: null,
    seed: SEED
  });

  if (screen.screen !== ScreenKind.ContractOffer) {
    throw new Error(`'${scenario}' landed on '${screen.screen}', not on the contract offer.`);
  }

  return screen;
}

/** The board `battle_ready` is one press away from, built through the live controller. */
function aBoard(): BattleScreenModel {
  const refuse = (): never => {
    throw new Error('This test draws a board, not a save slot.');
  };
  const controller = createSessionController({
    request: {
      content: browserContentSource(),
      scenario: 'battle_ready',
      checkpoint: 'battle_ready',
      seed: SEED
    },
    saves: { read: refuse, write: refuse, list: refuse, clear: refuse } as unknown as SaveStorePort,
    now: () => '1970-01-01T00:00:00.000Z',
    expected: { rulesetVersion: RULESET_VERSION, contentVersion: shippedContentVersion() }
  });

  void controller.start();

  const contractId = controller.store.snapshot().focusedContract;
  const record = contractId === null ? null : controller.previewBattle(contractId, null);
  const model =
    contractId === null || record === null
      ? null
      : controller.battleScreen(contractId, record, 0, true);

  if (model === null) {
    throw new Error('battle_ready produced no board to draw.');
  }

  return model;
}

describe('the scene behind each screen', () => {
  it('answers for every kind the union declares, rather than throwing on some of them', () => {
    // Checked against `SCREEN_KINDS` rather than being four entries somebody remembered to
    // write: a fifth screen added to the union without a model here would otherwise leave
    // this file measuring four fifths of it and still green.
    const models = [
      offerFor('screen_normal'),
      AFTER_ACTION_LOADING_SCREEN,
      CONTRACT_BOARD_LOADING_SCREEN,
      BATTLE_LOADING_SCREEN
    ];

    expect(new Set(models.map((model) => model.screen))).toEqual(new Set(SCREEN_KINDS));

    for (const model of models) {
      expect(() => describeScene(model), model.screen).not.toThrow();
    }
  });

  it('draws nothing behind the offer, the debrief or the board, and keeps the box', () => {
    // `DEC-020`: no schematic world behind the screens. The offer is asked on a run that
    // carries a contract and a whole roster — the state that used to draw the most — so an
    // offer branch that came back would show up here rather than hide behind an empty model.
    const offer = offerFor('screen_normal');

    expect(offer.contract).not.toBeNull();
    expect(offer.roster.length).toBeGreaterThan(0);

    for (const model of [offer, AFTER_ACTION_LOADING_SCREEN, CONTRACT_BOARD_LOADING_SCREEN]) {
      const scene = describeScene(model);

      expect(scene.shapes, model.screen).toEqual([]);
      expect(scene.width, model.screen).toBe(SCENE_WIDTH);
      expect(scene.height, model.screen).toBe(MIN_SCENE_HEIGHT);
    }
  });

  it('holds the battle board to one id per shape, as it holds the line-up', () => {
    // A word on a token and the token under it are two shapes, and every statement about
    // the board names one by its id. A unit listed twice would put two tokens, two bars and
    // two words under the same three ids.
    expect(() => describeScene(aBoardOf(['crew:0', 'crew:0']), 0, (key) => key)).toThrow(
      /appears twice/u
    );
  });

  it('fails loudly, naming the key, when a board with words on it is handed no catalogue', () => {
    // The canvas behind the campaign screens has no words and is drawn with no catalogue.
    // The board has words, and one drawn without a resolver must not print its keys.
    expect(() => describeScene(aBoardOf(['crew:0']))).toThrow(/battle\.role\.vanguard\.short/u);
  });

  it('still draws the battle board', () => {
    // The counterpart, so "draws nothing" cannot quietly become the answer for all four.
    expect(describeScene(aBoard(), 0, (key) => key).shapes.length).toBeGreaterThan(0);
  });

  it('is a function of the model alone', () => {
    // Two projections of one model agree down to the numbers. Without this, a layout that
    // reached for a clock or a random offset would still pass every check above.
    const board = aBoard();

    expect(describeScene(board, 0, (key) => key)).toEqual(describeScene(board, 0, (key) => key));
  });
});
