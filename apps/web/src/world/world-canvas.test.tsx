// @vitest-environment jsdom
import { startSession } from '@oath-and-coin/application';
import { LOADING_SCREEN, type ScreenModel } from '@oath-and-coin/presentation';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { browserContentSource } from '../content-source.ts';
import { mount } from '../testing/render.tsx';

import { describeScene, type SceneDescription } from './scene-model.ts';
import { WorldCanvas } from './world-canvas.tsx';

/**
 * The renderer's **lifetime**, which is the whole of what this component can get wrong.
 *
 * What it draws is `scene-model.test.ts`'s subject and how it draws is PixiJS's; jsdom has
 * no WebGL, so the renderer itself cannot run here at all. What can run here is the
 * bookkeeping around it — how many renderers are brought up, what they are told to draw
 * afterwards, and whether the last one is released — and `pixi-scene.ts` is replaced by a
 * recorder so that bookkeeping is observable.
 *
 * **This file exists because nothing saw a page that stopped answering.** The component
 * tore the renderer down and brought a new one up on every model change, and a second
 * `Application.init` on a canvas whose context had just been destroyed blocks the
 * renderer's main thread for good: in a real browser the first press of any command froze
 * the page. Every check in this repository was green — the jsdom tests replace this
 * component with `null`, and no end-to-end run pressed a command.
 */

const recorder = vi.hoisted(() => ({
  mounted: [] as SceneDescription[],
  applied: [] as SceneDescription[],
  destroyed: 0
}));

vi.mock('./pixi-scene.ts', () => ({
  mountPixiScene: (_canvas: HTMLCanvasElement, initial: SceneDescription) => {
    recorder.mounted.push(initial);

    return Promise.resolve({
      apply: (description: SceneDescription) => {
        recorder.applied.push(description);
      },
      destroy: () => {
        recorder.destroyed += 1;
      }
    });
  }
}));

beforeEach(() => {
  recorder.mounted.length = 0;
  recorder.applied.length = 0;
  recorder.destroyed = 0;
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

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
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
