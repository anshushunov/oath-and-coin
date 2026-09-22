import type { Page } from '@playwright/test';

/**
 * The frame on the canvas, read back as pixels — shared by every suite that has to tell a
 * redrawn scene from one left standing.
 *
 * Lifted out of `live-command.spec.ts` unchanged, because the gate it served moved: that
 * suite pressed a command on the contract offer, and the offer's canvas left the page
 * (`DEC-020`) and the suite with it. `battle-redraw.spec.ts` carries the same question on the
 * battle board.
 */

/** What the canvas is actually showing, read back as pixels the page cannot fake. */
export interface FrameDigest {
  /** The shape count the component reports, for comparison against the pixels. */
  readonly shapes: number;
  /** FNV-1a over every byte of the frame — equal frames, equal digest. */
  readonly pixels: string;
  readonly distinctColors: number;
}

/**
 * Reads the drawn frame back off the canvas.
 *
 * The same technique `contract-offer.spec.ts` uses to prove a scene was drawn at all —
 * `preserveDrawingBuffer` is on for exactly this — carried one step further: a digest, so
 * two frames of one scene can be told apart rather than only "something was drawn".
 */
export async function frameDigest(page: Page): Promise<FrameDigest> {
  return page.evaluate((testId: string) => {
    const canvas = document.querySelector(`[data-testid="${testId}"]`);

    if (!(canvas instanceof HTMLCanvasElement)) {
      throw new Error(`The page has no <canvas data-testid="${testId}">.`);
    }

    const probe = document.createElement('canvas');
    probe.width = canvas.width;
    probe.height = canvas.height;

    const context = probe.getContext('2d', { willReadFrequently: true });

    if (context === null) {
      throw new Error('This browser gave no 2D context to read the scene back with.');
    }

    context.drawImage(canvas, 0, 0);

    const { data } = context.getImageData(0, 0, probe.width, probe.height);
    const colours = new Set<number>();
    let hash = 0x811c9dc5;

    for (let offset = 0; offset < data.length; offset += 4) {
      const pixel =
        ((data[offset] ?? 0) << 24) |
        ((data[offset + 1] ?? 0) << 16) |
        ((data[offset + 2] ?? 0) << 8) |
        (data[offset + 3] ?? 0);

      colours.add(pixel);
      hash = Math.imul(hash ^ (pixel & 0xff), 0x01000193);
      hash = Math.imul(hash ^ ((pixel >>> 8) & 0xff), 0x01000193);
      hash = Math.imul(hash ^ ((pixel >>> 16) & 0xff), 0x01000193);
      hash = Math.imul(hash ^ ((pixel >>> 24) & 0xff), 0x01000193);
    }

    return {
      shapes: Number(canvas.dataset['sceneShapes'] ?? '-1'),
      pixels: (hash >>> 0).toString(16).padStart(8, '0'),
      distinctColors: colours.size
    };
  }, 'world-canvas');
}
