/**
 * What a hero is made of in a fight (`DEC-016` §1, `COMBAT_SPEC` §3.6).
 *
 * Five numbers, and the list is not invented here: `GDD` §6.2 already names the combat
 * half of the compact skill set as натиск, защита, точность, контроль, поддержка. A sixth
 * would be a change to the GDD; a fifth removed would leave one of the four roles
 * (`COMBAT_SPEC` §3.3) without an attribute of its own.
 *
 * **Its own layer, beside the motivational scales rather than among them** (`BQ-013`'s
 * direct instruction, `DEC-016` §2). `greed`, `caution`, `pride` and `trustInGuild` answer
 * "will he go"; these answer "how does he fight", and no rule reads both. The separation
 * is held by `combat/vocabulary.test.ts` rather than by intent.
 *
 * Bounds are declared in `packages/content/src/bounds.ts` as their own constants, not
 * borrowed from the trait scale: the numbers coincide and the quantities do not, and a
 * shared constant would tie a change in how greedy a hero may be to a change in how
 * strong a crew is.
 */
export interface HeroCombatLayer {
  /** Натиск — melee damage, and what is compared against a target's stability. */
  readonly might: number;

  /** Защита — where `maxHealth` and `stability` come from. */
  readonly guard: number;

  /** Точность — the effect of a rear-row action before obstruction. */
  readonly aim: number;

  /**
   * Контроль — initiative order within a round, and nothing else.
   *
   * Deliberately only that. An early draft had it set status durations as well; those are
   * fixed constants (`COMBAT_SPEC` §3.5), because one attribute driving both the queue and
   * how long a freeze lasts makes every test about duration a test about `focus`.
   */
  readonly focus: number;

  /** Поддержка — how much a heal restores. */
  readonly care: number;
}

/** Every attribute above, in declaration order — derived, never typed a second time. */
export const COMBAT_ATTRIBUTES = Object.freeze([
  'might',
  'guard',
  'aim',
  'focus',
  'care'
] as const satisfies readonly (keyof HeroCombatLayer)[]);

export type CombatAttribute = (typeof COMBAT_ATTRIBUTES)[number];
