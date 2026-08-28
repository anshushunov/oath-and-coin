// @vitest-environment jsdom
import { startSession } from '@oath-and-coin/application';
import { LOADING_SCREEN, type ScreenModel } from '@oath-and-coin/presentation';
import { StrictMode, act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { browserContentSource } from '../content-source.ts';
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

/** A campaign on screen, so the two models below describe two different scenes. */
function aCampaignScreen(): ScreenModel {
  return startSession({
    content: browserContentSource(),
    scenario: 'screen_normal',
    checkpoint: 'screen_normal',
    seed: 424242n
  }).screen;
}

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
    const campaign = aCampaignScreen();
    const tree = await mountCanvas(LOADING_SCREEN);

    expect(recorder.mounted).toHaveLength(1);

    tree.rerender(<WorldCanvas model={campaign} />);
    await settle();

    // The claim in full: one renderer for the life of the page, and the new scene reached
    // it. A component that remounted would satisfy neither half — and would freeze a real
    // browser on this very step.
    expect(recorder.mounted).toHaveLength(1);
    expect(recorder.destroyed).toBe(0);
    expect(recorder.applied).toEqual([describeScene(campaign)]);
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
    const campaign = aCampaignScreen();
    const tree = await mountCanvas(LOADING_SCREEN);
    const canvas = tree.container.querySelector('canvas');

    expect(canvas?.dataset['sceneShapes']).toBe(
      String(describeScene(LOADING_SCREEN).shapes.length)
    );

    tree.rerender(<WorldCanvas model={campaign} />);
    await settle();

    expect(canvas?.dataset['sceneShapes']).toBe(String(describeScene(campaign).shapes.length));
    expect(describeScene(campaign).shapes.length).not.toBe(
      describeScene(LOADING_SCREEN).shapes.length
    );

    tree.unmount();
    await settle();

    expect(canvas?.dataset['sceneShapes']).toBeUndefined();
  });
});

describe('a model that arrives before the renderer has finished coming up', () => {
  it('is drawn once it has, rather than dropped', async () => {
    // The sequence a page produces on its own: `Application.init` takes a moment, the
    // session lands in that moment, and React renders the new model before the renderer
    // exists to draw it. A draw dispatched outside the chain finds no scene and is lost —
    // the canvas then shows the campaign as it was when the page opened, for good.
    const campaign = aCampaignScreen();
    recorder.held = true;

    const tree = mount(<WorldCanvas model={LOADING_SCREEN} />);
    await settle();

    expect(recorder.mounted).toHaveLength(1);
    expect(recorder.applied).toEqual([]);

    tree.rerender(<WorldCanvas model={campaign} />);
    await settle();
    await release();

    expect(recorder.mounted).toHaveLength(1);
    expect(recorder.applied).toEqual([describeScene(campaign)]);
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
    const campaign = aCampaignScreen();
    const refused = new Error('this draw refuses');
    const tree = await mountCanvas(LOADING_SCREEN);

    recorder.applyThrows = refused;

    const unhandled = await unhandledDuring(async () => {
      tree.rerender(<WorldCanvas model={campaign} />);
      await settle();

      tree.unmount();
      await settle();
    });

    expect(unhandled).toEqual([refused]);
    expect(recorder.destroyed).toBe(1);
  });
});
