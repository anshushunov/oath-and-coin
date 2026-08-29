/**
 * What a unit is doing on its turn (`COMBAT_SPEC` §4.1).
 *
 * **Its own module, and the split is not cosmetic.** A doctrine is an order of preference
 * over these (`doctrine.ts`) and an event names the one that was taken (`events.ts`), so
 * with the enum living beside the events the two files import each other and `lint:deps`
 * refuses the cycle by name. The vocabulary is what both of them depend on; it depends on
 * neither.
 */

export const CombatAction = Object.freeze({
  Strike: 'strike',
  ShortStrike: 'short_strike',
  Shot: 'shot',
  Status: 'status',
  Support: 'support',
  Shift: 'shift',
  Reposition: 'reposition',
  Steady: 'steady'
});

export type CombatAction = (typeof CombatAction)[keyof typeof CombatAction];

export const COMBAT_ACTIONS: readonly CombatAction[] = Object.freeze(Object.values(CombatAction));
