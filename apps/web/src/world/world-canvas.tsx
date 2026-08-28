import type { ScreenModel } from '@oath-and-coin/presentation';
import { useEffect, useMemo, useRef, type RefObject } from 'react';

import { mountPixiScene, type PixiScene } from './pixi-scene.ts';
import { describeScene, type SceneDescription } from './scene-model.ts';

/**
 * The seam between React and the renderer: React owns one `<canvas>` element and never
 * looks inside it, PixiJS owns everything inside it and never touches the DOM around it.
 *
 * `ADR-010` §59 puts the Pixi facade in `apps/web/src/world`, and this is the whole of
 * what React contributes to it — an element, a lifetime, and the description to draw.
 * The description itself is computed by a pure function, so what this component can get
 * wrong is everything *around* the drawing: how many renderers are brought up, in what
 * order the scenes reach the one that exists, whether a scene abandoned mid-flight is
 * released, and whether a failure leaves the rest of the lifetime unable to run.
 * `world-canvas.test.tsx` is about exactly those four and about nothing else, because
 * jsdom has no WebGL and the renderer itself cannot run there at all.
 *
 * **Every step is serialized through one chain.** `Application.init` is asynchronous, and
 * React replays effects under `StrictMode`: set up, tear down, set up again, with the
 * second setup starting before the first `init` has settled. Two renderers initializing
 * on one canvas is undefined behaviour, and the first one's teardown then destroys
 * resources the second is using. So every mount, every draw and every teardown is
 * appended to a single promise chain held in a ref, and each runs after the previous one
 * has finished rather than beside it.
 *
 * **A failure is surfaced, and it does not take the chain with it** ({@link queue}). If no
 * renderer can be created the rejection reaches the page unhandled, which is what the
 * browser evidence records — the alternative, a `catch` that leaves the canvas blank,
 * would make "the scene is empty because the roster is" and "the scene is empty because
 * WebGL is unavailable" the same observation. What changed after external review is the
 * other half: a rejected chain used to stay rejected, so every later step — including the
 * teardown that releases the renderer — was skipped in silence.
 *
 * **One renderer for the life of the page, redrawn — never a renderer per model.** The
 * mount is keyed on nothing and the *draw* is keyed on the description, which is two
 * effects rather than one and is not a stylistic split. Until this was found the whole
 * thing hung off `[description]`, so every applied command destroyed the renderer and
 * initialized a new one on the same `<canvas>`; in a real browser the second `init` on a
 * canvas whose context had just been released blocks the renderer's main thread and the
 * page never answers again. Pressing any command on the negotiation screen froze the page
 * from the moment those controls became live, with every check in this repository green:
 * the jsdom tests replace this component with `null`, and no end-to-end run applied a
 * command that moved the campaign. `PixiScene.apply` had existed for exactly this since
 * the scene was written and nothing outside `mountPixiScene` ever called it.
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

  useEffect(() => {
    const canvas = canvasRef.current;

    if (canvas === null) {
      return;
    }

    let cancelled = false;

    queue(chainRef, async () => {
      if (cancelled) {
        return;
      }

      const mounted = await mountPixiScene(canvas, description);

      if (cancelled) {
        mounted.destroy();

        return;
      }

      sceneRef.current = mounted;
      drawnRef.current = description;

      // The one thing this component states about itself, and it states only that the
      // renderer got as far as drawing: the browser evidence waits for it so a frame is
      // never captured mid-`init`, and then checks the pixels, which this attribute
      // cannot fake. A marker without a pixel check would be a page marking its own
      // work; a pixel check without a marker would be a race.
      canvas.dataset['sceneShapes'] = String(description.shapes.length);
    });

    return () => {
      cancelled = true;
      queue(chainRef, () => {
        delete canvas.dataset['sceneShapes'];
        sceneRef.current?.destroy();
        sceneRef.current = null;
        drawnRef.current = null;
      });
    };
    // The description this closes over is the one committed with this effect, and it is
    // deliberately not a dependency: a renderer per description is the defect that froze
    // the page, and every description after this one arrives through the effect below.
    // Read out of a ref written during render instead — the shape this briefly had — and a
    // render React threw away could hand the renderer a scene the tree never committed,
    // which external review caught before it could happen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (canvas === null) {
      return;
    }

    // Appended to the same chain the mount uses, so a description arriving before `init`
    // has settled is drawn after it rather than onto a renderer that does not exist yet.
    queue(chainRef, () => {
      const scene = sceneRef.current;

      // Nothing to draw on — the mount was cancelled, or the page is on its way out — or
      // this is the description the mount already drew, and redrawing it would spend a
      // frame proving the scene had not changed.
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

/**
 * Appends one step to the serialization chain, and leaves the chain usable whatever the
 * step did.
 *
 * **A rejected promise stays rejected, and a chain built out of `then(step)` alone inherits
 * that forever.** External review found what it costs here: one failed `init` or one
 * throwing draw, and every later step is skipped — including the teardown that releases the
 * renderer, which is the moment the page most needs it to run.
 *
 * The error is re-raised rather than swallowed, on a promise of its own, so it reaches the
 * page unhandled exactly as it did before: a renderer that could not come up has to be
 * observable, and the browser evidence records it as an event. What it no longer does is
 * take the rest of the lifetime with it.
 */
function queue(chain: RefObject<Promise<void>>, step: () => void | Promise<void>): void {
  chain.current = chain.current.then(step).catch((error: unknown) => {
    void Promise.reject(error);
  });
}
