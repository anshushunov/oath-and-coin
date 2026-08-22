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
  contentIdName,
  contentIdNamespace,
  type ContentId
} from '@oath-and-coin/simulation';

import { ReasonDirection, ScreenState, REASON_DIRECTIONS, SCREEN_STATES } from './screen-state.ts';

/** This screen's title. A key, not text — nothing in this package resolves one. */
export const TITLE_KEY = 'screen.contract_offer.title';

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
  OpenContractOffer: 'screen.contract_offer.open'
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
