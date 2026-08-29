import type { SpikeBattleEvent } from '@oath-and-coin/simulation';

/**
 * THROWAWAY SPIKE. The third layer `DIRECTION_2026-08` §4.6 says the earlier cost split
 * missed: what turns a list of discrete events into a continuous presentation.
 *
 * Everything the spike has to answer about it lives here — a clock, a queue, a pause, two
 * speeds, a skip and a replay — so the cost of the layer is the size of this file plus the
 * animation half of the scene, and not a number guessed from the outside.
 */

/** How long each event kind is given on screen, at 1x, in milliseconds. */
const DURATIONS: Record<SpikeBattleEvent['kind'], number> = {
  intent: 240,
  hit: 200,
  status_applied: 180,
  unit_died: 360,
  tick_ended: 120
};

export type PlaybackPhase = 'playing' | 'paused' | 'finished';

export interface PlaybackStatus {
  readonly phase: PlaybackPhase;
  readonly speed: 1 | 2;
  /** How many events have been applied. */
  readonly applied: number;
  readonly total: number;
  /** Wall-clock milliseconds spent presenting, excluding pauses. */
  readonly elapsed: number;
}

export interface PlaybackHost {
  /** Hands one event to the presentation layer. */
  apply(event: SpikeBattleEvent): void;
  /** Advances continuous animation by `deltaMs` of presentation time. */
  advance(deltaMs: number): void;
  /** Puts the presentation back where it started, for a replay. */
  reset(): void;
  /** Called whenever the status a UI shows changes. */
  onStatus(status: PlaybackStatus): void;
}

export interface Playback {
  pause(): void;
  resume(): void;
  setSpeed(speed: 1 | 2): void;
  /** Applies everything that is left, at once. */
  skip(): void;
  replay(): void;
  stop(): void;
  status(): PlaybackStatus;
}

/**
 * Drives `host` through `events` off a requestAnimationFrame clock.
 *
 * The clock is injected so the browser evidence measures the real one and nothing else
 * has to: there is no second implementation of the schedule.
 */
export function startPlayback(
  events: readonly SpikeBattleEvent[],
  host: PlaybackHost,
  frames: (step: (nowMs: number) => void) => () => void = requestAnimationFrames
): Playback {
  let index = 0;
  let speed: 1 | 2 = 1;
  let phase: PlaybackPhase = events.length === 0 ? 'finished' : 'playing';
  let elapsed = 0;
  let held = 0;
  let last: number | null = null;

  const status = (): PlaybackStatus => ({
    phase,
    speed,
    applied: index,
    total: events.length,
    elapsed: Math.round(elapsed)
  });

  const announce = (): void => {
    host.onStatus(status());
  };

  const step = (nowMs: number): void => {
    if (last === null) {
      last = nowMs;

      return;
    }

    const wall = nowMs - last;
    last = nowMs;

    if (phase !== 'playing') {
      return;
    }

    const presented = wall * speed;
    elapsed += wall;
    held += presented;
    host.advance(presented);

    let moved = false;

    while (index < events.length) {
      const next = events[index];

      if (next === undefined) {
        break;
      }

      if (held < DURATIONS[next.kind]) {
        break;
      }

      held -= DURATIONS[next.kind];
      host.apply(next);
      index += 1;
      moved = true;
    }

    if (index >= events.length) {
      phase = 'finished';
      moved = true;
    }

    if (moved) {
      announce();
    }
  };

  const cancel = frames(step);

  announce();

  return {
    pause(): void {
      if (phase === 'playing') {
        phase = 'paused';
        announce();
      }
    },
    resume(): void {
      if (phase === 'paused') {
        phase = 'playing';
        announce();
      }
    },
    setSpeed(next: 1 | 2): void {
      speed = next;
      announce();
    },
    skip(): void {
      while (index < events.length) {
        const next = events[index];

        if (next === undefined) {
          break;
        }

        host.apply(next);
        index += 1;
      }

      // Long enough to settle every animation the scene is holding: a skip that left a
      // half-finished flash on screen would be a skip that did not arrive.
      host.advance(10_000);
      phase = 'finished';
      held = 0;
      announce();
    },
    replay(): void {
      host.reset();
      index = 0;
      held = 0;
      elapsed = 0;
      phase = events.length === 0 ? 'finished' : 'playing';
      announce();
    },
    stop(): void {
      cancel();
    },
    status
  };
}

function requestAnimationFrames(step: (nowMs: number) => void): () => void {
  let handle = 0;
  let running = true;

  const frame = (nowMs: number): void => {
    if (!running) {
      return;
    }

    step(nowMs);
    handle = window.requestAnimationFrame(frame);
  };

  handle = window.requestAnimationFrame(frame);

  return () => {
    running = false;
    window.cancelAnimationFrame(handle);
  };
}
