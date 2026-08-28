import {
  AfterActionFieldKeys,
  OfferFieldKeys,
  SettlementActionKeys,
  SettlementFieldKeys,
  afterActionStateKey,
  errorKey,
  type AfterActionConsequenceLine,
  type AfterActionContributionLine,
  type AfterActionDeficitLine,
  type AfterActionEventLine,
  type AfterActionScreenModel,
  type AfterActionSettlementLine
} from '@oath-and-coin/presentation';

import type { SessionController } from '@oath-and-coin/application';
import { useState } from 'react';

import { useText } from '../../text.tsx';

import { Captioned, KeyList, Label } from '../labels.tsx';

/**
 * The debrief: what the run cost, what it bought, and the one decision left over
 * (`RESOLUTION_SPEC` §6.1).
 *
 * **This screen decides nothing**, the same rule `ContractOfferScreen` is held to. Every
 * field the model carries becomes at most one label, in a fixed order; the only branches are
 * on {@link AfterActionScreenModel.state} — which blocks exist at all — on a field being
 * `null` (a grade, an event's hero, a promise) and on a list being empty. Never on what is
 * *in* one: which grade, which verdict and which deficit came out are the engine's answers,
 * carried as keys, and a screen reading them would be keeping a second copy of §4's rules.
 * `expectedSnapshot` makes the identical decisions from the identical fields, which is what
 * lets the two lists be compared at all.
 *
 * **No raw identifier becomes a label.** Every hero and the contract itself carry a content
 * id purely for the model's own bookkeeping, and none of them is drawn: it is not a name a
 * player reads, and showing it beside the resolved name it duplicates is the leak `TDD`
 * §11.1 forbids. `errorDetail` does not reach this screen at all — it is assembled in code,
 * carries a machine's own path, and neither hash covers it.
 *
 * **The settlement is the only thing here a player can press**, and both branches are priced
 * before either is. That is the whole reason `RESOLUTION_SPEC` §6.1 puts the block on this
 * screen rather than on the offer: a promise answered without its price legible is the
 * Football Manager failure mode this design exists to fix, which is also why the offer
 * screen's own settle control moves the player here instead of paying blind (owner's
 * decision of 2026-08-28).
 *
 * Where an applied settlement takes the player is not this screen's business: §6.4's table
 * lives in `screenKindFor`, and answering it here as well would be a second answer to one
 * question.
 */
export function AfterActionScreen({
  model,
  controller
}: {
  readonly model: AfterActionScreenModel;
  readonly controller: AfterActionScreenActions;
}) {
  const text = useText();
  // What the last press came back with, and nothing else. It belongs to the moment rather
  // than to the model — a refused `settleContract` leaves the campaign exactly as it was
  // (§6.4), so there is nowhere in a projection of that campaign for it to live — which is
  // also why it sits outside every snapshot: no press, no text.
  const [rejectionKey, setRejection] = useState<string | null>(null);

  return (
    <section className="after-action" data-testid="after-action-screen">
      <Label text={text(model.titleKey)} />
      <Label text={text(afterActionStateKey(model.state))} />

      {model.errorCode === null ? null : <Label text={text(errorKey(model.errorCode))} />}

      {model.contractDisplayNameKey === null ? null : (
        <Label text={text(model.contractDisplayNameKey)} />
      )}

      {model.gradeKey === null ? null : (
        <Captioned captionKey={AfterActionFieldKeys.Grade} value={text(model.gradeKey)} />
      )}

      {model.events.length === 0 ? null : (
        <div className="events">
          <Label text={text(AfterActionFieldKeys.Events)} />
          {model.events.map((line, index) => (
            // Keyed by position, which is honest here rather than lazy: a feed line carries
            // no identity of its own — two `need_short` lines about two needs differ only in
            // fields — and the list is rebuilt whole whenever the model changes, so there is
            // no reordering for a key to survive.
            <EventBlock key={index} line={line} />
          ))}
        </div>
      )}

      {model.contributions.length === 0 ? null : (
        <div className="contributions">
          <Label text={text(AfterActionFieldKeys.Contributions)} />
          {model.contributions.map((line) => (
            <ContributionBlock key={line.heroDefinition} line={line} />
          ))}
        </div>
      )}

      {model.coverage.length === 0 ? null : (
        <div className="coverage">
          <Label text={text(AfterActionFieldKeys.Coverage)} />
          {model.coverage.map((line) => (
            <div className="row" key={line.needKey}>
              <Label text={text(line.needKey)} />
              <Label text={text(line.verdictKey)} />
            </div>
          ))}
        </div>
      )}

      {model.deficits.length === 0 ? null : (
        <div className="deficits">
          <Label text={text(AfterActionFieldKeys.Deficits)} />
          {model.deficits.map((line) => (
            <DeficitBlock key={line.key} line={line} />
          ))}
        </div>
      )}

      {model.dominantKey === null ? null : (
        <Captioned captionKey={AfterActionFieldKeys.Dominant} value={text(model.dominantKey)} />
      )}

      {model.consequences.length === 0 ? null : (
        <div className="consequences">
          <Label text={text(AfterActionFieldKeys.Consequences)} />
          {model.consequences.map((line, index) => (
            // Positional again, and for a sharper reason than the feed's: §5.1 allows one
            // record of each kind per hero, so a wound and a grudge on the same man are two
            // rows that share a hero and differ in kind.
            <ConsequenceBlock key={index} line={line} />
          ))}
        </div>
      )}

      {model.settlement === null ? null : (
        <SettlementBlock
          settlement={model.settlement}
          rejectionKey={rejectionKey}
          onAnswer={(pay) => {
            setRejection(answer(controller, model, pay));
          }}
        />
      )}
    </section>
  );
}

/**
 * The subset of the session controller this screen is allowed to use.
 *
 * `Pick` over the controller's own type rather than a hand-written interface, for the reason
 * `OfferScreenActions` records: there is one declaration of what the command takes, and this
 * is a statement about *which* commands a debrief may send. It may not negotiate, may not
 * save, and may not move the focus — a component that grew such a call would stop compiling
 * rather than quietly gain the ability.
 */
export type AfterActionScreenActions = Pick<SessionController, 'settleContract'>;

/**
 * Answers the promise, and hands back the refusal it produced or `null`.
 *
 * @throws when the screen has no contract to settle — a defect in this component, which must
 * not draw a control for a settlement that is not there.
 */
function answer(
  controller: AfterActionScreenActions,
  model: AfterActionScreenModel,
  pay: boolean
): string | null {
  const contractId = model.contractDefinition;

  if (contractId === null) {
    throw new Error(
      'A settlement was pressed on a debrief with no contract — a defect in this component, ' +
        'which must not draw a control for an outcome it is not showing.'
    );
  }

  const result = controller.settleContract({ contractId, pay });

  return result.applied ? null : result.rejectionCode;
}

/**
 * One line of the outcome feed, in the chronology `history` holds (`RESOLUTION_SPEC` §3.4).
 *
 * The hero and the need are each drawn only when the event names one — a branch on a model
 * field being `null`, never on which event this is. §6.3 is the reason the model decides it:
 * a debrief that always named somebody would teach the player to look for a scapegoat.
 */
function EventBlock({ line }: { readonly line: AfterActionEventLine }) {
  const text = useText();

  return (
    <div className="row event">
      <Label text={text(line.key)} />
      {line.heroDisplayNameKey === null ? null : <Label text={text(line.heroDisplayNameKey)} />}
      {line.needKey === null ? null : <Label text={text(line.needKey)} />}
      <Label text={text(line.reasonKey)} />
    </div>
  );
}

/**
 * What one man brought and how much of it counted (`DEC-014`, `ADR-015`) — two numbers, each
 * under its own caption, because "100 → 50" with nothing naming either side is the column a
 * player cannot read.
 */
function ContributionBlock({ line }: { readonly line: AfterActionContributionLine }) {
  const text = useText();

  return (
    <div className="contribution">
      <div className="row">
        <Label text={text(line.heroDisplayNameKey)} />
        <Captioned captionKey={AfterActionFieldKeys.Brought} value={String(line.amount)} />
        <Captioned captionKey={AfterActionFieldKeys.Counted} value={String(line.counted)} />
        <Captioned captionKey={AfterActionFieldKeys.Commitment} value={text(line.commitmentKey)} />
      </div>

      <KeyList captionKey={AfterActionFieldKeys.Provenance} keys={line.provenanceKeys} />
    </div>
  );
}

/**
 * One diagnosis with its sources (`RESOLUTION_SPEC` §4.7): what was short, by how much, on
 * which needs and among whom.
 *
 * The needs and the heroes carry no caption of their own, and that is the model's shape
 * rather than an omission: a deficit's sources are what the line is *about*, so a heading
 * over them would be a second name for the diagnosis already named above.
 */
function DeficitBlock({ line }: { readonly line: AfterActionDeficitLine }) {
  const text = useText();

  return (
    <div className="row deficit">
      <Label text={text(line.key)} />
      <Captioned
        captionKey={AfterActionFieldKeys.DeficitMagnitude}
        value={String(line.magnitude)}
      />
      {line.needKeys.map((needKey) => (
        <Label key={needKey} text={text(needKey)} />
      ))}
      {line.heroes.map((hero) => (
        <Label key={hero.definition} text={text(hero.displayNameKey)} />
      ))}
    </div>
  );
}

/** What the outcome cost one person, and the reason the engine recorded (§5.2). */
function ConsequenceBlock({ line }: { readonly line: AfterActionConsequenceLine }) {
  const text = useText();

  return (
    <div className="row consequence">
      <Label text={text(line.heroDisplayNameKey)} />
      <Label text={text(line.kindKey)} />
      <Label text={text(line.reasonKey)} />
      <Captioned
        captionKey={AfterActionFieldKeys.ConsequenceMagnitude}
        value={String(line.magnitude)}
      />
    </div>
  );
}

/**
 * The promise still to be answered: what the patron paid, what was promised to whom, and the
 * two futures with a button under each.
 *
 * **Each branch is one column: its treasury, what it costs beyond the treasury, and the
 * button that chooses it.** The two figures used to sit side by side with the consequences
 * elsewhere, which is the layout that makes a promise read as a discount — a player
 * comparing two numbers is not being shown that one of them costs a man's trust. Keeping the
 * price and the consequence under the same heading as the control that commits to them is
 * `NEGOTIATION_SPEC` §5.1's "цена уступки, видна до подтверждения", applied to the moment the
 * concession is actually made.
 *
 * The consequence lines appear only when something was promised, which is the model's own
 * `promise` being `null` — `settleContract` ignores `pay` on a package that promised nothing
 * (`NEGOTIATION_SPEC` §6), so a sentence there would name a grievance the engine will not
 * apply. The buttons stay in both cases: the command still has to be sent, and both values
 * of `pay` settle the contract exactly alike when there is no promise to break.
 */
function SettlementBlock({
  settlement,
  rejectionKey,
  onAnswer
}: {
  readonly settlement: AfterActionSettlementLine;
  readonly rejectionKey: string | null;
  readonly onAnswer: (pay: boolean) => void;
}) {
  const text = useText();

  return (
    <div className="settlement">
      <Captioned
        captionKey={AfterActionFieldKeys.PatronPays}
        value={String(settlement.patronPays)}
      />
      <Captioned
        captionKey={OfferFieldKeys.PromisedBonus}
        value={String(settlement.promisedBonus)}
      />

      {settlement.keyHero === null ? null : (
        <Captioned
          captionKey={OfferFieldKeys.KeyHero}
          value={text(settlement.keyHero.displayNameKey)}
        />
      )}

      <KeyList
        captionKey={SettlementFieldKeys.Crew}
        keys={settlement.crew.map((hero) => hero.displayNameKey)}
      />

      <div className="row branches">
        <div className="branch">
          <Captioned
            captionKey={SettlementFieldKeys.TreasuryIfKept}
            value={String(settlement.treasuryIfKept)}
          />
          {(settlement.promise?.keepConsequenceKeys ?? []).map((key) => (
            <Label key={key} text={text(key)} />
          ))}
          <button
            type="button"
            data-testid="settle-pay"
            onClick={() => {
              onAnswer(true);
            }}
          >
            {text(SettlementActionKeys.Pay)}
          </button>
        </div>

        <div className="branch">
          <Captioned
            captionKey={SettlementFieldKeys.TreasuryIfBroken}
            value={String(settlement.treasuryIfBroken)}
          />
          {(settlement.promise?.breakConsequenceKeys ?? []).map((key) => (
            <Label key={key} text={text(key)} />
          ))}
          <button
            type="button"
            data-testid="settle-refuse"
            onClick={() => {
              onAnswer(false);
            }}
          >
            {text(SettlementActionKeys.Refuse)}
          </button>
        </div>
      </div>

      {rejectionKey === null ? null : (
        <p className="rejection" data-testid="settlement-rejection">
          {text(rejectionKey)}
        </p>
      )}
    </div>
  );
}
