import type { BattleUnitId } from './battle-unit-id.ts';
import type { StatusId } from './battle-status.ts';

/**
 * Where a number in a battle came from (`COMBAT_SPEC` §8.2).
 *
 * The pipeline that produces one is `combat/effect.ts`; the shape it produces is here,
 * because a `damage_dealt` carries it, the battle record carries the events, and the
 * stored resolution carries the record (§6.4).
 *
 * **The invariant this shape exists for:** `base + Σ delta === final`. A number that
 * cannot be taken apart does not reach the screen (`GDD` §21.4).
 */

/** Why a number moved. A closed vocabulary, artifact-safe, and a localization key. */
export const ModifierCodes = Object.freeze({
  /** The actor is chilled, so everything he does lands lighter (§3.5). */
  Chilled: 'combat.modifier.chilled',
  /** Cells stood in the way — his own as readily as theirs (§4.3). */
  Obstruction: 'combat.modifier.obstruction',
  /** The target was guarded, and a shield took the first of it (§3.5). */
  Guarded: 'combat.modifier.guarded'
});

export type ModifierCode = (typeof ModifierCodes)[keyof typeof ModifierCodes];

export const MODIFIER_CODES: readonly ModifierCode[] = Object.freeze(Object.values(ModifierCodes));

export interface ProvenanceStep {
  readonly code: ModifierCode;
  readonly source: BattleUnitId | StatusId;
  /** Signed: what this step did to the number. */
  readonly delta: number;
}

export interface AmountProvenance {
  readonly base: number;
  readonly steps: readonly ProvenanceStep[];
  readonly final: number;
}
