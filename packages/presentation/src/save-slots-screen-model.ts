import type { ContentId } from '@oath-and-coin/simulation';

import {
  SAVES_TITLE_KEY,
  SaveSlotStatusKeys,
  contractDisplayNameKey,
  saveSlotDisplayNameKey,
  saveSlotLoadKey,
  saveSlotSaveKey
} from './keys.ts';
import { ScreenState } from './screen-state.ts';

/**
 * The save-slots screen: three lines and one of the five states (design spec §3.2).
 *
 * The second screen of the new stack, and it is built the way the first one is — a
 * model that decides everything and a component that decides nothing. What differs is
 * where its input comes from: a contract screen is a projection of a campaign this
 * layer can see whole, and a slot line is a projection of a *file*, which this layer
 * may not know anything about. `SaveDescriptor`, `SaveSlot` and `SaveErrorCode` all
 * live in `packages/application` and `packages/content`, and
 * `presentation-depends-only-on-simulation` forbids importing any of them.
 *
 * So the input is declared here as its own structural shape, exactly as `DecidedStep`
 * is, and the session controller — which holds a descriptor, a slot name and a refusal
 * at once — assigns to it structurally at the call site. The compiler checks the shapes
 * agree there rather than here, which is the cost segment 4 named for `DecidedStep` and
 * accepted for the same reason: the alternative moves a rule out of this layer, and the
 * rule below (which set of slots is which screen) is this layer's whole subject.
 */

/**
 * What this layer knows about one slot: strings, numbers and nothing that belongs to a
 * layer above.
 *
 * All five fields are as they came off the storage, and two of them can be set at once
 * for a reason worth stating: {@link errorCode} is not only "this file cannot be read".
 * It is also where a refused *write* lands, and a refused write changes nothing on the
 * storage — so a line can legitimately carry a full descriptor and a code together, and
 * the screen owes the player both. Which of the two put the code there is not a
 * distinction this layer can make, and it does not need to: it shows the campaign that
 * is there and the refusal that happened.
 */
export interface SaveSlotInput {
  readonly slot: string;
  /** When the save in this slot was taken, ISO-8601, or `null` when the slot is empty. */
  readonly createdAt: string | null;
  readonly logicalTime: number | null;
  readonly focusedContract: ContentId | null;
  readonly errorCode: string | null;
}

/** One slot, as the screen shows it. */
export interface SaveSlotLine {
  /** The slot's own name. Bookkeeping, never shown — see {@link displayNameKey}. */
  readonly slot: string;
  readonly displayNameKey: string;
  /** Empty, occupied or unreadable, as one of {@link SaveSlotStatusKeys}. */
  readonly statusKey: string;
  readonly createdAt: string | null;
  readonly logicalTime: number | null;
  /**
   * The key naming the contract the saved screen was showing, or `null` with the rest
   * of the descriptor. Never the raw content id: the id is what the file carries, and
   * `TDD` §11.1 keeps it off the screen exactly as it is kept off the contract screen.
   */
  readonly contractDisplayNameKey: string | null;
  readonly errorCode: string | null;
  readonly saveKey: string;
  /**
   * The key of this slot's "load" action, or `null` when there is nothing in it to
   * load.
   *
   * `null` rather than a boolean the screen reads: every branch the components make is
   * "is this model field null", and one that asked "is this slot empty *and* did
   * nothing refuse" would be a rule the screen decided for itself. An unreadable slot
   * keeps its action, because the refusal is shown by trying (design spec §3.1: "отказ
   * на месте").
   */
  readonly loadKey: string | null;
}

export interface SaveSlotsScreenModel {
  readonly state: ScreenState;
  readonly titleKey: string;
  readonly slots: readonly SaveSlotLine[];
}

/**
 * The screen before the slots have been read — the one state {@link saveSlotsScreenModel}
 * never produces.
 *
 * It carries no lines, and that is the honest shape: how many slots there are and what
 * they are called arrives with the answer, so a screen drawn before it has three lines
 * it invented. Stated once here rather than hand-written by each caller, for the reason
 * {@link import('./contract-offer-screen-model-factory.ts').LOADING_SCREEN} records —
 * two hand-written copies of one value is a drift this repository has already paid for.
 */
export const SAVE_SLOTS_LOADING_SCREEN: SaveSlotsScreenModel = Object.freeze({
  state: ScreenState.Loading,
  titleKey: SAVES_TITLE_KEY,
  slots: Object.freeze([])
});

/**
 * Builds the screen from the slots as they were read.
 *
 * The classification is the whole of this function, and each of the four rules is a
 * claim about what a player may do next:
 *
 * - every slot refused → `Error`. Three refusals at once is a storage that is gone,
 *   not three independent accidents, and a screen that called it `Incomplete` would be
 *   offering a slot to write into that cannot be written into either;
 * - some refused and some did not → `Incomplete`. The mixed set the design spec names;
 * - none refused and every slot is empty → `Empty`;
 * - none refused and something is there → `Normal`.
 *
 * `createdAt` is what says a slot holds a campaign, never `logicalTime`: a save taken
 * before anything happened has a logical time of zero, and a rule reading that as
 * "nothing here" would hide the first save a player ever makes.
 *
 * @throws when `inputs` is empty, names one slot twice, or carries a descriptor in
 * pieces.
 */
export function saveSlotsScreenModel(inputs: readonly SaveSlotInput[]): SaveSlotsScreenModel {
  if (inputs.length === 0) {
    throw new Error(
      'A save-slots screen needs at least one slot: a screen with no lines is the loading ' +
        'screen, and that one is SAVE_SLOTS_LOADING_SCREEN rather than a set of slots that ' +
        'happens to be empty.'
    );
  }

  // Not "exactly three", although three is what ships. How many slots exist is
  // `packages/application`'s `SAVE_SLOTS`, which this package may not import, and a
  // literal three here would be a second declaration of that closed set with nothing
  // able to check it against the first.
  const seen = new Set<string>();
  for (const input of inputs) {
    if (seen.has(input.slot)) {
      throw new Error(
        `Slot '${input.slot}' is named twice. Two lines for one slot would show a player two ` +
          'answers about one file, and nothing on the screen would say which is current.'
      );
    }
    seen.add(input.slot);
  }

  return createSaveSlotsScreenModel({
    state: stateOf(inputs),
    titleKey: SAVES_TITLE_KEY,
    slots: inputs.map(toLine)
  });
}

/**
 * Refuses every model that would lie, at the point one is claimed rather than only at
 * the point one is built.
 *
 * The same gate `createContractOfferScreenModel` is, and for the reason its own comment
 * records: a TypeScript spread walks around a factory function, so
 * `{ ...model, state: 'Normal' }` over three refusals typechecks and would otherwise
 * hash, render and be published as a screen saying everything is fine.
 */
export function createSaveSlotsScreenModel(model: SaveSlotsScreenModel): SaveSlotsScreenModel {
  if (model.state === ScreenState.Loading) {
    if (model.slots.length > 0) {
      throw new Error(
        'A Loading save-slots screen must carry no lines: the slots have not been read, so any ' +
          'line on it describes a slot nobody has looked at.'
      );
    }

    return model;
  }

  if (model.slots.length === 0) {
    throw new Error(
      `A ${model.state} save-slots screen must carry at least one slot; only Loading may carry ` +
        'none.'
    );
  }

  for (const line of model.slots) {
    requireWholeLine(line);
  }

  const implied = stateOf(model.slots);

  if (implied !== model.state) {
    throw new Error(
      `This screen claims state ${model.state}, but its ${String(model.slots.length)} lines are ` +
        `a ${implied} screen. The state is a fact about the slots, not a field a caller may set ` +
        'against them.'
    );
  }

  return model;
}

/**
 * The three descriptor fields arrive from one decoded save, so a value holding some of
 * them lost the rest on the way.
 *
 * Left unchecked, the screen would show a save with a date and no contract — which is
 * indistinguishable, on the screen, from a save that was written that way.
 *
 * Two callers with two different shapes, so two entry points with exact types rather than
 * one taking a union of both with the contract field optional on either side. That union
 * was the first spelling and review was right about it: it typechecked against
 * {@link SaveSlotLine}, which has no `focusedContract` at all, so the rule held by
 * accident of `??` rather than by the compiler agreeing the field exists.
 */
function requireWholeInput(input: SaveSlotInput): void {
  requireDescriptorTogether(input.slot, input.createdAt, input.logicalTime, input.focusedContract);
}

function requireWholeLine(line: SaveSlotLine): void {
  requireDescriptorTogether(
    line.slot,
    line.createdAt,
    line.logicalTime,
    line.contractDisplayNameKey
  );
}

function requireDescriptorTogether(
  slot: string,
  createdAt: string | null,
  logicalTime: number | null,
  contract: ContentId | string | null
): void {
  const present = [createdAt, logicalTime, contract].filter((field) => field !== null);

  if (present.length !== 0 && present.length !== 3) {
    throw new Error(
      `Slot '${slot}' carries part of a descriptor: createdAt, logicalTime and the focused ` +
        'contract come out of one save together and go on the screen together.'
    );
  }
}

/**
 * Which of the four shapes a set of read slots is, decided by how many of them are
 * **unreadable** — never by how many carry a code.
 *
 * The two are not the same set, and the difference is one slot: a write that was refused
 * leaves a code on a slot whose campaign is intact and loadable. Counting that slot as a
 * refusal put the screen in `Incomplete` while all three slots read perfectly, which
 * contradicts what `Incomplete` means (design spec §3.2: "часть слотов читается, часть
 * нет") and told the player something untrue about their storage. The refusal itself does
 * not go anywhere — it stays on its own slot's line, which is where it belongs.
 *
 * So "unreadable" is the same predicate {@link statusKeyOf} shows: a code and no campaign.
 */
function isUnreadable(line: {
  readonly createdAt: string | null;
  readonly errorCode: string | null;
}): boolean {
  return line.createdAt === null && line.errorCode !== null;
}

function stateOf(
  lines: readonly {
    readonly createdAt: string | null;
    readonly errorCode: string | null;
  }[]
): ScreenState {
  const unreadable = lines.filter(isUnreadable).length;

  if (unreadable === lines.length) {
    return ScreenState.Error;
  }

  if (unreadable > 0) {
    return ScreenState.Incomplete;
  }

  return lines.some((line) => line.createdAt !== null) ? ScreenState.Normal : ScreenState.Empty;
}

function toLine(input: SaveSlotInput): SaveSlotLine {
  requireWholeInput(input);

  return {
    slot: input.slot,
    displayNameKey: saveSlotDisplayNameKey(input.slot),
    statusKey: statusKeyOf(input),
    createdAt: input.createdAt,
    logicalTime: input.logicalTime,
    contractDisplayNameKey:
      input.focusedContract === null ? null : contractDisplayNameKey(input.focusedContract),
    errorCode: input.errorCode,
    saveKey: saveSlotSaveKey(input.slot),
    loadKey:
      input.createdAt === null && input.errorCode === null ? null : saveSlotLoadKey(input.slot)
  };
}

/**
 * Occupied wins over unreadable, and that ordering is the one decision here.
 *
 * A slot whose write was refused holds both a campaign and a code; what it *is* is
 * occupied — the campaign in it is intact and loadable — and the code beside it says
 * what happened to it, on its own line. Calling such a slot "unreadable" would tell the
 * player the opposite of what the port promises.
 */
function statusKeyOf(input: SaveSlotInput): string {
  if (isUnreadable(input)) {
    return SaveSlotStatusKeys.Unreadable;
  }

  return input.createdAt === null ? SaveSlotStatusKeys.Empty : SaveSlotStatusKeys.Occupied;
}
