import type { ContractOfferScreenModel } from '@oath-and-coin/presentation';
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
 * after the element it drew on is gone.
 *
 * **A failure to mount is not swallowed.** If no renderer can be created the rejection
 * reaches the page as an unhandled one, which is what Task 15's evidence records. The
 * alternative — a `catch` that leaves the canvas blank — would make "the scene is empty
 * because the roster is" and "the scene is empty because WebGL is unavailable" the same
 * observation, and the second is the one worth knowing about.
 */
export function WorldCanvas({ model }: { readonly model: ContractOfferScreenModel }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const description = useMemo(() => describeScene(model), [model]);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (canvas === null) {
      return;
    }

    // `Application.init` is asynchronous, so a component unmounted before it settles
    // would otherwise leave a renderer attached to a canvas React has already removed.
    // The flag is read after the await; the handle is kept so the cleanup that runs
    // later can still reach it.
    let cancelled = false;
    let scene: PixiScene | null = null;

    void mountPixiScene(canvas, description).then((mounted) => {
      if (cancelled) {
        mounted.destroy();

        return;
      }

      scene = mounted;
    });

    return () => {
      cancelled = true;
      scene?.destroy();
      scene = null;
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
