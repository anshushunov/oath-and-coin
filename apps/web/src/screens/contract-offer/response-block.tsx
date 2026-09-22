import {
  FieldKeys,
  actionKey,
  qualitativeKey,
  reasonDirectionKey,
  waveredKey,
  type ResponseLine
} from '@oath-and-coin/presentation';

import { useText } from '../../text.tsx';

import { Captioned, Label } from '../labels.tsx';

/**
 * One hero's answer: what they said, why, what stopped them if anything did, what
 * settled a dead heat if there was one, and whether their mood turned the answer.
 */
export function ResponseBlock({ response }: { readonly response: ResponseLine }) {
  const text = useText();

  return (
    <div className="response">
      <div className="row">
        <Label text={text(response.heroDisplayNameKey)} />
        <Label text={text(actionKey(response.action))} />
      </div>

      {response.reasons.map((reason, index) => (
        // Keyed by position, which is honest here rather than lazy: reasons carry no
        // identity of their own — two `stands_with_comrade` lines about two different
        // comrades are distinguished by `sourceEntity`, which a blocked line does not
        // have at all — and the list is rebuilt whole whenever the model changes, so
        // there is no reordering for a key to survive.
        <div className="row reason" key={index}>
          <Label text={text(reason.reasonCode)} />

          {/* A branch on whether this reason carries a source worth naming — a model
              fact, never a branch on the reason's code. `payment_attractive` names the
              contract and `trusts_the_guild` names the responding hero, both already
              on this screen, so the factory leaves the key null for them rather than
              the screen deciding to skip it. */}
          {reason.sourceDisplayNameKey === null ? null : (
            <Label text={text(reason.sourceDisplayNameKey)} />
          )}

          {/* Which way this reason pulled relative to the answer above it — read off
              the model, never worked out here from the action. A risk that pushed
              toward refusal supports a refusal and opposes an acceptance, and the
              screen has no business deciding which. */}
          <Label text={text(reasonDirectionKey(reason.direction))} />
          <Captioned
            captionKey={FieldKeys.ReasonStrength}
            value={text(qualitativeKey(reason.strength))}
          />
        </div>
      ))}

      {/* Same shape of branch as above: on a model field being null, never on a code.
          A block names its own principle so the screen does not have to guess one from
          the hero, and stays its own line so "too risky" reads differently from "will
          not do this at all". */}
      {response.blockedByDisplayNameKey === null ? null : (
        <div className="row">
          <Label text={text(FieldKeys.ResponseBlockedBy)} />
          <Label text={text(response.blockedByDisplayNameKey)} />
        </div>
      )}

      {/* The rule that settled a dead heat, when there was one. The decision with no
          reasons at all is exactly the one that most needs a line saying what decided
          it. */}
      {response.tieBreakCode === null ? null : <Label text={text(response.tieBreakCode)} />}

      <Label text={text(waveredKey(response.wavered))} />
    </div>
  );
}
