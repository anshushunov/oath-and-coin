/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mount } from '../../testing/render.tsx';
import { OfferSummary, PINNED_HEIGHT } from './package-band.tsx';

/**
 * A `ResizeObserver` for jsdom, which has none: it records what it was asked to watch and
 * lets the test report a size the way the browser does.
 *
 * Only *where the number goes* is checked here — jsdom has no layout, so there is no height
 * to measure. That the number is the row's real height and that the padding it becomes keeps
 * a focused control out from under the row is the browser's to check
 * (`offer-focus.spec.ts`).
 */
class RecordingObserver {
  static last: RecordingObserver | null = null;

  readonly observed: { target: Element; box: string | undefined }[] = [];
  disconnected = false;

  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    RecordingObserver.last = this;
  }

  observe(target: Element, options?: ResizeObserverOptions): void {
    this.observed.push({ target, box: options?.box });
  }

  unobserve(): void {}

  disconnect(): void {
    this.disconnected = true;
  }

  /** Reports a border-box height, the one field the row reads. */
  report(blockSize: number): void {
    const entry = {
      borderBoxSize: [{ blockSize, inlineSize: 0 }]
    } as unknown as ResizeObserverEntry;

    this.callback([entry], this as unknown as ResizeObserver);
  }
}

function observer(): RecordingObserver {
  const last = RecordingObserver.last;

  if (last === null) {
    throw new Error('The summary row started no ResizeObserver.');
  }

  return last;
}

function screenOf(container: HTMLElement): HTMLElement {
  const screen = container.querySelector('section');

  if (screen === null) {
    throw new Error('The screen is not rendered.');
  }

  return screen;
}

afterEach(() => {
  RecordingObserver.last = null;
  vi.unstubAllGlobals();
});

describe('OfferSummary', () => {
  it('watches its own border box', () => {
    vi.stubGlobal('ResizeObserver', RecordingObserver);
    const { container } = mount(
      <section>
        <OfferSummary>Итог</OfferSummary>
      </section>
    );

    expect(observer().observed).toEqual([
      { target: container.querySelector('[data-testid="offer-summary"]'), box: 'border-box' }
    ]);
  });

  // The height is published on the screen, because `scroll-padding-top` is a property of the
  // scrolling box and a custom property only reaches down the tree, never up it.
  it('publishes its height on the screen it is pinned in, and follows it when it wraps', () => {
    vi.stubGlobal('ResizeObserver', RecordingObserver);
    const { container } = mount(
      <section>
        <OfferSummary>Итог</OfferSummary>
      </section>
    );
    const screen = screenOf(container);

    observer().report(59);
    expect(screen.style.getPropertyValue(PINNED_HEIGHT)).toBe('59px');

    observer().report(75.5);
    expect(screen.style.getPropertyValue(PINNED_HEIGHT)).toBe('75.5px');
  });

  // A screen that loses its row — a state with no contract — must lose the padding with it,
  // or it keeps a band at its top that nothing covers and nothing may scroll into.
  it('takes the height away and stops watching when it is unmounted', () => {
    vi.stubGlobal('ResizeObserver', RecordingObserver);
    const tree = mount(
      <section>
        <OfferSummary>Итог</OfferSummary>
      </section>
    );
    const screen = screenOf(tree.container);

    observer().report(59);
    tree.rerender(<section />);

    expect(screen.style.getPropertyValue(PINNED_HEIGHT)).toBe('');
    expect(observer().disconnected).toBe(true);
  });
});
