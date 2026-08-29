import type { BattleEvent } from '@oath-and-coin/simulation';

/**
 * The orchestration of a battle's playback: where the feed is in the event list, and how far
 * into the current effect it is (`COMBAT_SPEC` §10.2, the five requirements the spike bought).
 *
 * **Two coordinates, not one, and that is the whole of this module.** The queue position says
 * which events the scene has been told about; the phase says how far the current effect has
 * got. A feed with one coordinate reads identically until somebody presses skip: the spike's
 * first version emptied the queue and left half a flash on the board and a number hanging in
 * the air, and the fix was one line whose *reason* is a second piece of state. Replay is the
 * same rake from the other side — a replay that only rewound the queue would draw a first
 * frame that does not match the battle's first frame.
 *
 * **Two instructions, not one.** A frame tells the scene both what to apply and how far to
 * advance, because a scene that draws only on an event loses the first frame of every effect
 * (measured: `hit.png` and `paused.png` are the same event, and the popup number is on the
 * second only), and a scene that draws only on a timer loses the instant of the blow.
 *
 * **Pure, and no clock in it.** The clock is `requestAnimationFrame` and lives in `apps/web`;
 * everything that can be wrong about pacing — the remainder of a long frame, an event applied
 * twice, a pause that quietly kept counting — is decided here, where a test can ask about it
 * without a browser. `ADR-002`'s line between the discrete model and the continuous
 * presentation runs exactly through {@link FeedStep}.
 */

/** How fast the feed runs. Two, because §10.2 asks for two and a third is a preference. */
export const FeedSpeed = Object.freeze({
  Normal: 1,
  Fast: 2
});

export type FeedSpeed = (typeof FeedSpeed)[keyof typeof FeedSpeed];

export const FEED_SPEEDS: readonly FeedSpeed[] = Object.freeze(Object.values(FeedSpeed));

/**
 * Where playback is, as the two coordinates §10.2 п.2 names.
 *
 * Plain data with no methods, so a host can hold it in a `useState` and so a test can build
 * any position without replaying its way there.
 */
export interface BattleFeed {
  /** How many events the scene has already been handed. */
  readonly applied: number;
  /** Milliseconds spent on the event that is next, of the duration it is owed. */
  readonly phase: number;
  readonly paused: boolean;
  readonly speed: FeedSpeed;
}

/** What one frame owes the scene. */
export interface FeedStep {
  readonly feed: BattleFeed;
  /** Hand these to the scene's `apply`, in this order. */
  readonly apply: readonly BattleEvent[];
  /** Hand this many milliseconds to the scene's `advance`. */
  readonly advance: number;
  /**
   * The scene must be torn back down to the battle's opening position before applying
   * anything. Only a replay sets it: a skip goes *forward* through the same battle.
   */
  readonly rewound: boolean;
}

/**
 * How long the scene is given for each kind of event, in milliseconds at {@link
 * FeedSpeed.Normal}.
 *
 * **Different per kind, because they are not the same event.** A blow wants to be seen; a
 * `turn_spent` is bookkeeping the player never looks at. The spike measured 82 events at a
 * flat 200 ms and got ≈16 seconds for a fight of five rounds, which `GDD` §10.1 wants (a
 * defeat worth reading rather than worth re-rolling); these keep that order of magnitude and
 * spend it where there is something to look at.
 *
 * Exhaustive over the union rather than a lookup with a default: a nineteenth event kind must
 * not quietly inherit somebody else's pacing.
 */
export function durationOf(event: BattleEvent): number {
  switch (event.kind) {
    case 'battle_started':
      return 600;
    case 'round_started':
      return 400;
    case 'intent_declared':
      // The one the whole screen is for (`DIRECTION` §4.4): the line of intent with its
      // reason is what the player reads, and it is worth more time than the blow it explains.
      return 700;
    case 'damage_dealt':
    case 'healing_done':
      return 450;
    case 'damage_absorbed':
      return 300;
    case 'doctrine_broken':
      // The moment the milestone exists to produce (§13.2 п.1). Long enough to be noticed
      // without being told to notice it.
      return 900;
    case 'unit_downed':
      return 700;
    case 'retreat_signalled':
      return 600;
    case 'retreat_obeyed':
    case 'retreat_refused':
      return 500;
    case 'unit_shifted':
      return 400;
    case 'status_applied':
    case 'status_expired':
      return 350;
    case 'shift_resisted':
    case 'unit_pinned':
    case 'blocked':
      return 300;
    case 'turn_spent':
      return 80;
    case 'round_ended':
      return 300;
    case 'battle_ended':
      return 800;
  }
}

/** A feed at the opening position, running, at the slower of the two speeds. */
export function startFeed(): BattleFeed {
  return { applied: 0, phase: 0, paused: false, speed: FeedSpeed.Normal };
}

/**
 * One frame: what the scene must apply, and how far it must advance.
 *
 * **The remainder of a long frame is carried, not dropped.** A tab that was in the background
 * returns with one enormous `elapsed`, and a feed applying at most one event per frame would
 * lose the rest of the battle quietly. So the loop consumes as many whole durations as the
 * frame paid for and keeps the change in {@link BattleFeed.phase}.
 *
 * **A pause moves nothing at all**, including the animations: the spike's two frames 700 ms
 * apart during a pause had the same digest. What keeps running is the renderer, and that is
 * the host's business — this function is not called any less often while paused, it just has
 * nothing to say.
 */
export function tickFeed(
  feed: BattleFeed,
  events: readonly BattleEvent[],
  elapsed: number
): FeedStep {
  if (feed.paused) {
    return { feed, apply: [], advance: 0, rewound: false };
  }

  let applied = feed.applied;
  let phase = feed.phase + elapsed * feed.speed;
  const apply: BattleEvent[] = [];

  for (;;) {
    const next = events[applied];

    if (next === undefined) {
      // Nothing left to spend the time on. The phase stops rather than growing without
      // bound, so a finished feed left running for a minute is still a finished feed.
      phase = 0;
      break;
    }

    const owed = durationOf(next);

    if (phase < owed) {
      break;
    }

    apply.push(next);
    applied += 1;
    phase -= owed;
  }

  return {
    feed: { ...feed, applied, phase },
    apply,
    advance: elapsed * feed.speed,
    rewound: false
  };
}

/**
 * Long enough that every effect the scene has started is over by the end of it.
 *
 * A number rather than a "finish everything" flag on the scene, because the scene's other
 * input is already "advance by this much" and a second way to say the same thing is a second
 * thing to keep in agreement. Ten seconds is the spike's own value and is an order of
 * magnitude past the longest effect above.
 */
export const SKIP_ADVANCE = 10_001;

/**
 * To the end of the battle at once: everything left is applied, and the animations are told
 * to finish (§10.2 п.2).
 *
 * Both coordinates move. The queue goes to the end and the phase goes to nought — a skip that
 * left the phase where it stood would put the next replay half a beat into an effect nobody
 * had started.
 */
export function skipFeed(feed: BattleFeed, events: readonly BattleEvent[]): FeedStep {
  return {
    feed: { ...feed, applied: events.length, phase: 0 },
    apply: events.slice(feed.applied),
    advance: SKIP_ADVANCE,
    rewound: false
  };
}

/**
 * Back to the opening position (§10.2 п.2).
 *
 * **The two controls the player set survive it and nothing else does.** A replay is about the
 * battle, not about the pace the player is watching it at, so speed and pause are carried and
 * both coordinates are not. `rewound` is what tells the host to tear the scene down: applying
 * events forward onto a board that is still showing the end of the fight would draw a battle
 * that never happened.
 */
export function replayFeed(feed: BattleFeed): FeedStep {
  return {
    feed: { applied: 0, phase: 0, paused: feed.paused, speed: feed.speed },
    apply: [],
    advance: 0,
    rewound: true
  };
}
