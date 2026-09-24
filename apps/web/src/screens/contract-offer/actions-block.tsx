import { OfferAction, offerActionKey, type AvailableAction } from '@oath-and-coin/presentation';

import { useText } from '../../text.tsx';
import { Button } from '../../ui/button.tsx';

import { Refusal } from './refusal.tsx';

/**
 * The six commands of the protocol, each either live or dark with the refusal it would get
 * (`offer-actions.ts`).
 *
 * **Two reasons a control can be dark, and only one of them is a rule.** The model's own
 * `disabledReasonKey` is the engine's answer — this package cannot be revised, the crew is
 * not filled — and it is shown as text beside the button. `canCompose` is the other: the
 * *form* is not filled in yet, which is not a fact about the campaign and carries no
 * refusal to show, because nothing has been refused. A player is told about the first and
 * simply cannot press the second.
 *
 * `refusal` is a third thing again: what the last press actually came back with, when it
 * was about the package as a whole rather than about a lever. It stands beside the button
 * that was pressed — the control it is about — in the slot a dark button's reason takes,
 * and the two never meet: a dark button cannot be pressed. A refusal that names a lever
 * never reaches this block at all; it stands beside that lever ({@link LeverRefusal}).
 * **It used to be printed here for every refusal, after the last button, and that put it
 * below the window at 1280×800 — the owner typed an advance past the ceiling, pressed, and
 * read nothing.**
 *
 * Every branch here is on a field being `null` or a boolean the parent computed — never on
 * which action this is — and `expectedSnapshot` makes the identical decisions from the
 * identical model fields. `canCompose` and `refusal` produce no text of their own, so
 * neither can move the second hash.
 */
export function ActionsBlock({
  actions,
  composeBlockedBy: composeBlocked,
  refusal,
  onPress
}: {
  readonly actions: readonly AvailableAction[];
  /** The screen's own reason `compose` is dark, when the engine has none (`§5.1`). */
  readonly composeBlockedBy: string | null;
  /** The last refusal, when it names no lever and so belongs beside the button pressed. */
  readonly refusal: Refusal | null;
  readonly onPress: (action: OfferAction) => void;
}) {
  const text = useText();

  if (actions.length === 0) {
    return null;
  }

  return (
    <div className="actions" data-testid="offer-actions">
      {actions.map((available) => {
        // The engine's refusal when it has one, the screen's when it does not. Never both:
        // a control cannot be dark for two reasons at once, and a player reading two would
        // not know which one to act on.
        const reasonKey =
          available.disabledReasonKey ??
          (available.action === OfferAction.Compose ? composeBlocked : null);

        return (
          <div className="action" key={available.action}>
            {/* The kit's button, which carries the reason itself and ties it to the control
                (`aria-describedby`) — a dark step of the ladder says why on the same line. */}
            <Button
              testId={`action-${available.action}`}
              disabledReason={reasonKey === null ? null : text(reasonKey)}
              onPress={() => {
                onPress(available.action);
              }}
            >
              {text(offerActionKey(available.action))}
            </Button>

            {refusal === null || refusal.action !== available.action ? null : (
              <Refusal textKey={refusal.key} />
            )}
          </div>
        );
      })}
    </div>
  );
}
