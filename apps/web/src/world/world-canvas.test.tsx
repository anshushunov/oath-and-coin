// @vitest-environment jsdom
import { createSessionController, type SaveStorePort } from '@oath-and-coin/application';
import { RULESET_VERSION } from '@oath-and-coin/content';
import {
  LOADING_SCREEN,
  type BattleScreenModel,
  type ScreenModel
} from '@oath-and-coin/presentation';
import { StrictMode, act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { browserContentSource, shippedContentVersion } from '../content-source.ts';
import { mount } from '../testing/render.tsx';

import { describeScene, type SceneDescription } from './scene-model.ts';
import { WorldCanvas } from './world-canvas.tsx';

/**
 * The renderer's **lifetime**, which is the whole of what this component can get wrong.
 *
 * What it draws is `scene-model.test.ts`'s subject and how it draws is PixiJS's; jsdom has
 * no WebGL, so the renderer itself cannot run here at all. What can run here is everything
 * around the drawing — how many renderers are brought up, in what order scenes reach the
 * one that exists, whether a scene abandoned mid-flight is released, and whether a failure
 * leaves the rest of the lifetime unable to run — and `pixi-scene.ts` is replaced by a
 * recorder so that all four are observable.
 *
 * **This file exists because nothing saw a page that stopped answering.** The component
 * tore the renderer down and brought a new one up on every model change, and a second
 * `Application.init` on a canvas whose context had just been destroyed blocks the
 * renderer's main thread for good: in a real browser the first press of any command froze
 * the page. Every check in this repository was green — the jsdom tests replace this
 * component with `null`, and no end-to-end run applied a command that moved the campaign.
 *
 * **`init` is held open on purpose in most of these.** A recorder that resolved
 * immediately makes every question about *ordering* unanswerable: the mount is always
 * finished before anything else happens, so a model arriving mid-`init`, an unmount
 * mid-`init` and `StrictMode`'s replay all collapse into the one sequence that was never
 * in doubt. External review found two live mutants hiding in exactly that gap.
 */

const recorder = vi.hoisted(() => ({
  mounted: [] as SceneDescription[],
  applied: [] as SceneDescription[],
  destroyed: 0,
  /** Mounts wait here while `held` is set, so a test can decide when `init` settles. */
  held: false,
  waiting: [] as (() => void)[],
  /** What a draw does instead of recording, when a test is about a failing one. */
  applyThrows: null as Error | null
}));

vi.mock('./pixi-scene.ts', () => ({
  mountPixiScene: async (_canvas: HTMLCanvasElement, initial: SceneDescription) => {
    recorder.mounted.push(initial);

    if (recorder.held) {
      await new Promise<void>((resolve) => {
        recorder.waiting.push(resolve);
      });
    }

    return {
      apply: (description: SceneDescription) => {
        if (recorder.applyThrows !== null) {
          throw recorder.applyThrows;
        }

        recorder.applied.push(description);
      },
      destroy: () => {
        recorder.destroyed += 1;
      }
    };
  }
}));

beforeEach(() => {
  recorder.mounted.length = 0;
  recorder.applied.length = 0;
  recorder.waiting.length = 0;
  recorder.destroyed = 0;
  recorder.held = false;
  recorder.applyThrows = null;
});

/**
 * A board with men on it, so that this and {@link LOADING_SCREEN} describe two different
 * scenes. It was the offer's line-up until `DEC-020` took the canvas off the offer: the offer
 * now describes the same empty box a loading screen does, and a pair of models that draw one
 * picture could not tell a redraw from no redraw.
 */
function aBoardOnScreen(): ScreenModel {
  const battle = aBattleScreen();

  return battle.at(battle.landed);
}

/**
 * The fight `battle_ready` is one press away from, at a moment where something has just
 * landed on somebody — so the phase really moves the picture (the popup rises and fades)
 * and a redraw between two phases is a redraw of a different scene, not of the same one.
 *
 * Built through the live controller rather than by hand, the arrangement
 * `battle-screen.test.tsx` uses: the board has to be one a campaign can produce.
 */
function aBattleScreen(): {
  readonly at: (applied: number) => BattleScreenModel;
  readonly landed: number;
} {
  const refuse = (): never => {
    throw new Error('This test draws a board, not a save slot.');
  };
  const controller = createSessionController({
    request: {
      content: browserContentSource(),
      scenario: 'battle_ready',
      checkpoint: 'battle_ready',
      seed: 424242n
    },
    saves: { read: refuse, write: refuse, list: refuse, clear: refuse } as unknown as SaveStorePort,
    now: () => '1970-01-01T00:00:00.000Z',
    expected: { rulesetVersion: RULESET_VERSION, contentVersion: shippedContentVersion() }
  });

  void controller.start();

  const contractId = controller.store.snapshot().focusedContract;

  if (contractId === null) {
    throw new Error('battle_ready left no contract focused.');
  }

  const record = controller.previewBattle(contractId, null);

  if (record === null) {
    throw new Error('battle_ready produced no battle to draw.');
  }

  const at = (applied: number): BattleScreenModel => {
    const model = controller.battleScreen(contractId, record, applied, true);

    if (model === null) {
      throw new Error('battle_ready produced no campaign to build a board from.');
    }

    return model;
  };

  for (let applied = 1; applied < record.events.length; applied += 1) {
    if (at(applied).effect !== null) {
      return { at, landed: applied };
    }
  }

  throw new Error('battle_ready produced no event that lands on anybody.');
}

/**
 * A resolver that answers every key with itself. The words on the board are not this file's
 * question — which renderer draws them is — and one stable function is what keeps the
 * description the same object between two renders of the same model.
 */
const echo = (key: string): string => key;

/** Mounts the canvas and lets the promise chain the component keeps settle. */
async function mountCanvas(model: ScreenModel) {
  const tree = mount(<WorldCanvas model={model} />);
  await settle();

  return tree;
}

/** Lets every `init` this test is holding finish, then lets the chain drain. */
async function release(): Promise<void> {
  for (const resolve of recorder.waiting.splice(0)) {
    resolve();
  }

  await settle();
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let turn = 0; turn < 8; turn += 1) {
      await Promise.resolve();
    }
  });
}

/**
 * Runs `body` and answers with whatever went unhandled while it did.
 *
 * The component re-raises a failed step on a promise of its own so that it reaches the page
 * — that is the rule `world-canvas.tsx` keeps and the browser evidence reads. Here the same
 * rejection would be reported against the test run, so it is caught, asserted on, and kept
 * out of the suite's own report.
 */
async function unhandledDuring(body: () => Promise<void>): Promise<unknown[]> {
  const seen: unknown[] = [];
  const capture = (reason: unknown): void => {
    seen.push(reason);
  };

  process.on('unhandledRejection', capture);

  try {
    await body();
    await new Promise((resolve) => setTimeout(resolve, 0));
  } finally {
    process.off('unhandledRejection', capture);
  }

  return seen;
}

describe('the renderer behind the screen', () => {
  it('is brought up once and told what to draw afterwards, never brought up again', async () => {
    const campaign = aBoardOnScreen();
    const tree = await mountCanvas(LOADING_SCREEN);

    expect(recorder.mounted).toHaveLength(1);

    tree.rerender(<WorldCanvas model={campaign} textOf={echo} />);
    await settle();

    // The claim in full: one renderer for the life of the page, and the new scene reached
    // it. A component that remounted would satisfy neither half — and would freeze a real
    // browser on this very step.
    expect(recorder.mounted).toHaveLength(1);
    expect(recorder.destroyed).toBe(0);
    expect(recorder.applied).toEqual([describeScene(campaign, 0, echo)]);
  });

  it('draws the scene it was mounted with exactly once', async () => {
    // The other half of "told what to draw afterwards": the first description is already
    // drawn by the mount itself, so an update that redrew it would spend a frame proving
    // the scene had not changed.
    await mountCanvas(LOADING_SCREEN);

    expect(recorder.mounted).toEqual([describeScene(LOADING_SCREEN)]);
    expect(recorder.applied).toEqual([]);
  });

  it('releases the renderer when the page goes away', async () => {
    const tree = await mountCanvas(LOADING_SCREEN);

    tree.unmount();
    await settle();

    expect(recorder.destroyed).toBe(1);
  });

  it('says how many shapes it drew, and stops saying so once it is gone', async () => {
    // What the browser evidence waits for before it photographs the canvas. It has to move
    // with the scene rather than with the mount: a marker left at the first model's count
    // would let a frame be taken of a scene that is no longer the one described.
    const campaign = aBoardOnScreen();
    const tree = await mountCanvas(LOADING_SCREEN);
    const canvas = tree.container.querySelector('canvas');

    expect(canvas?.dataset['sceneShapes']).toBe(
      String(describeScene(LOADING_SCREEN).shapes.length)
    );

    tree.rerender(<WorldCanvas model={campaign} textOf={echo} />);
    await settle();

    expect(canvas?.dataset['sceneShapes']).toBe(
      String(describeScene(campaign, 0, echo).shapes.length)
    );
    expect(describeScene(campaign, 0, echo).shapes.length).not.toBe(
      describeScene(LOADING_SCREEN).shapes.length
    );

    tree.unmount();
    await settle();

    expect(canvas?.dataset['sceneShapes']).toBeUndefined();
  });
});

describe('the frame counter a browser check waits on', () => {
  it('counts every frame drawn, so "the next frame" is something a check can wait for', async () => {
    // `data-scene-shapes` is set by the mount and never goes away while the canvas lives, so
    // after a press a wait on it is satisfied at once — by the frame drawn *before* the press.
    // Review found three such waits in the browser suites. A number that moves with every
    // draw is what "the renderer has drawn what the press produced" can be waited on with.
    const campaign = aBoardOnScreen();
    const tree = await mountCanvas(LOADING_SCREEN);
    const canvas = tree.container.querySelector('canvas');

    expect(canvas?.dataset['sceneFrame']).toBe('1');

    tree.rerender(<WorldCanvas model={campaign} textOf={echo} />);
    await settle();

    expect(canvas?.dataset['sceneFrame']).toBe('2');

    // The same model again is not a frame: nothing was drawn, so nothing is counted.
    tree.rerender(<WorldCanvas model={campaign} textOf={echo} />);
    await settle();

    expect(canvas?.dataset['sceneFrame']).toBe('2');

    tree.unmount();
    await settle();

    expect(canvas?.dataset['sceneFrame']).toBeUndefined();
  });
});

describe('the battle board', () => {
  it('resolves the words on the board with the catalogue it is handed', async () => {
    // The scene resolves every key before the canvas (`battle-scene-model.ts`), and this is
    // the one seam the resolver crosses to get there. A component that dropped it would
    // describe a board with no catalogue, which throws on the first word.
    const battle = aBattleScreen();
    const asked: string[] = [];
    const textOf = (key: string): string => {
      asked.push(key);

      return key;
    };

    mount(<WorldCanvas model={battle.at(0)} textOf={textOf} />);
    await settle();

    expect(recorder.mounted).toHaveLength(1);
    expect(asked.length).toBeGreaterThan(0);
    expect(
      recorder.mounted[0]!.shapes.filter((shape) => shape.kind === 'battle-label')
    ).toHaveLength(battle.at(0).units.length);
  });

  it('does not bring up a second renderer between frames', async () => {
    // The invariant the browser gate cannot see. `battle-redraw.spec.ts` proves the frame on
    // the board changed; whether the *same* renderer changed it is counted here, where the
    // renderer is a recorder. The board is the one canvas `DEC-020` leaves on the page, and
    // both of the feed's inputs reach it: `advance` moves the phase within an event, `apply`
    // moves the model to the next one. Neither may cost a renderer.
    const battle = aBattleScreen();
    const landed = battle.at(battle.landed);
    const next = battle.at(battle.landed + 1);
    const tree = mount(<WorldCanvas model={landed} phase={0} textOf={echo} />);
    await settle();

    tree.rerender(<WorldCanvas model={landed} phase={0.5} textOf={echo} />);
    await settle();
    tree.rerender(<WorldCanvas model={next} phase={0} textOf={echo} />);
    await settle();

    expect(recorder.mounted).toHaveLength(1);
    expect(recorder.destroyed).toBe(0);
    expect(recorder.applied).toEqual([
      describeScene(landed, 0.5, echo),
      describeScene(next, 0, echo)
    ]);
    // Three different pictures, or the two draws above would be redraws of one scene and
    // the case would say nothing about frames.
    expect(describeScene(landed, 0.5, echo)).not.toEqual(describeScene(landed, 0, echo));
    expect(describeScene(next, 0, echo)).not.toEqual(describeScene(landed, 0.5, echo));
  });
});

describe('a model that arrives before the renderer has finished coming up', () => {
  it('is drawn once it has, rather than dropped', async () => {
    // The sequence a page produces on its own: `Application.init` takes a moment, the
    // session lands in that moment, and React renders the new model before the renderer
    // exists to draw it. A draw dispatched outside the chain finds no scene and is lost —
    // the canvas then shows the campaign as it was when the page opened, for good.
    const campaign = aBoardOnScreen();
    recorder.held = true;

    const tree = mount(<WorldCanvas model={LOADING_SCREEN} />);
    await settle();

    expect(recorder.mounted).toHaveLength(1);
    expect(recorder.applied).toEqual([]);

    tree.rerender(<WorldCanvas model={campaign} textOf={echo} />);
    await settle();
    await release();

    expect(recorder.mounted).toHaveLength(1);
    expect(recorder.applied).toEqual([describeScene(campaign, 0, echo)]);
  });

  it('is released rather than left drawing when the page goes first', async () => {
    recorder.held = true;

    const tree = mount(<WorldCanvas model={LOADING_SCREEN} />);
    await settle();

    tree.unmount();
    await settle();
    await release();

    // The renderer that nobody is waiting for any more is still a renderer holding a GPU
    // context. It arrives after the element is gone, and it has to be let go there.
    expect(recorder.destroyed).toBe(1);
  });
});

describe('the effects React replays under StrictMode', () => {
  it('leave one renderer, not two', async () => {
    // `StrictMode` runs setup, cleanup and setup again, and the first `init` is still in
    // flight when the second starts. Two renderers initializing on one canvas is undefined
    // behaviour and the first one's teardown then destroys what the second is using — the
    // reason every step goes through one chain rather than running beside the others.
    recorder.held = true;

    mount(
      <StrictMode>
        <WorldCanvas model={LOADING_SCREEN} />
      </StrictMode>
    );
    await settle();
    await release();

    expect(recorder.mounted).toHaveLength(1);
    expect(recorder.destroyed).toBe(0);
  });
});

describe('a step that fails', () => {
  it('does not take the teardown with it', async () => {
    // A rejected chain used to stay rejected: one throwing draw and every later step was
    // skipped in silence, including the release of the renderer. The failure itself still
    // has to reach the page, which is what the rejection below is.
    const campaign = aBoardOnScreen();
    const refused = new Error('this draw refuses');
    const tree = await mountCanvas(LOADING_SCREEN);

    recorder.applyThrows = refused;

    const unhandled = await unhandledDuring(async () => {
      tree.rerender(<WorldCanvas model={campaign} textOf={echo} />);
      await settle();

      tree.unmount();
      await settle();
    });

    expect(unhandled).toEqual([refused]);
    expect(recorder.destroyed).toBe(1);
  });
});
