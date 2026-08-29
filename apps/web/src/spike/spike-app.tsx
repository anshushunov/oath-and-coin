import { runSpikeBattle, type SpikeBattleEvent } from '@oath-and-coin/simulation';
import { useEffect, useRef, useState } from 'react';

import { mountBattleScene, SCENE_HEIGHT, SCENE_WIDTH, type BattleScene } from './battle-scene.ts';
import { startPlayback, type Playback, type PlaybackStatus } from './orchestration.ts';

/**
 * THROWAWAY SPIKE. One page: a battle run to the end in the core, played back through the
 * orchestrator into the Pixi scene, with the four controls `MVP_PLAN` §6.6 names.
 */
export function SpikeApp() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playbackRef = useRef<Playback | null>(null);
  const [status, setStatus] = useState<PlaybackStatus | null>(null);
  const [line, setLine] = useState('');
  const [battle] = useState(() => runSpikeBattle());

  useEffect(() => {
    const canvas = canvasRef.current;

    if (canvas === null) {
      return;
    }

    let cancelled = false;
    let scene: BattleScene | null = null;
    let frames = 0;
    let presented = 0;

    void mountBattleScene(canvas, battle.initial).then((mounted) => {
      if (cancelled) {
        mounted.destroy();

        return;
      }

      scene = mounted;

      playbackRef.current = startPlayback(battle.events, {
        apply(event) {
          mounted.apply(event);
          setLine(describe(event));
          canvas.dataset['sceneAlive'] = String(mounted.describe().alive);
        },
        advance(deltaMs) {
          frames += 1;
          presented += deltaMs;
          mounted.advance(deltaMs);
          canvas.dataset['sceneFrames'] = String(frames);
          canvas.dataset['scenePresentedMs'] = String(Math.round(presented));
        },
        reset() {
          mounted.reset();
          setLine('');
        },
        onStatus(next) {
          setStatus(next);
        }
      });

      canvas.dataset['sceneReady'] = '1';
    });

    return () => {
      cancelled = true;
      playbackRef.current?.stop();
      playbackRef.current = null;
      scene?.destroy();
    };
  }, [battle]);

  return (
    <main data-testid="spike-root">
      <h1>Combat spike</h1>

      <div data-testid="spike-controls">
        <button
          type="button"
          data-testid="spike-pause"
          onClick={() => {
            playbackRef.current?.pause();
          }}
        >
          Пауза
        </button>
        <button
          type="button"
          data-testid="spike-resume"
          onClick={() => {
            playbackRef.current?.resume();
          }}
        >
          Продолжить
        </button>
        <button
          type="button"
          data-testid="spike-speed-1"
          onClick={() => {
            playbackRef.current?.setSpeed(1);
          }}
        >
          ×1
        </button>
        <button
          type="button"
          data-testid="spike-speed-2"
          onClick={() => {
            playbackRef.current?.setSpeed(2);
          }}
        >
          ×2
        </button>
        <button
          type="button"
          data-testid="spike-skip"
          onClick={() => {
            playbackRef.current?.skip();
          }}
        >
          Пропустить
        </button>
        <button
          type="button"
          data-testid="spike-replay"
          onClick={() => {
            playbackRef.current?.replay();
          }}
        >
          Повторить
        </button>
      </div>

      <p data-testid="spike-line">{line}</p>

      <canvas
        ref={canvasRef}
        data-testid="spike-canvas"
        width={SCENE_WIDTH}
        height={SCENE_HEIGHT}
      />

      <div hidden data-testid="spike-report">
        {JSON.stringify({
          ticks: battle.ticks,
          events: battle.events.length,
          status
        })}
      </div>
    </main>
  );
}

/** The one-line trace, in the shape a battle log would print it. */
function describe(event: SpikeBattleEvent): string {
  switch (event.kind) {
    case 'intent':
      return `${event.actor} → ${event.action}${event.target === null ? '' : ` ${event.target}`} (${event.reason})`;
    case 'hit':
      return `${event.actor} бьёт ${event.target} на ${String(event.amount)}`;
    case 'status_applied':
      return `${event.target}: ${event.status}`;
    case 'unit_died':
      return `${event.unit} выбыл`;
    case 'tick_ended':
      return `— такт ${String(event.tick)} —`;
  }
}
