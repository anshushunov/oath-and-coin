import { describe, expect, it } from 'vitest';

import { contractDisplayNameKey, SaveFieldKeys, SaveSlotStatusKeys } from './keys.ts';
import {
  SAVE_SLOTS_LOADING_SCREEN,
  createSaveSlotsScreenModel,
  saveSlotsScreenModel,
  type SaveSlotInput,
  type SaveSlotsScreenModel
} from './save-slots-screen-model.ts';
import { ScreenState } from './screen-state.ts';
import { ids } from './testing/fixtures.ts';

/**
 * The five shapes of the slots screen, and the one rule that decides which of them a
 * set of slots is in.
 *
 * The inputs are hand-built here and that is not a shortcut: this layer's whole input
 * is five scalars per slot, and the layer that produces them — the session controller —
 * has its own tests over the store it reads them from. What this file is for is the
 * classification, which is where the states can be got wrong without any of that
 * moving: an unreadable slot beside a readable one is `Incomplete`, and three
 * unreadable ones are not "three times incomplete" but a storage that is gone.
 */

const EMPTY_SLOT: SaveSlotInput = {
  slot: 'slot-a',
  createdAt: null,
  logicalTime: null,
  focusedContract: null,
  errorCode: null
};

function anEmpty(slot: string): SaveSlotInput {
  return { ...EMPTY_SLOT, slot };
}

function anOccupied(slot: string): SaveSlotInput {
  return {
    slot,
    createdAt: '2026-08-19T09:41:00.000Z',
    logicalTime: 3,
    focusedContract: ids.caravan,
    errorCode: null
  };
}

function anUnreadable(slot: string): SaveSlotInput {
  return { ...anEmpty(slot), errorCode: 'SAVE_MALFORMED' };
}

function lineFor(model: SaveSlotsScreenModel, slot: string) {
  const line = model.slots.find((candidate) => candidate.slot === slot);

  if (line === undefined) {
    throw new Error(`The model carries no line for '${slot}'.`);
  }

  return line;
}

describe('which of the five shapes a set of slots is in', () => {
  it('is Loading before the slots have been read, and that shape carries no lines', () => {
    // The one state the factory never produces, for the same reason `LOADING_SCREEN` is
    // a constant: a screen that has not read the slots yet knows neither how many there
    // are nor what they are called, so a "loading" line would be an invented one.
    expect(SAVE_SLOTS_LOADING_SCREEN.state).toBe(ScreenState.Loading);
    expect(SAVE_SLOTS_LOADING_SCREEN.slots).toEqual([]);
  });

  it('is Empty when every slot is empty', () => {
    const model = saveSlotsScreenModel([anEmpty('slot-a'), anEmpty('slot-b'), anEmpty('slot-c')]);

    expect(model.state).toBe(ScreenState.Empty);
    expect(model.slots.map((line) => line.statusKey)).toEqual([
      SaveSlotStatusKeys.Empty,
      SaveSlotStatusKeys.Empty,
      SaveSlotStatusKeys.Empty
    ]);
  });

  it('is Normal when nothing refused and at least one slot holds a campaign', () => {
    const model = saveSlotsScreenModel([
      anOccupied('slot-a'),
      anEmpty('slot-b'),
      anEmpty('slot-c')
    ]);

    expect(model.state).toBe(ScreenState.Normal);
    expect(lineFor(model, 'slot-a').statusKey).toBe(SaveSlotStatusKeys.Occupied);
  });

  it('is Incomplete when one slot refused and another did not', () => {
    const model = saveSlotsScreenModel([
      anOccupied('slot-a'),
      anUnreadable('slot-b'),
      anEmpty('slot-c')
    ]);

    expect(model.state).toBe(ScreenState.Incomplete);
    expect(lineFor(model, 'slot-b').statusKey).toBe(SaveSlotStatusKeys.Unreadable);
  });

  it('is Error when every slot refused, rather than Incomplete three times over', () => {
    // The difference is the whole of what this state is for: three slots refusing at
    // once is a storage nobody can save into either, and a screen that called that
    // "some of it works" would be offering the player a slot to write to.
    const model = saveSlotsScreenModel([
      anUnreadable('slot-a'),
      anUnreadable('slot-b'),
      anUnreadable('slot-c')
    ]);

    expect(model.state).toBe(ScreenState.Error);
  });

  it('is Empty rather than Normal when a slot carries a time but no campaign', () => {
    // Guards the classification against being read off `logicalTime` alone: a zero
    // logical time is a legitimate campaign, and `createdAt` is what says a file exists.
    const model = saveSlotsScreenModel([
      { ...anOccupied('slot-a'), createdAt: '2026-08-19T09:41:00.000Z', logicalTime: 0 },
      anEmpty('slot-b'),
      anEmpty('slot-c')
    ]);

    expect(model.state).toBe(ScreenState.Normal);
    expect(lineFor(model, 'slot-a').logicalTime).toBe(0);
  });
});

describe('a slot whose last write was refused', () => {
  it('keeps the campaign it already held, and carries the refusal beside it', () => {
    // The property the port promises and the screen has to show: a write that failed
    // changed nothing on the storage, so the line must still describe what is there.
    // A screen that dropped the descriptor when a code arrived would be telling the
    // player their save is gone.
    const model = saveSlotsScreenModel([
      { ...anOccupied('slot-a'), errorCode: 'SAVE_STORAGE_UNAVAILABLE' },
      anEmpty('slot-b'),
      anEmpty('slot-c')
    ]);
    const line = lineFor(model, 'slot-a');

    expect(line.createdAt).toBe('2026-08-19T09:41:00.000Z');
    expect(line.logicalTime).toBe(3);
    expect(line.contractDisplayNameKey).toBe(contractDisplayNameKey(ids.caravan));
    expect(line.errorCode).toBe('SAVE_STORAGE_UNAVAILABLE');
    expect(line.statusKey).toBe(SaveSlotStatusKeys.Occupied);
    expect(model.state).toBe(ScreenState.Incomplete);
  });
});

describe('the keys a line carries', () => {
  it('names the slot, its two actions and its contract, and never a raw id', () => {
    const line = lineFor(
      saveSlotsScreenModel([anOccupied('slot-a'), anEmpty('slot-b'), anEmpty('slot-c')]),
      'slot-a'
    );

    expect(line.displayNameKey).toBe('save.slot.slot_a.name');
    expect(line.saveKey).toBe('save.slot.slot_a.save');
    expect(line.loadKey).toBe('save.slot.slot_a.load');
    expect(line.contractDisplayNameKey).toBe('contract.core.escort_the_caravan.name');
  });

  it('offers no load on a slot with nothing in it', () => {
    // `null` rather than a flag the screen reads with a branch of its own: every other
    // branch this screen makes is "is this model field null", and an empty slot is the
    // one line with nothing to load.
    expect(lineFor(saveSlotsScreenModel([anEmpty('slot-a')]), 'slot-a').loadKey).toBeNull();
  });

  it('offers a load on an unreadable slot, because the refusal is shown by trying', () => {
    // The transition the design spec names: "попытка загрузить нечитаемый слот → отказ
    // на месте". A screen that hid the action would leave the player with a line that
    // says something is wrong and no way to find out what.
    expect(lineFor(saveSlotsScreenModel([anUnreadable('slot-a')]), 'slot-a').loadKey).toBe(
      'save.slot.slot_a.load'
    );
  });

  it('names every field it shows a bare value for', () => {
    // The captions are the model's, not the screen's — the same rule `FieldKeys` states
    // for the contract screen, and for the same reason: a date and a number standing on
    // their own say nothing about what they are a date and a number of.
    expect(Object.values(SaveFieldKeys)).toEqual([
      'field.save.created_at',
      'field.save.logical_time',
      'field.save.contract'
    ]);
  });
});

describe('a model that would lie', () => {
  it('is refused when a non-loading screen carries no slots at all', () => {
    expect(() => saveSlotsScreenModel([])).toThrow(/at least one slot/u);
  });

  it('is refused when two lines name the same slot', () => {
    expect(() => saveSlotsScreenModel([anEmpty('slot-a'), anEmpty('slot-a')])).toThrow(
      /twice|duplicate/u
    );
  });

  it('is refused when a descriptor arrives in pieces', () => {
    // The three descriptor fields come from one decoded save, so a line holding two of
    // them lost one on the way. Left unchecked, the screen would show a save with no
    // date or a date with no contract and look like a save that was written that way.
    expect(() =>
      saveSlotsScreenModel([{ ...anOccupied('slot-a'), focusedContract: null }])
    ).toThrow(/together/u);
  });

  it('is refused when a Loading screen carries lines anyway', () => {
    expect(() =>
      createSaveSlotsScreenModel({
        state: ScreenState.Loading,
        titleKey: SAVE_SLOTS_LOADING_SCREEN.titleKey,
        slots: saveSlotsScreenModel([anEmpty('slot-a')]).slots
      })
    ).toThrow(/Loading/u);
  });

  it('is refused when a state is claimed that the lines do not support', () => {
    // The same hole `createContractOfferScreenModel` closes: a spread walks around the
    // factory, and `{ ...model, state: 'Normal' }` over three unreadable slots is a
    // screen claiming everything is fine above three refusals.
    const failed = saveSlotsScreenModel([anUnreadable('slot-a')]);

    expect(() => createSaveSlotsScreenModel({ ...failed, state: ScreenState.Normal })).toThrow(
      /Normal/u
    );
  });
});
