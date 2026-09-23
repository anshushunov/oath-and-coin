import {
  LeverDisabledKeys,
  OfferFieldKeys,
  OfferAction,
  ScreenKind,
  ScreenState,
  TreasuryFieldKeys,
  errorKey,
  heroOfferRows,
  leverOfRefusal,
  screenStateKey,
  type ContentId,
  type ContractOfferScreenModel,
  type HeroCard
} from '@oath-and-coin/presentation';

import type { SessionController } from '@oath-and-coin/application';
import { useState } from 'react';

import { useText } from '../../text.tsx';
import { Columns } from '../../ui/layout.tsx';

import { Captioned, Label } from '../labels.tsx';

import { ActionsBlock } from './actions-block.tsx';
import { ContractBlock } from './contract-block.tsx';
import { FormationBlock } from './formation-block.tsx';
import { HeroRow } from './hero-row.tsx';
import { OfferBlock } from './offer-block.tsx';
import type { OfferForm } from './offer-form.ts';
import { OfferSummary, PackageBand, Tally } from './package-band.tsx';
import type { Refusal } from './refusal.tsx';
import { SettlementBlock } from './settlement-block.tsx';

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
 * visits them in the same order a column would.
 *
 * **Layout Б of the kit's relayout (spec §4).** The package is across the top: a narrow
 * summary row — contract, count, treasury — pinned while the page scrolls, and under it, in
 * the ordinary flow, the band of levers, promise and the ladder of commands
 * (`package-band.tsx`; the owner's decision of 2026-09-23). The squad below them is one card
 * per hero with his own answer on it, two cards to a line. The pairing and the
 * "refusals first" order are `heroOfferRows`'s: both are decisions on the *value* of an
 * answer, which this component is not allowed to make, so it only maps the list it is
 * handed. The squad used to be two columns — every card, then every answer — joined by name
 * across the page, and that is what the owner could not read.
 *
 * The one screen-state text is the "being edited" mark on the count ({@link Tally}): it
 * exists only while the form holds terms the package does not record, so a render of the
 * model alone — which is what both hashes compare — never carries it.
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
  // Where the last refusal stands: beside the lever it names, or — when it names none —
  // beside the button that was pressed. Decided once, here, from the model's own answer
  // (`leverOfRefusal`), so that every block below branches only on whether the refusal it
  // was handed is `null`.
  const refusedLever =
    form.refusal === null ? null : leverOfRefusal(form.refusal.action, form.refusal.key);
  const leverRefusal =
    form.refusal === null || refusedLever === null
      ? null
      : { lever: refusedLever, key: form.refusal.key };
  const buttonRefusal = form.refusal !== null && refusedLever === null ? form.refusal : null;

  // The count goes quiet while the form holds terms the package does not record — and only
  // then: a refused `compose` leaves the draft where it was but takes the mark off, because
  // the refusal is now what the screen has to say about those terms (spec §4.2). Another
  // command refused says nothing about the typed terms, so the mark stays. And a package the
  // model says cannot be recomposed has no "being edited" state at all — the typed terms can
  // never become it, and the dark `compose` below already says why.
  const stale =
    form.refusal?.action !== OfferAction.Compose &&
    canRecompose(model) &&
    isEditing(form.draft, model);
  const hasSummary = model.contract !== null || showTreasury;
  const hasBand =
    model.offer !== null || model.promiseTerms !== null || model.availableActions.length > 0;

  return (
    <section className="contract-offer" data-testid="contract-offer-screen">
      <Label text={text(model.titleKey)} />
      <Label text={text(screenStateKey(model.state))} />

      {model.errorCode === null ? null : <Label text={text(errorKey(model.errorCode))} />}

      {hasSummary ? (
        <OfferSummary>
          {model.contract === null ? null : <ContractBlock contract={model.contract} />}
          {model.contract === null ? null : (
            <Tally contract={model.contract} answered={model.responses.length > 0} stale={stale} />
          )}

          {/* The treasury and what the deal would leave (`NEGOTIATION_SPEC` §5.1's own "цена
              уступки, видна до подтверждения"): in the pinned row, so the price of every
              term below it — the promise included — is on screen wherever that term is. */}
          {showTreasury ? (
            <div className="row treasury">
              <Captioned captionKey={TreasuryFieldKeys.Treasury} value={String(model.treasury)} />
              <Captioned
                captionKey={TreasuryFieldKeys.Forecast}
                value={String(model.treasuryForecast)}
                testId="treasury-forecast"
              />
            </div>
          ) : null}
        </OfferSummary>
      ) : null}

      {hasBand ? (
        <PackageBand>
          {model.offer === null ? null : (
            <OfferBlock
              offer={model.offer}
              draft={form.draft}
              onDraft={(draft) => {
                // A keystroke clears the last refusal: it was about the package as it stood,
                // and the package has just changed.
                setForm({ ...form, draft, refusal: null });
              }}
              heroDisplayNameKeyOf={heroDisplayNameKeyOf}
              refusal={leverRefusal}
            />
          )}

          {/* The promise, under the levers that set its bonus. */}
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

          <ActionsBlock
            actions={model.availableActions}
            composeBlockedBy={composeBlockedBy(form.draft, model)}
            refusal={buttonRefusal}
            onPress={(action) => {
              const key = press(controller, action, form.draft, model, onBattle);

              setForm({ ...form, refusal: key === null ? null : { action, key } });
            }}
          />
        </PackageBand>
      ) : null}

      {/* The squad, one card per hero with his own answer on it, refusals first — the
          order and the pairing are `heroOfferRows`'s, not this component's. */}
      {model.roster.length === 0 ? null : (
        <Columns>
          {heroOfferRows(model).map((row) => (
            <HeroRow key={row.hero.definition} row={row} />
          ))}
        </Columns>
      )}

      {model.settlement === null ? null : (
        <SettlementBlock
          settlement={model.settlement}
          heroDisplayNameKeyOf={heroDisplayNameKeyOf}
        />
      )}

      {model.deployment === null ? null : (
        <FormationBlock
          deployment={model.deployment}
          draft={form.draft}
          onChange={(draft) => {
            // The same rule as `onDraft` above: a move on the board, the doctrine or the
            // threshold clears the last refusal, which was about the formation as it stood.
            setForm({ ...form, draft, refusal: null });
          }}
          refusal={leverRefusal}
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
    </section>
  );
}

/**
 * Whether the model lets this package be composed again — its own answer for `compose`,
 * read as a `null` reason and never worked out here from the phase: a locked package whose
 * crew has not filled is still revisable (`offer-actions.ts`, `composeRefusal`).
 */
function canRecompose(model: ContractOfferScreenModel): boolean {
  return model.availableActions.some(
    (available) => available.action === OfferAction.Compose && available.disabledReasonKey === null
  );
}

/**
 * Whether the form holds terms the package does not record — the half of the draft that
 * `compose` sends, compared against what the model says the package already is.
 *
 * The formation half is left out on purpose: placing the crew is its own command, and
 * moving a man on the board does not change what the squad was asked about.
 */
function isEditing(draft: OfferForm, model: ContractOfferScreenModel): boolean {
  const recorded = formFor(model).draft;

  return (
    draft.advance !== recorded.advance ||
    draft.promisedBonus !== recorded.promisedBonus ||
    draft.methodTag !== recorded.methodTag ||
    draft.keyHero !== recorded.keyHero ||
    // As sets: the form keeps the crew in the options' order and the package in its own,
    // and a hero ticked off and on again has changed nothing about who is asked.
    draft.invited.length !== recorded.invited.length ||
    draft.invited.some((hero) => !recorded.invited.includes(hero))
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
  readonly refusal: Refusal | null;
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
    refusal: null
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
/**
 * Why the draft cannot be recorded yet, or `null` when it can.
 *
 * **A reason and not a boolean, and the difference is what the owner ran into.** The first
 * edition answered yes or no, so the one control that starts the whole loop went dark
 * without a word while the other six explained themselves — `composeOffer` would accept an
 * unfinished draft, so the engine's own refusal is `null` and there was nothing to print.
 * A player who opens the build sees seven dark buttons and no way to learn which one is
 * waiting on him.
 *
 * The order is the order a person fills the form in: name somebody first, then decide who
 * goes with him.
 */
function composeBlockedBy(draft: OfferForm, model: ContractOfferScreenModel): string | null {
  if (draft.keyHero === null) {
    return LeverDisabledKeys.NoKeyHero;
  }

  return draft.invited.length === (model.offer?.crewLever.exactly ?? 0)
    ? null
    : LeverDisabledKeys.CrewNotChosen;
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
