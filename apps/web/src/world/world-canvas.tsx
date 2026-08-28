import type { ScreenModel } from '@oath-and-coin/presentation';
import { useEffect, useMemo, useRef } from 'react';

import { mountPixiScene, type PixiScene } from './pixi-scene.ts';
import { describeScene, type SceneDescription } from './scene-model.ts';

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
 *
 * **One renderer for the life of the page, redrawn — never a renderer per model.** The
 * mount is keyed on nothing and the *draw* is keyed on the description, which is two
 * effects rather than one and is not a stylistic split. Until this was found the whole
 * thing hung off `[description]`, so every applied command destroyed the renderer and
 * initialized a new one on the same `<canvas>`; in a real browser the second `init` on a
 * canvas whose context had just been released blocks the renderer's main thread and the
 * page never answers again. Pressing any command on the negotiation screen froze the page
 * from the moment those controls became live, with every check in this repository green:
 * the jsdom tests replace this component with `null`, and no end-to-end run pressed a
 * command. `PixiScene.apply` had existed for exactly this since the scene was written and
 * nothing outside `mountPixiScene` ever called it.
 */
export function WorldCanvas({ model }: { readonly model: ScreenModel }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  const sceneRef = useRef<PixiScene | null>(null);
  // What the renderer is currently showing, so the update below can tell "already drawn"
  // from "not drawn yet". Compared by identity, which is exactly what `useMemo` gives it:
  // one description per model, and one model per store update.
  const drawnRef = useRef<SceneDescription | null>(null);
  const description = useMemo(() => describeScene(model), [model]);
  // Read by the mount effect, which runs once and must therefore draw whatever the current
  // model is rather than the one this component first rendered with. A ref rather than a
  // dependency: making the mount depend on the description is the defect this component
  // was fixed for.
  const latest = useRef(description);
  latest.current = description;

  useEffect(() => {
    const canvas = canvasRef.current;

    if (canvas === null) {
      return;
    }

    let cancelled = false;

    chainRef.current = chainRef.current.then(async () => {
      if (cancelled) {
        return;
      }

      const initial = latest.current;
      const mounted = await mountPixiScene(canvas, initial);

      if (cancelled) {
        mounted.destroy();

        return;
      }

      sceneRef.current = mounted;
      drawnRef.current = initial;

      // The one thing this component states about itself, and it states only that the
      // renderer got as far as drawing: the browser evidence waits for it so a frame is
      // never captured mid-`init`, and then checks the pixels, which this attribute
      // cannot fake. A marker without a pixel check would be a page marking its own
      // work; a pixel check without a marker would be a race.
      canvas.dataset['sceneShapes'] = String(initial.shapes.length);
    });

    return () => {
      cancelled = true;
      chainRef.current = chainRef.current.then(() => {
        delete canvas.dataset['sceneShapes'];
        sceneRef.current?.destroy();
        sceneRef.current = null;
        drawnRef.current = null;
      });
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (canvas === null) {
      return;
    }

    // Appended to the same chain the mount uses, so a description arriving before `init`
    // has settled is drawn after it rather than onto a renderer that does not exist yet.
    chainRef.current = chainRef.current.then(() => {
      const scene = sceneRef.current;

      // Nothing to draw on — the mount was cancelled, or the page is on its way out. The
      // description is not remembered either: whatever comes up next reads `latest`.
      if (scene === null || drawnRef.current === description) {
        return;
      }

      scene.apply(description);
      drawnRef.current = description;
      canvas.dataset['sceneShapes'] = String(description.shapes.length);
    });
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
