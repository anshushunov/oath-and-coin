import {
  BattleEventKeys,
  BattleFieldKeys,
  battleLineTones,
  battleStateKey,
  errorKey,
  type BattleIntentLine,
  type BattleJournalLine,
  type BattleScreenModel
} from '@oath-and-coin/presentation';

import { Feed } from '../../ui/feed.tsx';
import { Columns } from '../../ui/layout.tsx';
import { Panel } from '../../ui/panel.tsx';
import { WorldCanvas } from '../../world/world-canvas.tsx';
import { useText } from '../../text.tsx';

import { Captioned, Label, Tinted, Who } from '../labels.tsx';

import { CrewPanel } from './crew-panel.tsx';

/**
 * The fight, as a board, a line of intent, a journal and five buttons (`COMBAT_SPEC` §10.2).
 *
 * **This screen decides nothing**, the rule every screen here is held to. Every field of the
 * model becomes at most one label in a fixed order; the branches are on the state, on a field
 * being `null` and on a list being empty, never on what is *in* one. `expectedSnapshot` makes
 * the identical decisions from the identical fields, which is what lets the two be compared.
 *
 * **The controls are the host's, not the model's.** Whether the feed is paused and how fast
 * it is running are facts about the moment a person is in, not about the campaign — so they
 * live in whatever holds the clock and are passed in here as callbacks and flags. Putting
 * them on the read model would put an animation coordinate through the read-model hash, and
 * the browser evidence would then measure a different screen every frame.
 *
 * **The board is drawn twice, and both are on purpose.** The canvas is the picture; the panel
 * under it is everybody on it in words, because a picture is not a text dub and `GDD` §16.6
 * asks for one. The journal beside the panel is the same argument over time.
 *
 * **Layout Б, the owner's** (the spec of the kit, §5; decision 2 of 2026-09-23): the field
 * across the whole width, because only there does a word on a token read; under it the
 * outcome in the largest size on the screen, the line of intent and the controls; under those
 * the people and the journal side by side. The order in the document is the order a reader
 * meets them, and `expectedSnapshot` walks the same order.
 */
export function BattleScreen({
  model,
  controls,
  phase = 0
}: {
  readonly model: BattleScreenModel;
  readonly controls: BattleControls;
  /** How far into the current event's life this frame is — the feed's second instruction. */
  readonly phase?: number;
}) {
  const text = useText();

  return (
    <section className="battle" data-testid="battle-screen" data-state={model.state}>
      <div className="battle-head">
        <Label text={text(model.titleKey)} />
        <Label text={text(battleStateKey(model.state))} />

        {model.errorCode === null ? null : <Label text={text(errorKey(model.errorCode))} />}

        {model.contractDisplayNameKey === null ? null : (
          <Label text={text(model.contractDisplayNameKey)} />
        )}

        {model.doctrineKey === null ? null : (
          <Captioned captionKey={BattleFieldKeys.Doctrine} value={text(model.doctrineKey)} />
        )}

        {model.units.length === 0 ? null : (
          <Captioned
            captionKey={BattleFieldKeys.Round}
            value={String(model.round)}
            testId="battle-round"
          />
        )}
      </div>

      {model.units.length === 0 ? null : (
        <div className="battle-field">
          {/* The screen's own resolver: every word on the board is resolved before the canvas. */}
          <WorldCanvas model={model} phase={phase} textOf={text} />
        </div>
      )}

      {/*
        How it ended, first thing under the field and in the largest size on the screen. It
        was always drawn — last, below eighty lines of journal and in the size of everything
        else, so the frame of a finished fight never showed it (§1 of the spec). The screen's
        title and its state stay smaller: this is the one headline a finished fight has.
      */}
      {model.outcomeKey === null ? null : (
        <div className="battle-outcome" data-testid="battle-outcome">
          <Label text={text(BattleFieldKeys.Outcome)} />
          <Label text={text(model.outcomeKey)} />
        </div>
      )}

      {model.intent === null ? null : <IntentLine intent={model.intent} />}

      <Controls model={model} controls={controls} />

      {model.units.length === 0 && model.journal.length === 0 ? null : (
        <Columns>
          {model.units.length === 0 ? null : <CrewPanel units={model.units} />}
          {model.journal.length === 0 ? null : (
            <Panel titleKey={BattleFieldKeys.Journal}>
              <Feed
                testId="battle-journal"
                // Keyed by position inside the feed: a journal line carries no identity of
                // its own — two `turn_spent` lines about one man differ in nothing — and the
                // list only ever grows at the end, so there is no reordering to survive.
                lines={model.journal.map((line, index) => (
                  <JournalRow key={index} line={line} />
                ))}
              />
            </Panel>
          )}
        </Columns>
      )}
    </section>
  );
}

/** The line of intent with its cause, in words — the board draws the same line as an arrow. */
function IntentLine({ intent }: { readonly intent: BattleIntentLine }) {
  const text = useText();
  // The names are coloured by the rule the journal's are, off the same two side words: the
  // intent line is the journal's `intent_declared` line lifted out and kept in view.
  const tones = battleLineTones({
    key: BattleEventKeys.IntentDeclared,
    sideKey: intent.sideKey,
    targetSideKey: intent.targetSideKey
  });

  return (
    <div className="intent" data-testid="battle-intent">
      <Label text={text(BattleFieldKeys.Intent)} />
      {/*
        A name when he has one, his side and his job when he has not. A foe carries no
        display name, and the frame of a running fight read `Намерение Выстрел Доран`: the
        act had no subject and the *target's* name sat where the actor's belongs.
      */}
      <Tinted tone={tones.who}>
        <Who
          displayNameKey={intent.displayNameKey}
          sideKey={intent.sideKey}
          roleKey={intent.roleKey}
        />
      </Tinted>
      <Label text={text(intent.actionKey)} />
      {/*
        The word between the two men, the same one the journal's own `intent_declared` line
        carries: an intent is always the subject's act aimed at the other man, so it is
        always `To`. Without it the same event read two ways on one screen.
      */}
      {intent.targetUnit === null ? null : (
        <>
          <Label text={text(BattleFieldKeys.To)} />
          <Tinted tone={tones.target}>
            <Who
              displayNameKey={intent.targetDisplayNameKey}
              sideKey={intent.targetSideKey}
              roleKey={intent.targetRoleKey}
            />
          </Tinted>
        </>
      )}
      <Label text={text(intent.reasonKey)} />
      {/*
        The moment `DIRECTION` §4.8 is about, and it is never shown on its own: a man going
        against the order is only legible beside the order he went against.
      */}
      {intent.contraryToDoctrineKey === null ? null : (
        <Label text={text(intent.contraryToDoctrineKey)} />
      )}
    </div>
  );
}

/**
 * One line of the journal, with the three colours of `DEC-018` on its spans.
 *
 * Which span carries which colour is `battleLineTones`' decision, read off the words this line
 * prints and off nothing else (`packages/presentation`, where every branch on a value lives).
 * What is left here is putting each colour on the one span it belongs to: the man, the man
 * after the arrow, the status, the number — never the line.
 */
function JournalRow({ line }: { readonly line: BattleJournalLine }) {
  const text = useText();
  const tones = battleLineTones(line);

  return (
    <div className="journal-line">
      <Label text={text(line.key)} />
      <Tinted tone={tones.who}>
        <Who displayNameKey={line.displayNameKey} sideKey={line.sideKey} roleKey={line.roleKey} />
      </Tinted>
      {line.detailKey === null ? null : (
        <Tinted tone={tones.detail}>
          <Label text={text(line.detailKey)} />
        </Tinted>
      )}
      {/*
        The other man, after the word saying which way it went and before the number. The
        owner's first play read `Урон Противник Столкновение 10` and asked «кто куда бьёт»:
        the striker and the figure were there, and nobody struck. The arrow is a text from
        the catalogue like every other word here, and the man after it is named by the rule
        the man before it is.
      */}
      {line.linkKey === null ? null : (
        <>
          <Label text={text(line.linkKey)} />
          <Tinted tone={tones.target}>
            <Who
              displayNameKey={line.targetDisplayNameKey}
              sideKey={line.targetSideKey}
              roleKey={line.targetRoleKey}
            />
          </Tinted>
        </>
      )}
      {line.amount === null ? null : (
        <Tinted tone={tones.amount}>
          <Label text={String(line.amount)} />
        </Tinted>
      )}
    </div>
  );
}

/** What the player may press, and what each press means to the feed (`COMBAT_SPEC` §10.2). */
export interface BattleControls {
  togglePause(): void;
  toggleSpeed(): void;
  skip(): void;
  replay(): void;
  /** Signals a withdrawal from `round`, which re-runs the fight from that round on. */
  retreat(round: number): void;
}

function Controls({
  model,
  controls
}: {
  readonly model: BattleScreenModel;
  readonly controls: BattleControls;
}) {
  const text = useText();
  const retreat = model.retreat;

  return (
    <div className="controls" data-testid="battle-controls">
      <button type="button" data-testid="battle-pause" onClick={controls.togglePause}>
        {text(model.controls.pauseKey)}
      </button>
      <button type="button" data-testid="battle-speed" onClick={controls.toggleSpeed}>
        {text(model.controls.speedKey)}
      </button>
      <button type="button" data-testid="battle-skip" onClick={controls.skip}>
        {text(model.controls.skipKey)}
      </button>
      <button type="button" data-testid="battle-replay" onClick={controls.replay}>
        {text(model.controls.replayKey)}
      </button>

      {retreat === null ? null : (
        <button
          type="button"
          data-testid="battle-retreat"
          // Disabled rather than hidden. A lever the player cannot find is a lever
          // `MVP_PLAN` §6.4 cannot measure, and how often it is reached for is the
          // measurement `DEC-005` is decided by.
          disabled={retreat.atRound === null}
          onClick={() => {
            if (retreat.atRound !== null) {
              controls.retreat(retreat.atRound);
            }
          }}
        >
          {text(retreat.labelKey)}
        </button>
      )}

      {/*
        The cost, beside the button and always — §10.2 asks for "a separate button with its
        price on it". A sentence rather than a figure: what a withdrawal costs is one
        `Retreat` on every hero who moved, and how much that is worth to a man is exactly
        the number `DEC-006` keeps off a screen.
      */}
      {retreat === null ? null : <Label text={text(retreat.costKey)} />}
    </div>
  );
}
