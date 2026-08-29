import { CombatAction } from '../domain/combat-action.ts';
import { DOCTRINE_IDS, DoctrineId, compareDoctrineIds } from '../domain/doctrine-id.ts';

/**
 * The one group order a player gives before a battle (`COMBAT_SPEC` §7.2, `MVP_PLAN` §6.2).
 *
 * A doctrine is a **strong preference, not a prohibition**, and that is the whole reason it
 * can be broken and the breach noticed (`COMBAT_SPEC` §7.3). Expressed as an order of
 * preference over actions rather than as a set of rules, because an order is what a rule
 * that "moves the ranking" can actually be: a hero takes the first thing on his doctrine's
 * list that is available to him, and the personality reaction is the one thing that reaches
 * past the list entirely.
 *
 * The **name** of a doctrine lives in `domain/doctrine-id.ts`: the one a player chose is
 * stored on the contract's package and has to survive a save. The order it implies is a
 * rule, and it is here.
 */

export { DOCTRINE_IDS, DoctrineId, compareDoctrineIds };

/**
 * What each doctrine reaches for first (`COMBAT_SPEC` §5.1).
 *
 * `Reposition` sits where it does on purpose. Under `hold_the_line` it comes **first**,
 * because that doctrine is about standing where you belong and a man knocked out of his row
 * goes back; under the other two it is last but one, ahead only of doing nothing. `Steady`
 * closes every list, so "nothing to do" is never a turn that vanishes without a reason
 * (§4.1).
 */
export const DOCTRINE_PREFERENCE: Readonly<Record<DoctrineId, readonly CombatAction[]>> =
  Object.freeze({
    [DoctrineId.HoldTheLine]: Object.freeze([
      CombatAction.Reposition,
      CombatAction.Strike,
      CombatAction.ShortStrike,
      CombatAction.Shot,
      CombatAction.Status,
      CombatAction.Support,
      CombatAction.Shift,
      CombatAction.Steady
    ]),
    [DoctrineId.BreakThemFirst]: Object.freeze([
      CombatAction.Shift,
      // Control before damage, and this is the one list that puts it there. Without it
      // `Status` would be unreachable in every doctrine — a shot is always available to a
      // rear unit when anybody stands, so a ranking that never prefers the status is a
      // ranking in which one of the four statuses can never be applied at all.
      CombatAction.Status,
      CombatAction.Strike,
      CombatAction.ShortStrike,
      CombatAction.Shot,
      CombatAction.Support,
      CombatAction.Reposition,
      CombatAction.Steady
    ]),
    [DoctrineId.SpareThePeople]: Object.freeze([
      CombatAction.Support,
      CombatAction.Strike,
      CombatAction.ShortStrike,
      CombatAction.Shot,
      CombatAction.Status,
      CombatAction.Shift,
      CombatAction.Reposition,
      CombatAction.Steady
    ])
  });
