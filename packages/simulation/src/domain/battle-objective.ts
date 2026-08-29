import type { BattleUnitId } from './battle-unit-id.ts';

/**
 * What a contract's need becomes once the crew is sent to fight for it
 * (`COMBAT_SPEC` §6.2, `ADR-016` §1).
 *
 * **Authored data, never inferred from the need's name.** "Frontline" is a hold on one
 * contract and a subduing on the next, and a rule that read it off the identifier would be
 * the content's meaning invented by the engine — which is also why the mapping moves with
 * the contract file rather than living in a table here.
 *
 * Three kinds and no more, because each counts something different and the three cover what
 * a short battle can be about: put N of them down, keep one of ours up, stand for N rounds.
 * A fourth would need its own increment rule (§6.2.1) and its own column in §6.2.2, and
 * neither is free.
 */
export const BattleObjectiveKind = Object.freeze({
  Subdue: 'subdue',
  Protect: 'protect',
  Hold: 'hold'
});

export type BattleObjectiveKind = (typeof BattleObjectiveKind)[keyof typeof BattleObjectiveKind];

export const BATTLE_OBJECTIVE_KINDS: readonly BattleObjectiveKind[] = Object.freeze(
  Object.values(BattleObjectiveKind)
);

export type BattleObjective =
  /** Each of the named foes that goes down counts (`COMBAT_SPEC` §6.2). */
  | { readonly kind: 'subdue'; readonly targets: readonly BattleUnitId[] }
  /** What the ward has left of his health counts. */
  | { readonly kind: 'protect'; readonly ward: BattleUnitId }
  /** Each round the crew stands counts, up to `rounds`. */
  | { readonly kind: 'hold'; readonly rounds: number };
