import { BattleOutcome, DoctrineId, type BattleEvent } from '@oath-and-coin/simulation';
import { describe, expect, it } from 'vitest';

import { FeedSpeed, replayFeed, skipFeed, startFeed, tickFeed } from './battle-feed.ts';

/**
 * The five requirements the spike bought (`COMBAT_SPEC` §10.2), as cases rather than as a
 * paragraph. Four of them are about this file; the fifth — contrasting outline on a popup
 * number — is about the scene and is checked where the scene is.
 *
 * Every one of them cost a frame to find, and none of them is visible from reading the code
 * that violates it: a feed with one coordinate looks exactly like a feed with two until
 * somebody presses skip and half a flash stays on the board.
 */

const events: readonly BattleEvent[] = [
  { kind: 'battle_started', crew: ['crew:a'], foes: ['foe:a'], doctrine: DoctrineId.HoldTheLine },
  { kind: 'round_started', round: 1 },
  { kind: 'turn_spent', unit: 'crew:a' },
  { kind: 'round_ended', round: 1 },
  { kind: 'battle_ended', outcome: BattleOutcome.CrewStanding }
];

/** Runs the feed at one speed until it stops moving, collecting what it asked for. */
function play(elapsedPerFrame: number, frames: number, speed: FeedSpeed = FeedSpeed.Normal) {
  let feed = { ...startFeed(), speed };
  const applied: BattleEvent[] = [];
  let advanced = 0;

  for (let frame = 0; frame < frames; frame += 1) {
    const step = tickFeed(feed, events, elapsedPerFrame);

    applied.push(...step.apply);
    advanced += step.advance;
    feed = step.feed;
  }

  return { feed, applied, advanced };
}

describe('the feed has two coordinates and hands out two instructions', () => {
  it('asks for the scene to be advanced on a frame where no event is applied', () => {
    // Requirement 1: applying an event and advancing the animation are two inputs, and a
    // frame that only did the first loses the first frame of every effect — which is how the
    // spike's popup number failed to appear on the frame that created it.
    //
    // Taken one event in, because the *first* event is applied on the first frame there is:
    // there is nothing already on screen for it to wait behind.
    const opened = tickFeed(startFeed(), events, 1);
    const step = tickFeed(opened.feed, events, 1);

    expect(opened.apply).toEqual([events[0]]);
    expect(step.apply).toHaveLength(0);
    expect(step.advance).toBe(1);
  });

  it('applies an event once the one before it has had its time, and no sooner', () => {
    // **The duration charged is the one on screen, not the one arriving.** A blow's number
    // has to age over the blow's own life; charging the next event's duration put the phase
    // on the wrong event, which is what external review found through the popup.
    const early = play(10, 2);
    const late = play(10, 400);

    expect(early.applied).toEqual([events[0]]);
    expect(late.applied).toEqual(events);
  });

  it('reports how far through the event that is showing it is, never the next one', () => {
    // `battle_started` is owed 600ms. A third of the way through it the share is a third —
    // measured against *its* duration, not against `round_started`'s 400.
    const opened = tickFeed(startFeed(), events, 0);
    const third = tickFeed(opened.feed, events, 200);

    expect(third.feed.applied).toBe(1);
    expect(third.share).toBeCloseTo(200 / 600, 5);
  });

  it('shows nothing at the opening position and a finished effect at the end', () => {
    expect(tickFeed(startFeed(), events, 0).share).toBe(0);
    expect(skipFeed(startFeed(), events).share).toBe(1);
  });

  it('carries the remainder of a long frame into the next event rather than dropping it', () => {
    // A frame longer than one event's duration must not eat the events it skipped past: a
    // browser tab that was in the background for a second comes back with one enormous
    // elapsed time, and a feed that applied one event per frame would silently lose the rest.
    const step = tickFeed(startFeed(), events, 100_000);

    expect(step.apply).toEqual(events);
  });
});

describe('pause stops the feed and not the renderer (requirement 3)', () => {
  it('applies nothing and moves nothing while paused, however many frames it is asked for', () => {
    let feed = { ...startFeed(), paused: true };

    for (let frame = 0; frame < 500; frame += 1) {
      const step = tickFeed(feed, events, 16);

      expect(step.apply).toHaveLength(0);
      expect(step.advance).toBe(0);
      feed = step.feed;
    }

    expect(feed.applied).toBe(0);
    expect(feed.phase).toBe(0);
  });

  it('picks up exactly where it was when the pause is lifted', () => {
    const running = tickFeed(startFeed(), events, 120);
    const paused = tickFeed({ ...running.feed, paused: true }, events, 5_000);
    const resumed = tickFeed({ ...paused.feed, paused: false }, events, 0);

    expect(resumed.feed.phase).toBe(running.feed.phase);
    expect(resumed.feed.applied).toBe(running.feed.applied);
  });
});

describe('the second speed is a second speed and not a second feed', () => {
  it('reaches the end of the same list in fewer frames', () => {
    const normal = play(50, 6);
    const fast = play(50, 6, FeedSpeed.Fast);

    expect(fast.applied.length).toBeGreaterThan(normal.applied.length);
  });

  it('applies the same events in the same order at either speed', () => {
    expect(play(50, 400, FeedSpeed.Fast).applied).toEqual(play(50, 400).applied);
  });
});

describe('skip and replay reset both coordinates (requirement 2)', () => {
  it('skip applies everything left and tells the scene to finish its animations', () => {
    // The half the spike's first version got wrong: it emptied the queue and left a flash
    // half-drawn and a number hanging, because the animation coordinate was never touched.
    const midway = tickFeed(startFeed(), events, 300);
    const skipped = skipFeed(midway.feed, events);

    expect([...midway.apply, ...skipped.apply]).toEqual(events);
    expect(skipped.feed.applied).toBe(events.length);
    expect(skipped.feed.phase).toBe(0);
    expect(skipped.advance).toBeGreaterThan(10_000);
  });

  it('skip on an already finished feed asks for nothing and stays finished', () => {
    const done = skipFeed(startFeed(), events);

    expect(skipFeed(done.feed, events).apply).toHaveLength(0);
    expect(skipFeed(done.feed, events).feed.applied).toBe(events.length);
  });

  it('replay puts both coordinates back to nought and says the scene must be rebuilt', () => {
    const skipped = skipFeed(startFeed(), events);
    const replayed = replayFeed(skipped.feed);

    expect(replayed.feed.applied).toBe(0);
    expect(replayed.feed.phase).toBe(0);
    expect(replayed.rewound).toBe(true);
    expect(replayed.apply).toHaveLength(0);
    expect(replayed.advance).toBe(0);
  });

  it('replay from the start is the start, so the frame after it is the first frame', () => {
    // What `replayed_frame` differing from `skipped_frame` measured in the spike, said as a
    // property: whatever the feed had reached, a replay leaves it in the state `startFeed`
    // produces, apart from the two controls the player set.
    const skipped = skipFeed({ ...startFeed(), speed: FeedSpeed.Fast }, events);
    const replayed = replayFeed(skipped.feed);

    expect(replayed.feed).toEqual({
      applied: 0,
      phase: 0,
      paused: false,
      speed: FeedSpeed.Fast
    });
  });

  it('keeps a pause across a replay, because the player set it and the replay did not', () => {
    expect(replayFeed({ ...startFeed(), paused: true }).feed.paused).toBe(true);
  });
});

describe('what the feed refuses to invent', () => {
  it('never applies an event twice, at any frame length', () => {
    for (const elapsed of [1, 7, 16, 33, 250, 4_000]) {
      const played = play(elapsed, 4_000);

      expect(played.applied, `at ${String(elapsed)} ms per frame`).toEqual(events);
    }
  });

  it('is finished exactly when it has applied every event', () => {
    const played = play(16, 4_000);

    expect(played.feed.applied).toBe(events.length);
    expect(tickFeed(played.feed, events, 16).apply).toHaveLength(0);
  });

  it('has nothing to do with an empty battle, and says so without dividing by it', () => {
    const step = tickFeed(startFeed(), [], 16);

    expect(step.apply).toHaveLength(0);
    expect(step.feed.applied).toBe(0);
  });
});
