import { byDeclarationOrder, type Comparator } from '../collections/comparator.ts';

/**
 * Which of the four jobs a hero holds in a fight (`COMBAT_SPEC` §3.3, `DEC-016` §5).
 *
 * A closed engine vocabulary, like `NeedId` and `ReasonCodes`: content states which role a
 * hero holds, never invents one. The literals are stable strings because they reach a
 * canonical artifact and become localization keys, so renaming one is a save-format and a
 * text change rather than a rename.
 *
 * **A role is a home, not a pass.** What a unit may do is decided by the row it is standing
 * in right now (`COMBAT_SPEC` §4.1); the role says which row is its own and carries one
 * modifier to `stability`. That is what makes "knock him off his row" a mechanic instead of
 * a line of text — a `Vanguard` pushed into the rear has none of his own actions there.
 */
export const CombatRole = Object.freeze({
  /** Столкновение — row 1: takes the blow, fights in melee. */
  Vanguard: 'vanguard',

  /** Опора — row 2: reaches depth 1, heals and shields its own row 1. */
  Support: 'support',

  /** Тыл — row 3: ranged and magic at any depth, statuses. */
  Rear: 'rear',

  /** Ломающий строй — rows 1 and 2: forced displacement. */
  Breaker: 'breaker'
});

export type CombatRole = (typeof CombatRole)[keyof typeof CombatRole];

/** Every role above, in declaration order — derived, never typed a second time. */
export const COMBAT_ROLES: readonly CombatRole[] = Object.freeze(Object.values(CombatRole));

/**
 * Declaration order, not alphabet — the comparator any `SortedMap<CombatRole, …>` is built
 * with, for the reason `compareNeedIds` gives at length: a second ordering would make the
 * canonical artifact a function of which comparator a call site happened to pass.
 */
export const compareCombatRoles: Comparator<CombatRole> = byDeclarationOrder(COMBAT_ROLES);
