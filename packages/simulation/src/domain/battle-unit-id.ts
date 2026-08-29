import { compareStrings } from '../collections/comparator.ts';

/**
 * A combatant's identity inside one battle. Stable for its length and no longer.
 *
 * Its own module rather than a member of `battle-unit.ts`, because a status instance names
 * the unit that applied it and a unit carries its statuses — two files each needing the
 * other's type is the cycle `lint:deps` refuses by name.
 */
export type BattleUnitId = string;

export const compareBattleUnitIds = compareStrings;
