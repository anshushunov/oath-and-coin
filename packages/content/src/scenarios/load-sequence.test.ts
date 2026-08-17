import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ERROR_CODES, ErrorCodes } from '../error-codes.ts';

import { loadAndRunScenario, type ScenarioRunResult } from './load-sequence.ts';

/**
 * The debt `FULL_TYPESCRIPT_MIGRATION` §3.1 booked against this task, paid in the only
 * currency it accepts: every one of the five stable error codes reached from a fixture,
 * and the order of the stages proved by inputs that are broken at two stages at once.
 *
 * The corpus covers exactly one of the five — `CONTENT_ROOT_NOT_FOUND`, the single code
 * any shipped manifest declares. `SCHEMA_INVALID` and `CONTENT_INVALID` are unreachable
 * on valid content, and `SCENARIO_INVALID` and `CHECKPOINT_UNKNOWN` the exporter never
 * handled at all: a broken manifest aborted the export. So these are fixtures by
 * necessity, which is exactly what §8.7 said they would have to be.
 *
 * The order matters more than the codes. Each stage-order case is broken at two stages
 * and asserts the *earlier* one: a run reporting the later code would be sending an
 * author to the wrong tree with a message about the wrong file.
 */

const repoRoot = resolve(import.meta.dirname, '..', '..', '..', '..');
const scenarioRoot = join(repoRoot, 'scenarios');
const contentRoot = join(repoRoot, 'content');

let root = '';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'oac-load-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A copy of the shipped content tree, for tests that need to break exactly one file. */
function contentCopy(): string {
  const copy = join(root, 'content');
  cpSync(contentRoot, copy, { recursive: true });
  return copy;
}

/** A scenario directory holding one manifest and, optionally, one command list. */
function scenarioCopy(scenario: string, withCommands = true): string {
  const directory = join(root, 'scenarios');
  cpSync(join(scenarioRoot, `${scenario}.manifest.json`), join(directory, `${scenario}.manifest.json`), {
    recursive: true
  });

  if (withCommands) {
    cpSync(
      join(scenarioRoot, `${scenario}.commands.json`),
      join(directory, `${scenario}.commands.json`),
      { recursive: true }
    );
  }

  return directory;
}

function run(overrides: {
  scenarioRoot?: string;
  scenario?: string;
  checkpoint?: string | null;
  contentRoot?: string;
}): ScenarioRunResult {
  return loadAndRunScenario({
    scenarioRoot: overrides.scenarioRoot ?? scenarioRoot,
    scenario: overrides.scenario ?? 'gate0',
    checkpoint: overrides.checkpoint ?? null,
    contentRoot: overrides.contentRoot ?? contentRoot,
    seed: 7n
  });
}

function codeOf(result: ScenarioRunResult): string | null {
  return result.kind === 'failed' ? result.errorCode : null;
}

describe('the happy path', () => {
  it('runs the scenario and carries what a caller needs to describe it', () => {
    const result = run({});

    expect(result.kind).toBe('ran');
    if (result.kind !== 'ran') {
      return;
    }

    expect(result.manifest.scenario).toBe('gate0');
    expect(result.outcome.steps.length).toBe(result.commands.length);
    expect(result.outcome.finalState.metadata.campaignSeed).toBe(7n);
    expect(result.outcome.finalState.metadata.rulesetVersion).toBe('m1-decision/1');
  });

  it('stops before content on a scenario whose screen is shown before content exists', () => {
    const result = run({ scenario: 'screen_loading' });

    expect(result.kind).toBe('loading');
  });
});

describe('every one of the five stable codes is reachable', () => {
  it('SCENARIO_INVALID — the scenario names a manifest that is not there', () => {
    expect(codeOf(run({ scenario: 'no_such_scenario' }))).toBe(ErrorCodes.ScenarioInvalid);
  });

  it('SCENARIO_INVALID — the manifest is there and is malformed', () => {
    const directory = scenarioCopy('gate0');
    writeFileSync(join(directory, 'gate0.manifest.json'), '{ not json', 'utf8');

    expect(codeOf(run({ scenarioRoot: directory }))).toBe(ErrorCodes.ScenarioInvalid);
  });

  it('CHECKPOINT_UNKNOWN — the requested checkpoint is not one this scenario declares', () => {
    expect(codeOf(run({ checkpoint: 'not_a_checkpoint' }))).toBe(ErrorCodes.CheckpointUnknown);
  });

  it('CONTENT_ROOT_NOT_FOUND — the content directory itself is missing', () => {
    expect(codeOf(run({ contentRoot: join(root, 'absent') }))).toBe(
      ErrorCodes.ContentRootNotFound
    );
  });

  it('SCHEMA_INVALID — a content file does not satisfy its contract', () => {
    const copy = contentCopy();
    const hero = JSON.parse(readFileSync(join(copy, 'heroes', 'bram.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    hero.greed = 'quite a lot';
    writeFileSync(join(copy, 'heroes', 'bram.json'), JSON.stringify(hero), 'utf8');

    expect(codeOf(run({ contentRoot: copy }))).toBe(ErrorCodes.SchemaInvalid);
  });

  it('CONTENT_INVALID — a file passes its contract and fails the loader', () => {
    // Referential integrity is the loader's own job: a trait id is a well-formed content
    // id, so the contract has nothing to object to, and only the loader knows whether a
    // trait file defines it.
    const copy = contentCopy();
    const hero = JSON.parse(readFileSync(join(copy, 'heroes', 'bram.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    hero.traits = ['core:no_such_trait'];
    writeFileSync(join(copy, 'heroes', 'bram.json'), JSON.stringify(hero), 'utf8');

    expect(codeOf(run({ contentRoot: copy }))).toBe(ErrorCodes.ContentInvalid);
  });

  it('leaves no code unreached', () => {
    // Written as a check rather than as a comment, because "all five" is the claim and a
    // sixth code added later would otherwise arrive with no case behind it.
    expect(ERROR_CODES).toHaveLength(5);
  });
});

describe('the order of the stages is the guarantee', () => {
  it('reports the scenario before the checkpoint', () => {
    const directory = scenarioCopy('gate0');
    writeFileSync(join(directory, 'gate0.manifest.json'), '{ not json', 'utf8');

    expect(codeOf(run({ scenarioRoot: directory, checkpoint: 'not_a_checkpoint' }))).toBe(
      ErrorCodes.ScenarioInvalid
    );
  });

  it('reports the checkpoint before the content root', () => {
    expect(
      codeOf(run({ checkpoint: 'not_a_checkpoint', contentRoot: join(root, 'absent') }))
    ).toBe(ErrorCodes.CheckpointUnknown);
  });

  it('reports the checkpoint before the loading short-circuit', () => {
    // A `loading` manifest still resolves its checkpoint: a command file that has
    // genuinely gone missing must be caught rather than assumed away by a screen that
    // reads no content.
    expect(codeOf(run({ scenario: 'screen_loading', checkpoint: 'not_a_checkpoint' }))).toBe(
      ErrorCodes.CheckpointUnknown
    );
  });

  it('reports the missing content root before schema validation', () => {
    expect(codeOf(run({ contentRoot: join(root, 'absent') }))).toBe(
      ErrorCodes.ContentRootNotFound
    );
  });

  it('reports the schema before the loader, on a file that fails both', () => {
    // The stage that matters most, and the one worth the second broken field. `greed`
    // out of range is a contract violation; the unknown trait id is a loader violation.
    // Reported as a loader failure, an author reads a message about referential
    // integrity for a file whose real problem is a number the schema already describes.
    const copy = contentCopy();
    const hero = JSON.parse(readFileSync(join(copy, 'heroes', 'bram.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    hero.greed = 5000;
    hero.traits = ['core:no_such_trait'];
    writeFileSync(join(copy, 'heroes', 'bram.json'), JSON.stringify(hero), 'utf8');

    expect(codeOf(run({ contentRoot: copy }))).toBe(ErrorCodes.SchemaInvalid);
  });
});

describe('a scenario with no command file at all', () => {
  it('is read as an empty command list rather than as a missing file', () => {
    const directory = scenarioCopy('screen_error', false);
    const result = run({ scenarioRoot: directory, scenario: 'screen_error', contentRoot: join(root, 'absent') });

    expect(codeOf(result)).toBe(ErrorCodes.ContentRootNotFound);
  });

  it('still refuses a checkpoint that names a command id', () => {
    // The half that keeps the tolerance above from swallowing a real loss: a command
    // file that has genuinely gone missing takes every checkpoint naming a command with
    // it, and the resolver is what notices.
    const directory = scenarioCopy('gate0', false);

    expect(codeOf(run({ scenarioRoot: directory }))).toBe(ErrorCodes.CheckpointUnknown);
  });
});

describe('a hero index outside the roster is a rejection, not a crash', () => {
  function withCommands(commands: readonly Record<string, unknown>[]): string {
    const directory = join(root, 'scenarios');
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, 'demo.manifest.json'),
      JSON.stringify({
        schema_version: 1,
        scenario: 'demo',
        expected_outcome: 'success',
        checkpoints: [{ name: 'final', after_command_id: 1 }]
      }),
      'utf8'
    );
    writeFileSync(join(directory, 'demo.commands.json'), JSON.stringify({ commands }), 'utf8');
    return directory;
  }

  it('answers UNKNOWN_HERO for a negative index, the way C# does', () => {
    // External review's counterexample. `hero_index` is `int` in C#, `new HeroId(-1)` is
    // a legal value there, the roster lookup misses and the engine records a rejection.
    // Refusing the id outright turned that recorded rejection into a thrown exception —
    // on an input no shipped scenario contains, so the corpus could never see it.
    const directory = withCommands([
      { command_id: 1, hero_index: -1, contract: 'core:cleanse_the_crypt', expected_state_version: 0 }
    ]);

    const result = run({ scenarioRoot: directory, scenario: 'demo' });

    expect(result.kind).toBe('ran');
    if (result.kind !== 'ran') {
      return;
    }

    expect(result.outcome.steps[0]?.applied).toBe(false);
    expect(result.outcome.steps[0]?.rejectionCode).toBe('rejected.unknown_hero');
    expect(result.outcome.steps[0]?.heroDefinition).toBeNull();
    // And it costs the campaign nothing, like every other rejection.
    expect(result.outcome.finalState.metadata.nextDecisionOrdinal).toBe(0n);
  });

  it('refuses an index the original could not have deserialized at all', () => {
    const directory = withCommands([
      {
        command_id: 1,
        hero_index: 2147483648,
        contract: 'core:cleanse_the_crypt',
        expected_state_version: 0
      }
    ]);

    const result = run({ scenarioRoot: directory, scenario: 'demo' });

    // A contract violation naming the file and the path, not a thrown id: the value is
    // outside what a signed 32-bit field holds, so no C# run could have produced it.
    expect(codeOf(result)).toBe(ErrorCodes.ScenarioInvalid);
    expect(result.kind === 'failed' && result.errorDetail).toContain('$.commands[0].hero_index');
  });
});

describe('the error detail is for a human, never for a comparison', () => {
  it('carries the underlying message, which may name a machine-specific path', () => {
    const result = run({ contentRoot: join(root, 'absent') });

    expect(result.kind).toBe('failed');
    if (result.kind !== 'failed') {
      return;
    }

    expect(result.errorDetail).toContain('does not exist');
    // Recorded rather than asserted away: the frozen corpus deliberately keeps no
    // `error_detail` in its read model for exactly this reason, so nothing downstream
    // may compare on it.
    expect(result.errorDetail).toContain(root);
  });
});
