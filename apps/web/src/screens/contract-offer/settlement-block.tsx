import {
  OfferFieldKeys,
  SettlementFieldKeys,
  type SettlementLine
} from '@oath-and-coin/presentation';

import { useText } from '../../text.tsx';

import { Captioned, KeyList } from '../labels.tsx';

/**
 * What the promise costs and who is bound by it, shown once there is a crew to bind
 * (`NEGOTIATION_SPEC` §5.1): the promised bonus, the key hero it is owed to, the crew
 * it binds, and the two treasury figures a kept and a broken promise would each leave —
 * the price of the promise, visible before it is made.
 *
 * **This block draws no control.** `session-controller.ts` wires all five negotiation
 * commands, `settleContract` (`pay: true` to keep the word, `pay: false` to break it)
 * among them, but nothing on this screen dispatches any of them yet — the same
 * deferral `OfferBlock`'s own doc comment states for the advance, the method and the
 * promised bonus above. This block used to draw two `<button>` elements here with no
 * `onClick` at all, reachable the moment a real `pollCrew` filled a crew, pressable and
 * inert — a control that does nothing is worse than no control, so this task removed
 * them rather than leave a promise to wire a handler later. Wiring `settleContract` to
 * a real action is that later work, not this one's.
 */
export function SettlementBlock({
  settlement,
  heroDisplayNameKeyOf
}: {
  readonly settlement: SettlementLine;
  readonly heroDisplayNameKeyOf: (definition: string) => string;
}) {
  const text = useText();

  return (
    <div className="settlement">
      <Captioned
        captionKey={OfferFieldKeys.PromisedBonus}
        value={String(settlement.promisedBonus)}
      />

      {settlement.keyHeroDefinition === null ? null : (
        <Captioned
          captionKey={OfferFieldKeys.KeyHero}
          value={text(heroDisplayNameKeyOf(settlement.keyHeroDefinition))}
        />
      )}

      <KeyList
        captionKey={SettlementFieldKeys.Crew}
        keys={settlement.crew.map(heroDisplayNameKeyOf)}
      />

      <div className="row">
        <Captioned
          captionKey={SettlementFieldKeys.TreasuryIfKept}
          value={String(settlement.treasuryIfKept)}
        />
        <Captioned
          captionKey={SettlementFieldKeys.TreasuryIfBroken}
          value={String(settlement.treasuryIfBroken)}
        />
      </div>
    </div>
  );
}
