import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { memoryFileSource } from '../file-source.ts';
import { loadContentSet, nodeFileSource } from '../node/index.ts';

import {
  SUPPORTED_CONTRAST_SCHEMA_VERSION,
  loadContrastDefinition,
  type ContrastDefinition
} from './contrast-definition.ts';
import { runContrast } from './contrast-runner.ts';

/**
 * The runner's own properties, over the real content the repository ships — a fixture
 * literal that validated nothing would prove nothing about the loader that stands between
 * an author's JSON and a `ContrastDefinition` (`AGENTS.md` §2.1). Every contrast below is
 * built through {@link loadContrastDefinition}, the same door the shipped files go through.
 */

const repoRoot = resolve(import.meta.dirname, '..', '..', '..', '..');
const content = loadContentSet(resolve(repoRoot, 'content'));

/** `risk_raised.json`'s own numbers: mira declines `core:escort_the_caravan` once its risk
 * reaches 100, robustly across every mood the seed-2/ordinal-0 draw could produce — the
 * default every test below overrides only what it is about. */
const CONTRAST: Readonly<Record<string, unknown>> = {
  schema_version: SUPPORTED_CONTRAST_SCHEMA_VERSION,
  contrast: 'c',
  content_root: 'content',
  seed: 2,
  hero: 'core:mira',
  contract: 'core:escort_the_caravan',
  vary: { input: 'contract.risk', from: 0, to: 100 },
  expect: 'accept_to_decline'
};

interface ContrastOverrides {
  readonly input?: string;
  readonly from?: unknown;
  readonly to?: unknown;
  readonly expect?: string;
  readonly hero?: string;
  readonly contract?: string;
  readonly seed?: number;
}

function aContrast(overrides: ContrastOverrides): ContrastDefinition {
  const file = {
    ...CONTRAST,
    hero: overrides.hero ?? CONTRAST.hero,
    contract: overrides.contract ?? CONTRAST.contract,
    seed: overrides.seed ?? CONTRAST.seed,
    expect: overrides.expect ?? CONTRAST.expect,
    vary: {
      input: overrides.input ?? (CONTRAST.vary as { input: string }).input,
      from: overrides.from ?? (CONTRAST.vary as { from: unknown }).from,
      to: overrides.to ?? (CONTRAST.vary as { to: unknown }).to
    }
  };

  return loadContrastDefinition(memoryFileSource({ 'c.json': JSON.stringify(file) }), 'c.json');
}

describe('the contrast runner', () => {
  it('runs both sides on the same seed and the same ordinal', () => {
    // A runner that answered `left` by revising the state `right` is built from — or the
    // reverse — would draw `right` at an ordinal `left` had already advanced past. Building
    // both sides independently from the same untouched starting state is what this pins.
    const run = runContrast(aContrast({ input: 'offer.advance', from: 0, to: 40 }), content);

    expect(run.left.seed).toBe(run.right.seed);
    expect(run.left.ordinal).toBe(run.right.ordinal);
  });

  it('does not count a flip in the wrong direction as the declared flip', () => {
    // The true direction here is accept_to_decline (risk_raised.json's own numbers, see
    // `CONTRAST` above): mira accepts core:escort_the_caravan at risk 0 and declines it at
    // risk 100. Declaring the opposite direction must not read as "flipped" just because
    // the answer changed — an implementation that only compared `left !== right` would
    // pass this contrast anyway.
    const run = runContrast(
      aContrast({ expect: 'decline_to_accept', input: 'contract.risk', from: 0, to: 100 }),
      content
    );

    expect(run.flipped).toBe(false);
  });

  it('flips every shipped contrast as it declares', () => {
    const contrastsRoot = resolve(repoRoot, 'scenarios', 'contrasts');
    const source = nodeFileSource(contrastsRoot);
    const files = readdirSync(contrastsRoot)
      .filter((name) => name.endsWith('.json'))
      .sort();

    // A floor, not merely "some": `> 0` would keep this green after a shipped contrast was
    // deleted, exactly the way `orphaned-data.test.ts`'s old `toBe(4)` on this same
    // directory caught nothing when `comrade_accepted_first.json` was briefly removed —
    // the assertion has to fall if the count falls, not merely if it hits zero. Nine is
    // the count this task ships (`payment_raised`, `risk_raised`,
    // `tag_added_that_a_trait_hates`, `comrade_accepted_first`, `advance_raised`,
    // `method_switched_to_deception`, `bonus_promised`, `grievance_remembered`,
    // `stopped_believing`); a tenth added later only raises the floor further.
    expect(files.length).toBeGreaterThanOrEqual(9);

    for (const file of files) {
      const definition = loadContrastDefinition(source, file);
      const contentForThisContrast = loadContentSet(resolve(repoRoot, definition.contentRoot));

      expect(runContrast(definition, contentForThisContrast).flipped, file).toBe(true);
    }
  });
});
