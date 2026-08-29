import {
  FeedSpeed,
  replayFeed,
  skipFeed,
  startFeed,
  tickFeed,
  type BattleFeed,
  type BattleRecord,
  type BattleScreenModel,
  type ContentId
} from '@oath-and-coin/presentation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { BattleScreen, type BattleControls } from './battle-screen.tsx';

/**
 * The one place in this repository that holds a clock (`COMBAT_SPEC` §10.2, `ADR-002`).
 *
 * Everything that can be *wrong* about pacing was moved into `battle-feed.ts`, which is pure
 * and is tested as one: the remainder of a long frame, an event applied twice, a pause that
 * quietly kept counting, a skip that emptied the queue and left half a flash on the board.
 * What is left here is the thing a test cannot hold — `requestAnimationFrame` — and the
 * wiring of the feed's two instructions to the two inputs of the presentation.
 *
 * **The loop does not stop when the feed is paused**, and that is §10.2 п.3 rather than an
 * oversight: pausing stops the *feed*, not the renderer. A loop that cancelled its own frame
 * would leave every effect frozen mid-flight, and the spike measured what that looks like —
 * the frame during a pause is identical 700 ms apart while the renderer is still running at
 * 61.7 fps.
 *
 * **The retreat button re-runs the battle rather than interrupting one** (§6.3). The record
 * this is playing came out of a resolver run with `retreatAtRound: null`; pressing the button
 * asks for another run with the round filled in, and §9's determinism makes every event
 * before that round identical — so the feed keeps its position and the player carries on
 * watching a prefix of what he has just chosen.
 */

/**
 * The two things this page asks of the layer below it.
 *
 * A port rather than the whole `SessionController`, so the page can be driven in a test by
 * something that is not a session — and so what it actually needs is legible: run this fight,
 * and describe it at this position.
 */
export interface BattlePlaybackPort {
  previewBattle(contractId: ContentId, retreatAtRound: number | null): BattleRecord | null;
  battleScreen(
    contractId: ContentId,
    record: BattleRecord,
    applied: number,
    paused: boolean,
    speed: number
  ): BattleScreenModel | null;
}

export function BattlePlayback({
  contractId,
  port,
  onFinished,
  startPaused = false
}: {
  readonly contractId: ContentId;
  readonly port: BattlePlaybackPort;
  /**
   * Whether the feed waits for the player to start it.
   *
   * The lab opens paused, and that is the only way the browser evidence can measure a frame
   * at all: a feed running on `requestAnimationFrame` is at a different position in every
   * run, so a screenshot of it would be a screenshot of the machine's timing. Pressing play
   * is one click, and it is the same click a player makes.
   */
  readonly startPaused?: boolean;
  /**
   * Called once, the first time the feed reaches the end, with the round a withdrawal was
   * signalled at — which is what the caller then commits `resolveContract` with.
   */
  onFinished?: (retreatAtRound: number | null) => void;
}) {
  const [retreatAtRound, setRetreatAtRound] = useState<number | null>(null);
  const [record, setRecord] = useState(() => port.previewBattle(contractId, null));
  const [feed, setFeed] = useState<BattleFeed>(() => ({ ...startFeed(), paused: startPaused }));
  const [phase, setPhase] = useState(0);
  const announced = useRef(false);

  const events = record?.events ?? [];

  // Held in a ref as well as in state so the frame callback can read the current feed
  // without the loop having to be torn down and rebuilt on every frame — which would make
  // "how often does this re-subscribe" a function of the frame rate.
  const feedRef = useRef(feed);
  feedRef.current = feed;
  const eventsRef = useRef(events);
  eventsRef.current = events;

  useEffect(() => {
    let frame = 0;
    let last: number | null = null;

    const step = (now: number): void => {
      const elapsed = last === null ? 0 : now - last;
      last = now;

      const instruction = tickFeed(feedRef.current, eventsRef.current, elapsed);

      setFeed(instruction.feed);
      // The second input, and the only thing reaching the scene between events. A long
      // effect ages slowly and a short one is over before it is noticed, which is the
      // pacing §10.2 asks for — and it is the feed's arithmetic, not this page's.
      setPhase(instruction.share);

      frame = requestAnimationFrame(step);
    };

    frame = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    if (!announced.current && events.length > 0 && feed.applied >= events.length) {
      announced.current = true;
      onFinished?.(retreatAtRound);
    }
  }, [events.length, feed.applied, onFinished, retreatAtRound]);

  const signalRetreat = useCallback(
    (round: number) => {
      // Another run of the same fight, with the round filled in. The feed keeps its position:
      // everything before `round` is identical by §9, so the player is still looking at the
      // frame he was looking at — what changed is what happens next.
      const rerun = port.previewBattle(contractId, round);

      if (rerun !== null) {
        setRetreatAtRound(round);
        setRecord(rerun);
      }
    },
    [contractId, port]
  );

  const controls: BattleControls = {
    togglePause: () => {
      setFeed((current) => ({ ...current, paused: !current.paused }));
    },
    toggleSpeed: () => {
      setFeed((current) => ({
        ...current,
        speed: current.speed === FeedSpeed.Normal ? FeedSpeed.Fast : FeedSpeed.Normal
      }));
    },
    skip: () => {
      setFeed(skipFeed(feedRef.current, eventsRef.current).feed);
      // Both coordinates, which is the whole of §10.2 п.2: the queue goes to the end and the
      // animations are told to finish. A skip that only emptied the queue leaves half a
      // flash on the board — measured, in the spike, not reasoned about.
      setPhase(1);
    },
    replay: () => {
      setFeed(replayFeed(feedRef.current).feed);
      setPhase(0);
      announced.current = false;
    },
    retreat: signalRetreat
  };

  const model =
    record === null
      ? null
      : port.battleScreen(contractId, record, feed.applied, feed.paused, feed.speed);

  if (model === null) {
    return null;
  }

  return <BattleScreen model={model} controls={controls} phase={phase} />;
}
