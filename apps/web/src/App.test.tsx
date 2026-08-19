// @vitest-environment jsdom
import {
  createSessionController,
  type SessionController,
  type SessionState,
  type Store
} from '@oath-and-coin/application';
import { ScreenState } from '@oath-and-coin/presentation';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { App } from './App.tsx';
import { browserContentSource, shippedContentVersion } from './content-source.ts';
import type { RunRequest } from './run-request.ts';
import { mount, render } from './testing/render.tsx';

/**
 * The page's lifecycle, which is what Task 16 changed about it.
 *
 * Until this file existed the page had none: `App` computed a session once, during
 * render, and there was nothing to observe between "mounted" and "showing". A save store
 * answers through IndexedDB or across an IPC boundary, so the session became something
 * that arrives rather than something that is, and the questions below are the ones that
 * only exist once that is true — what the page shows while it waits, that it shows the
 * answer when it comes, and what happens to an answer arriving for a page that is gone.
 *
 * The report is read as JSON rather than the screen as markup on purpose: what the
 * screen renders is `contract-offer-screen.test.tsx`'s subject, over every state and
 * against an independently built expectation. Repeating any of that here would measure
 * the screen twice and the lifecycle once.
 */

/**
 * The one part of the page that cannot run here, replaced rather than worked around.
 *
 * `world-canvas.tsx` deliberately does not swallow a failure to create a renderer — its
 * own doc comment says why, and jsdom has no WebGL and no 2D context, so mounting the
 * real one turns every test in this file into an unhandled rejection from inside
 * PixiJS. What that would measure is jsdom, not the page. The scene has its own checks
 * on both sides of this: `scene-model.test.ts` over the description it draws, and the
 * browser evidence over the pixels a real renderer produces.
 */
vi.mock('./world/world-canvas.tsx', () => ({
  WorldCanvas: () => null
}));

interface PageReport {
  readonly screen_state: string;
  readonly content_version: string | null;
  readonly canonical_hash: string | null;
  readonly saved_state_hash: string | null;
}

function reportIn(container: HTMLElement): PageReport {
  const report = container.querySelector('[data-testid="run-report"]');

  if (report === null) {
    throw new Error('The page rendered no run report, so there is nothing to read it from.');
  }

  return JSON.parse(report.textContent ?? '') as PageReport;
}

/**
 * A real controller over the real bundle, with `start` held behind a gate the test
 * opens.
 *
 * The controller is the genuine one rather than a hand-built double: what is being
 * measured is the page's behaviour around a wait, and a double would let the page agree
 * with a session shape nothing in this workspace actually produces. Only the *moment*
 * the run lands is the test's to decide.
 */
function gatedController(run: RunRequest): {
  readonly controller: SessionController;
  /** How many subscribers the page currently holds on the session. */
  subscribers(): number;
  /** Lets the held `start` through and waits for it to land. */
  finish(): Promise<void>;
} {
  const inner = createSessionController({
    request: {
      content: browserContentSource(),
      scenario: run.scenario,
      checkpoint: run.checkpoint,
      seed: run.seed
    },
    saves: {
      read: () => Promise.resolve(null),
      write: () => Promise.resolve(),
      list: () => Promise.resolve([])
    },
    now: () => '2026-08-19T09:41:00.000Z',
    expected: { rulesetVersion: 'unused-here', contentVersion: 'unused-here' }
  });

  let open = () => {};
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });

  // Counted here rather than inside `createStore`, which has no way to report it: the
  // question is how many listeners *this page* is holding, and the only place that can
  // be seen is between the page and the store.
  const held = new Set<() => void>();
  const store: Store<SessionState> = {
    snapshot: () => inner.store.snapshot(),
    subscribe: (listener) => {
      held.add(listener);
      const unsubscribe = inner.store.subscribe(listener);

      return () => {
        held.delete(listener);
        unsubscribe();
      };
    },
    replace: (next) => {
      inner.store.replace(next);
    }
  };

  const started = gate.then(() => inner.start());

  return {
    controller: {
      store,
      start: () => started,
      save: (slot) => inner.save(slot),
      load: (slot) => inner.load(slot)
    },
    subscribers: () => held.size,
    finish: async () => {
      open();
      await started;
    }
  };
}

describe('the page while its session is still arriving', () => {
  it('shows the loading screen rather than nothing', () => {
    // Not an empty page and not a screen guessed in advance: `LOADING_SCREEN` is a
    // stated model with its own read-model hash, and the corpus tells it apart from
    // `Empty` — a page that showed the latter would be claiming the campaign has nothing
    // on offer while it is still reading the campaign.
    const gated = gatedController({
      scenario: 'screen_normal',
      checkpoint: null,
      seed: 424242n,
      locale: 'ru'
    });
    const { container } = mount(<App createController={() => gated.controller} />);

    expect(reportIn(container).screen_state).toBe(ScreenState.Loading);
  });

  it('shows the run once it lands', async () => {
    const gated = gatedController({
      scenario: 'screen_normal',
      checkpoint: null,
      seed: 424242n,
      locale: 'ru'
    });
    const { container } = mount(<App createController={() => gated.controller} />);

    await act(async () => {
      await gated.finish();
    });

    expect(reportIn(container).screen_state).toBe(ScreenState.Normal);
    expect(reportIn(container).canonical_hash).toMatch(/^[0-9a-f]{64}$/u);
  });
});

describe('a page taken down while its session is still arriving', () => {
  it('is written into by nothing that arrives afterwards', async () => {
    // The hazard the lifecycle introduced: a run landing after the player has navigated
    // away. The page holds no state of its own — everything it shows comes through the
    // store — so what has to be true is that the subscription is gone by then, and that
    // is what React's `useSyncExternalStore` cleanup is for. Checked rather than
    // asserted in a comment: the session below really does move after the unmount, and
    // the page really does not.
    const gated = gatedController({
      scenario: 'screen_normal',
      checkpoint: null,
      seed: 424242n,
      locale: 'ru'
    });
    const { container, unmount } = mount(<App createController={() => gated.controller} />);
    expect(gated.subscribers()).toBe(1);

    unmount();
    expect(gated.subscribers()).toBe(0);

    await act(async () => {
      await gated.finish();
    });

    // The run did land — otherwise this test would prove only that nothing happened.
    expect(gated.controller.store.snapshot().screen.state).toBe(ScreenState.Normal);
    expect(container.textContent).toBe('');
  });
});

describe('the page over its own composition root', () => {
  it('runs the scenario its URL declares, through the controller it builds itself', () => {
    // The one test of the default `createController`: everything else here hands the
    // page a controller, and a seam nothing ever exercises is a seam that can be wired
    // to nothing at all.
    const container = render(<App />);
    const report = reportIn(container);

    expect(report.screen_state).toBe(ScreenState.Normal);
    expect(report.canonical_hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(report.saved_state_hash).toBeNull();
  });

  it('reads saves under the version its own content digests to', () => {
    // What the build says about itself, against what a run of it produces. These are
    // the two sides of `SAVE_CONTENT_MISMATCH`: if they disagreed, every save this
    // build wrote would be refused by this same build on the next load, and nothing
    // else in the workspace would notice.
    const container = render(<App />);

    expect(reportIn(container).content_version).toBe(shippedContentVersion());
  });
});
