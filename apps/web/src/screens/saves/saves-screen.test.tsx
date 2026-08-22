// @vitest-environment jsdom
import {
  SAVE_SLOTS_LOADING_SCREEN,
  ScreenState,
  saveSlotsScreenModel,
  type SaveSlotInput,
  type SaveSlotsScreenModel
} from '@oath-and-coin/presentation';
import { act } from 'react';
import { beforeAll, describe, expect, it } from 'vitest';

import { browserLocaleCatalogue, browserUiTextCatalogue } from '../../content-source.ts';
import { collectRenderedTexts } from '../../rendered-texts.ts';
import { render } from '../../testing/render.tsx';
import { TextSource } from '../../text.tsx';

import { SavesScreen } from './saves-screen.tsx';

/**
 * The save-slots screen in five states, and the four transitions that are not states at
 * all.
 *
 * The expected texts are written out here rather than produced by a second projection,
 * and that is deliberate: `expectedSnapshot` exists for the contract screen because the
 * corpus compares a rendered-UI hash across two implementations, and this screen has no
 * corpus. What it needs instead is a statement of what a player reads, in order, that a
 * reader of this file can check against the catalogue by eye — a parallel projection
 * would agree with the screen by construction the day both are edited together.
 *
 * Both catalogues are real, and the screen resolves against a merge of the two, because
 * that is what `App` gives it: a slot line carries a contract's authored display name
 * (`content/locale/ru.json`) beside interface text the screens invent
 * (`ui-text/ru.json`, `ADR-012`).
 */

const CREATED_AT = '2026-08-19T09:41:00.000Z';

let catalogue: ReadonlyMap<string, string>;

beforeAll(() => {
  catalogue = new Map([...browserLocaleCatalogue('ru'), ...browserUiTextCatalogue('ru')]);
});

function text(key: string): string {
  const resolved = catalogue.get(key);

  if (resolved === undefined) {
    throw new Error(`The two shipped catalogues answer nothing for '${key}'.`);
  }

  return resolved;
}

function empty(slot: string): SaveSlotInput {
  return { slot, createdAt: null, logicalTime: null, focusedContract: null, errorCode: null };
}

function occupied(slot: string): SaveSlotInput {
  return {
    slot,
    createdAt: CREATED_AT,
    logicalTime: 4,
    // A contract the shipped tree actually holds, so the key resolves through the real
    // catalogue rather than through one this file invented.
    focusedContract: 'core:escort_the_caravan' as SaveSlotInput['focusedContract'],
    errorCode: null
  };
}

function unreadable(slot: string): SaveSlotInput {
  return { ...empty(slot), errorCode: 'SAVE_MALFORMED' };
}

interface Clicked {
  readonly saved: string[];
  readonly loaded: string[];
}

function renderScreen(model: SaveSlotsScreenModel): {
  readonly container: HTMLElement;
  readonly clicked: Clicked;
} {
  const clicked: Clicked = { saved: [], loaded: [] };
  const container = render(
    <TextSource catalogue={catalogue}>
      <SavesScreen
        model={model}
        onSave={(slot) => clicked.saved.push(slot)}
        onLoad={(slot) => clicked.loaded.push(slot)}
      />
    </TextSource>
  );

  return { container, clicked };
}

/**
 * Clicks a button and lets React finish with it.
 *
 * Inside `act`, and that is not ceremony: React 19 schedules a state update rather than
 * applying it, so a bare `click()` leaves the assertions reading the markup as it was
 * before the click — which passes or fails by timing rather than by behaviour.
 */
function click(container: HTMLElement, testId: string): void {
  const element = container.querySelector(`[data-testid="${testId}"]`);

  if (!(element instanceof HTMLButtonElement)) {
    throw new Error(`The screen has no button at [data-testid="${testId}"].`);
  }

  act(() => {
    element.click();
  });
}

function has(container: HTMLElement, testId: string): boolean {
  return container.querySelector(`[data-testid="${testId}"]`) !== null;
}

describe('the five states of the slots screen', () => {
  it('draws Loading as a title and a state and nothing it has not read yet', () => {
    const { container } = renderScreen(SAVE_SLOTS_LOADING_SCREEN);

    expect(collectRenderedTexts(container)).toEqual([
      text('screen.saves.title'),
      text('screen.saves.state.loading')
    ]);
  });

  it('draws Empty as three slots a player may write to', () => {
    const model = saveSlotsScreenModel([empty('slot-a'), empty('slot-b'), empty('slot-c')]);
    const { container } = renderScreen(model);

    expect(model.state).toBe(ScreenState.Empty);
    expect(collectRenderedTexts(container)).toEqual([
      text('screen.saves.title'),
      text('screen.saves.state.empty'),
      text('save.slot.slot_a.name'),
      text('save.slot.status.empty'),
      text('save.slot.slot_a.save'),
      text('save.slot.slot_b.name'),
      text('save.slot.status.empty'),
      text('save.slot.slot_b.save'),
      text('save.slot.slot_c.name'),
      text('save.slot.status.empty'),
      text('save.slot.slot_c.save')
    ]);
  });

  it('draws Normal with the campaign a slot holds, named and captioned', () => {
    const model = saveSlotsScreenModel([occupied('slot-a'), empty('slot-b'), empty('slot-c')]);
    const { container } = renderScreen(model);

    expect(model.state).toBe(ScreenState.Normal);
    expect(collectRenderedTexts(container).slice(0, 11)).toEqual([
      text('screen.saves.title'),
      text('screen.saves.state.normal'),
      text('save.slot.slot_a.name'),
      text('save.slot.status.occupied'),
      text('field.save.created_at'),
      CREATED_AT,
      text('field.save.logical_time'),
      '4',
      text('field.save.contract'),
      text('contract.core.escort_the_caravan.name'),
      text('save.slot.slot_a.save')
    ]);
    expect(collectRenderedTexts(container)[11]).toBe(text('save.slot.slot_a.load'));
  });

  it('draws Incomplete with the refusal on the slot that refused, and only there', () => {
    const model = saveSlotsScreenModel([occupied('slot-a'), unreadable('slot-b'), empty('slot-c')]);
    const { container } = renderScreen(model);

    expect(model.state).toBe(ScreenState.Incomplete);
    expect(collectRenderedTexts(container)).toContain(text('error.save_malformed'));
    expect(has(container, 'slot-b-error')).toBe(true);
    expect(has(container, 'slot-a-error')).toBe(false);
    expect(has(container, 'slot-c-error')).toBe(false);
  });

  it('draws Error as three refusals, with no campaign claimed anywhere', () => {
    const model = saveSlotsScreenModel([
      unreadable('slot-a'),
      unreadable('slot-b'),
      unreadable('slot-c')
    ]);
    const { container } = renderScreen(model);

    expect(model.state).toBe(ScreenState.Error);
    expect(collectRenderedTexts(container)).toEqual([
      text('screen.saves.title'),
      text('screen.saves.state.error'),
      ...['slot_a', 'slot_b', 'slot_c'].flatMap((slot) => [
        text(`save.slot.${slot}.name`),
        text('save.slot.status.unreadable'),
        text('error.save_malformed'),
        text(`save.slot.${slot}.save`),
        text(`save.slot.${slot}.load`)
      ])
    ]);
  });
});

describe('what the screen does when a slot is clicked', () => {
  it('saves into an empty slot without asking anything', () => {
    // Nothing is destroyed, so nothing is confirmed. A confirmation in front of an empty
    // slot would train the player to click through the one that matters.
    const { container, clicked } = renderScreen(
      saveSlotsScreenModel([empty('slot-a'), empty('slot-b'), empty('slot-c')])
    );

    click(container, 'slot-a-save');

    expect(clicked.saved).toEqual(['slot-a']);
  });

  it('asks before writing over a slot that holds a campaign', () => {
    const { container, clicked } = renderScreen(
      saveSlotsScreenModel([occupied('slot-a'), empty('slot-b'), empty('slot-c')])
    );

    click(container, 'slot-a-save');

    // The design spec's transition: "сохранить поверх занятого с подтверждением". The
    // click has asked a question and touched nothing.
    expect(clicked.saved).toEqual([]);
    expect(collectRenderedTexts(container)).toContain(text('save.overwrite.question'));

    click(container, 'slot-a-confirm');

    expect(clicked.saved).toEqual(['slot-a']);
  });

  it('leaves the slot alone when the confirmation is declined', () => {
    // The half that matters: a screen that asked and wrote anyway would be a screen
    // whose question is decoration.
    const { container, clicked } = renderScreen(
      saveSlotsScreenModel([occupied('slot-a'), empty('slot-b'), empty('slot-c')])
    );

    click(container, 'slot-a-save');
    click(container, 'slot-a-cancel');

    expect(clicked.saved).toEqual([]);
    expect(collectRenderedTexts(container)).not.toContain(text('save.overwrite.question'));
    expect(has(container, 'slot-a-save')).toBe(true);
  });

  it('asks about one slot at a time', () => {
    // Two open questions at once is a screen where "подтвердить" is ambiguous.
    const { container } = renderScreen(
      saveSlotsScreenModel([occupied('slot-a'), occupied('slot-b'), empty('slot-c')])
    );

    click(container, 'slot-a-save');
    click(container, 'slot-b-save');

    expect(has(container, 'slot-a-confirm')).toBe(false);
    expect(has(container, 'slot-b-confirm')).toBe(true);
  });

  it('offers to load a slot that holds a campaign, and hands the slot back', () => {
    const { container, clicked } = renderScreen(
      saveSlotsScreenModel([occupied('slot-a'), empty('slot-b'), empty('slot-c')])
    );

    click(container, 'slot-a-load');

    expect(clicked.loaded).toEqual(['slot-a']);
    expect(has(container, 'slot-b-load')).toBe(false);
  });

  it('offers to load an unreadable slot too, so the refusal can be shown in place', () => {
    const { container, clicked } = renderScreen(
      saveSlotsScreenModel([unreadable('slot-a'), empty('slot-b'), empty('slot-c')])
    );

    click(container, 'slot-a-load');

    expect(clicked.loaded).toEqual(['slot-a']);
  });
});

describe('a slot whose write was refused', () => {
  it('still shows the campaign that is in it, above the refusal', () => {
    // The transition "отказ записи → слот остаётся прежним и это видно". The port
    // promises the storage is untouched, so a screen that dropped the descriptor when a
    // code arrived would be telling the player their save is gone.
    const { container } = renderScreen(
      saveSlotsScreenModel([
        { ...occupied('slot-a'), errorCode: 'SAVE_STORAGE_UNAVAILABLE' },
        empty('slot-b'),
        empty('slot-c')
      ])
    );
    const texts = collectRenderedTexts(container);

    expect(texts).toContain(CREATED_AT);
    expect(texts).toContain(text('contract.core.escort_the_caravan.name'));
    expect(texts).toContain(text('error.save_storage_unavailable'));
    expect(texts).toContain(text('save.slot.status.occupied'));
  });
});

describe('what never reaches a player', () => {
  it('shows no slot name and no contract id, only the keys naming them', () => {
    // `TDD` §11.1. `slot-a` is an identifier this build chose and a player never typed;
    // `core:escort_the_caravan` is a content id. Neither is a name anyone reads.
    const { container } = renderScreen(
      saveSlotsScreenModel([occupied('slot-a'), unreadable('slot-b'), empty('slot-c')])
    );

    for (const shown of collectRenderedTexts(container)) {
      expect(shown).not.toContain('core:escort_the_caravan');
      expect(shown).not.toContain('SAVE_MALFORMED');
    }
  });

  it('fails the render rather than putting a key on the screen', () => {
    const model = saveSlotsScreenModel([empty('slot-a')]);
    const incomplete = new Map(catalogue);
    incomplete.delete('save.slot.slot_a.save');

    expect(() =>
      render(
        <TextSource catalogue={incomplete}>
          <SavesScreen model={model} onSave={() => {}} onLoad={() => {}} />
        </TextSource>
      )
    ).toThrow(/save[.]slot[.]slot_a[.]save/u);
  });
});
