import { BattleEventKeys, BattleFieldKeys } from './keys.ts';

/**
 * Which span of a journal line carries a colour, and which (`DEC-018`, `COMBAT_SPEC` §10.2.1).
 *
 * **Three channels, and each has a word beside it.** The name — whose man he is, read off the
 * side word the line carries for him; the number — harm or aid, read off the line's own word
 * («Урон», «Урон поглощён», «Помощь»); the status — one colour for all four, read off the
 * line's own word again («Состояние наложено», «Состояние прошло»). Nothing else on a line is
 * coloured, and a line is never coloured whole.
 *
 * **Decided here and not in a component**, for the rule every screen in this repository is
 * held to: a screen branches on a field being `null` and on a list being empty, never on
 * what is *in* one. The branch on a key has to live somewhere, and this is the layer that
 * already owns every other such branch (`BattleControlsLine`, `battleCounterpart`).
 *
 * **The inputs are exactly the words the line prints and nothing else.** Not `round`, which
 * the line carries and the screen never prints; not whether the man has a name, which in M2
 * happens to agree with his side on every reachable line and would stop agreeing with the
 * first named foe — and then the colour would be the only thing on the line saying which side
 * he was on, which `GDD` §16.6 forbids outright. A channel that read a field with no word
 * behind it would be a meaning without a word.
 *
 * The names of the tones are the colour roles of `apps/web/src/ui/tokens.ts`. This package
 * cannot import that module (`presentation-depends-only-on-simulation`), and does not need
 * to: it names a role, and the stylesheet decides what the role looks like.
 */

export type SideTone = 'crew' | 'foe';
export type AmountTone = 'harm' | 'aid';
export type DetailTone = 'status';

export interface BattleLineTones {
  /** The subject's name, or his side word and his job when he has no name. */
  readonly who: SideTone | null;
  /** The second man, after the arrow. */
  readonly target: SideTone | null;
  /** The number, on the three kinds that carry one. */
  readonly amount: AmountTone | null;
  /** The status a line lays or lifts. */
  readonly detail: DetailTone | null;
}

/** The words of a line a colour may be read off, and only those. */
export interface BattleLineWords {
  readonly key: string;
  readonly sideKey: string | null;
  readonly targetSideKey: string | null;
}

type EventKey = (typeof BattleEventKeys)[keyof typeof BattleEventKeys];

/**
 * Every kind, written out. A `Record` over the kinds rather than a `switch` with a default,
 * so a twentieth kind does not build until somebody has said what it colours.
 */
const BY_KIND: Readonly<Record<EventKey, Pick<BattleLineTones, 'amount' | 'detail'>>> = {
  [BattleEventKeys.BattleStarted]: { amount: null, detail: null },
  [BattleEventKeys.RoundStarted]: { amount: null, detail: null },
  [BattleEventKeys.IntentDeclared]: { amount: null, detail: null },
  [BattleEventKeys.DamageDealt]: { amount: 'harm', detail: null },
  [BattleEventKeys.HealingDone]: { amount: 'aid', detail: null },
  // A blow somebody took the edge off is still a blow: the number is what was taken off it.
  [BattleEventKeys.DamageAbsorbed]: { amount: 'harm', detail: null },
  [BattleEventKeys.StatusApplied]: { amount: null, detail: 'status' },
  [BattleEventKeys.StatusExpired]: { amount: null, detail: 'status' },
  [BattleEventKeys.UnitShifted]: { amount: null, detail: null },
  [BattleEventKeys.ShiftResisted]: { amount: null, detail: null },
  [BattleEventKeys.UnitPinned]: { amount: null, detail: null },
  [BattleEventKeys.TurnSpent]: { amount: null, detail: null },
  [BattleEventKeys.UnitDowned]: { amount: null, detail: null },
  [BattleEventKeys.DoctrineBroken]: { amount: null, detail: null },
  [BattleEventKeys.RetreatSignalled]: { amount: null, detail: null },
  [BattleEventKeys.RetreatObeyed]: { amount: null, detail: null },
  [BattleEventKeys.RetreatRefused]: { amount: null, detail: null },
  [BattleEventKeys.RoundEnded]: { amount: null, detail: null },
  [BattleEventKeys.BattleEnded]: { amount: null, detail: null }
};

const isEventKey = (key: string): key is EventKey => Object.hasOwn(BY_KIND, key);

/**
 * The colours of one line.
 *
 * @throws on a key that is not a journal line and on a side word that is not one of the two,
 * because either means the rule has stopped covering what the journal prints — and a line
 * left in the base colour would say so to nobody.
 */
export function battleLineTones(line: BattleLineWords): BattleLineTones {
  if (!isEventKey(line.key)) {
    throw new Error(
      `'${line.key}' is not a line the battle journal carries, so no rule says what colours it.`
    );
  }

  return {
    who: sideTone(line.sideKey),
    target: sideTone(line.targetSideKey),
    ...BY_KIND[line.key]
  };
}

function sideTone(sideKey: string | null): SideTone | null {
  switch (sideKey) {
    case null:
      return null;
    case BattleFieldKeys.Crew:
      return 'crew';
    case BattleFieldKeys.Foes:
      return 'foe';
    default:
      throw new Error(`'${sideKey}' is not a side word, so it cannot say whose man this is.`);
  }
}
