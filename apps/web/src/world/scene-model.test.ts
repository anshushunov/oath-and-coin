import { startSession } from '@oath-and-coin/application';
import {
  AFTER_ACTION_LOADING_SCREEN,
  CONTRACT_BOARD_LOADING_SCREEN,
  SCREEN_KINDS,
  ScreenKind,
  ScreenState,
  createContractOfferScreenModel,
  type ContractLine,
  type ContractOfferScreenModel,
  type HeroCard,
  type ResponseLine
} from '@oath-and-coin/presentation';
import { describe, expect, it } from 'vitest';

import { browserContentSource } from '../content-source.ts';

import { MIN_SCENE_HEIGHT, SCENE_WIDTH, describeScene, type SceneShape } from './scene-model.ts';

/**
 * Task 14 has no oracle, so this file carries the whole weight of the scene's proof.
 *
 * That changes what the tests are allowed to be. There is no frozen expectation to
 * compare against, which means a snapshot of the numbers would be a record of whatever
 * the code did on the day it was written — `AGENTS.md` §8 calls that out directly:
 * a snapshot is admissible only alongside a check of what the result *means*. So the
 * assertions below are about properties instead: which shapes exist, in which order,
 * whether any two of them collide, whether any of them leaves the box. Each one holds
 * for reasons that can be stated without reading the layout constants back.
 *
 * The models come from `startSession` over the shipped content wherever a shipped
 * scenario can pose the question, for the same reason the screen tests do: a hand-built
 * model can agree with a projection no run could ever reach. Two questions are not
 * reachable that way — a roster that outgrows one row, and a responder who is not the
 * first hero — and those are hand-built and say so.
 */

/**
 * The five scenarios whose manifests declare the five states, in state order.
 *
 * Which state each one produces is asserted where that is the question — the screen's
 * own tests — and not restated here. This file's questions are about the projection, and
 * it takes the states as scenarios precisely because it must not read a state itself.
 */
const SCREEN_SCENARIOS = [
  { scenario: 'screen_loading' },
  { scenario: 'screen_empty' },
  { scenario: 'screen_error' },
  { scenario: 'screen_incomplete' },
  { scenario: 'screen_normal' }
] as const;

/** The seed the scenario runner's CLI defaults to, and the one the corpus records. */
const SEED = 424242n;

function modelFor(scenario: string): ContractOfferScreenModel {
  const { screen } = startSession({
    content: browserContentSource(),
    scenario,
    checkpoint: null,
    seed: SEED
  });

  // Every scenario here is a negotiation, and `SessionState.screen` is a union of three
  // since the contract loop grew a debrief and a board. A throw rather than a cast: a run
  // that landed elsewhere has stopped being what this file measures.
  if (screen.screen !== ScreenKind.ContractOffer) {
    throw new Error(`'${scenario}' landed on '${screen.screen}', not on the contract offer.`);
  }

  return screen;
}

/** A roster entry with only the fields the scene reads stated. */
function aHeroCard(definition: string): HeroCard {
  return {
    definition,
    displayNameKey: `hero.${definition}.name`,
    greed: 'Moderate',
    caution: 'Moderate',
    pride: 'Moderate',
    principleKeys: [],
    inclinationKeys: []
  } as HeroCard;
}

/** A response from one hero, likewise minimal. */
function aResponse(heroDefinition: string): ResponseLine {
  return {
    heroDefinition,
    heroDisplayNameKey: `hero.${heroDefinition}.name`,
    action: 'accept',
    reasons: [],
    blockedByEntity: null,
    blockedByDisplayNameKey: null,
    tieBreakCode: null,
    wavered: false
  };
}

const A_CONTRACT: ContractLine = {
  definition: 'core:escort_the_caravan',
  displayNameKey: 'contract.core.escort_the_caravan.name',
  patronFee: 40,
  risk: 'Moderate',
  tagKeys: [],
  requiredCrew: 2,
  acceptedCount: 0
} as ContractLine;

/**
 * A `Normal` model over a stated roster and a stated set of responders.
 *
 * `createContractOfferScreenModel` still validates it, so a case cannot accidentally
 * pose a combination the factory would refuse to build.
 */
function aModel(rosterDefinitions: readonly string[], responders: readonly string[]) {
  return createContractOfferScreenModel({
    state: ScreenState.Normal,
    titleKey: 'ui.contract_offer.title',
    contract: A_CONTRACT,
    roster: rosterDefinitions.map(aHeroCard),
    responses: responders.map(aResponse),
    errorCode: null,
    errorDetail: null,
    // The negotiation fields (`DEC-008` Task 15) are not this file's question — the
    // scene reads only `contract` and `roster` (`describeScene`'s own rule) — so a
    // minimal, legal offer is enough to keep the model itself valid.
    treasury: 400,
    offer: {
      version: 1,
      // A bare literal, not `OfferPhase.Draft` (the convention `packages/presentation`'s
      // own tests use): `apps/web` does not depend on `@oath-and-coin/simulation` at
      // all (`package.json` names only `application`/`content`/`presentation`), and the
      // type this satisfies structurally is a plain string union either way.
      phase: 'draft',
      advanceLever: { value: 0, min: 0, max: 0, disabledReasonKey: null },
      bonusLever: { value: 0, min: 0, max: 0, disabledReasonKey: null },
      methodLever: { chosen: null, options: [], disabledReasonKey: null },
      keyHeroLever: { chosen: null, options: [], disabledReasonKey: null },
      crewLever: { chosen: [], options: [], exactly: 1, disabledReasonKey: null },
      budget: { available: 0, maxAdvance: 0, maxBonus: 0 },
      lockCommitment: 0
    },
    treasuryForecast: 400,
    promiseTerms: null,
    settlement: null
  });
}

function overlaps(a: SceneShape, b: SceneShape): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

describe('the scene behind the contract-offer screen', () => {
  it.each(SCREEN_SCENARIOS)(
    'draws the contract of $scenario exactly when the model carries one',
    ({ scenario }) => {
      const model = modelFor(scenario);
      const markers = describeScene(model).shapes.filter(
        (shape) => shape.kind === 'contract-marker'
      );

      // Not "the contract states have a marker and the others do not" spelled out per
      // state: that would restate the state table this projection deliberately does not
      // read. The rule is the one the projection actually applies.
      expect(markers).toHaveLength(model.contract === null ? 0 : 1);

      if (model.contract !== null) {
        expect(markers[0]?.id).toBe(`contract:${model.contract.definition}`);
      }
    }
  );

  it.each(SCREEN_SCENARIOS)(
    'draws one token per hero of $scenario, in roster order',
    ({ scenario }) => {
      const model = modelFor(scenario);
      const tokens = describeScene(model).shapes.filter((shape) => shape.kind === 'hero-token');

      // One token per hero and no one dropped, which is what a shipped scenario can
      // actually ask. It cannot ask about the *order*: measured, every shipped roster
      // arrives already sorted by definition — `["core:bram", "core:doran", "core:ilsa",
      // "core:kestrel", "core:mira", "core:zara"]` — so a projection that sorted the
      // roster itself passes this identically. The mutant that sorts is red on the
      // hand-built case below and green here, and this comment exists so the next reader
      // does not mistake this for the check that covers it.
      expect(tokens.map((token) => token.id)).toEqual(
        model.roster.map((hero) => `hero:${hero.definition}`)
      );
    }
  );

  it('lays the roster out in the order the model gives, not in its definitions order', () => {
    // A roster no shipped scenario produces: reverse-alphabetical at the front. Sorting
    // by definition, keying a `Map` off it, or any other "stable" reordering shows
    // `bram` first here and is red.
    const tokens = describeScene(
      aModel(['core:zara', 'core:bram', 'core:doran'], [])
    ).shapes.filter((shape) => shape.kind === 'hero-token');

    expect(tokens.map((token) => token.id)).toEqual([
      'hero:core:zara',
      'hero:core:bram',
      'hero:core:doran'
    ]);
  });

  it('puts the contract marker before the roster', () => {
    const shapes = describeScene(modelFor('screen_normal')).shapes;

    // The renderer draws in list order, so this is the difference between a marker
    // behind the line-up and one on top of it.
    expect(shapes[0]?.kind).toBe('contract-marker');
    expect(shapes.slice(1).every((shape) => shape.kind === 'hero-token')).toBe(true);
  });

  it('shows nothing at all for a screen with nothing to offer', () => {
    // `screen_empty` is the state whose whole content is its absence, and a scene that
    // drew a marker for a contract that is not there would be inventing one.
    expect(describeScene(modelFor('screen_empty')).shapes).toEqual([]);
  });

  it('marks a hero answered by their definition, not by how many answers there are', () => {
    // The middle hero of three answers. An implementation that called the first
    // `responses.length` heroes answered — the mistake the model's own completeness rule
    // is written against — produces the exact opposite of this.
    const scene = describeScene(aModel(['core:zara', 'core:bram', 'core:doran'], ['core:bram']));
    const tokens = scene.shapes.filter((shape) => shape.kind === 'hero-token');

    expect(tokens.map((token) => token.answered)).toEqual([false, true, false]);
  });

  it('agrees with the shipped run about who has answered', () => {
    // The same rule against a run rather than a hand-built model: `screen_incomplete` is
    // the shipped scenario where the two lists differ in length.
    //
    // It is the weaker of the two checks and deliberately not the only one. Measured,
    // the single hero who answers there is `core:bram`, the *first* of the roster — so
    // the counting mistake this rule is written against produces exactly the same six
    // flags and passes. What this case does add is that the shipped run reaches the
    // branch at all, which the hand-built one cannot say.
    const model = modelFor('screen_incomplete');
    const answered = new Set(model.responses.map((response) => response.heroDefinition));

    expect(model.responses.length).toBeLessThan(model.roster.length);
    expect(
      describeScene(model)
        .shapes.filter((shape) => shape.kind === 'hero-token')
        .map((token) => token.answered)
    ).toEqual(model.roster.map((hero) => answered.has(hero.definition)));
  });

  it('gives every shape a size a renderer can draw', () => {
    // External review found this one by substitution: `width: TOKEN_SIZE` → `width: 0`
    // passed every other check in this file. Order, ids, `answered` and the scene's
    // height are all unaffected; the overlap check accepts a zero-width rectangle
    // because it cannot overlap anything; containment accepts it for the same reason.
    // On the canvas the roster simply disappears.
    const shapes = describeScene(aModel(['core:bram', 'core:zara'], ['core:bram'])).shapes;

    expect(shapes.length).toBeGreaterThan(0);

    for (const shape of shapes) {
      expect(Number.isFinite(shape.x), `${shape.id} x`).toBe(true);
      expect(Number.isFinite(shape.y), `${shape.id} y`).toBe(true);
      expect(shape.width, `${shape.id} width`).toBeGreaterThan(0);
      expect(shape.height, `${shape.id} height`).toBeGreaterThan(0);
    }
  });

  it('keeps a hero token distinct from every other shape', () => {
    // Ten heroes, so the grid wraps and rows are tested as well as columns. Pairwise
    // rather than "the positions are distinct": two tokens can sit at different
    // coordinates and still cover each other.
    const shapes = describeScene(
      aModel(
        Array.from({ length: 10 }, (_, index) => `core:hero_${String(index)}`),
        []
      )
    ).shapes;

    const collisions = shapes.flatMap((a, i) =>
      shapes
        .slice(i + 1)
        .filter((b) => overlaps(a, b))
        .map((b) => `${a.id} / ${b.id}`)
    );

    expect(collisions).toEqual([]);
  });

  it('grows the scene rather than drawing a wrapped roster outside it', () => {
    const wide = describeScene(
      aModel(
        Array.from({ length: 10 }, (_, index) => `core:hero_${String(index)}`),
        []
      )
    );

    expect(wide.width).toBe(SCENE_WIDTH);
    expect(wide.height).toBeGreaterThan(MIN_SCENE_HEIGHT);

    for (const shape of wide.shapes) {
      expect(shape.x).toBeGreaterThanOrEqual(0);
      expect(shape.y).toBeGreaterThanOrEqual(0);
      expect(shape.x + shape.width).toBeLessThanOrEqual(wide.width);
      expect(shape.y + shape.height).toBeLessThanOrEqual(wide.height);
    }
  });

  it('keeps the box a box when there is nothing in it', () => {
    const empty = describeScene(modelFor('screen_empty'));

    expect(empty.width).toBe(SCENE_WIDTH);
    expect(empty.height).toBe(MIN_SCENE_HEIGHT);
  });

  it('is a function of the model alone', () => {
    // Two projections of one model agree down to the numbers. Without this, a layout
    // that reached for a clock or a random offset would still pass every check above.
    const model = modelFor('screen_normal');

    expect(describeScene(model)).toEqual(describeScene(model));
  });

  it('refuses a roster that names the same hero twice', () => {
    // The adapter keys its display objects by id. Two heroes sharing one would leave a
    // roster of two drawn as one, with nothing anywhere reporting it.
    expect(() => describeScene(aModel(['core:bram', 'core:bram'], []))).toThrow(/appears twice/u);
  });
});

describe('the scene behind the other two screens', () => {
  it('answers for every kind the union declares, rather than throwing on two of them', () => {
    // `describeScene` took one model until the contract loop grew three. A `switch` that
    // threw on the two new ones would take the canvas down with the first settlement.
    //
    // The matrix is checked against `SCREEN_KINDS` rather than being three entries somebody
    // remembered to write: a fourth screen added to the union without a model here would
    // otherwise leave this file measuring three quarters of it and still green.
    const models = [
      modelFor('screen_normal'),
      AFTER_ACTION_LOADING_SCREEN,
      CONTRACT_BOARD_LOADING_SCREEN
    ];

    expect(new Set(models.map((model) => model.screen))).toEqual(new Set(SCREEN_KINDS));

    for (const model of models) {
      expect(() => describeScene(model), model.screen).not.toThrow();
    }
  });

  it('draws nothing for a debrief or a board, and keeps the box', () => {
    // `DEC-015`, the owner's decision of 2026-08-28: neither model carries a crew, so
    // there is no line-up to draw. The box keeps its shape so the canvas does not collapse
    // to the 300×150 a `<canvas>` defaults to.
    for (const model of [AFTER_ACTION_LOADING_SCREEN, CONTRACT_BOARD_LOADING_SCREEN]) {
      const scene = describeScene(model);

      expect(scene.shapes, model.screen).toEqual([]);
      expect(scene.width, model.screen).toBe(SCENE_WIDTH);
      expect(scene.height, model.screen).toBe(MIN_SCENE_HEIGHT);
    }
  });

  it('still draws the offer screen it always drew', () => {
    // The counterpart, so "draws nothing" cannot quietly become the answer for all three.
    expect(describeScene(modelFor('screen_normal')).shapes.length).toBeGreaterThan(0);
  });
});
