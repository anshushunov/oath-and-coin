import {
  MODIFIER_CODES,
  ModifierCodes,
  type AmountProvenance,
  type ModifierCode,
  type ProvenanceStep
} from '../domain/battle-provenance.ts';
import type { BattleUnitId } from '../domain/battle-unit-id.ts';
import { divideTowardZero, multiplyInt32 } from '../integer-division.ts';

import { effectPercent } from './field.ts';

/**
 * How a base number becomes the number that happened, and the record of every step
 * (`COMBAT_SPEC` §3.6, §8.2).
 *
 * The record is the point. `GDD` §21.4 asks that every number name where it came from, and
 * `DIRECTION_2026-08` §4.7 records what the debrief screen costs without it: the claim
 * "the data is already in the engine" was false, and provenance is the part that has to be
 * designed rather than exported.
 *
 * The **shape** of that record lives in `domain/battle-provenance.ts`, because a
 * `damage_dealt` carries it and the stored resolution carries the events (§6.4). The
 * pipeline that fills it is here.
 */

export { MODIFIER_CODES, ModifierCodes };
export type { AmountProvenance, ModifierCode, ProvenanceStep };

export interface EffectInput {
  readonly base: number;
  /** Percentage points the actor loses to being chilled — `0` or `CHILL_EFFECT`. */
  readonly chillPoints: number;
  readonly blockers: number;
  /** How much the target's shield absorbs, and who put it there. */
  readonly absorb: { readonly amount: number; readonly by: BattleUnitId } | null;
  /** Which unit is chilled, for the step to name. */
  readonly actor: BattleUnitId;
}

/**
 * Applies §3.6's pipeline and returns the number with its reasons.
 *
 * **The order is fixed and arithmetically significant**: under truncation, chilling then
 * obstructing is not the same as the reverse. The floor is applied to the *combined*
 * reduction rather than to each part, so a chilled actor behind one blocker keeps 40% and
 * not 70% of 70%.
 *
 * The two reductions are still recorded as two steps, and their deltas are the real
 * arithmetic rather than a share invented for the screen: the chill step is what chilling
 * alone would have cost, and the obstruction step is the rest. `base + Σ delta === final`
 * exactly, which is the invariant `COMBAT_SPEC` §12.1 п.1 holds.
 */
export function applyEffect(input: EffectInput): AmountProvenance {
  const steps: ProvenanceStep[] = [];

  const afterChill = scaled(input.base, effectPercent(0, input.chillPoints));

  if (input.chillPoints > 0) {
    steps.push({
      code: ModifierCodes.Chilled,
      source: input.actor,
      delta: afterChill - input.base
    });
  }

  const afterBoth = scaled(input.base, effectPercent(input.blockers, input.chillPoints));

  if (input.blockers > 0) {
    steps.push({
      code: ModifierCodes.Obstruction,
      source: input.actor,
      delta: afterBoth - afterChill
    });
  }

  const absorbed = input.absorb === null ? afterBoth : Math.max(0, afterBoth - input.absorb.amount);

  if (input.absorb !== null && absorbed !== afterBoth) {
    steps.push({
      code: ModifierCodes.Guarded,
      source: input.absorb.by,
      delta: absorbed - afterBoth
    });
  }

  return { base: input.base, steps, final: absorbed };
}

/** How much of `amount` a shield actually took, for the `damage_absorbed` event. */
export function absorbedBy(provenance: AmountProvenance): number {
  return provenance.steps
    .filter((step) => step.code === ModifierCodes.Guarded)
    .reduce((sum, step) => sum - step.delta, 0);
}

/** What the formation cost this number — the aggregate §8.3 calls «съедено строем». */
export function eatenByTheFormation(provenance: AmountProvenance): number {
  return provenance.steps
    .filter((step) => step.code === ModifierCodes.Obstruction)
    .reduce((sum, step) => sum - step.delta, 0);
}

function scaled(value: number, percent: number): number {
  return divideTowardZero(multiplyInt32(value, percent), 100);
}
