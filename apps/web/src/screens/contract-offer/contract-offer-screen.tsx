import {
  FieldKeys,
  OfferFieldKeys,
  OfferAction,
  ScreenKind,
  ScreenState,
  SettlementFieldKeys,
  TreasuryFieldKeys,
  actionKey,
  errorKey,
  offerActionKey,
  offerPhaseKey,
  qualitativeKey,
  reasonDirectionKey,
  screenStateKey,
  waveredKey,
  type AvailableAction,
  type ChoiceOption,
  type Cell,
  type ContentId,
  type DoctrineId,
  type ContractLine,
  type ContractOfferScreenModel,
  type DeploymentLine,
  type HeroCard,
  type Lever,
  type NumericLever,
  type OfferLine,
  type ResponseLine,
  type SettlementLine
} from '@oath-and-coin/presentation';

import type { SessionController } from '@oath-and-coin/application';
import { useState } from 'react';

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
export function ContractOfferScreen({
  model,
  controller,
  onBattle
}: {
  readonly model: ContractOfferScreenModel;
  readonly controller: OfferScreenActions;
  /**
   * Whether sending this crew starts a fight the player watches before it is committed
   * (`COMBAT_SPEC` §6.3), answered by the host.
   *
   * Here rather than on the read model, because the model carries no plan and giving it one
   * so that a button could branch would put the enemy pattern on the negotiation screen —
   * which is a thing the player is not told before he sends anybody.
   */
  readonly onBattle?: (contractId: ContentId) => boolean;
}) {
  const text = useText();
  const [form, setForm] = useState(() => formFor(model));

  // **Adjusting state while rendering, which React documents and which is the right shape
  // here.** The alternative is an effect that resets the form after the wrong one has
  // already been painted, and a player would see the previous contract's package for a
  // frame on a screen that has moved to another one.
  //
  // The key is the contract *and* the package's version, and both halves are load-bearing.
  // An applied `composeOffer` answers with `version + 1`, and everything typed is now
  // recorded — so starting again from the campaign is right. A *refused* one moves neither,
  // so the draft survives, which is the whole reason it exists: a refusal that silently
  // emptied the form would make a player retype everything to find out whether the refusal
  // was even about what they had typed.
  if (form.key !== packageKeyOf(model)) {
    setForm(formFor(model));
  }
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
        <OfferBlock
          offer={model.offer}
          draft={form.draft}
          onDraft={(draft) => {
            // A keystroke clears the last refusal: it was about the package as it stood,
            // and the package has just changed.
            setForm({ ...form, draft, rejectionKey: null });
          }}
          heroDisplayNameKeyOf={heroDisplayNameKeyOf}
        />
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

      {model.forecast === null ? null : (
        <div className="forecast" data-testid="offer-forecast">
          <Label text={text(OfferFieldKeys.Forecast)} />
          <Label text={text(OfferFieldKeys.ForecastObjectives)} />
          {model.forecast.objectives.map((objective) => (
            <div className="row" key={objective.needKey}>
              <Label text={text(objective.needKey)} />
              <Label text={text(objective.verdictKey)} />
            </div>
          ))}
          {model.forecast.reasons.length === 0 ? null : (
            <>
              <Label text={text(OfferFieldKeys.ForecastReasons)} />
              {/*
                In the model's own order, which is the ranking `DEC-006` asks for
                (declaration order in `ForecastReasonCodes`). A screen that sorted them
                would be choosing what to say first, which is the one thing this list is.
              */}
              {model.forecast.reasons.map((reason, index) => (
                <div className="row" key={index}>
                  <Label text={text(reason.key)} />
                  {reason.needKey === null ? null : <Label text={text(reason.needKey)} />}
                  {reason.heroDisplayNameKey === null ? null : (
                    <Label text={text(reason.heroDisplayNameKey)} />
                  )}
                  {reason.column === null ? null : (
                    <Captioned
                      captionKey={OfferFieldKeys.ForecastColumn}
                      value={String(reason.column)}
                    />
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {model.deployment === null ? null : (
        <FormationBlock
          deployment={model.deployment}
          draft={form.draft}
          onChange={(draft) => {
            setForm({ ...form, draft });
          }}
        />
      )}

      <ActionsBlock
        actions={model.availableActions}
        canCompose={isSendable(form.draft, model)}
        rejectionKey={form.rejectionKey}
        onPress={(action) => {
          setForm({
            ...form,
            rejectionKey: press(controller, action, form.draft, model, onBattle)
          });
        }}
      />
    </section>
  );
}

/**
 * The subset of the session controller this screen is allowed to use.
 *
 * `Pick` over the controller's own type rather than a hand-written interface: there is one
 * declaration of what each command takes, and this is a statement about *which* of them the
 * negotiation screen may send — it may not save, may not load, and may not move the focus
 * to another contract. A component that grew such a call would stop compiling rather than
 * quietly gain the ability.
 */
export type OfferScreenActions = Pick<
  SessionController,
  | 'composeOfferFromDraft'
  | 'askKeyHero'
  | 'lockOffer'
  | 'pollCrew'
  | 'placeCrewFromDraft'
  | 'resolveContract'
  | 'show'
>;

/**
 * A package as a player is assembling it, before any of it has been recorded.
 *
 * **This is the state the read model deliberately cannot hold.** `ContractOfferScreenModel`
 * is what the campaign records, rebuilt from the engine after every command, so a
 * half-filled term has nowhere in it to live — and an immutable projection that could hold
 * one would have stopped being a projection.
 *
 * `keyHero` is nullable here and is not on `OfferDraft`, and the difference is the point: a
 * command needs somebody to negotiate with, a form does not yet. Until one is chosen there
 * is no `OfferDraft` to build at all, which is why {@link isSendable} refuses rather than
 * this screen inventing a hero.
 */
interface OfferForm {
  readonly advance: number;
  readonly promisedBonus: number;
  readonly methodTag: ContentId | null;
  readonly keyHero: ContentId | null;
  readonly invited: readonly ContentId[];
  /**
   * Where each man is to stand, keyed by his definition (`COMBAT_SPEC` §3.7).
   *
   * Part of the draft rather than of the model, for the reason the rest of this form is: it
   * is what a player is *typing*, and until `placeCrew` takes it nothing about the campaign
   * has moved. Once the command applies, the model carries the formation and this is rebuilt
   * from it.
   */
  readonly placement: Readonly<Record<string, Cell>>;
  readonly doctrine: DoctrineId | null;
  readonly retreatBelowPercent: number;
}

/**
 * The formation half of the draft, taken from the package when it already carries one.
 *
 * An applied `placeCrew` records the formation on the package, so starting again from the
 * campaign is right — the same rule the rest of the draft follows. A contract that goes to no
 * fight has no formation block at all, and the draft carries the empty one.
 */
function formationFor(
  model: ContractOfferScreenModel
): Pick<OfferForm, 'placement' | 'doctrine' | 'retreatBelowPercent'> {
  const deployment = model.deployment;

  if (deployment === null) {
    return { placement: {}, doctrine: null, retreatBelowPercent: 0 };
  }

  return {
    placement: Object.fromEntries(
      deployment.crew.flatMap((slot) =>
        slot.cell === null ? [] : [[slot.heroDefinition, slot.cell]]
      )
    ),
    // A battle always has an order in force (`COMBAT_SPEC` §7.2) — "none" is not a state the
    // rules have — so the draft starts on the first of the three rather than on nothing, and
    // the player changes it or does not.
    doctrine: deployment.doctrineLever.chosen ?? deployment.doctrineLever.options[0]?.value ?? null,
    retreatBelowPercent: deployment.retreatBelowPercent ?? 0
  };
}

interface FormState {
  /** The package this draft belongs to; a change to it throws the draft away. */
  readonly key: string | null;
  readonly draft: OfferForm;
  /** The refusal the last press produced, or `null` when the last press was taken. */
  readonly rejectionKey: string | null;
}

const EMPTY_FORM: OfferForm = {
  advance: 0,
  promisedBonus: 0,
  methodTag: null,
  keyHero: null,
  invited: [],
  placement: {},
  doctrine: null,
  retreatBelowPercent: 0
};

/**
 * Which package a draft belongs to — the contract and the version together.
 *
 * `null` when there is no package on screen at all, and that is a key like any other: a
 * screen that has just gained one differs from a screen that had none, so the form is
 * rebuilt exactly as it should be.
 */
function packageKeyOf(model: ContractOfferScreenModel): string | null {
  return model.contract === null || model.offer === null
    ? null
    : // Separated, not concatenated: a contract id may end in a digit, so `a` at version
      // 11 and `a1` at version 1 would key the same, and a form would survive a change it
      // must not survive. 0x1F is the separator this repository already joins strings with
      // before hashing them, for exactly that collision, and it cannot occur inside an id.
      `${model.contract.definition}${String(model.offer.version)}`;
}

/** The form a player starts from: whatever the package currently records. */
function formFor(model: ContractOfferScreenModel): FormState {
  const { offer } = model;

  return {
    key: packageKeyOf(model),
    draft:
      offer === null
        ? EMPTY_FORM
        : {
            advance: offer.advanceLever.value,
            promisedBonus: offer.bonusLever.value,
            methodTag: offer.methodLever.chosen,
            keyHero: offer.keyHeroLever.chosen,
            invited: [...offer.crewLever.chosen],
            ...formationFor(model)
          },
    rejectionKey: null
  };
}

/**
 * Whether this form can become a command at all.
 *
 * Two conditions, and neither is a game rule this screen invented. A crew of the wrong size
 * is refused by `composeOffer` itself (`rejected.crew_size_mismatch`), and the size it is
 * held to is the model's own `crewLever.exactly` — read, never chosen here. A form with no
 * key hero cannot be turned into an `OfferDraft`, because the command names one; that is a
 * fact about the shape of the command rather than a rule about packages.
 *
 * Everything else a package can get wrong — a key hero outside the crew, a term past the
 * patron fee — is left to the engine, and the refusal it answers with is what the player
 * reads. A screen that pre-empted those would be keeping a second copy of rules it does not
 * own, which is the whole failure `offer-actions.ts` is built to avoid.
 */
function isSendable(draft: OfferForm, model: ContractOfferScreenModel): boolean {
  return draft.keyHero !== null && draft.invited.length === (model.offer?.crewLever.exactly ?? 0);
}

/**
 * Sends one command, and answers with the refusal it produced or `null`.
 *
 * `settle` is the one that sends nothing. Answering a promise means choosing whether to pay
 * it, and what each choice costs is on the debrief (`RESOLUTION_SPEC` §6.1) — owner's
 * decision of 2026-08-28. A button here that paid one way or the other would be a promise
 * answered without the player being able to see the price, which is the Football Manager
 * failure mode this design exists to fix, so it moves them to where the price is instead.
 */
function press(
  controller: OfferScreenActions,
  action: OfferAction,
  draft: OfferForm,
  model: ContractOfferScreenModel,
  onBattle?: (contractId: ContentId) => boolean
): string | null {
  const contractId = model.contract?.definition;

  if (contractId === undefined) {
    throw new Error(
      'A negotiation command was pressed on a screen with no contract — a defect in this ' +
        'component, which must not draw a control for a package that is not there.'
    );
  }

  switch (action) {
    case OfferAction.Compose:
      return draft.keyHero === null
        ? null
        : refusalOf(
            controller.composeOfferFromDraft(contractId, {
              advance: draft.advance,
              promisedBonus: draft.promisedBonus,
              methodTag: draft.methodTag,
              keyHero: draft.keyHero,
              invited: draft.invited
            })
          );
    case OfferAction.AskKeyHero:
      return refusalOf(controller.askKeyHero(contractId));
    case OfferAction.Lock:
      return refusalOf(controller.lockOffer({ contractId }));
    case OfferAction.Poll:
      return refusalOf(controller.pollCrew({ contractId }));
    case OfferAction.Place:
      // Everything the draft holds, handed over as it stands. A man with no cell is sent
      // without one and `placeCrew` refuses by name (`unplaced_hero`) — the screen does not
      // pre-empt that, for the reason it pre-empts nothing else: the refusal the player
      // reads is the engine's own, and a guard here would be a second set of rules.
      return draft.doctrine === null
        ? null
        : refusalOf(
            controller.placeCrewFromDraft(contractId, {
              placement:
                model.deployment?.crew.flatMap((slot) => {
                  const cell = draft.placement[slot.heroDefinition];

                  return cell === undefined ? [] : [{ hero: slot.heroDefinition, cell }];
                }) ?? [],
              doctrine: draft.doctrine,
              retreatBelowPercent: draft.retreatBelowPercent
            })
          );
    case OfferAction.Resolve:
      // A contract that goes to a fight is not resolved by pressing this: the fight is
      // watched first, and the outcome is committed at the end of it with whatever the
      // player decided about withdrawing (`COMBAT_SPEC` §6.3). `onBattle` answers whether
      // this is such a contract, and it is the host's question rather than the screen's —
      // the read model carries no plan, and giving it one so that a button could branch
      // would put the enemy pattern on the negotiation screen.
      if (onBattle?.(contractId) === true) {
        return null;
      }

      return refusalOf(controller.resolveContract({ retreatAtRound: null, contractId }));
    case OfferAction.Settle:
      controller.show(ScreenKind.AfterAction);

      return null;
  }
}

function refusalOf(result: {
  readonly applied: boolean;
  readonly rejectionCode: string | null;
}): string | null {
  return result.applied ? null : result.rejectionCode;
}

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
 * `rejectionKey` is a third thing again, and it lives outside the list: it is what the last
 * press actually came back with, so it belongs to the moment rather than to any one control.
 *
 * Every branch here is on a field being `null` or a boolean the parent computed — never on
 * which action this is — and `expectedSnapshot` makes the identical decisions from the
 * identical model fields. `canCompose` and `rejectionKey` produce no text of their own, so
 * neither can move the second hash.
 */
function ActionsBlock({
  actions,
  canCompose,
  rejectionKey,
  onPress
}: {
  readonly actions: readonly AvailableAction[];
  readonly canCompose: boolean;
  readonly rejectionKey: string | null;
  readonly onPress: (action: OfferAction) => void;
}) {
  const text = useText();

  if (actions.length === 0) {
    return null;
  }

  return (
    <div className="actions" data-testid="offer-actions">
      {actions.map((available) => (
        <div className="action" key={available.action}>
          <button
            type="button"
            data-testid={`action-${available.action}`}
            disabled={
              available.disabledReasonKey !== null ||
              (available.action === OfferAction.Compose && !canCompose)
            }
            onClick={() => {
              onPress(available.action);
            }}
          >
            {text(offerActionKey(available.action))}
          </button>

          {available.disabledReasonKey === null ? null : (
            <Label text={text(available.disabledReasonKey)} />
          )}
        </div>
      ))}

      {rejectionKey === null ? null : (
        <p className="rejection" data-testid="offer-rejection">
          {text(rejectionKey)}
        </p>
      )}
    </div>
  );
}

/**
 * A number a player may move, beside the number the package already records.
 *
 * Both, not one: the caption above it shows what the campaign has *recorded*, which is what
 * `expectedSnapshot` describes and what the rendered-UI hash compares — an input's value is
 * a DOM property with no text node behind it, so a screen that replaced the text with a
 * control would have made the recorded term unprovable from the frame. The input is what is
 * being assembled; the text beside it is what stands.
 *
 * `min` and `max` come off the lever, so the control cannot be moved past a bound the engine
 * would refuse — and `disabled` off the same lever's reason, so a locked package is not
 * merely refused after the fact.
 */
function NumberField({
  testId,
  lever,
  value,
  onChange
}: {
  readonly testId: string;
  readonly lever: NumericLever;
  readonly value: number;
  readonly onChange: (value: number) => void;
}) {
  return (
    <input
      type="number"
      className="lever-input"
      data-testid={testId}
      min={lever.min}
      max={lever.max}
      // Every money term of a package is an integer, all the way down to the canonical
      // artifact (`RESOLUTION_SPEC` §4.8), and `step` is what makes the control itself say
      // so — the handler below is the second line of defence, not the only one.
      step={1}
      value={String(value)}
      disabled={lever.disabledReasonKey !== null}
      onChange={(event) => {
        // **`valueAsNumber`, never `parseInt` over the text.** External review found what
        // the difference costs: `input[type=number]` legitimately accepts `1e1` and `1.5`,
        // and `Number.parseInt` reads both as `1` — so a player who typed ten got one, a
        // player who typed one and a half got one, and in each case the package carried a
        // term nobody entered with nothing on screen saying so. The browser's own parse
        // reads `1e1` as ten.
        const typed = event.target.valueAsNumber;

        // Anything that is not a whole number leaves the term where it was: an empty box is
        // `NaN`, and a player midway through clearing a field has not said "nothing"; a
        // fraction is a number this package cannot carry at all. Silence beats a value
        // nobody typed — the last one they did type still stands, and the control shows it.
        if (Number.isInteger(typed)) {
          onChange(typed);
        }
      }}
    />
  );
}

/**
 * A closed set of options a player picks from — one of them, or several.
 *
 * Renders exactly the texts {@link KeyList} did before a handler existed, in the same order,
 * so the second hash sees no difference between a list a player can act on and a list they
 * could only read. What changed is what sits beside each name.
 */
function OptionList({
  captionKey,
  type,
  name,
  prefix,
  options,
  disabled,
  isChosen,
  onToggle
}: {
  readonly captionKey: string;
  readonly type: 'radio' | 'checkbox';
  readonly name: string;
  readonly prefix: string;
  readonly options: readonly ChoiceOption<ContentId>[];
  readonly disabled: boolean;
  readonly isChosen: (value: ContentId) => boolean;
  readonly onToggle: (value: ContentId) => void;
}) {
  const text = useText();

  if (options.length === 0) {
    return null;
  }

  return (
    <div className="key-list">
      <Label text={text(captionKey)} />
      {options.map((option, index) => (
        <label className="option" key={option.value}>
          <input
            type={type}
            name={name}
            // Positional, never the option's own id:  asserts
            // that no content id reaches *any* attribute, not only the ones a player reads,
            // and a hook carrying one would put the raw identifier back on the page through
            // the one door that walk exists to watch.
            data-testid={`${prefix}-option-${String(index)}`}
            checked={isChosen(option.value)}
            disabled={disabled}
            onChange={() => {
              onToggle(option.value);
            }}
          />
          <span className="label">{text(option.labelKey)}</span>
        </label>
      ))}
    </div>
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
  draft,
  onDraft,
  heroDisplayNameKeyOf
}: {
  readonly offer: OfferLine;
  readonly draft: OfferForm;
  readonly onDraft: (next: OfferForm) => void;
  readonly heroDisplayNameKeyOf: (definition: string) => string;
}) {
  const text = useText();

  return (
    <div className="offer">
      <Captioned captionKey={OfferFieldKeys.Version} value={String(offer.version)} />
      <Label text={text(offerPhaseKey(offer.phase))} />

      <div className="row lever">
        <Captioned captionKey={OfferFieldKeys.Advance} value={String(offer.advanceLever.value)} />
        <NumberField
          testId="offer.advance"
          lever={offer.advanceLever}
          value={draft.advance}
          onChange={(advance) => {
            onDraft({ ...draft, advance });
          }}
        />
        <DisabledReason lever={offer.advanceLever} />

        {offer.methodLever.options.length === 0 ? null : (
          <div className="method-options">
            <Label text={text(OfferFieldKeys.Method)} />
            {offer.methodLever.options.map((option, index) => (
              <label className="method-option" key={option.value}>
                <input
                  type="radio"
                  name="offer-method"
                  data-testid={`method-option-${String(index)}`}
                  checked={option.value === draft.methodTag}
                  disabled={offer.methodLever.disabledReasonKey !== null}
                  onChange={() => {
                    onDraft({ ...draft, methodTag: option.value });
                  }}
                />
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
        <NumberField
          testId="offer.promised_bonus"
          lever={offer.bonusLever}
          value={draft.promisedBonus}
          onChange={(promisedBonus) => {
            onDraft({ ...draft, promisedBonus });
          }}
        />
        <DisabledReason lever={offer.bonusLever} />
      </div>

      {/* Both hero levers show every option before they show the choice made out of it:
          a set of alternatives a player cannot see is not a set they can choose from,
          and the crew being part of the package is the whole point of `RESOLUTION_SPEC`
          §2.5. Never gated on emptiness — a roster is never empty on a screen that has a
          contract at all (`contractOfferScreenModel`'s own `Empty` guard). */}
      <OptionList
        captionKey={OfferFieldKeys.KeyHeroOptions}
        type="radio"
        name="offer-key-hero"
        prefix="key-hero"
        options={offer.keyHeroLever.options}
        disabled={offer.keyHeroLever.disabledReasonKey !== null}
        isChosen={(value) => value === draft.keyHero}
        onToggle={(keyHero) => {
          onDraft({ ...draft, keyHero });
        }}
      />

      {offer.keyHeroLever.chosen === null ? null : (
        <Captioned
          captionKey={OfferFieldKeys.KeyHero}
          value={text(heroDisplayNameKeyOf(offer.keyHeroLever.chosen))}
        />
      )}
      <DisabledReason lever={offer.keyHeroLever} />

      <OptionList
        captionKey={OfferFieldKeys.CrewOptions}
        type="checkbox"
        name="offer-crew"
        prefix="crew"
        options={offer.crewLever.options}
        disabled={offer.crewLever.disabledReasonKey !== null}
        isChosen={(value) => draft.invited.includes(value)}
        onToggle={(value) => {
          // Kept in the options' own order rather than in the order they were ticked: the
          // engine sorts the crew into a `SortedSet` anyway (`composeOffer`), so click order
          // is a difference nothing downstream can see — and a list that reordered itself as
          // a player worked would be the same thing the owner rejected for the method
          // alternatives.
          onDraft({
            ...draft,
            invited: offer.crewLever.options
              .map((option) => option.value)
              .filter((candidate) =>
                candidate === value
                  ? !draft.invited.includes(value)
                  : draft.invited.includes(candidate)
              )
          });
        }}
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

/**
 * The 3×3, the order and the threshold (`COMBAT_SPEC` §3.7, §7.2, §7.4).
 *
 * **The board comes from the model.** Nine cells drawn from a loop written here would be a
 * second declaration of §3.1's field, and the two would part company the day the field
 * changes shape.
 *
 * **Nothing is decided here.** Pressing a cell moves a man in the *draft* and nothing else;
 * a man already standing on that cell is turned out of it, because two men on one cell is
 * what `placeCrew` refuses by name (`cell_taken`) and letting a player build that state and
 * then telling him about it is the failure `NEGOTIATION_SPEC` §5.1's dark controls exist to
 * avoid. Everything else the command can refuse — an unplaced hero, a contract with no plan
 * — is left to the engine, whose refusal the player reads.
 */
function FormationBlock({
  deployment,
  draft,
  onChange
}: {
  readonly deployment: DeploymentLine;
  readonly draft: OfferForm;
  readonly onChange: (draft: OfferForm) => void;
}) {
  const text = useText();
  const [holding, setHolding] = useState<ContentId | null>(
    deployment.crew[0]?.heroDefinition ?? null
  );

  const standingOn = (cell: Cell): ContentId | null =>
    Object.entries(draft.placement).find(
      ([, at]) => at.row === cell.row && at.column === cell.column
    )?.[0] as ContentId | null;

  return (
    <div className="formation" data-testid="offer-formation">
      <Label text={text(OfferFieldKeys.Formation)} />

      <div className="formation-crew">
        {deployment.crew.map((slot) => {
          const cell = draft.placement[slot.heroDefinition];

          return (
            <button
              key={slot.heroDefinition}
              type="button"
              data-testid={`formation-hero-${slot.heroDefinition}`}
              aria-pressed={holding === slot.heroDefinition}
              onClick={() => {
                setHolding(slot.heroDefinition);
              }}
            >
              <Label text={text(slot.displayNameKey)} />
              <Label text={text(slot.roleKey)} />
              {cell === undefined ? (
                <Label text={text(OfferFieldKeys.Unplaced)} />
              ) : (
                <>
                  <Label text={text(OfferFieldKeys.Cell)} />
                  <Label text={String(cell.row)} />
                  <Label text={String(cell.column)} />
                </>
              )}
            </button>
          );
        })}
      </div>

      <div className="formation-board" data-testid="formation-board">
        {deployment.cells.map((cell) => (
          <button
            key={`${String(cell.row)}:${String(cell.column)}`}
            type="button"
            data-testid={`formation-cell-${String(cell.row)}-${String(cell.column)}`}
            onClick={() => {
              if (holding === null) {
                return;
              }

              const evicted = standingOn(cell);
              const next = { ...draft.placement, [holding]: cell };

              if (evicted !== null && evicted !== holding) {
                delete next[evicted];
              }

              onChange({ ...draft, placement: next });
            }}
          >
            {String(cell.row)}
          </button>
        ))}
      </div>

      <div className="formation-doctrine">
        <Label text={text(OfferFieldKeys.Doctrine)} />
        {deployment.doctrineLever.options.map((option) => (
          <button
            key={option.value}
            type="button"
            data-testid={`formation-doctrine-${option.value}`}
            aria-pressed={draft.doctrine === option.value}
            onClick={() => {
              onChange({ ...draft, doctrine: option.value });
            }}
          >
            {text(option.labelKey)}
          </button>
        ))}
      </div>

      <label className="formation-retreat">
        <Label text={text(OfferFieldKeys.RetreatBelow)} />
        <input
          type="number"
          data-testid="formation-retreat-below"
          value={draft.retreatBelowPercent}
          onChange={(event) => {
            onChange({ ...draft, retreatBelowPercent: Number(event.target.value) });
          }}
        />
      </label>
    </div>
  );
}
