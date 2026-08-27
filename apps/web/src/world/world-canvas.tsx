import type { ScreenModel } from '@oath-and-coin/presentation';
import { useEffect, useMemo, useRef } from 'react';

import { mountPixiScene, type PixiScene } from './pixi-scene.ts';
import { describeScene } from './scene-model.ts';

/**
 * The seam between React and the renderer: React owns one `<canvas>` element and never
 * looks inside it, PixiJS owns everything inside it and never touches the DOM around it.
 *
 * `ADR-010` §59 puts the Pixi facade in `apps/web/src/world`, and this is the whole of
 * what React contributes to it — an element, a lifetime, and the description to draw.
 * The description itself is computed by a pure function, so what this component would
 * get wrong is confined to the lifetime: mounting twice, or leaving a renderer alive
 * after the element it drew on is gone. Both are real and both were found by external
 * review rather than by a test, because there is no test here — jsdom has no WebGL.
 *
 * **Mounts are serialized through one chain.** `Application.init` is asynchronous, and
 * React replays effects under `StrictMode`: set up, tear down, set up again, with the
 * second setup starting before the first `init` has settled. Two renderers initializing
 * on one canvas is undefined behaviour, and the first one's teardown then destroys
 * resources the second is using. So every mount and every teardown is appended to a
 * single promise chain held in a ref, and each step runs after the previous one has
 * finished rather than beside it.
 *
 * **A failure to mount is not swallowed.** If no renderer can be created the rejection
 * reaches the page as an unhandled one, which is what the browser evidence records. The
 * alternative — a `catch` that leaves the canvas blank — would make "the scene is empty
 * because the roster is" and "the scene is empty because WebGL is unavailable" the same
 * observation, and the second is the one worth knowing about.
 */
export function WorldCanvas({ model }: { readonly model: ScreenModel }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  const description = useMemo(() => describeScene(model), [model]);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (canvas === null) {
      return;
    }

    let cancelled = false;
    let scene: PixiScene | null = null;

    chainRef.current = chainRef.current.then(async () => {
      if (cancelled) {
        return;
      }

      const mounted = await mountPixiScene(canvas, description);

      if (cancelled) {
        mounted.destroy();

        return;
      }

      scene = mounted;

      // The one thing this component states about itself, and it states only that the
      // renderer got as far as drawing: the browser evidence waits for it so a frame is
      // never captured mid-`init`, and then checks the pixels, which this attribute
      // cannot fake. A marker without a pixel check would be a page marking its own
      // work; a pixel check without a marker would be a race.
      canvas.dataset['sceneShapes'] = String(description.shapes.length);
    });

    return () => {
      cancelled = true;
      chainRef.current = chainRef.current.then(() => {
        delete canvas.dataset['sceneShapes'];
        scene?.destroy();
        scene = null;
      });
    };
  }, [description]);

  return (
    <canvas
      ref={canvasRef}
      data-testid="world-canvas"
      // Stated on the element as well as passed to the renderer: until the canvas has a
      // drawing buffer of its own it is 300×150, and a page that measured itself before
      // the renderer settled would measure that default rather than the scene.
      width={description.width}
      height={description.height}
    />
  );
}
