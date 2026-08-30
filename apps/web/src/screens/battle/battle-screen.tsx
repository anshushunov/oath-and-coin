import {
  BattleFieldKeys,
  battleStateKey,
  errorKey,
  type BattleJournalLine,
  type BattleScreenModel,
  type BattleUnitLine
} from '@oath-and-coin/presentation';

import { WorldCanvas } from '../../world/world-canvas.tsx';
import { useText } from '../../text.tsx';

import { Captioned, Label } from '../labels.tsx';

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
 * **The board is drawn twice, and both are on purpose.** The canvas is the picture; the list
 * beside it is the same board in words, because a picture is not a text dub and `GDD` §16.6
 * asks for one. The journal underneath is the same argument over time.
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
        <>
          <Captioned
            captionKey={BattleFieldKeys.Round}
            value={String(model.round)}
            testId="battle-round"
          />
          <WorldCanvas model={model} phase={phase} />
          <div className="board" data-testid="battle-board">
            <Label text={text(BattleFieldKeys.Board)} />
            {model.units.map((unit) => (
              <UnitRow key={unit.unit} unit={unit} />
            ))}
          </div>
        </>
      )}

      {model.intent === null ? null : (
        <div className="intent" data-testid="battle-intent">
          <Label text={text(BattleFieldKeys.Intent)} />
          {model.intent.displayNameKey === null ? null : (
            <Label text={text(model.intent.displayNameKey)} />
          )}
          <Label text={text(model.intent.actionKey)} />
          {model.intent.targetDisplayNameKey === null ? null : (
            <Label text={text(model.intent.targetDisplayNameKey)} />
          )}
          <Label text={text(model.intent.reasonKey)} />
          {/*
            The moment `DIRECTION` §4.8 is about, and it is never shown on its own: a man
            going against the order is only legible beside the order he went against.
          */}
          {model.intent.contraryToDoctrineKey === null ? null : (
            <Label text={text(model.intent.contraryToDoctrineKey)} />
          )}
        </div>
      )}

      {model.journal.length === 0 ? null : (
        <div className="journal" data-testid="battle-journal">
          <Label text={text(BattleFieldKeys.Journal)} />
          {model.journal.map((line, index) => (
            // Keyed by position: a journal line carries no identity of its own — two
            // `turn_spent` lines about one man differ in nothing — and the list only ever
            // grows at the end, so there is no reordering for a key to survive.
            <JournalRow key={index} line={line} />
          ))}
        </div>
      )}

      <Controls model={model} controls={controls} />

      {model.outcomeKey === null ? null : (
        <Captioned
          captionKey={BattleFieldKeys.Outcome}
          value={text(model.outcomeKey)}
          testId="battle-outcome"
        />
      )}
    </section>
  );
}

/** One man, in words: who he is, what he holds, what is left of him and what is on him. */
function UnitRow({ unit }: { readonly unit: BattleUnitLine }) {
  const text = useText();

  return (
    <div className="unit" data-testid={`battle-unit-${unit.unit}`}>
      {/*
        Which side he is on, in a word and not only in a colour. Found by looking at the
        frame: the list under the board read as nine men with four names and five roles,
        and nothing on it said which of them the player had sent — §10.2 п.5's argument
        about status applies to the side just as directly (`GDD` §16.6).
      */}
      <Label text={text(unit.side === 'crew' ? BattleFieldKeys.Crew : BattleFieldKeys.Foes)} />
      {unit.displayNameKey === null ? null : <Label text={text(unit.displayNameKey)} />}
      <Label text={text(unit.roleKey)} />
      <Captioned captionKey={BattleFieldKeys.Health} value={String(unit.health)} />
      {unit.leftKey === null ? null : <Label text={text(unit.leftKey)} />}
      {unit.statuses.map((status) => (
        // The word and the mark, both, and never the tint alone (§10.2 п.5, `GDD` §16.6).
        <span className="status" key={status.key}>
          <Label text={text(status.key)} />
          <Label text={text(status.markKey)} />
        </span>
      ))}
    </div>
  );
}

function JournalRow({ line }: { readonly line: BattleJournalLine }) {
  const text = useText();

  return (
    <div className="journal-line">
      <Label text={text(line.key)} />
      {line.displayNameKey === null ? null : <Label text={text(line.displayNameKey)} />}
      {line.detailKey === null ? null : <Label text={text(line.detailKey)} />}
      {line.amount === null ? null : <Label text={String(line.amount)} />}
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
