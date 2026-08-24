// @vitest-environment jsdom
import {
  createSessionController,
  type SessionController,
  type SessionState,
  type Store
} from '@oath-and-coin/application';
import { RULESET_VERSION, SaveErrorCodes, SaveReadError } from '@oath-and-coin/content';
import { ScreenState } from '@oath-and-coin/presentation';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
  readonly screen: string;
  readonly screen_state: string;
  readonly saves_screen_state: string | null;
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
      load: (slot) => inner.load(slot),
      slots: () => inner.slots(),
      composeOffer: (input) => inner.composeOffer(input),
      proposeContractToHero: (input) => inner.proposeContractToHero(input),
      lockOffer: (input) => inner.lockOffer(input),
      pollCrew: (input) => inner.pollCrew(input),
      settleContract: (input) => inner.settleContract(input)
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
      locale: 'ru',
      screen: 'contract-offer'
    });
    const { container } = mount(<App createController={() => gated.controller} />);

    expect(reportIn(container).screen_state).toBe(ScreenState.Loading);
  });

  it('shows the run once it lands', async () => {
    const gated = gatedController({
      scenario: 'screen_normal',
      checkpoint: null,
      seed: 424242n,
      locale: 'ru',
      screen: 'contract-offer'
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
      locale: 'ru',
      screen: 'contract-offer'
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

describe('the page after a save is loaded back', () => {
  it('reports no run hash, as `null` and not as an empty string', async () => {
    // `canonical_hash` is a hash of a whole run, a loaded session has no run, and this
    // field is what oracle parity reads. Written `null`, never `''` and never `0`: the
    // corpus records `null` for the two entries that produced no artifact, and a page
    // that answered an empty string would compare unequal against the very absence it
    // was reporting.
    const slots = new Map<string, Uint8Array>();
    const controller = createSessionController({
      request: {
        content: browserContentSource(),
        scenario: 'screen_normal',
        checkpoint: null,
        seed: 424242n
      },
      saves: {
        read: (slot) => Promise.resolve(slots.get(slot) ?? null),
        write: (slot, bytes) => {
          slots.set(slot, bytes);
          return Promise.resolve();
        },
        list: () => Promise.resolve([])
      },
      now: () => '2026-08-19T09:41:00.000Z',
      expected: { rulesetVersion: RULESET_VERSION, contentVersion: shippedContentVersion() }
    });

    const { container } = mount(<App createController={() => controller} />);
    expect(reportIn(container).canonical_hash).toMatch(/^[0-9a-f]{64}$/u);

    await act(async () => {
      await controller.save('slot-a');
      await controller.load('slot-a');
    });

    const report = reportIn(container);
    expect(report.canonical_hash).toBeNull();
    expect(report.saved_state_hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(report.screen_state).toBe(ScreenState.Normal);
  });
});

describe('the page on its slots screen', () => {
  // The URL is real, so it has to be put back: jsdom keeps one location for the whole
  // file, and a `?screen=saves` left behind would silently open every test below this
  // one on the wrong screen — passing, and about something else.
  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  /**
   * A real controller over the real bundle, writing into a map.
   *
   * The store is a map rather than IndexedDB because neither Vitest environment has one
   * (`indexeddb-store.ts` records the measurement), and what these tests are about is
   * the *page's* four transitions — the store behind them is `indexeddb-store.test.ts`'s
   * subject and the browser evidence's. `broken` is what makes the failed-write
   * transition reachable at all: a map never refuses.
   */
  function controllerOver(
    slots: Map<string, Uint8Array>,
    broken: { write: boolean } = { write: false }
  ): SessionController {
    return createSessionController({
      request: {
        content: browserContentSource(),
        scenario: 'screen_normal',
        checkpoint: null,
        seed: 424242n
      },
      saves: {
        read: (slot) => Promise.resolve(slots.get(slot) ?? null),
        write: (slot, bytes) => {
          if (broken.write) {
            return Promise.reject(
              new SaveReadError(SaveErrorCodes.StorageUnavailable, 'the fixture store is closed.')
            );
          }

          slots.set(slot, bytes);
          return Promise.resolve();
        },
        list: () => Promise.resolve([...slots.keys()] as ('slot-a' | 'slot-b' | 'slot-c')[])
      },
      now: () => '2026-08-19T09:41:00.000Z',
      expected: { rulesetVersion: RULESET_VERSION, contentVersion: shippedContentVersion() }
    });
  }

  /** Opens the page on `?screen=saves` and waits for the first read of the storage. */
  async function openSaves(controller: SessionController): Promise<HTMLElement> {
    // The URL is the way in, because it is the way a run declares which screen it opened
    // (`run-request.ts`). Set on the real location rather than through a prop: the page
    // parses `window.location.search` once at mount, and a test that bypassed it would
    // be exercising a path no browser takes.
    window.history.replaceState(null, '', '/?screen=saves');

    const container = render(<App createController={() => controller} />);
    await settle();

    return container;
  }

  /** Lets every promise the page started run out, and React finish with the results. */
  async function settle(): Promise<void> {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  async function click(container: HTMLElement, testId: string): Promise<void> {
    const element = container.querySelector(`[data-testid="${testId}"]`);

    if (!(element instanceof HTMLButtonElement)) {
      throw new Error(`The page has no button at [data-testid="${testId}"].`);
    }

    await act(async () => {
      element.click();
    });
    await settle();
  }

  function savesStateIn(container: HTMLElement): string | null {
    return reportIn(container).saves_screen_state;
  }

  it('opens on the slots screen the URL declared, and says so in its report', async () => {
    const container = await openSaves(controllerOver(new Map()));

    expect(reportIn(container).screen).toBe('saves');
    expect(savesStateIn(container)).toBe(ScreenState.Empty);
    expect(container.querySelector('[data-testid="saves-screen"]')).not.toBeNull();
    // And the contract screen is not also on the page: two screens at once would make
    // the rendered-UI hash a hash of both.
    expect(container.querySelector('[data-testid="contract-offer-screen"]')).toBeNull();
  });

  it('occupies an empty slot when it is saved into', async () => {
    const stored = new Map<string, Uint8Array>();
    const container = await openSaves(controllerOver(stored));

    await click(container, 'slot-a-save');

    expect(stored.has('slot-a')).toBe(true);
    // The line re-read the storage rather than assuming: `Normal` is the model's answer
    // about slots that hold campaigns, and it can only be reached by asking again.
    expect(savesStateIn(container)).toBe(ScreenState.Normal);
    expect(container.querySelector('[data-testid="slot-a-error"]')).toBeNull();
  });

  it('leaves for the contract screen when a slot loads', async () => {
    const stored = new Map<string, Uint8Array>();
    const controller = controllerOver(stored);
    const container = await openSaves(controller);
    await click(container, 'slot-a-save');

    await click(container, 'slot-a-load');

    expect(reportIn(container).screen).toBe('contract-offer');
    expect(container.querySelector('[data-testid="contract-offer-screen"]')).not.toBeNull();
    // The campaign on the page is the one out of the file: a load answers no run hash
    // and does answer a save checksum (design spec §4.4).
    expect(reportIn(container).canonical_hash).toBeNull();
    expect(reportIn(container).saved_state_hash).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('stays where it is and shows the refusal when a slot cannot be loaded', async () => {
    // "отказ на месте, без ухода с экрана". A page that navigated first would drop the
    // player onto the previous session's screen with the reason nowhere.
    const stored = new Map<string, Uint8Array>([['slot-b', new Uint8Array([1, 2, 3])]]);
    const container = await openSaves(controllerOver(stored));
    expect(savesStateIn(container)).toBe(ScreenState.Incomplete);

    await click(container, 'slot-b-load');

    expect(reportIn(container).screen).toBe('saves');
    expect(container.querySelector('[data-testid="slot-b-error"]')).not.toBeNull();
  });

  it('keeps the campaign a slot holds when the write over it is refused', async () => {
    // The transition "отказ записи → слот остаётся прежним и это видно". The storage is
    // untouched by a refused write — that is what the port promises — so the line must
    // still describe what is in it, with the refusal beside it and not instead of it.
    const stored = new Map<string, Uint8Array>();
    const broken = { write: false };
    const container = await openSaves(controllerOver(stored, broken));
    await click(container, 'slot-a-save');
    const written = stored.get('slot-a');

    broken.write = true;
    await click(container, 'slot-a-save');
    await click(container, 'slot-a-confirm');

    expect(stored.get('slot-a')).toBe(written);
    expect(container.querySelector('[data-testid="slot-a-error"]')).not.toBeNull();
    expect(container.textContent).toContain('2026-08-19T09:41:00.000Z');
    // And the screen still says the storage reads: `Incomplete` is about slots that
    // cannot be read, and this one reads — it refused a write. The refusal is on its own
    // line, which the assertion above holds.
    expect(savesStateIn(container)).toBe(ScreenState.Normal);
  });
});

describe('the page over its own composition root', () => {
  it('runs the scenario its URL declares, through the controller it builds itself', () => {
    // The one test of the default `createController`: everything else here hands the
    // page a controller, and a seam nothing ever exercises is a seam that can be wired
    // to nothing at all.
    const container = render(<App />);
    const report = reportIn(container);

    expect(report.screen).toBe('contract-offer');
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
