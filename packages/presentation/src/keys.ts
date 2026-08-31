/**
 * Every localization key the two screens can produce, and nothing that resolves one.
 *
 * `TDD` §11.1: no player-facing string is assembled in code and no raw identifier
 * reaches a label. This module is the whole vocabulary of keys the contract-offer
 * screen and the save-slots screen need, so a caller never builds one by hand — the
 * failure that rule exists to prevent is a key spelled two ways in two places, where
 * the catalogue has one of them and the screen shows the other.
 *
 * One module rather than the C# original's eight files. That split followed C#'s
 * one-public-type-per-file convention, not a boundary: every builder here answers the
 * same question, and the lists they export are read together by one completeness
 * check.
 *
 * Two lists that exist in C# are missing here on purpose, and both are named in the
 * segment plan (§1.2): `ERROR_CODES` lives in `packages/content`, which this package
 * may not import, so {@link errorKey} is a function without a list beside it, and the
 * completeness check builds that list in `tests/locale` from the content-side
 * constant. The alternative — copying the five codes here — would be a second
 * declaration of a closed set with nothing to check it against.
 */

import {
  ACTIONS,
  BATTLE_OUTCOMES,
  COMBAT_ACTIONS,
  COMBAT_ROLES,
  CommitmentState,
  ConsequenceKind,
  CoverageVerdict,
  DOCTRINE_IDS,
  DeficitKind,
  NEED_IDS,
  OfferPhase,
  OutcomeGrade,
  RejectionCodes,
  STATUS_IDS,
  contentIdName,
  contentIdNamespace,
  type BattleOutcome,
  type CombatAction,
  type CombatRole,
  type ContentId,
  type DoctrineId,
  type NeedId,
  type StatusId
} from '@oath-and-coin/simulation';

import { CONTRACT_AVAILABILITIES, type ContractAvailability } from './contract-availability.ts';
import { OFFER_ACTIONS, type OfferAction } from './offer-actions.ts';
import { ReasonDirection, ScreenState, REASON_DIRECTIONS, SCREEN_STATES } from './screen-state.ts';

/** This screen's title. A key, not text — nothing in this package resolves one. */
export const TITLE_KEY = 'screen.contract_offer.title';

/**
 * The debrief screen's title, and the board's (`RESOLUTION_SPEC` §6.1, §6.4).
 *
 * Each its own key rather than one shared "title", for the reason
 * {@link SAVES_TITLE_KEY} is separate from {@link TITLE_KEY}: a text that had to name
 * three screens at once would name none of them.
 */
export const AFTER_ACTION_TITLE_KEY = 'screen.after_action.title';
export const CONTRACT_BOARD_TITLE_KEY = 'screen.contract_board.title';
export const BATTLE_TITLE_KEY = 'screen.battle.title';

/**
 * A content tag's key (`target:cult` → `tag.target.cult`).
 *
 * A tag is a category, not a named entity: nothing in content authors a display name
 * for one, so unlike a hero or a contract there is no authored key to carry along and
 * the key is built from the id by a fixed convention instead.
 */
export function tagKey(tag: ContentId): string {
  return `tag.${contentIdNamespace(tag)}.${contentIdName(tag)}`;
}

/**
 * A contract's display-name key (`core:escort_the_caravan` →
 * `contract.core.escort_the_caravan.name`).
 *
 * Content follows this convention for every shipped contract's own authored
 * `display_name_key`, but `ContractState` — unlike `HeroState`, which carries its own
 * key — never copied it from content into state, so there is nothing on the state
 * this package reads to carry it faithfully. Rebuilding it from the convention is
 * what the C# original did, with the same caveat: an author who spells a key
 * differently fails the catalogue-completeness check loudly rather than shipping a
 * screen that shows an untranslated key.
 */
export function contractDisplayNameKey(id: ContentId): string {
  return `contract.${contentIdNamespace(id)}.${contentIdName(id)}.name`;
}

/**
 * A trait's display-name key. `HeldTrait` — the only shape of a trait this package
 * ever sees, because `ADR-002` keeps the content-side definition out of state — has
 * an id and no authored display key, exactly like a contract.
 *
 * Built from the trait's own id, never from its tag: a tag is what a *contract*
 * latches onto (`HERO_DECISION_SPEC` §1.1), so reusing it here would name a hero's
 * principle after the category it reacts to ("Temple") rather than the principle
 * itself ("will not strike a temple").
 */
export function traitDisplayNameKey(id: ContentId): string {
  return `trait.${contentIdNamespace(id)}.${contentIdName(id)}.name`;
}

/**
 * An action's key (`action:accept` → `action.accept`).
 *
 * A response line carries the action's own wire text rather than a parsed id (see
 * the read model), so this splits the same `namespace:name` shape rather than reusing
 * {@link tagKey}, which takes a typed id.
 */
export function actionKey(action: string): string {
  return action.replace(':', '.');
}

/**
 * Every key {@link actionKey} can produce, derived from the engine's own closed list
 * rather than naming the two actions again — a third action cannot arrive in the core
 * and quietly go unchecked against the catalogue.
 */
export const ACTION_KEYS: readonly string[] = Object.freeze(ACTIONS.map(actionKey));

/**
 * A stable error code's key (`CONTENT_ROOT_NOT_FOUND` → `error.content_root_not_found`).
 *
 * A stable code is exactly as much a raw identifier as a content id, and `TDD` §11.1
 * makes no exception for it.
 */
export function errorKey(errorCode: string): string {
  return `error.${errorCode.toLowerCase()}`;
}

/** Which of the five shapes the screen is in — shown on every state, right after the title. */
export function screenStateKey(state: ScreenState): string {
  return `screen.contract_offer.state.${state.toLowerCase()}`;
}

export const SCREEN_STATE_KEYS: readonly string[] = Object.freeze(
  SCREEN_STATES.map(screenStateKey)
);

/**
 * The keys `wavered` resolves to. A bare `true`/`false` reaching a label is
 * code-composed, unlocalized player-facing text regardless of locale.
 */
export const WAVERED_TRUE_KEY = 'response.wavered.true';
export const WAVERED_FALSE_KEY = 'response.wavered.false';

export function waveredKey(wavered: boolean): string {
  return wavered ? WAVERED_TRUE_KEY : WAVERED_FALSE_KEY;
}

export const WAVERED_KEYS: readonly string[] = Object.freeze([WAVERED_TRUE_KEY, WAVERED_FALSE_KEY]);

/** The keys a reason's direction resolves to — the same treatment, for the same reason. */
export function reasonDirectionKey(direction: ReasonDirection): string {
  return `reason.direction.${direction.toLowerCase()}`;
}

export const REASON_DIRECTION_KEYS: readonly string[] = Object.freeze(
  REASON_DIRECTIONS.map(reasonDirectionKey)
);

/**
 * The key naming each field the screen shows, so a value that is a bare number or a
 * bare qualitative grade says what it is a number or a grade *of*.
 *
 * External review of the C# screen found what their absence costs: on the captured
 * frame the texts `40`, `4`, `3` and a run of "Умеренно / Слабо / Умеренно" stood one
 * under another with nothing to say which was the patron fee, which the crew, and which
 * of greed, caution and pride each grade belonged to. Both hashes were green
 * throughout, and correctly so — they compare the texts the model produced, and every
 * one of those was the right text for its field.
 *
 * A caption is its own label beside the value, never `caption + ': ' + value`
 * composed in code: the punctuation and word order between a caption and its value
 * differ by language, so the colon lives in the catalogue with the words.
 */
export const FieldKeys = Object.freeze({
  ContractPatronFee: 'field.contract.patron_fee',
  ContractRisk: 'field.contract.risk',
  ContractRequiredCrew: 'field.contract.required_crew',
  ContractAcceptedCount: 'field.contract.accepted_count',
  ContractTags: 'field.contract.tags',

  HeroGreed: 'field.hero.greed',
  HeroCaution: 'field.hero.caution',
  HeroPride: 'field.hero.pride',
  HeroPrinciples: 'field.hero.principles',
  HeroInclinations: 'field.hero.inclinations',

  ReasonStrength: 'field.reason.strength',
  ResponseBlockedBy: 'field.response.blocked_by'
});

/**
 * Every caption above. Derived from the frozen object, which is as close to a closed
 * set as this one gets: these are not the members of an enum, so there is nothing
 * else to derive them from, but `Object.values` still beats a second hand-written
 * list that could disagree with the first.
 */
export const FIELD_KEYS: readonly string[] = Object.freeze(Object.values(FieldKeys));

/**
 * The two keys `promiseTerms` resolves to (`NEGOTIATION_SPEC` §5.1, §5.2): what counts
 * as keeping the guild's word and what counts as breaking it. Interface text, not
 * content's — the predicate belongs to the screen, not to any one contract — so both
 * keys are fixed rather than built from a contract's own identifier the way
 * {@link contractDisplayNameKey} is.
 */
export const PromiseTermsKeys = Object.freeze({
  Fulfil: 'offer.promise.fulfil',
  Breach: 'offer.promise.breach'
});

export const PROMISE_TERMS_KEYS: readonly string[] = Object.freeze(Object.values(PromiseTermsKeys));

/**
 * Which of the offer's three phases it is in (`NEGOTIATION_SPEC` §2.1) — its own key
 * per phase, shown right beside {@link screenStateKey}'s answer: state says "is there
 * something to show", phase says "where the negotiation is", and neither can stand in
 * for the other.
 */
export function offerPhaseKey(phase: OfferPhase): string {
  return `offer.phase.${phase}`;
}

/**
 * Every key {@link offerPhaseKey} can produce, derived from the engine's own closed
 * `OfferPhase` rather than the three strings typed again — a fourth phase cannot
 * arrive in the core and quietly go unchecked against the catalogue.
 */
export const OFFER_PHASE_KEYS: readonly string[] = Object.freeze(
  Object.values(OfferPhase).map((phase) => offerPhaseKey(phase))
);

/**
 * The captions the negotiation package shows (`NEGOTIATION_SPEC` §5.1) — the same
 * treatment {@link FieldKeys} gives the contract and the roster, for the same reason: a
 * bare `40` beside a bare `25` says nothing about which is the advance and which the
 * promised bonus.
 *
 * A second object rather than three more members on {@link FieldKeys}: that object's
 * own values are frozen into `content/locale/ru.json` (`ADR-012` grandfathered them
 * there before the interface catalogue existed), and `content/locale/ru.json` is
 * itself frozen (`tests/locale/catalogue.test.ts`'s `FROZEN_CONTENT_KEY_COUNT`) — a
 * negotiation caption belongs in `ui-text/ru.json` like every other text this task
 * invents, and {@link FIELD_KEYS} feeding `everyKeyTheScreenCanShow()`'s content-side
 * completeness check is exactly the check a new member here must not trip.
 *
 * `KeyHero` is shared between {@link OfferLine.keyHeroDefinition} and
 * {@link SettlementLine.keyHeroDefinition}, and `PromisedBonus` between
 * {@link OfferLine.promisedBonus}, {@link PromiseTermsLine.bonus} and
 * {@link SettlementLine.promisedBonus}: all three name the same fact at different
 * points in the negotiation's lifecycle, and a second caption for the same fact would
 * be a second declaration of one word.
 *
 * `SelectedMethod` exists beside `Method` rather than instead of it, and the
 * distinction is load-bearing. `Method` captions the *group* — both alternatives a
 * negotiable contract offers, `OfferLine.methodOptionKeys` — and which one is
 * currently chosen is otherwise visible only as a radio's `checked` state, which no
 * walk over rendered *text* (`collectRenderedTexts`, `expectedSnapshot`) can see at
 * all. `SelectedMethod` projects `OfferLine.methodTagKey` itself as a second, ordinary
 * `Captioned` value, so the choice a player made is provable by the same mechanism
 * every other field on this screen already is, not only by inspecting a DOM property
 * a snapshot cannot reach.
 */
export const OfferFieldKeys = Object.freeze({
  Version: 'field.offer.version',
  Advance: 'field.offer.advance',
  Method: 'field.offer.method',
  SelectedMethod: 'field.offer.method_selected',
  PromisedBonus: 'field.offer.promised_bonus',
  KeyHero: 'field.offer.key_hero',
  KeyHeroOptions: 'field.offer.key_hero_options',
  Crew: 'field.offer.crew',
  CrewOptions: 'field.offer.crew_options',
  CrewSize: 'field.offer.crew_size',
  BudgetAvailable: 'field.offer.budget_available',
  MaxAdvance: 'field.offer.max_advance',
  MaxBonus: 'field.offer.max_bonus',
  Shortfall: 'field.offer.shortfall',
  LockCommitment: 'field.offer.lock_commitment',
  /**
   * The formation block (`COMBAT_SPEC` §3.7), which lives on the package because it is
   * decided before the crew leaves and not at the moment of sending.
   */
  Formation: 'field.offer.formation',
  Cell: 'field.offer.cell',
  Unplaced: 'field.offer.unplaced',
  Doctrine: 'field.offer.doctrine',
  RetreatBelow: 'field.offer.retreat_below',
  /**
   * The forecast, said before the crew goes (`COMBAT_SPEC` §10.1).
   *
   * Its own captions rather than the debrief's: over there the same three words are what
   * *happened*, here they are what is *expected*, and one text describing both would say
   * neither. The column heading on the debrief is `AfterActionFieldKeys.Promised`.
   */
  Forecast: 'field.offer.forecast',
  ForecastObjectives: 'field.offer.forecast_objectives',
  ForecastReasons: 'field.offer.forecast_reasons',
  ForecastColumn: 'field.offer.forecast_column'
});

export const OFFER_FIELD_KEYS: readonly string[] = Object.freeze(Object.values(OfferFieldKeys));

/**
 * Why a package's levers cannot be moved right now (`NEGOTIATION_SPEC` §3.1's table).
 *
 * Two keys, not one, because the two sentences are different and the difference is the
 * one a player has to act on: a locked, crewed package is a deal already struck and the
 * next move is to send the crew out; a settled one is finished and the money has moved.
 * `composeOffer` refuses both with the same code, which is why the *screen's* vocabulary
 * has to be finer than the engine's — a text that covered both would say neither.
 *
 * There is deliberately no key for "locked, crew unfilled": that is not disabled at all.
 * `RESOLUTION_SPEC` §6.2 makes a new version legal exactly there, and it is the only way
 * out of a package a declining invitee has stranded.
 */
export const LeverDisabledKeys = Object.freeze({
  Locked: 'offer.locked',
  Settled: 'offer.settled'
});

export const LEVER_DISABLED_KEYS: readonly string[] = Object.freeze(
  Object.values(LeverDisabledKeys)
);

/**
 * What each of the six protocol commands is called on a control (`NEGOTIATION_SPEC` §3.1,
 * `RESOLUTION_SPEC` §3.1) — `compose` → `action.offer.compose`.
 *
 * Built from the action's own member by a fixed convention, the way {@link offerPhaseKey}
 * is, so a seventh command cannot arrive in the protocol and quietly go unchecked against
 * the catalogue.
 *
 * Its own prefix rather than {@link actionKey}'s: that one names what a *hero* answered
 * (`action.accept`), and these name what the *guild* does. One namespace for both would put
 * "accepted" and "record the terms" under one heading, and the two are not the same kind of
 * thing at all.
 */
export function offerActionKey(action: OfferAction): string {
  return `action.offer.${action}`;
}

export const OFFER_ACTION_KEYS: readonly string[] = Object.freeze(
  OFFER_ACTIONS.map(offerActionKey)
);

/**
 * Every refusal a dark control can name.
 *
 * The engine's own closed vocabulary, and its members are already dotted lowercase — so a
 * `RejectionCodes` value *is* a localization key, exactly as a `ReasonCodes` value already
 * is on a response line. Nothing here builds one; this list exists so the completeness
 * check knows which texts the interface owes (`ADR-012`: the code is the engine's, the
 * sentence a player reads is the screen's).
 */
export const REJECTION_KEYS: readonly string[] = Object.freeze(Object.values(RejectionCodes));

/**
 * The captions for the two campaign-wide money facts (`NEGOTIATION_SPEC` §2.3, §5.1):
 * the treasury as it stands, and what it would read after settling the contract on
 * screen and keeping the word (`ContractOfferScreenModel.treasuryForecast`) — Crusader
 * Kings III's "price of a concession, visible before it is signed".
 */
export const TreasuryFieldKeys = Object.freeze({
  Treasury: 'field.treasury',
  Forecast: 'field.treasury_forecast'
});

export const TREASURY_FIELD_KEYS: readonly string[] = Object.freeze(
  Object.values(TreasuryFieldKeys)
);

/**
 * The captions {@link SettlementLine} needs beyond {@link OfferFieldKeys.PromisedBonus}
 * and {@link OfferFieldKeys.KeyHero}, which it shares: the crew bound by the promise,
 * and the two outcomes `settleContract` can produce.
 */
export const SettlementFieldKeys = Object.freeze({
  Crew: 'field.settlement.crew',
  TreasuryIfKept: 'field.settlement.treasury_if_kept',
  TreasuryIfBroken: 'field.settlement.treasury_if_broken'
});

export const SETTLEMENT_FIELD_KEYS: readonly string[] = Object.freeze(
  Object.values(SettlementFieldKeys)
);

/**
 * What `settleContract` is called on the controls that dispatch it — the debrief's, and
 * only the debrief's.
 *
 * `ContractOfferScreen` renders none of them, and that is the owner's decision of
 * 2026-08-28 rather than an omission: answering a promise is a choice between two prices,
 * both of which are on the debrief (`RESOLUTION_SPEC` §6.1), so the offer screen's own
 * settle control moves the player there instead of paying blind. These keys were reserved
 * for "whichever task first draws a control that dispatches the command", and this is it.
 *
 * **Three, because a package that promised nothing offers no choice at all.**
 * `settleContract` ignores `pay` when `promisedBonus` is `0` (`NEGOTIATION_SPEC` §6), so
 * "Выплатить" and "Отказаться платить" would there be two labels over one outcome — the
 * fictional decision external review of this task found on a shipped scenario
 * (`resolution-fitting-crew-wins` resolves a package with no promise). `Settle` is what a
 * screen offers instead: one command, named for what it does.
 */
export const SettlementActionKeys = Object.freeze({
  Pay: 'settlement.pay',
  Refuse: 'settlement.refuse',
  Settle: 'settlement.settle'
});

export const SETTLEMENT_ACTION_KEYS: readonly string[] = Object.freeze(
  Object.values(SettlementActionKeys)
);

/**
 * What each answer to the promise costs beyond the money (`NEGOTIATION_SPEC` §2.2, §3.3),
 * one sentence per consequence the engine will actually apply.
 *
 * **Not a forecast, and that is why they are fixed texts rather than numbers.** `DEC-006`
 * keeps predictions qualitative; what these say is which *kind* of thing happens — the key
 * hero stops believing the guild's word, he and every witness carry a grievance — while the
 * sizes are `grievanceForBrokenPromise`'s and belong to the moment the command applies. A
 * screen quoting a grievance figure would be publishing an engine constant as a promise.
 *
 * Three keys and not two, because breaking a word does two separate things to one man and a
 * single sentence covering both would name whichever the writer thought mattered more.
 *
 * The kept branch has one, and it says only what keeping the word *does*: the bonus leaves,
 * and no grievance comes of this promise. It deliberately does not say that nobody is
 * aggrieved — external review caught that claim, and `settleContract` does not support it:
 * `pay: true` touches no `HeroState` at all, so a man carrying a grievance from a word
 * broken earlier still carries it afterwards.
 */
export const SettlementConsequenceKeys = Object.freeze({
  Kept: 'settlement.consequence.kept',
  BrokenGrievance: 'settlement.consequence.broken_grievance',
  BrokenDisbelief: 'settlement.consequence.broken_disbelief'
});

export const SETTLEMENT_CONSEQUENCE_KEYS: readonly string[] = Object.freeze(
  Object.values(SettlementConsequenceKeys)
);

/** The save-slots screen's title. Its own key, not a second use of {@link TITLE_KEY}. */
export const SAVES_TITLE_KEY = 'screen.saves.title';

/**
 * What the one link between the two screens is called, from each side.
 *
 * Two keys rather than one "switch screens", because what the button offers is different
 * from each side and a text that covered both would name neither.
 */
export const ScreenLinkKeys = Object.freeze({
  OpenSaves: 'screen.saves.open',
  OpenContractOffer: 'screen.contract_offer.open',
  /**
   * Leaving a finished fight for its debrief (`COMBAT_SPEC` §10.2 → §10.3).
   *
   * A screen link rather than one of the battle screen's own controls, and for the reason
   * every link is one: the rendered-UI snapshot is collected from the screen element, and a
   * control that navigates *away* from a screen must not be part of that screen's evidence.
   */
  OpenAfterAction: 'screen.after_action.open'
});

export const SCREEN_LINK_KEYS: readonly string[] = Object.freeze(Object.values(ScreenLinkKeys));

/**
 * Which of the five shapes the slots screen is in — its own key per state, never
 * {@link screenStateKey}'s.
 *
 * The five words are the same five and the sentences are not: `Incomplete` on the
 * contract screen is a hero who has not answered yet, and here it is a slot that
 * refused to be read. One key for both would force one text to describe both, and the
 * text that does is the one that says nothing.
 */
export function saveSlotsStateKey(state: ScreenState): string {
  return `screen.saves.state.${state.toLowerCase()}`;
}

export const SAVE_SLOTS_STATE_KEYS: readonly string[] = Object.freeze(
  SCREEN_STATES.map(saveSlotsStateKey)
);

/**
 * A slot's own name, its "save here" action and its "load this" action
 * (`slot-a` → `save.slot.slot_a.name`).
 *
 * The hyphen becomes an underscore, the same substitution {@link actionKey} makes for a
 * colon and for the same reason: a slot name is a wire identifier and a localization key
 * is not. The catalogue's grammar admits `[a-z0-9_]` between dots and nothing else
 * (`packages/content`'s `LOCALIZATION_KEY_PATTERN`, which this package may not import),
 * so a key built with the hyphen left in is a key the loader refuses outright — which is
 * how this was found rather than shipped.
 *
 * Three keys per slot rather than one name plus two shared verbs, because a shared
 * verb would have to be composed with the name to say which slot it acts on — and
 * composing player-facing text in code is what `TDD` §11.1 forbids. Three buttons all
 * reading "Сохранить" is also the one thing a screen reader cannot tell apart.
 *
 * Built from the slot's own string by a fixed convention, the same way
 * {@link contractDisplayNameKey} is: this layer is handed slot names and does not know
 * the closed set they come from — `SAVE_SLOTS` is `packages/application`'s, which this
 * package may not import — so the check that the catalogue answers all nine keys lives
 * in `tests/locale`, which may see both sides.
 */
export function saveSlotDisplayNameKey(slot: string): string {
  return `save.slot.${keySegment(slot)}.name`;
}

export function saveSlotSaveKey(slot: string): string {
  return `save.slot.${keySegment(slot)}.save`;
}

export function saveSlotLoadKey(slot: string): string {
  return `save.slot.${keySegment(slot)}.load`;
}

/** A slot name as one segment of a localization key: `slot-a` → `slot_a`. */
function keySegment(slot: string): string {
  return slot.replaceAll('-', '_');
}

/**
 * What a slot line's status says, as one of three keys.
 *
 * Its own line rather than left implicit in which fields are populated: an empty slot
 * would otherwise be a line with a name and nothing under it, which reads as a screen
 * that failed to draw rather than as a slot a player may write to.
 */
export const SaveSlotStatusKeys = Object.freeze({
  Empty: 'save.slot.status.empty',
  Occupied: 'save.slot.status.occupied',
  Unreadable: 'save.slot.status.unreadable'
});

export const SAVE_SLOT_STATUS_KEYS: readonly string[] = Object.freeze(
  Object.values(SaveSlotStatusKeys)
);

/**
 * The captions on the slots screen, for the same reason {@link FieldKeys} exists: the
 * three facts a slot line shows literally are a timestamp, an integer and a contract,
 * and a column of those three with nothing naming them is the defect external review
 * found on the Godot frame.
 *
 * `created_at` is shown exactly as the file recorded it, ISO-8601, and is deliberately
 * not formatted for a locale: `toLocaleString` answers differently per machine and per
 * time zone, so a frame taken as evidence would stop being comparable with the next
 * one taken anywhere else.
 */
export const SaveFieldKeys = Object.freeze({
  SaveCreatedAt: 'field.save.created_at',
  SaveLogicalTime: 'field.save.logical_time',
  SaveContract: 'field.save.contract'
});

export const SAVE_FIELD_KEYS: readonly string[] = Object.freeze(Object.values(SaveFieldKeys));

/**
 * The confirmation in front of overwriting an occupied slot (design spec §3.1).
 *
 * Keys rather than model fields, and that is the one thing on this screen the model
 * does not decide: whether a confirmation is currently being asked is interface state —
 * it belongs to the moment between two clicks and to no slot's contents — so it lives
 * where that moment does, in the component, and only its vocabulary is stated here.
 */
export const SaveOverwriteKeys = Object.freeze({
  Question: 'save.overwrite.question',
  Confirm: 'save.overwrite.confirm',
  Cancel: 'save.overwrite.cancel'
});

export const SAVE_OVERWRITE_KEYS: readonly string[] = Object.freeze(
  Object.values(SaveOverwriteKeys)
);

/**
 * The captions the debrief shows, for the reason {@link FieldKeys} exists: a column of bare
 * numbers — what a man brought, how much counted, how big a deficit was, what the patron
 * pays — says nothing about which is which. Its own object rather than more members on
 * {@link FieldKeys}, because that object's values are frozen inside `content/locale/ru.json`
 * and every text this screen invents belongs in `ui-text/` (`ADR-012`).
 */
export const AfterActionFieldKeys = Object.freeze({
  Grade: 'field.after_action.grade',
  Events: 'field.after_action.events',
  Contributions: 'field.after_action.contributions',
  Brought: 'field.after_action.brought',
  Counted: 'field.after_action.counted',
  Commitment: 'field.after_action.commitment',
  Provenance: 'field.after_action.provenance',
  Coverage: 'field.after_action.coverage',
  Deficits: 'field.after_action.deficits',
  DeficitMagnitude: 'field.after_action.deficit_magnitude',
  Dominant: 'field.after_action.dominant',
  Consequences: 'field.after_action.consequences',
  ConsequenceMagnitude: 'field.after_action.consequence_magnitude',
  PatronPays: 'field.after_action.patron_pays',
  /** The new column of `COMBAT_SPEC` §10.3: what the forecast said before the crew went. */
  Promised: 'field.after_action.promised',
  /** The new section of §10.3: the battle's own feed, and the two facts about the fight. */
  Battle: 'field.after_action.battle',
  BattleOutcome: 'field.after_action.battle_outcome',
  Rounds: 'field.after_action.rounds',
  RetreatSignalled: 'field.after_action.retreat_signalled'
});

export const AFTER_ACTION_FIELD_KEYS: readonly string[] = Object.freeze(
  Object.values(AfterActionFieldKeys)
);

/** The two captions a board row needs beyond the ones the offer screen already names. */
export const ContractBoardFieldKeys = Object.freeze({
  Needs: 'field.board.needs',
  Availability: 'field.board.availability'
});

export const CONTRACT_BOARD_FIELD_KEYS: readonly string[] = Object.freeze(
  Object.values(ContractBoardFieldKeys)
);

/**
 * The step an outcome landed on (`RESOLUTION_SPEC` §4.6) — one key per grade, built from
 * the engine's own closed vocabulary rather than the four words typed again.
 */
export function outcomeGradeKey(grade: OutcomeGrade): string {
  return `outcome.grade.${grade}`;
}

export const OUTCOME_GRADE_KEYS: readonly string[] = Object.freeze(
  Object.values(OutcomeGrade).map((grade) => outcomeGradeKey(grade))
);

/**
 * What a contract asks for, by name (`RESOLUTION_SPEC` §2.3).
 *
 * `NeedId` is a closed *engine* vocabulary — an author writes a weight, never a need — so
 * unlike a contract or a trait there is no authored display name to carry along, and the
 * key is built from the id by a fixed convention the way {@link tagKey} is. The texts
 * therefore belong to `ui-text/` and not to `content/locale/` (`ADR-012`): nothing under
 * `content/` invents them.
 */
export function needKey(need: NeedId): string {
  return `need.${need}`;
}

export const NEED_KEYS: readonly string[] = Object.freeze(NEED_IDS.map(needKey));

/** How one need came out, as one of three words (`RESOLUTION_SPEC` §4.3). */
export function coverageVerdictKey(verdict: CoverageVerdict): string {
  return `outcome.verdict.${verdict}`;
}

export const COVERAGE_VERDICT_KEYS: readonly string[] = Object.freeze(
  Object.values(CoverageVerdict).map((verdict) => coverageVerdictKey(verdict))
);

/**
 * How willingly one hero came (`RESOLUTION_SPEC` §2.4) — the sentence beside his two
 * numbers on the debrief (`DEC-014`).
 */
export function commitmentStateKey(commitment: CommitmentState): string {
  return `commitment.${commitment}`;
}

export const COMMITMENT_STATE_KEYS: readonly string[] = Object.freeze(
  Object.values(CommitmentState).map((commitment) => commitmentStateKey(commitment))
);

/** Which of the three ways the crew came up short this diagnosis is (`RESOLUTION_SPEC` §4.7). */
export function deficitKindKey(kind: DeficitKind): string {
  return `outcome.deficit.${kind}`;
}

export const DEFICIT_KIND_KEYS: readonly string[] = Object.freeze(
  Object.values(DeficitKind).map((kind) => deficitKindKey(kind))
);

/** What the outcome cost one person (`RESOLUTION_SPEC` §5.1). */
export function consequenceKindKey(kind: ConsequenceKind): string {
  return `outcome.consequence.${kind}`;
}

export const CONSEQUENCE_KIND_KEYS: readonly string[] = Object.freeze(
  Object.values(ConsequenceKind).map((kind) => consequenceKindKey(kind))
);

/**
 * What each line of the outcome feed is called (`RESOLUTION_SPEC` §3.4, §6.1) — one key
 * per event a resolution raises, and none for the events that are not part of one.
 *
 * A frozen object rather than a function over `DomainEvent['kind']`, because the seven are
 * a *subset* of that union and a builder taking the whole of it would silently name
 * `offer_locked` as a line of a debrief. Which seven belong here is decided in exactly one
 * place — `after-action-screen-model.ts`'s own exhaustive `switch`, which the compiler
 * forces to answer for every kind the union grows.
 */
export const OutcomeEventKeys = Object.freeze({
  NeedCovered: 'outcome.event.need_covered',
  NeedShort: 'outcome.event.need_short',
  HeroFalteredEarly: 'outcome.event.hero_faltered_early',
  ObjectiveTaken: 'outcome.event.objective_taken',
  ObjectiveLost: 'outcome.event.objective_lost',
  HeroSufferedConsequence: 'outcome.event.hero_suffered_consequence',
  ContractResolved: 'outcome.event.contract_resolved'
});

export const OUTCOME_EVENT_KEYS: readonly string[] = Object.freeze(Object.values(OutcomeEventKeys));

/**
 * Everything the battle screen names (`COMBAT_SPEC` §10.2).
 *
 * **The reason codes are not here, and that is not an omission.** `TargetReasons`,
 * `BlockReasons` and `MotiveReasons` are already localization keys in the simulation — the
 * intent line prints one straight off the event — so a builder here would be a second
 * spelling of a set that already has one, which is the exact failure `TDD` §11.1 names.
 * The completeness check reads them from the engine's own lists.
 */
export function battleStateKey(state: ScreenState): string {
  return `screen.battle.state.${state.toLowerCase()}`;
}

export const BATTLE_STATE_KEYS: readonly string[] = Object.freeze(
  SCREEN_STATES.map(battleStateKey)
);

/** Which of the four jobs a unit holds (`COMBAT_SPEC` §3.3). */
export function combatRoleKey(role: CombatRole): string {
  return `battle.role.${role}`;
}

export const COMBAT_ROLE_KEYS: readonly string[] = Object.freeze(COMBAT_ROLES.map(combatRoleKey));

/** What a unit did on its turn (`COMBAT_SPEC` §4.1). */
export function combatActionKey(action: CombatAction): string {
  return `battle.action.${action}`;
}

export const COMBAT_ACTION_KEYS: readonly string[] = Object.freeze(
  COMBAT_ACTIONS.map(combatActionKey)
);

/** The order the crew went out under (`COMBAT_SPEC` §7.2). */
export function doctrineKey(doctrine: DoctrineId): string {
  return `battle.doctrine.${doctrine}`;
}

export const DOCTRINE_KEYS: readonly string[] = Object.freeze(DOCTRINE_IDS.map(doctrineKey));

/**
 * A status, twice: what it is called, and the glyph beside it.
 *
 * **Two keys per status rather than one, because §10.2 п.5 asks for it.** The spike's scene
 * carried side *and* status on the colour channel, which is the case colour blindness breaks
 * outright (`GDD` §16.6): the tint says nothing on its own, so the mark and the word carry
 * it. The glyph is a key like everything else — a component that typed one in would be
 * inventing a player-facing string.
 */
export function battleStatusKey(status: StatusId): string {
  return `battle.status.${status}`;
}

export function battleStatusMarkKey(status: StatusId): string {
  return `battle.status.${status}.mark`;
}

export const BATTLE_STATUS_KEYS: readonly string[] = Object.freeze([
  ...STATUS_IDS.map(battleStatusKey),
  ...STATUS_IDS.map(battleStatusMarkKey)
]);

/** How the fight ended (`COMBAT_SPEC` §6.1). */
export function battleOutcomeKey(outcome: BattleOutcome): string {
  return `battle.outcome.${outcome}`;
}

export const BATTLE_OUTCOME_KEYS: readonly string[] = Object.freeze(
  BATTLE_OUTCOMES.map(battleOutcomeKey)
);

/**
 * One line of the battle's own journal, per event kind (`COMBAT_SPEC` §8.1, §10.2).
 *
 * A frozen object rather than a builder over `BattleEvent['kind']`, for the reason
 * {@link OutcomeEventKeys} is one: which kinds get a line is decided by the screen model's
 * own exhaustive `switch`, and a builder taking the whole union would let a kind reach the
 * journal without anybody deciding it should.
 */
export const BattleEventKeys = Object.freeze({
  BattleStarted: 'battle.event.battle_started',
  RoundStarted: 'battle.event.round_started',
  IntentDeclared: 'battle.event.intent_declared',
  DamageDealt: 'battle.event.damage_dealt',
  HealingDone: 'battle.event.healing_done',
  DamageAbsorbed: 'battle.event.damage_absorbed',
  StatusApplied: 'battle.event.status_applied',
  StatusExpired: 'battle.event.status_expired',
  UnitShifted: 'battle.event.unit_shifted',
  ShiftResisted: 'battle.event.shift_resisted',
  UnitPinned: 'battle.event.unit_pinned',
  TurnSpent: 'battle.event.turn_spent',
  UnitDowned: 'battle.event.unit_downed',
  DoctrineBroken: 'battle.event.doctrine_broken',
  RetreatSignalled: 'battle.event.retreat_signalled',
  RetreatObeyed: 'battle.event.retreat_obeyed',
  RetreatRefused: 'battle.event.retreat_refused',
  RoundEnded: 'battle.event.round_ended',
  BattleEnded: 'battle.event.battle_ended'
});

export const BATTLE_EVENT_KEYS: readonly string[] = Object.freeze(Object.values(BattleEventKeys));

/** What the battle screen labels its own parts with. */
export const BattleFieldKeys = Object.freeze({
  Board: 'battle.field.board',
  Round: 'battle.field.round',
  Doctrine: 'battle.field.doctrine',
  Intent: 'battle.field.intent',
  Journal: 'battle.field.journal',
  Crew: 'battle.field.crew',
  Foes: 'battle.field.foes',
  Health: 'battle.field.health',
  Outcome: 'battle.field.outcome',
  Downed: 'battle.field.downed',
  Withdrew: 'battle.field.withdrew'
});

export type BattleFieldKeys = (typeof BattleFieldKeys)[keyof typeof BattleFieldKeys];

export const BATTLE_FIELD_KEYS: readonly string[] = Object.freeze(Object.values(BattleFieldKeys));

/**
 * The controls of §10.2, and the one lever `DEC-005` gives the player.
 *
 * The retreat button carries its cost on it, and the cost is a *sentence* rather than a
 * figure: what a withdrawal costs is one `Retreat` on every hero who moved, and how much
 * that is worth is exactly the kind of number `DEC-006` keeps off a screen.
 */
export const BattleControlKeys = Object.freeze({
  Pause: 'battle.control.pause',
  Resume: 'battle.control.resume',
  Speed: 'battle.control.speed',
  Skip: 'battle.control.skip',
  Replay: 'battle.control.replay',
  Retreat: 'battle.control.retreat',
  RetreatCost: 'battle.control.retreat.cost',
  RetreatGiven: 'battle.control.retreat.given',
  RetreatUnavailable: 'battle.control.retreat.unavailable'
});

export type BattleControlKeys = (typeof BattleControlKeys)[keyof typeof BattleControlKeys];

export const BATTLE_CONTROL_KEYS: readonly string[] = Object.freeze(
  Object.values(BattleControlKeys)
);

/** How far a contract on the board has got — see `ContractAvailability`. */
export function contractAvailabilityKey(availability: ContractAvailability): string {
  return `board.availability.${availability}`;
}

export const CONTRACT_AVAILABILITY_KEYS: readonly string[] = Object.freeze(
  CONTRACT_AVAILABILITIES.map(contractAvailabilityKey)
);

/**
 * Which of the five shapes the debrief screen is in, and which the board is in — each its
 * own key per state, never {@link screenStateKey}'s.
 *
 * The same argument {@link saveSlotsStateKey} makes: `Incomplete` on the offer screen is a
 * hero who has not answered, on the debrief it is a promise nobody has answered for, and
 * on the board it is a campaign with nothing left to take. One key for all three would
 * force one text to describe all three, and that text says nothing.
 */
export function afterActionStateKey(state: ScreenState): string {
  return `screen.after_action.state.${state.toLowerCase()}`;
}

export const AFTER_ACTION_STATE_KEYS: readonly string[] = Object.freeze(
  SCREEN_STATES.map(afterActionStateKey)
);

export function contractBoardStateKey(state: ScreenState): string {
  return `screen.contract_board.state.${state.toLowerCase()}`;
}

export const CONTRACT_BOARD_STATE_KEYS: readonly string[] = Object.freeze(
  SCREEN_STATES.map(contractBoardStateKey)
);
