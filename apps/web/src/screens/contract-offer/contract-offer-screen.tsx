import {
  FieldKeys,
  OfferFieldKeys,
  ScreenState,
  SettlementFieldKeys,
  TreasuryFieldKeys,
  actionKey,
  errorKey,
  offerPhaseKey,
  qualitativeKey,
  reasonDirectionKey,
  screenStateKey,
  waveredKey,
  type ContractLine,
  type ContractOfferScreenModel,
  type HeroCard,
  type Lever,
  type OfferLine,
  type ResponseLine,
  type SettlementLine
} from '@oath-and-coin/presentation';

import { useText } from '../../text.tsx';

import { Captioned, KeyList, Label } from '../labels.tsx';

/**
 * The first product screen of the new stack: a rendering of one
 * `ContractOfferScreenModel`, built from that model and the catalogue above it and
 * from nothing else. The port of `game/ui/ContractOfferScreen.cs`, node for node.
 *
 * **This screen decides nothing.** Every field the model carries becomes at most one
 * label, in a fixed order, with no branch on a field's *value* beyond
 * {@link ContractOfferScreenModel.state} deciding which blocks exist at all — the
 * same "any other branch means the model was incomplete" rule the factory is held to.
 * Reading a screen-state key off `state` is that one allowed branch rather than an
 * exception to it. The remaining branches are all of one other kind: whether a model
 * field is `null` (a reason's source name, a response's blocker, a tie-break) or a
 * model list is empty (a hero's principles, a contract's tags) — never on what is in
 * it. `expectedSnapshot` makes the identical decisions from the identical fields.
 *
 * **No raw identifier becomes a label.** Every field that is a localization key is
 * resolved before it reaches one; every field that carries a content id purely for
 * the model's own bookkeeping — a contract's `definition`, a hero's `definition`, a
 * response's `heroDefinition`, a reason's `sourceEntity`, a blocking entity — is not
 * shown at all. It is not a name a player reads, showing it beside the resolved name
 * it duplicates is the raw-identifier leak `TDD` §11.1 forbids, and `readModelHash`
 * already covers every one of them without help from here. The three objective
 * numbers the spec calls out on purpose — patron fee, required crew, accepted count —
 * are the one kind of value shown literally, because they were never keys.
 * `errorDetail` does not reach this screen at all: it is assembled in code, carries a
 * machine's own path, and neither hash covers it.
 *
 * **Node order is the wire format.** This renders exactly one text per entry
 * `expectedSnapshot` puts in its list, in the same order, and nothing else. Which
 * element a text hangs off does not enter into it — `collectRenderedTexts` is a
 * document-order walk, so a row laying a caption and its value out side by side
 * visits them in the same order a column would. The roster and the responses are two
 * columns for the reason the Godot original made them two: a single stack of six hero
 * cards followed by six response blocks is twice as tall as the window and pushes
 * every response below the fold. A depth-first walk still visits every roster text
 * before every response text, so that is a layout choice and not a change to the
 * order the snapshot states.
 */
export function ContractOfferScreen({ model }: { readonly model: ContractOfferScreenModel }) {
  const text = useText();
  // The one join this screen has to make for itself: `OfferLine`'s hero levers and
  // `SettlementLine.keyHeroDefinition`/`crew` carry a hero's raw content id for
  // bookkeeping (`OfferLine`'s own doc comment), and the roster already carries that
  // id's display-name key — the same convention `ResponseLine.heroDefinition` uses.
  // Built once per render rather than per field that needs it. A lever's *options* need
  // no such join: each already carries its own label key, because a screen has no roster
  // to look one up in for a hero nobody has chosen yet.
  const heroDisplayNameKeyOf = buildHeroDisplayNameKeyOf(model.roster);
  // `NEGOTIATION_SPEC` §5.1: the treasury reads on `Empty` exactly as it reads on
  // `Normal` — a campaign with nothing to offer still has one — and only `Loading` and
  // `Error` have no campaign behind them to read a figure from at all.
  const showTreasury = model.state !== ScreenState.Loading && model.state !== ScreenState.Error;

  return (
    <section className="contract-offer" data-testid="contract-offer-screen">
      <Label text={text(model.titleKey)} />
      <Label text={text(screenStateKey(model.state))} />

      {model.errorCode === null ? null : <Label text={text(errorKey(model.errorCode))} />}

      {model.contract === null ? null : <ContractBlock contract={model.contract} />}

      {model.roster.length === 0 && model.responses.length === 0 ? null : (
        <div className="columns">
          <div className="roster">
            {model.roster.map((hero) => (
              <HeroCardBlock key={hero.definition} hero={hero} />
            ))}
          </div>
          <div className="responses">
            {model.responses.map((response) => (
              <ResponseBlock key={response.heroDefinition} response={response} />
            ))}
          </div>
        </div>
      )}

      {model.offer === null ? null : (
        <OfferBlock offer={model.offer} heroDisplayNameKeyOf={heroDisplayNameKeyOf} />
      )}

      {/* Treasury and its forecast sit beside the promise (`NEGOTIATION_SPEC` §5.1's
          own "цена уступки, видна до подтверждения"), in the one container both this
          and `PromiseTermsBlock` render into — the treasury the deal would leave is
          the price of the very promise stated beside it. */}
      {showTreasury || model.promiseTerms !== null ? (
        <div className="row price">
          {showTreasury ? (
            <>
              <Captioned captionKey={TreasuryFieldKeys.Treasury} value={String(model.treasury)} />
              <Captioned
                captionKey={TreasuryFieldKeys.Forecast}
                value={String(model.treasuryForecast)}
                testId="treasury-forecast"
              />
            </>
          ) : null}

          {model.promiseTerms === null ? null : (
            <div className="promise">
              <Label text={text(model.promiseTerms.fulfilKey)} />
              <Label text={text(model.promiseTerms.breachKey)} />
              <Captioned
                captionKey={OfferFieldKeys.PromisedBonus}
                value={String(model.promiseTerms.bonus)}
              />
            </div>
          )}
        </div>
      ) : null}

      {model.settlement === null ? null : (
        <SettlementBlock
          settlement={model.settlement}
          heroDisplayNameKeyOf={heroDisplayNameKeyOf}
        />
      )}
    </section>
  );
}

/**
 * A hero's display-name key, joined from the raw content id {@link OfferLine} and
 * {@link SettlementLine} carry for bookkeeping — never shown itself, only used to look
 * up the name that is (`TDD` §11.1).
 *
 * @throws when `definition` names nobody in the roster — a content-loading or
 * roster-building bug this screen refuses to paper over rather than show a hero with
 * no name.
 */
function buildHeroDisplayNameKeyOf(roster: readonly HeroCard[]): (definition: string) => string {
  const byDefinition = new Map(roster.map((hero) => [hero.definition, hero.displayNameKey]));

  return (definition) => {
    const key = byDefinition.get(definition);

    if (key === undefined) {
      throw new Error(
        `The negotiation package names hero '${definition}', but the roster this screen was given ` +
          'has no display-name key for it — a content-loading or roster-building bug, not a hero ' +
          'with no name.'
      );
    }

    return key;
  };
}

/**
 * The offer itself: its name, the four facts about it, and its tags when it has any.
 *
 * The four facts share one row so that they read as four facts rather than as a
 * column of unexplained numbers.
 */
function ContractBlock({ contract }: { readonly contract: ContractLine }) {
  const text = useText();

  return (
    <div className="contract">
      <Label text={text(contract.displayNameKey)} />

      <div className="row">
        <Captioned captionKey={FieldKeys.ContractPatronFee} value={String(contract.patronFee)} />
        <Captioned
          captionKey={FieldKeys.ContractRisk}
          value={text(qualitativeKey(contract.risk))}
        />
        <Captioned
          captionKey={FieldKeys.ContractRequiredCrew}
          value={String(contract.requiredCrew)}
        />
        <Captioned
          captionKey={FieldKeys.ContractAcceptedCount}
          value={String(contract.acceptedCount)}
        />
      </div>

      <KeyList captionKey={FieldKeys.ContractTags} keys={contract.tagKeys} />
    </div>
  );
}

/**
 * One hero: their name and three scales on one line, then whichever of their
 * principles and inclinations they have.
 *
 * The name and the scales share a row because six heroes at four lines each fill a
 * 720px window on their own, and a hero's scales belong beside the hero rather than
 * under them.
 */
function HeroCardBlock({ hero }: { readonly hero: HeroCard }) {
  const text = useText();

  return (
    <div className="hero">
      <div className="row">
        <Label text={text(hero.displayNameKey)} />
        <Captioned captionKey={FieldKeys.HeroGreed} value={text(qualitativeKey(hero.greed))} />
        <Captioned captionKey={FieldKeys.HeroCaution} value={text(qualitativeKey(hero.caution))} />
        <Captioned captionKey={FieldKeys.HeroPride} value={text(qualitativeKey(hero.pride))} />
      </div>

      <KeyList captionKey={FieldKeys.HeroPrinciples} keys={hero.principleKeys} />
      <KeyList captionKey={FieldKeys.HeroInclinations} keys={hero.inclinationKeys} />
    </div>
  );
}

/**
 * One hero's answer: what they said, why, what stopped them if anything did, what
 * settled a dead heat if there was one, and whether their mood turned the answer.
 */
function ResponseBlock({ response }: { readonly response: ResponseLine }) {
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

/**
 * The negotiation package as one draft block (`NEGOTIATION_SPEC` §5.1): version and
 * phase, then the three levers a player pulls together — advance, method, promised
 * bonus — and last what locking this exact package would reserve. The CK3 layout rule
 * this segment's plan names: a control that changes money shows the money it changes,
 * next to it. `lockCommitment` is that money, and the three levers above it are what
 * produces it — `advance × requiredCrew + promisedBonus` — so it closes the block
 * rather than sitting apart from what it prices.
 *
 * Advance and promised bonus are shown the same way every other objective number on
 * this screen is — a caption beside a value, `Captioned` — not as editable `<input>`
 * elements: this task draws what the model carries, and wiring a lever to a command is
 * explicitly later work (the negotiation slice's five commands are Task 16's, not this
 * screen's to dispatch; `NEGOTIATION_SPEC` §3.1 names a sixth since 2026-08-25). The method choice is a real `role="radio"` group even so,
 * because which of two named alternatives a package has chosen is a selection among a
 * closed set the way a number is not, and a screen that already draws it this way costs
 * nothing extra to keep drawing it this way once a handler lands.
 *
 * The radio group's `checked` state is not the only place the choice is visible.
 * `OfferFieldKeys.SelectedMethod` repeats it as an ordinary `Captioned` value right
 * under the group — the same text `OfferFieldKeys.Method`'s two options already carry,
 * projected a second time from `methodTagKey` directly rather than from which option
 * happens to render first. A `checked` prop is a DOM property with no text node behind
 * it, so without this second line "which alternative won" could not be told from
 * rendered text at all — see {@link OfferFieldKeys.SelectedMethod}'s own doc comment.
 */
function OfferBlock({
  offer,
  heroDisplayNameKeyOf
}: {
  readonly offer: OfferLine;
  readonly heroDisplayNameKeyOf: (definition: string) => string;
}) {
  const text = useText();

  return (
    <div className="offer">
      <Captioned captionKey={OfferFieldKeys.Version} value={String(offer.version)} />
      <Label text={text(offerPhaseKey(offer.phase))} />

      <div className="row lever">
        <Captioned captionKey={OfferFieldKeys.Advance} value={String(offer.advanceLever.value)} />
        <DisabledReason lever={offer.advanceLever} />

        {offer.methodLever.options.length === 0 ? null : (
          <div className="method-options">
            <Label text={text(OfferFieldKeys.Method)} />
            {offer.methodLever.options.map((option) => (
              <label className="method-option" key={option.value}>
                <input type="radio" name="offer-method" checked={option.selected} readOnly />
                <span className="label">{text(option.labelKey)}</span>
              </label>
            ))}
          </div>
        )}

        {offer.methodLever.options
          .filter((option) => option.selected)
          .map((option) => (
            <Captioned
              key={option.value}
              captionKey={OfferFieldKeys.SelectedMethod}
              value={text(option.labelKey)}
            />
          ))}

        <DisabledReason lever={offer.methodLever} />

        <Captioned
          captionKey={OfferFieldKeys.PromisedBonus}
          value={String(offer.bonusLever.value)}
        />
        <DisabledReason lever={offer.bonusLever} />
      </div>

      {/* Both hero levers show every option before they show the choice made out of it:
          a set of alternatives a player cannot see is not a set they can choose from,
          and the crew being part of the package is the whole point of `RESOLUTION_SPEC`
          §2.5. Never gated on emptiness — a roster is never empty on a screen that has a
          contract at all (`contractOfferScreenModel`'s own `Empty` guard). */}
      <KeyList
        captionKey={OfferFieldKeys.KeyHeroOptions}
        keys={offer.keyHeroLever.options.map((option) => option.labelKey)}
      />

      {offer.keyHeroLever.chosen === null ? null : (
        <Captioned
          captionKey={OfferFieldKeys.KeyHero}
          value={text(heroDisplayNameKeyOf(offer.keyHeroLever.chosen))}
        />
      )}
      <DisabledReason lever={offer.keyHeroLever} />

      <KeyList
        captionKey={OfferFieldKeys.CrewOptions}
        keys={offer.crewLever.options.map((option) => option.labelKey)}
      />
      <Captioned captionKey={OfferFieldKeys.CrewSize} value={String(offer.crewLever.exactly)} />

      <KeyList
        captionKey={OfferFieldKeys.Crew}
        keys={offer.crewLever.chosen.map(heroDisplayNameKeyOf)}
      />
      <DisabledReason lever={offer.crewLever} />

      <div className="row budget">
        <Captioned
          captionKey={OfferFieldKeys.BudgetAvailable}
          value={String(offer.budget.available)}
        />
        <Captioned captionKey={OfferFieldKeys.MaxAdvance} value={String(offer.advanceLever.max)} />
        <Captioned captionKey={OfferFieldKeys.MaxBonus} value={String(offer.bonusLever.max)} />

        {/* Only when the package has stopped fitting — a branch on a number being zero is
            the same kind as a branch on an empty list, and "не хватает: 0" beside a
            package that fits is a heading for an absence. */}
        {offer.budget.shortfall === 0 ? null : (
          <Captioned
            captionKey={OfferFieldKeys.Shortfall}
            value={String(offer.budget.shortfall)}
            testId="offer-shortfall"
          />
        )}
      </div>

      <Captioned captionKey={OfferFieldKeys.LockCommitment} value={String(offer.lockCommitment)} />
    </div>
  );
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
function DisabledReason({ lever }: { readonly lever: Lever }) {
  const text = useText();

  return lever.disabledReasonKey === null ? null : <Label text={text(lever.disabledReasonKey)} />;
}

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
function SettlementBlock({
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
