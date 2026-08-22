import {
  computeContentVersion,
  memoryFileSource,
  type ContentFileSource
} from '@oath-and-coin/content';
import { ScreenState, readModelHash } from '@oath-and-coin/presentation';
import { describe, expect, it } from 'vitest';

import type { ContentSourcePort } from './ports.ts';
import { startSession } from './session.ts';

/**
 * The layer read through the port, with no filesystem anywhere.
 *
 * Every fixture below is an in-memory source, which is the same door `apps/web` goes
 * through — so these tests exercise the browser path rather than a Node path that
 * happens to be convenient. The shipped tree is covered elsewhere and covered harder:
 * `pnpm scenario:parity` runs the very function under test, `screenFor`, against all 54
 * frozen corpus entries.
 *
 * What is checked here is what parity cannot see, because the corpus has no entry for
 * it: that the three-way split lands on the right screen, that a machine-dependent
 * error message stays out of what gets hashed, and that the content version a session
 * reports is the one its own content produced.
 */

const HERO = {
  schema_version: 3,
  id: 'core:bram',
  display_name_key: 'hero.core.bram.name',
  greed: 60,
  caution: 30,
  pride: 45,
  trust_in_guild: 50,
  traits: ['core:greedy'],
  relationships: []
};

const CONTRACT = {
  schema_version: 3,
  id: 'core:escort',
  display_name_key: 'contract.core.escort.name',
  patron_fee: 70,
  risk: 30,
  required_crew: 1,
  tags: ['method:escort']
};

const TRAIT = {
  schema_version: 3,
  id: 'core:greedy',
  display_name_key: 'trait.core.greedy.name',
  kind: 'inclination',
  tag: 'method:escort',
  weight: 20
};

function contentTree(overrides: { readonly patron_fee?: number } = {}): ContentFileSource {
  return memoryFileSource({
    'heroes/bram.json': JSON.stringify(HERO),
    'contracts/escort.json': JSON.stringify({ ...CONTRACT, ...overrides }),
    'traits/greedy.json': JSON.stringify(TRAIT)
  });
}

interface ScenarioFixture {
  readonly manifest: Record<string, unknown>;
  readonly commands?: Record<string, unknown>;
}

/**
 * A port over exactly one content root, named `fixture-content`.
 *
 * Anything else answers `null`, which is what makes `CONTENT_ROOT_NOT_FOUND` reachable
 * without a filesystem to delete a directory from.
 */
function portOver(scenario: ScenarioFixture, content: ContentFileSource | null): ContentSourcePort {
  const files: Record<string, string> = {
    'fixture.manifest.json': JSON.stringify(scenario.manifest)
  };
  if (scenario.commands !== undefined) {
    files['fixture.commands.json'] = JSON.stringify(scenario.commands);
  }

  return {
    scenarios: memoryFileSource(files),
    openContentRoot: (path) => (path === 'fixture-content' && content !== null ? content : null)
  };
}

const ranScenario: ScenarioFixture = {
  manifest: {
    schema_version: 1,
    scenario: 'fixture',
    expected_outcome: 'success',
    expected_screen_state: 'normal',
    content_root: 'fixture-content',
    checkpoints: [
      { name: 'start', after_command_id: 0 },
      { name: 'final', after_command_id: 1 }
    ]
  },
  commands: {
    commands: [{ command_id: 1, hero_index: 0, contract: 'core:escort', expected_state_version: 0 }]
  }
};

const loadingScenario: ScenarioFixture = {
  manifest: {
    schema_version: 1,
    scenario: 'fixture',
    expected_outcome: 'loading',
    expected_screen_state: 'loading',
    checkpoints: [{ name: 'start', after_command_id: 0 }]
  }
};

const failingScenario: ScenarioFixture = {
  manifest: {
    schema_version: 1,
    scenario: 'fixture',
    expected_outcome: 'error',
    fault: { kind: 'missing_content_root', path: 'nowhere' },
    expected_error_code: 'CONTENT_ROOT_NOT_FOUND',
    expected_screen_state: 'error',
    checkpoints: [{ name: 'start', after_command_id: 0 }]
  }
};

function session(
  scenario: ScenarioFixture,
  content: ContentFileSource | null = contentTree(),
  checkpoint: string | null = null
) {
  return startSession({
    content: portOver(scenario, content),
    scenario: 'fixture',
    checkpoint,
    seed: 424242n
  });
}

describe('the screen a session lands on', () => {
  it('is Loading for a scenario shown before any content is read', () => {
    expect(session(loadingScenario, null).screen.state).toBe(ScreenState.Loading);
  });

  it('is not Empty for that scenario, which is a different screen with a different hash', () => {
    // The one mutant this file exists for. `loading` is a fact about the manifest and
    // `empty` is a fact about a campaign with nothing to offer; a session that inferred
    // Loading from an absence of content would collapse the two, and the corpus records
    // `screen_loading` and `screen_empty` with the same content and different
    // `read_model.sha256`.
    const loading = session(loadingScenario, null).screen;
    const empty = session(
      { ...ranScenario, manifest: { ...ranScenario.manifest, content_root: 'fixture-content' } },
      memoryFileSource({
        'heroes/bram.json': JSON.stringify(HERO),
        // A `contracts/` directory that exists and offers nothing. Not a `.json`, so
        // the loader finds the directory and loads no contract out of it — which is
        // the campaign an `Empty` screen describes.
        'contracts/README.md': 'this campaign has nothing on offer',
        'traits/greedy.json': JSON.stringify(TRAIT)
      })
    ).screen;

    expect(loading.state).toBe(ScreenState.Loading);
    expect(empty.state).toBe(ScreenState.Empty);
    expect(readModelHash(loading)).not.toBe(readModelHash(empty));
  });

  it('is Error when the content root the manifest names is not there', () => {
    const state = session(failingScenario, null);

    expect(state.screen.state).toBe(ScreenState.Error);
    expect(state.screen.errorCode).toBe('CONTENT_ROOT_NOT_FOUND');
  });

  it('is a run screen when the scenario ran', () => {
    const state = session(ranScenario);

    expect(state.screen.state).toBe(ScreenState.Normal);
    expect(state.screen.responses).toHaveLength(1);
  });

  it('is the screen of the checkpoint asked for, not of the whole scenario', () => {
    // The checkpoint is an input, and a session that dropped it would answer the same
    // screen for every point in a run — which is precisely what the harness of Task 15
    // drives five different states from.
    const state = session(ranScenario, contentTree(), 'start');

    expect(state.screen.state).toBe(ScreenState.Incomplete);
    expect(state.screen.responses).toEqual([]);
  });
});

describe('the error detail', () => {
  it('is carried beside the screen, for a human to read', () => {
    expect(session(failingScenario, null).errorDetail).toContain('does not exist');
  });

  it('is absent from a session that did not fail', () => {
    expect(session(ranScenario).errorDetail).toBeNull();
    expect(session(loadingScenario, null).errorDetail).toBeNull();
  });

  it('does not reach the hash, however much of it differs', () => {
    // It can name an absolute path, so it is a property of the machine rather than of
    // the game. Two runs failing the same way on two machines have to produce the same
    // read model, or every hash the corpus records would be unreproducible off the
    // machine that recorded it.
    const here = session(failingScenario, null);
    const elsewhere = session(
      {
        manifest: {
          ...failingScenario.manifest,
          fault: { kind: 'missing_content_root', path: 'somewhere/else/entirely' }
        }
      },
      null
    );

    expect(elsewhere.errorDetail).not.toBe(here.errorDetail);
    expect(readModelHash(elsewhere.screen)).toBe(readModelHash(here.screen));
  });
});

describe('the content version a session reports', () => {
  it('is the one its own content digests to', () => {
    const content = contentTree();

    expect(session(ranScenario, content).contentVersion).toBe(computeContentVersion(content));
  });

  it('moves when the content moves', () => {
    // A version read from anywhere but the loaded content — a constant, another tree,
    // the manifest — would survive an edit, and a replay claiming "same content" over
    // edited numbers is worse than one admitting it cannot reproduce the run.
    const before = session(ranScenario, contentTree()).contentVersion;
    const after = session(ranScenario, contentTree({ patron_fee: 71 })).contentVersion;

    expect(after).not.toBe(before);
  });

  it('is absent, with the canonical hash, for a run that produced no artifact', () => {
    for (const state of [session(loadingScenario, null), session(failingScenario, null)]) {
      expect(state.contentVersion).toBeNull();
      expect(state.canonicalHash).toBeNull();
    }
  });

  it('comes with a canonical hash for a run that did', () => {
    expect(session(ranScenario).canonicalHash).toMatch(/^[0-9a-f]{64}$/u);
  });
});

describe('the campaign a session carries', () => {
  it('is the state the run ended on, not a projection of it', () => {
    // Until Task 16 a session kept the screen and threw the campaign away, and a
    // campaign is the whole of what a save file holds — there is nothing to write
    // without it. The screen cannot stand in for it: it is a lossy projection by
    // design, and `snapshot-codec.ts`'s own module comment says why (design spec §1.1).
    const state = session(ranScenario).state;

    expect(state).not.toBeNull();
    expect(state?.history).toHaveLength(1);
    expect(state?.metadata.contentVersion).toBe(computeContentVersion(contentTree()));
  });

  it('is absent exactly where the content version already is', () => {
    for (const state of [session(loadingScenario, null), session(failingScenario, null)]) {
      expect(state.state).toBeNull();
      expect(state.contentVersion).toBeNull();
    }
  });
});

describe('what a fresh run says about saving', () => {
  it('has no save behind it and no refusal in front of it', () => {
    // Both `null` from a run rather than from a save: `savedStateHash` names the file
    // this session was loaded from or last written to, and a run has written none.
    // Reported as `null` rather than as an empty string for the reason the module
    // comment gives about the other two — "no save" and "a save whose signature is the
    // empty string" are different claims.
    const state = session(ranScenario);

    expect(state.savedStateHash).toBeNull();
    expect(state.saveFailure).toBeNull();
  });
});
