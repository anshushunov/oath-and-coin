import { resolve } from 'node:path';

import { loadAndRunScenario } from '@oath-and-coin/content/node';
import {
  BlockerKeys,
  OfferLeverId,
  blockingReasons,
  contractOfferScreenModel
} from '@oath-and-coin/presentation';
import { ReasonCodes } from '@oath-and-coin/simulation';
import { describe, expect, it } from 'vitest';

/**
 * The summary "what stands in the way" (`DEC-019`) on shipped runs, not on hand-built lines:
 * the lever it names for a reason read off `effectiveTags` has to be the one that works, and
 * which one works depends on where the tag came from — the contract itself, or the method the
 * package chose.
 *
 * The hand-built cases are `blocking-reasons.test.ts` and the factory's own suite. This file
 * holds them to the two runs that pose the question for real: one where changing the method
 * is exactly what opens a closed hero, and one where the tag an aversion fired on is the
 * contract's own.
 */

const repoRoot = resolve(import.meta.dirname, '..', '..', '..');
const SEED = 424242n;

function summaryAfter(scenario: string, checkpoint: string | null = null) {
  const result = loadAndRunScenario({ repositoryRoot: repoRoot, scenario, checkpoint, seed: SEED });

  if (result.kind !== 'ran') {
    throw new Error(`'${scenario}' did not reach 'ran' (kind: '${result.kind}').`);
  }

  const { finalState, steps } = result.outcome;

  return blockingReasons(contractOfferScreenModel(finalState, steps));
}

describe('what stands in the way, on shipped runs', () => {
  // The first compose of this run offers `method:open` and the key hero answers with a score;
  // the second offers `method:deception` and the same hero is closed by
  // `core:refuses_deception` (`negotiation-scenarios.test.ts` proves both halves). So the
  // method is the lever, and "Торгу не поддаётся" would be the lie the review found.
  it('sends a hero closed by a principle on the chosen method to the method', () => {
    const principleLines = summaryAfter('method_choice_flips_the_key_hero').filter(
      (line) => line.reasonCode === ReasonCodes.PrincipleForbids
    );

    expect(principleLines).toEqual([
      {
        reasonCode: ReasonCodes.PrincipleForbids,
        leverId: OfferLeverId.Terms,
        remedyKey: BlockerKeys.Method,
        heroDisplayNameKeys: ['hero.core.vela.name']
      }
    ]);
  });

  // `fixture:test_aversion` fires on `test:gamma`, which `fixture:gamma_job` carries itself,
  // and the package chose no method at all.
  it('does not send an aversion to the contract’s own tag to the method', () => {
    expect(summaryAfter('repulsion_by_inclination')).toEqual([
      {
        reasonCode: ReasonCodes.PersonalAversion,
        leverId: null,
        remedyKey: BlockerKeys.NotThisPackage,
        heroDisplayNameKeys: ['hero.fixture.averse_hero.name']
      }
    ]);
  });
});
