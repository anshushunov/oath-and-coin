import { describe, expect, it } from 'vitest';

import { battleLineTones, type BattleLineTones } from './battle-line-tones.ts';
import { BattleEventKeys, BattleFieldKeys } from './keys.ts';

/**
 * The three colour channels of the journal (`DEC-018`, `COMBAT_SPEC` §10.2.1), as a table.
 *
 * **The table, and not a property of pairs of lines.** "Two lines with equal texts colour
 * alike" holds for a screen with no colour at all and for one with the colours swapped; the
 * spec names that and asks for every one of the nineteen kinds to be stated. So each kind is
 * written out below with the span it colours and the token it colours it with, and a kind
 * that is not listed here does not build: the row type is keyed by the kinds themselves.
 */

type EventKey = (typeof BattleEventKeys)[keyof typeof BattleEventKeys];

/** What the line's own word says about its number and its detail, per kind. */
const TABLE: Readonly<Record<EventKey, Pick<BattleLineTones, 'amount' | 'detail'>>> = {
  [BattleEventKeys.BattleStarted]: { amount: null, detail: null },
  [BattleEventKeys.RoundStarted]: { amount: null, detail: null },
  [BattleEventKeys.IntentDeclared]: { amount: null, detail: null },
  // Harm and aid — the same two the floating number carries (`POPUP_DAMAGE`/`POPUP_HEALING`).
  [BattleEventKeys.DamageDealt]: { amount: 'harm', detail: null },
  [BattleEventKeys.HealingDone]: { amount: 'aid', detail: null },
  // What was taken off a blow is still a blow: the word is «Урон поглощён», and
  // `BattleEffectLine.healing` is `false` for it — §10.2.1 says the same thing in words.
  [BattleEventKeys.DamageAbsorbed]: { amount: 'harm', detail: null },
  // One colour for every status, the one the mark on the board has.
  [BattleEventKeys.StatusApplied]: { amount: null, detail: 'status' },
  [BattleEventKeys.StatusExpired]: { amount: null, detail: 'status' },
  [BattleEventKeys.UnitShifted]: { amount: null, detail: null },
  [BattleEventKeys.ShiftResisted]: { amount: null, detail: null },
  [BattleEventKeys.UnitPinned]: { amount: null, detail: null },
  [BattleEventKeys.TurnSpent]: { amount: null, detail: null },
  [BattleEventKeys.UnitDowned]: { amount: null, detail: null },
  // The motive of a broken order is a reason, not a status — base colour.
  [BattleEventKeys.DoctrineBroken]: { amount: null, detail: null },
  [BattleEventKeys.RetreatSignalled]: { amount: null, detail: null },
  [BattleEventKeys.RetreatObeyed]: { amount: null, detail: null },
  [BattleEventKeys.RetreatRefused]: { amount: null, detail: null },
  [BattleEventKeys.RoundEnded]: { amount: null, detail: null },
  // The outcome is named by a word and has no axis a colour could carry.
  [BattleEventKeys.BattleEnded]: { amount: null, detail: null }
};

describe('battleLineTones: which span of a journal line is coloured, and with what', () => {
  it.each(Object.entries(TABLE))('%s', (key, expected) => {
    const tones = battleLineTones({ key, sideKey: null, targetSideKey: null });

    expect({ amount: tones.amount, detail: tones.detail }).toEqual(expected);
  });

  it('covers every kind the journal can carry, and no other', () => {
    expect(Object.keys(TABLE).sort()).toEqual(Object.values(BattleEventKeys).sort());
  });

  it('colours a man by the side word the line carries for him', () => {
    expect(
      battleLineTones({
        key: BattleEventKeys.DamageDealt,
        sideKey: BattleFieldKeys.Crew,
        targetSideKey: BattleFieldKeys.Foes
      })
    ).toMatchObject({ who: 'crew', target: 'foe' });

    expect(
      battleLineTones({
        key: BattleEventKeys.HealingDone,
        sideKey: BattleFieldKeys.Foes,
        targetSideKey: BattleFieldKeys.Foes
      })
    ).toMatchObject({ who: 'foe', target: 'foe' });
  });

  it('colours nobody on a line that names nobody', () => {
    expect(
      battleLineTones({ key: BattleEventKeys.RoundEnded, sideKey: null, targetSideKey: null })
    ).toEqual({ who: null, target: null, amount: null, detail: null });
  });

  it('refuses a key that is not a journal line, rather than leaving it uncoloured in silence', () => {
    // A twentieth kind added to the journal and not to the table would otherwise print in
    // the base colour and nothing would say the rule had stopped covering the journal.
    expect(() =>
      battleLineTones({ key: 'battle.event.invented', sideKey: null, targetSideKey: null })
    ).toThrow(/battle\.event\.invented/u);
  });

  it('refuses a side word it does not know', () => {
    expect(() =>
      battleLineTones({
        key: BattleEventKeys.DamageDealt,
        sideKey: BattleFieldKeys.Journal,
        targetSideKey: null
      })
    ).toThrow(/battle\.field\.journal/u);
  });
});
