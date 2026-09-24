import type { Lever, OfferAction, OfferLeverId } from '@oath-and-coin/presentation';

import { useText } from '../../text.tsx';

import { Label } from '../labels.tsx';

/**
 * What the last press came back with: the refusal, and which command was refused.
 *
 * The action travels with the key because the key alone does not say where the sentence
 * belongs. `offer_terms_out_of_bounds` is `composeOffer`'s answer for a term past the patron
 * fee and `placeCrew`'s for a retreat threshold past one hundred per cent, and the two
 * levers are half a screen apart — `leverOfRefusal` needs both halves to say which.
 */
export interface Refusal {
  readonly action: OfferAction;
  readonly key: string;
}

/** A refusal that names a lever, and the lever it names — what {@link LeverRefusal} draws. */
export interface LeverRefusal {
  readonly lever: OfferLeverId;
  readonly key: string;
}

/**
 * The sentence a press came back with, wherever it stands.
 *
 * One element and one test id however many places can draw it, because at most one refusal
 * exists at a time — it is what the *last* press answered — and the browser suites find it
 * by that id without knowing which control it landed beside.
 */
export function Refusal({ textKey }: { readonly textKey: string }) {
  const text = useText();

  return (
    <p className="rejection" data-testid="offer-rejection">
      {text(textKey)}
    </p>
  );
}

/**
 * The refusal beside the lever it names, or nothing — drawn inside that lever's own block,
 * which is what "beside" means on this screen: the block a control is in is the block its
 * refusal is in, so a reader who has found the number has found the sentence about it.
 *
 * A branch on which lever this is, and it is the same kind as `ActionsBlock`'s branch on
 * which action a button is: the model has said which lever the refusal names, and each
 * block asks only whether that is itself.
 */
export function LeverRefusal({
  at,
  refusal
}: {
  readonly at: OfferLeverId;
  readonly refusal: LeverRefusal | null;
}) {
  return refusal === null || refusal.lever !== at ? null : <Refusal textKey={refusal.key} />;
}

/**
 * Why a lever cannot be moved, beside that lever — a branch on a model field being `null`
 * and on nothing else.
 *
 * Its own line per lever rather than one for the package: the model states a reason per
 * lever ({@link leversOf}), and a screen that collapsed five equal reasons into one would
 * be asserting they must stay equal — plus leaving four disabled controls with no
 * accessible explanation of their own.
 */
export function DisabledReason({ lever }: { readonly lever: Lever }) {
  const text = useText();

  return lever.disabledReasonKey === null ? null : <Label text={text(lever.disabledReasonKey)} />;
}
