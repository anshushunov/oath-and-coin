import type {
  BattleEvent,
  BattleSide,
  BattleUnit,
  BattleUnitId,
  HeroId
} from '@oath-and-coin/simulation';

import {
  BattleEventKeys,
  BattleFieldKeys,
  battleOutcomeKey,
  battleStatusKey,
  combatActionKey,
  combatRoleKey,
  doctrineKey
} from './keys.ts';

/**
 * What one battle event is called, and what it needs beside a man's name (`COMBAT_SPEC` §8.1).
 *
 * **One module because two screens show the same journal.** The battle screen shows it as far
 * as the feed has got (§10.2) and the debrief shows all of it at once (§10.3) — the same list,
 * read at two moments — and two copies of this `switch` would be two answers to "what is a
 * `doctrine_broken` line called", which drift the day a nineteenth kind is added to one of
 * them.
 */

/**
 * One key per event kind, decided here and nowhere else.
 *
 * Exhaustive rather than a template over `event.kind`: the keys are a closed catalogue the
 * completeness check reads, and a template would let a nineteenth kind reach a screen with a
 * key no catalogue has a text for.
 */
export function battleEventKey(event: BattleEvent): string {
  switch (event.kind) {
    case 'battle_started':
      return BattleEventKeys.BattleStarted;
    case 'round_started':
      return BattleEventKeys.RoundStarted;
    case 'intent_declared':
      return BattleEventKeys.IntentDeclared;
    case 'damage_dealt':
      return BattleEventKeys.DamageDealt;
    case 'healing_done':
      return BattleEventKeys.HealingDone;
    case 'damage_absorbed':
      return BattleEventKeys.DamageAbsorbed;
    case 'status_applied':
      return BattleEventKeys.StatusApplied;
    case 'status_expired':
      return BattleEventKeys.StatusExpired;
    case 'unit_shifted':
      return BattleEventKeys.UnitShifted;
    case 'shift_resisted':
      return BattleEventKeys.ShiftResisted;
    case 'unit_pinned':
      return BattleEventKeys.UnitPinned;
    case 'turn_spent':
      return BattleEventKeys.TurnSpent;
    case 'unit_downed':
      return BattleEventKeys.UnitDowned;
    case 'doctrine_broken':
      return BattleEventKeys.DoctrineBroken;
    case 'retreat_signalled':
      return BattleEventKeys.RetreatSignalled;
    case 'retreat_obeyed':
      return BattleEventKeys.RetreatObeyed;
    case 'retreat_refused':
      return BattleEventKeys.RetreatRefused;
    case 'round_ended':
      return BattleEventKeys.RoundEnded;
    case 'battle_ended':
      return BattleEventKeys.BattleEnded;
  }
}

/** Whatever the line needs beside the man's name, as a key. */
export function battleDetailKey(event: BattleEvent): string | null {
  switch (event.kind) {
    case 'intent_declared':
      return combatActionKey(event.action);
    case 'status_applied':
    case 'status_expired':
      return battleStatusKey(event.status);
    case 'doctrine_broken':
      return event.motive;
    case 'retreat_refused':
      return event.motive;
    case 'battle_started':
      return doctrineKey(event.doctrine);
    case 'battle_ended':
      return battleOutcomeKey(event.outcome);
    case 'round_started':
    case 'round_ended':
    case 'damage_dealt':
    case 'healing_done':
    case 'damage_absorbed':
    case 'unit_shifted':
    case 'shift_resisted':
    case 'unit_pinned':
    case 'turn_spent':
    case 'unit_downed':
    case 'retreat_signalled':
    case 'retreat_obeyed':
      return null;
  }
}

/** What happened, as a number, on the three kinds that carry one (`DIRECTION` §4.7). */
export function battleAmount(event: BattleEvent): number | null {
  switch (event.kind) {
    case 'damage_dealt':
    case 'healing_done':
    case 'damage_absorbed':
      return event.amount;
    // Written out rather than defaulted, for the reason every other switch over this union
    // is: a nineteenth event kind that carried a number would otherwise reach the journal
    // with the number silently dropped, and nothing anywhere would say so.
    case 'battle_started':
    case 'round_started':
    case 'intent_declared':
    case 'status_applied':
    case 'status_expired':
    case 'unit_shifted':
    case 'shift_resisted':
    case 'unit_pinned':
    case 'turn_spent':
    case 'unit_downed':
    case 'doctrine_broken':
    case 'retreat_signalled':
    case 'retreat_obeyed':
    case 'retreat_refused':
    case 'round_ended':
    case 'battle_ended':
      return null;
  }
}

/**
 * The other man on the line, and the word between the two (`COMBAT_SPEC` §8.1, §10.2).
 *
 * **The owner's first play: «непонятно, кто куда бьёт».** A line read `Урон Противник
 * Столкновение 10` — who struck and how hard, and nothing about whom. PR #57 gave every line
 * its subject (`unitNamedBy`); this is the second man, on the eight kinds that carry one, and
 * `null` on the eleven that do not — a step into an empty cell carries no shover and a spent
 * turn nobody else, and a line that invented one would be teaching the reader a fight that
 * did not happen.
 *
 * **The link says which way it went, and it has to.** The event's own wording is about its
 * subject — «Урон» is what the subject dealt, «Сбит» is what happened to him — so the other
 * man is sometimes the one struck and sometimes the one who struck. One arrow for both would
 * name the wrong man as the one who acted on half the lines.
 */
export interface BattleCounterpart {
  readonly unit: BattleUnitId;
  readonly linkKey: string;
}

export function battleCounterpart(event: BattleEvent): BattleCounterpart | null {
  switch (event.kind) {
    case 'intent_declared':
      return event.target === null ? null : { unit: event.target, linkKey: BattleFieldKeys.To };
    case 'damage_dealt':
    case 'healing_done':
      return { unit: event.target, linkKey: BattleFieldKeys.To };
    case 'damage_absorbed':
      return { unit: event.by, linkKey: BattleFieldKeys.From };
    case 'status_applied':
      return { unit: event.source, linkKey: BattleFieldKeys.From };
    case 'unit_shifted':
      return event.partner === null ? null : { unit: event.partner, linkKey: BattleFieldKeys.With };
    case 'shift_resisted':
    case 'unit_downed':
      return { unit: event.by, linkKey: BattleFieldKeys.From };
    case 'status_expired':
    case 'unit_pinned':
    case 'turn_spent':
    case 'doctrine_broken':
    case 'retreat_obeyed':
    case 'retreat_refused':
    case 'battle_started':
    case 'round_started':
    case 'retreat_signalled':
    case 'round_ended':
    case 'battle_ended':
      return null;
  }
}

/** Whose man this is, as the one word a screen may say about a side. */
export const sideKeyOf = (side: BattleSide): string =>
  side === 'crew' ? BattleFieldKeys.Crew : BattleFieldKeys.Foes;

/**
 * What a screen calls a man: his name when he has one, his side and his job always.
 *
 * **One rule, applied to everybody a line names.** PR #57 wrote it for the subject after the
 * frame read `Намерение Выстрел` — an act with no subject — and the target is named by the
 * same function rather than by a second one, so the two cannot drift: a foe is «Противник
 * Столкновение» whether he struck or was struck.
 */
export interface BattleWho {
  readonly displayNameKey: string | null;
  readonly sideKey: string;
  readonly roleKey: string;
}

export function battleWho(
  unit: BattleUnit,
  displayNameKeyOf: (hero: HeroId) => string | null
): BattleWho {
  return {
    displayNameKey: unit.hero === null ? null : displayNameKeyOf(unit.hero),
    sideKey: sideKeyOf(unit.side),
    roleKey: combatRoleKey(unit.role)
  };
}
