import { describe, expect, it } from 'vitest';

import { resolveContentRoot } from './content-root.ts';
import { ScenarioOutcomeKind, type ScenarioManifest } from './scenario-manifest.ts';

/**
 * Which content root a scenario decides on, and which spellings of one it refuses.
 *
 * The refusals are the part external review of Task 13 asked for, and the reason is
 * that a second implementation of `ContentFileSource` now exists. `content_root` is an
 * unconstrained string in the manifest schema, and the two implementations do not
 * agree on every string: a filesystem resolves `..` and reads a directory, a bundle
 * holds a flat set of repository-relative paths and finds no such prefix. One manifest
 * would then produce a loaded content set on the desktop and `CONTENT_ROOT_NOT_FOUND`
 * in the browser, and nothing anywhere would report a disagreement.
 *
 * Refused here rather than in each source, because this is the one place that reads
 * the manifest's decision — and a rule stated twice is a rule that can be stated
 * differently.
 */

function aManifest(overrides: Partial<ScenarioManifest> = {}): ScenarioManifest {
  return {
    schemaVersion: 1,
    scenario: 'a_scenario',
    expectedOutcome: ScenarioOutcomeKind.Success,
    fault: null,
    expectedErrorCode: null,
    checkpoints: [{ name: 'final', afterCommandId: 0 }],
    contentRoot: null,
    expectedScreenState: null,
    ...overrides
  };
}

describe('the root a manifest decides on', () => {
  it('is the production tree when the manifest says nothing', () => {
    expect(resolveContentRoot(aManifest())).toBe('content');
  });

  it('is the one the manifest names, spelled with forward slashes', () => {
    expect(
      resolveContentRoot(aManifest({ contentRoot: 'scenarios\\fixtures\\decision_core' }))
    ).toBe('scenarios/fixtures/decision_core');
  });

  it('is under artifacts when the manifest declares a missing-root fault', () => {
    expect(
      resolveContentRoot(
        aManifest({
          expectedOutcome: ScenarioOutcomeKind.Error,
          fault: { kind: 'missing_content_root', path: 'fixtures/does-not-exist' }
        })
      )
    ).toBe('artifacts/oracle-faults/fixtures/does-not-exist');
  });
});

describe('a root the two implementations of the port would read differently', () => {
  // Each of these is a string the manifest schema accepts today. A filesystem answers
  // one thing about it and a set of bundled paths answers another, so the only way for
  // the two runtimes to agree is for neither to be asked.
  const cases = [
    ['navigating out of a fixture', 'scenarios/fixtures/decision_core/../screen_empty'],
    ['navigating out of the repository', '../content'],
    ['naming the current directory', './content'],
    ['absolute on POSIX', '/etc'],
    ['absolute on Windows', 'C:/content'],
    ['empty', ''],
    ['nothing but separators', '///']
  ] as const;

  it.each(cases)('is refused when %s', (_description, contentRoot) => {
    expect(() => resolveContentRoot(aManifest({ contentRoot }))).toThrow();
  });

  it('is refused in a fault path too', () => {
    // The fault composes its root from an authored fragment, and a fragment that
    // climbed out of `artifacts/` would name a directory that exists — turning the one
    // scenario whose whole purpose is to fail into one that quietly succeeds.
    expect(() =>
      resolveContentRoot(
        aManifest({
          expectedOutcome: ScenarioOutcomeKind.Error,
          fault: { kind: 'missing_content_root', path: '../../content' }
        })
      )
    ).toThrow();
  });
});
