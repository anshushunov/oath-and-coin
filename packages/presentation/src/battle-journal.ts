import type { BattleEvent } from '@oath-and-coin/simulation';

import {
  BattleEventKeys,
  battleOutcomeKey,
  battleStatusKey,
  combatActionKey,
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
