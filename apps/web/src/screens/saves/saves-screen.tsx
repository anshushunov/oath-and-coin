import {
  SaveFieldKeys,
  SaveOverwriteKeys,
  errorKey,
  saveSlotsStateKey,
  type SaveSlotLine,
  type SaveSlotsScreenModel
} from '@oath-and-coin/presentation';
import { useState } from 'react';

import { useText } from '../../text.tsx';
import { Captioned, Label } from '../labels.tsx';

import './saves-screen.css';

/**
 * The second product screen: three slots, what is in each of them, and the two things a
 * player may do to one.
 *
 * Built to the same rule as `contract-offer-screen.tsx` — **this screen decides
 * nothing**. Which slots exist, which of them hold a campaign, which refused and what
 * each line is called are all `saveSlotsScreenModel`'s answers, and every branch here is
 * of the one allowed kind: whether a model field is `null`. There is no branch on a
 * value, no string composed in code, and no raw identifier on a label — a slot's own
 * name (`slot-a`) is as much a raw identifier as a content id, and it reaches the markup
 * only as a `data-testid`, which no player reads.
 *
 * **The one piece of state that is genuinely the screen's.** Whether a confirmation is
 * currently being asked belongs to the moment between two clicks: it is not a property
 * of any slot, it survives no reload, and putting it in the model would make
 * `saveSlotsScreenModel` a function of something no storage can answer. So it lives here
 * — and only *which* slot is being asked about, never what the answer means.
 *
 * The confirmation itself is the design spec's transition (§3.1: "сохранить поверх
 * занятого с подтверждением"), and it is asked exactly when there is something to
 * destroy. An empty slot is written without a question, because a confirmation in front
 * of a slot with nothing in it teaches a player to click through the one that matters.
 */
export function SavesScreen({
  model,
  onSave,
  onLoad
}: {
  readonly model: SaveSlotsScreenModel;
  /** Called with the slot to write the campaign on screen into. */
  readonly onSave: (slot: string) => void;
  /** Called with the slot to replace the session from. */
  readonly onLoad: (slot: string) => void;
}) {
  const text = useText();
  // One slot at a time: two open questions would make "подтвердить" ambiguous, and the
  // player would be confirming whichever of them the layout put nearer.
  const [asking, setAsking] = useState<string | null>(null);

  return (
    <section className="saves" data-testid="saves-screen" data-state={model.state}>
      <Label text={text(model.titleKey)} />
      <Label text={text(saveSlotsStateKey(model.state))} />

      {model.slots.map((line) => (
        <div className="slot" data-testid={line.slot} key={line.slot}>
          <div className="row">
            <Label text={text(line.displayNameKey)} />
            <Label text={text(line.statusKey)} />
          </div>

          {/* Three branches on three model fields being null, and the model refuses a
              line that carries some of them and not others — so a save is never shown
              with a date and no contract, which on the screen is indistinguishable from
              a save that was written that way. */}
          {line.createdAt === null ? null : (
            <div className="row">
              <Captioned captionKey={SaveFieldKeys.SaveCreatedAt} value={line.createdAt} />
              {line.logicalTime === null ? null : (
                <Captioned
                  captionKey={SaveFieldKeys.SaveLogicalTime}
                  value={String(line.logicalTime)}
                />
              )}
              {line.contractDisplayNameKey === null ? null : (
                <Captioned
                  captionKey={SaveFieldKeys.SaveContract}
                  value={text(line.contractDisplayNameKey)}
                />
              )}
            </div>
          )}

          {/* A refusal about this slot, whether it came from reading the file or from a
              write that did not happen. Its own element with its own test id, because
              "which slot refused" is the whole of what the player needs from it. */}
          {line.errorCode === null ? null : (
            <div className="row refusal" data-testid={`${line.slot}-error`}>
              <Label text={text(errorKey(line.errorCode))} />
            </div>
          )}

          {asking === line.slot ? (
            <div className="row actions">
              <Label text={text(SaveOverwriteKeys.Question)} />
              <button
                type="button"
                data-testid={`${line.slot}-confirm`}
                onClick={() => {
                  setAsking(null);
                  onSave(line.slot);
                }}
              >
                {text(SaveOverwriteKeys.Confirm)}
              </button>
              <button
                type="button"
                data-testid={`${line.slot}-cancel`}
                onClick={() => {
                  setAsking(null);
                }}
              >
                {text(SaveOverwriteKeys.Cancel)}
              </button>
            </div>
          ) : (
            <div className="row actions">
              <button
                type="button"
                data-testid={`${line.slot}-save`}
                onClick={() => {
                  askOrSave(line, setAsking, onSave);
                }}
              >
                {text(line.saveKey)}
              </button>

              {/* No load on a slot with nothing to load, and one on an unreadable slot:
                  the refusal is shown by trying (design spec §3.1). */}
              {line.loadKey === null ? null : (
                <button
                  type="button"
                  data-testid={`${line.slot}-load`}
                  onClick={() => {
                    onLoad(line.slot);
                  }}
                >
                  {text(line.loadKey)}
                </button>
              )}
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

/**
 * Whether this click writes or asks first — the one place the difference is decided.
 *
 * On `createdAt`, which is the model's answer to "is there a campaign in this slot": the
 * same field the model classifies the whole screen by, so the question is asked exactly
 * when a save would replace something. A slot that only carries a refusal has nothing to
 * destroy, and a slot that carries both is occupied — its campaign is intact, which is
 * what the failed write leaves behind.
 */
function askOrSave(
  line: SaveSlotLine,
  setAsking: (slot: string | null) => void,
  onSave: (slot: string) => void
): void {
  if (line.createdAt === null) {
    onSave(line.slot);
    return;
  }

  setAsking(line.slot);
}
