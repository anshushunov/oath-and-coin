import { join, resolve } from 'node:path';

import { loadContentSet } from '@oath-and-coin/content/node';
import { describe, expect, it } from 'vitest';

import { DOCTRINE_IDS } from '@oath-and-coin/simulation';

import { fightTheCoreSet, measureAll } from './metrics.ts';

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

describe('the shape of the frozen set (COMBAT_SPEC §12.5)', () => {
  const fought = fightTheCoreSet(content);

  it('fights every doctrine, not the one the set used to stand on', () => {
    // **A mutant replacing the loop with `HoldTheLine` alone stayed green on everything
    // else**: 210 battles instead of 630, and every corridor still inside itself. External
    // review found it, and the reason it matters is what the audit found first — under that
    // one doctrine `status` and `shift` are never chosen, so two of the eight actions of
    // §4.1 and two of the four statuses of §3.5 take no part in any of the eight numbers.
    const byDoctrine = new Map<string, number>();

    for (const one of fought) {
      byDoctrine.set(one.doctrine, (byDoctrine.get(one.doctrine) ?? 0) + 1);
    }

    expect([...byDoctrine.keys()].sort()).toEqual([...DOCTRINE_IDS].sort());
    expect(new Set(byDoctrine.values()), 'every doctrine fights the same set').toHaveLength(1);
  });

  it('gives every contract, crew and formation all three orders', () => {
    // Stated as the product rather than as a total: a set of the right *size* built by
    // fighting one board three times would satisfy a count and measure nothing.
    const orders = new Map<string, Set<string>>();

    for (const one of fought) {
      const board = `${one.contract}|${one.crew}|${one.shape}`;

      orders.set(board, (orders.get(board) ?? new Set<string>()).add(one.doctrine));
    }

    expect(orders.size * DOCTRINE_IDS.length).toBe(fought.length);

    for (const [board, seen] of orders) {
      expect([...seen].sort(), board).toEqual([...DOCTRINE_IDS].sort());
    }
  });
});

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
