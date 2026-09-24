import { expect, type Page } from '@playwright/test';

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
  /**
   * The same count over the left half of the frame and over the right half.
   *
   * On the battle board that is the crew's side and the foes' (`cornerOf` in
   * `battle-scene-model.ts`), and the halves are what let a check say *both* sides carry
   * words: a count over the whole frame is as far above its threshold with only the crew
   * labelled as with everybody (a mutant labelling the crew alone measured 660 on the frame
   * where the full board measures 802).
   */
  readonly leftDistinctColors: number;
  readonly rightDistinctColors: number;
}

/**
 * How many frames the renderer has drawn since it came up (`data-scene-frame`), or `0` when it
 * has not drawn one yet.
 *
 * What a check waits on after a press. `data-scene-shapes` is set by the mount and stays, so
 * after a press a wait on it is satisfied at once — by the frame from *before* the press; this
 * number moves with every draw. Read it before the press, wait for it to pass that value
 * after ({@link expectNextFrame}).
 */
export async function sceneFrame(page: Page): Promise<number> {
  const value = await page.getByTestId('world-canvas').getAttribute('data-scene-frame');

  return value === null ? 0 : Number(value);
}

/**
 * Waits until the renderer has drawn past the frame numbered `before` and then stopped
 * drawing.
 *
 * Both halves, because a feed that is running draws on its own: in the combat loop the fight
 * plays while the player watches, so "a frame after the press" can be one the feed drew a
 * moment before the press landed. What the press leaves is a board that stops changing — the
 * fight is over, nothing on it moves — and the frame number holding still across several
 * animation frames is that, observed.
 */
export async function expectNextFrame(page: Page, before: number): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate(async (testId: string) => {
          const read = (): number =>
            Number(
              document
                .querySelector(`[data-testid="${testId}"]`)
                ?.getAttribute('data-scene-frame') ?? '0'
            );
          const first = read();

          for (let frame = 0; frame < 4; frame += 1) {
            await new Promise<void>((resolve) => {
              requestAnimationFrame(() => {
                resolve();
              });
            });
          }

          // `-1` while the board is still being redrawn, so the poll keeps asking.
          return read() === first ? first : -1;
        }, 'world-canvas'),
      { message: 'the renderer must draw the frame the press produced, and settle on it' }
    )
    .toBeGreaterThan(before);
}

/**
 * How many pixels of the frame are exactly the colour a token of the stylesheet names.
 *
 * The colour is read off the page — `getComputedStyle` on `:root`, the `tokens.css` the canvas
 * palette is generated with — rather than written here: a literal in this file would be a
 * second declaration of the colour, and the day the two disagree the count would be of a
 * colour nothing draws.
 *
 * Exact equality, on purpose. Antialiasing blends a shape's edges into its neighbours, so
 * every shade it produces is some other colour; what is exactly this colour is the inside of a
 * shape painted with it. A check built on it answers "is a shape of this colour on the frame",
 * which a count of distinct colours cannot: words alone are hundreds of shades
 * (`docs/research/BATTLE_LABEL_SPIKE_2026-09.md`), so a threshold on that count is equally
 * satisfied with the line of intent and without it.
 */
export async function pixelsOfToken(page: Page, variable: string): Promise<number> {
  return page.evaluate(
    ({ testId, name }) => {
      const canvas = document.querySelector(`[data-testid="${testId}"]`);

      if (!(canvas instanceof HTMLCanvasElement)) {
        throw new Error(`The page has no <canvas data-testid="${testId}">.`);
      }

      const declared = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/iu.exec(declared);

      if (match === null) {
        throw new Error(`'${name}' is '${declared}' on this page, which is not a #rrggbb colour.`);
      }

      const [red, green, blue] = [match[1], match[2], match[3]].map((part) =>
        Number.parseInt(part ?? '', 16)
      );
      const probe = document.createElement('canvas');
      probe.width = canvas.width;
      probe.height = canvas.height;

      const context = probe.getContext('2d', { willReadFrequently: true });

      if (context === null) {
        throw new Error('This browser gave no 2D context to read the scene back with.');
      }

      context.drawImage(canvas, 0, 0);

      const { data } = context.getImageData(0, 0, probe.width, probe.height);
      let count = 0;

      for (let offset = 0; offset < data.length; offset += 4) {
        if (
          data[offset] === red &&
          data[offset + 1] === green &&
          data[offset + 2] === blue &&
          data[offset + 3] === 255
        ) {
          count += 1;
        }
      }

      return count;
    },
    { testId: 'world-canvas', name: variable }
  );
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
    const left = new Set<number>();
    const right = new Set<number>();
    const middle = probe.width / 2;
    let hash = 0x811c9dc5;

    for (let offset = 0; offset < data.length; offset += 4) {
      const pixel =
        ((data[offset] ?? 0) << 24) |
        ((data[offset + 1] ?? 0) << 16) |
        ((data[offset + 2] ?? 0) << 8) |
        (data[offset + 3] ?? 0);

      colours.add(pixel);
      ((offset / 4) % probe.width < middle ? left : right).add(pixel);
      hash = Math.imul(hash ^ (pixel & 0xff), 0x01000193);
      hash = Math.imul(hash ^ ((pixel >>> 8) & 0xff), 0x01000193);
      hash = Math.imul(hash ^ ((pixel >>> 16) & 0xff), 0x01000193);
      hash = Math.imul(hash ^ ((pixel >>> 24) & 0xff), 0x01000193);
    }

    return {
      shapes: Number(canvas.dataset['sceneShapes'] ?? '-1'),
      pixels: (hash >>> 0).toString(16).padStart(8, '0'),
      distinctColors: colours.size,
      leftDistinctColors: left.size,
      rightDistinctColors: right.size
    };
  }, 'world-canvas');
}
