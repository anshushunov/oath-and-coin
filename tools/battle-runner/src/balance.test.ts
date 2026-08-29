import { join, resolve } from 'node:path';

import { loadContentSet } from '@oath-and-coin/content/node';
import { describe, expect, it } from 'vitest';

import { measureAll } from './metrics.ts';

/**
 * The eight corridors of `COMBAT_SPEC` §12.5, taken over the **shipped** content.
 *
 * This is the file that goes red when the game drifts out of what was declared before
 * balancing, and it is the reason the corridors are a gate rather than a paragraph. It is
 * also the slowest test in this repository by some distance — it fights the whole frozen set
 * — and that is the price of a balance claim that is measured rather than asserted.
 *
 * **The numbers are not pinned here.** A test asserting "the median is 7" would go red on
 * every content edit and teach whoever hit it to update the number; what is asserted is the
 * corridor, which is the thing that was decided. The values themselves are printed by
 * `battle-runner report --set core`, which is where a PR quotes them from (`AGENTS.md` §11).
 */

const repoRoot = resolve(import.meta.dirname, '..', '..', '..');
const content = loadContentSet(join(repoRoot, 'content'));
const measured = measureAll(content);

describe('the balance corridors declared before balancing (COMBAT_SPEC §12.5)', () => {
  it('measures all eight, so a missing one cannot pass by not being asked', () => {
    expect(measured.map((one) => one.id)).toEqual([
      'battle_length_rounds',
      'doctrine_breach_percent',
      'formation_changes_outcome_percent',
      'formation_strict_dominance',
      'six_against_four_percent',
      'rear_effect_by_own_men_ahead',
      'forecast_agreement_percent',
      'dominant_crew_percent'
    ]);
  });

  it('takes every one of them over more than one battle', () => {
    // A share of nothing is not a share, and a median of one case is that case. The most
    // comfortable way for this whole file to be green about nothing.
    for (const one of measured) {
      expect(one.cases, one.id).toBeGreaterThan(1);
    }
  });

  it.each(measured.map((one) => [one.id, one] as const))(
    '%s is inside the corridor §12.5 declared, or open by a decision that names itself',
    (_id, one) => {
      expect(
        `${one.id} = ${String(one.value)}${one.note === undefined ? '' : ` (${one.note})`}`,
        `${one.id} is outside its declared corridor (${one.threshold}). Either the numbers of ` +
          'COMBAT_SPEC §3.6/§4.3 need balancing or the corridor was wrong — and which of the ' +
          'two it is is a decision, not a number to nudge (§12.5, MVP_PLAN §6.4).'
      ).toSatisfy(() => one.status !== 'fail');
    }
  );
});
