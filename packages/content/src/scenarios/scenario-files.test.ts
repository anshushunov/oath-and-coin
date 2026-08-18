import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadScenarioCommands, loadScenarioManifest } from '../node/index.ts';

import { commandsUpTo, resolveCheckpoint } from './checkpoint-resolver.ts';
import {
  KNOWN_SCREEN_STATES,
  SUPPORTED_MANIFEST_SCHEMA_VERSION,
  type ScenarioManifest
} from './scenario-manifest.ts';

/**
 * The scenario format's own rules — every one of them a refusal, and every refusal a
 * case the C# loader already had.
 *
 * These write files to a temporary directory rather than pointing at `scenarios/`,
 * because a rule is only proven by the input that breaks it, and the repository's own
 * scenarios are all valid on purpose. The one thing read from the real tree is the
 * happy path, so that the fixtures cannot drift into describing a format nothing ships.
 */

const repoRoot = resolve(import.meta.dirname, '..', '..', '..', '..');
const scenarioRoot = join(repoRoot, 'scenarios');

let root = '';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'oac-scenario-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeManifest(scenario: string, body: Record<string, unknown>): string {
  const path = join(root, `${scenario}.manifest.json`);
  writeFileSync(path, JSON.stringify(body), 'utf8');
  return path;
}

const validManifest = (scenario: string): Record<string, unknown> => ({
  schema_version: SUPPORTED_MANIFEST_SCHEMA_VERSION,
  scenario,
  expected_outcome: 'success',
  checkpoints: [{ name: 'final', after_command_id: 1 }]
});

describe('a manifest is refused rather than read on a guess', () => {
  it('reads a well-formed one', () => {
    const manifest = loadScenarioManifest(writeManifest('demo', validManifest('demo')));

    expect(manifest.scenario).toBe('demo');
    expect(manifest.expectedOutcome).toBe('success');
    expect(manifest.checkpoints).toEqual([{ name: 'final', afterCommandId: 1 }]);
    expect(manifest.fault).toBeNull();
    expect(manifest.contentRoot).toBeNull();
    expect(manifest.expectedScreenState).toBeNull();
  });

  it('refuses a file that is not there', () => {
    expect(() => loadScenarioManifest(join(root, 'absent.manifest.json'))).toThrow(
      /does not exist/
    );
  });

  it('refuses a schema version this build does not read', () => {
    const path = writeManifest('demo', { ...validManifest('demo'), schema_version: 2 });

    expect(() => loadScenarioManifest(path)).toThrow(/declares schema_version 2/);
  });

  it('reports the version rather than the fields a later version would have', () => {
    // The whole reason the version is read before the contract is applied: a file
    // authored for another format legitimately lacks fields this one requires, and
    // reporting those buries the one diagnostic that explains them.
    const path = writeManifest('demo', { schema_version: 7 });

    expect(() => loadScenarioManifest(path)).toThrow(/declares schema_version 7/);
  });

  it('refuses an unknown property', () => {
    const path = writeManifest('demo', { ...validManifest('demo'), surprise: true });

    expect(() => loadScenarioManifest(path)).toThrow(/does not satisfy its contract/);
  });

  it('refuses a scenario id that disagrees with its own file name', () => {
    const path = writeManifest('demo', validManifest('other'));

    expect(() => loadScenarioManifest(path)).toThrow(/but its file name names 'demo'/);
  });

  it('refuses an outcome it has no meaning for', () => {
    const path = writeManifest('demo', { ...validManifest('demo'), expected_outcome: 'maybe' });

    expect(() => loadScenarioManifest(path)).toThrow(/expected 'success', 'error' or 'loading'/);
  });

  it('refuses an error outcome with nothing to compare against', () => {
    const path = writeManifest('demo', { ...validManifest('demo'), expected_outcome: 'error' });

    expect(() => loadScenarioManifest(path)).toThrow(/no expected_error_code/);
  });

  it('refuses a fault on a scenario that is not supposed to fail', () => {
    const path = writeManifest('demo', {
      ...validManifest('demo'),
      fault: { kind: 'missing_content_root', path: 'nowhere' }
    });

    expect(() => loadScenarioManifest(path)).toThrow(/only an 'error' scenario breaks the game/);
  });

  it('refuses a content root on a loading scenario, which reads no content at all', () => {
    const path = writeManifest('demo', {
      ...validManifest('demo'),
      expected_outcome: 'loading',
      content_root: 'content'
    });

    expect(() => loadScenarioManifest(path)).toThrow(/there is nothing here to point a content root at/);
  });

  it('refuses a fault and a content root together, because one would overrule the other', () => {
    const path = writeManifest('demo', {
      ...validManifest('demo'),
      expected_outcome: 'error',
      expected_error_code: 'CONTENT_ROOT_NOT_FOUND',
      fault: { kind: 'missing_content_root', path: 'nowhere' },
      content_root: 'content'
    });

    expect(() => loadScenarioManifest(path)).toThrow(/ambiguous/);
  });

  it('refuses a screen state no screen has', () => {
    const path = writeManifest('demo', {
      ...validManifest('demo'),
      expected_screen_state: 'purple'
    });

    expect(() => loadScenarioManifest(path)).toThrow(
      new RegExp(`expected one of: ${KNOWN_SCREEN_STATES.join(', ')}`)
    );
  });

  it('cannot carry an after_command_id past 2^53-1, the same inherited narrowing', () => {
    const text =
      '{"schema_version":1,"scenario":"demo","expected_outcome":"success",' +
      '"checkpoints":[{"name":"final","after_command_id":9007199254740993}]}';
    const path = join(root, 'demo.manifest.json');
    writeFileSync(path, text, 'utf8');

    expect(() => loadScenarioManifest(path)).toThrow(/does not satisfy its contract/);
  });

  it('refuses a checkpoint name declared twice', () => {
    const path = writeManifest('demo', {
      ...validManifest('demo'),
      checkpoints: [
        { name: 'final', after_command_id: 1 },
        { name: 'final', after_command_id: 2 }
      ]
    });

    expect(() => loadScenarioManifest(path)).toThrow(/more than once/);
  });
});

describe('a command list is refused rather than read on a guess', () => {
  function writeCommands(body: Record<string, unknown>): string {
    const path = join(root, 'demo.commands.json');
    writeFileSync(path, JSON.stringify(body), 'utf8');
    return path;
  }

  it('reads a well-formed one', () => {
    const commands = loadScenarioCommands(
      writeCommands({
        commands: [
          { command_id: 1, hero_index: 3, contract: 'core:job', expected_state_version: 0 }
        ]
      })
    );

    expect(commands).toEqual([
      { commandId: 1, heroIndex: 3, contract: 'core:job', expectedStateVersion: 0 }
    ]);
  });

  it('refuses an empty command list', () => {
    // An empty scenario would "reproduce" perfectly and demonstrate nothing — the most
    // comfortable way for a determinism check to be green about nothing at all.
    expect(() => loadScenarioCommands(writeCommands({ commands: [] }))).toThrow(
      /declares no commands/
    );
  });

  it('refuses a malformed content id with the file and the path, not a bare parse error', () => {
    const path = writeCommands({
      commands: [{ command_id: 1, hero_index: 0, contract: 'Core:Job', expected_state_version: 0 }]
    });

    expect(() => loadScenarioCommands(path)).toThrow(/\$\.commands\[0\]\.contract/);
  });

  it('refuses an unknown property', () => {
    const path = writeCommands({
      commands: [
        { command_id: 1, hero_index: 0, contract: 'core:job', expected_state_version: 0, why: 1 }
      ]
    });

    expect(() => loadScenarioCommands(path)).toThrow(/does not satisfy its contract/);
  });

  it.each(['command_id', 'expected_state_version'])(
    'cannot carry a %s past 2^53-1, which C# `long` held exactly',
    (field) => {
      // A recorded limit, pinned so it stays recorded — and pinned through raw JSON text
      // on purpose. Written as a number literal the value is already gone: the linter is
      // right that `9007199254740993` does not survive being parsed as a double, and a
      // test asserting "the contract refuses it" would be passing for a different reason
      // than the one it states.
      //
      // What actually happens is worse than a refusal and is the limit itself: `JSON.parse`
      // rounds the token to 9007199254740992 before any contract sees it. So the loader
      // never gets the chance to refuse the authored value — it refuses a neighbouring one.
      // Nothing in the shipped tree comes near this (ids start at 1); the exact path for a
      // 64-bit value is `bigint`, the same sentence §7.2 already uses for the campaign
      // seed. Widening these would move `stateVersion`, `nextEventId` and the artifact's
      // own number domain, which is a decision rather than a drive-by.
      const fields: Record<string, string> = {
        command_id: '1',
        hero_index: '0',
        contract: '"core:job"',
        expected_state_version: '0'
      };
      fields[field] = '9007199254740993';

      const body = Object.entries(fields)
        .map(([name, value]) => `"${name}":${value}`)
        .join(',');
      const text = `{"commands":[{${body}}]}`;
      const path = join(root, 'demo.commands.json');
      writeFileSync(path, text, 'utf8');

      const reparsed = JSON.parse(text) as { commands: Record<string, number>[] };
      expect(reparsed.commands[0]![field]).toBe(9007199254740992);

      expect(() => loadScenarioCommands(path)).toThrow(/does not satisfy its contract/);
    }
  );
});

describe('resolving a checkpoint', () => {
  const manifest = (checkpoints: ScenarioManifest['checkpoints']): ScenarioManifest => ({
    schemaVersion: 1,
    scenario: 'demo',
    expectedOutcome: 'success',
    fault: null,
    expectedErrorCode: null,
    checkpoints,
    contentRoot: null,
    expectedScreenState: null
  });

  const commands = [1, 2, 3].map((commandId) => ({
    commandId,
    heroIndex: 0,
    contract: 'core:job' as never,
    expectedStateVersion: commandId - 1
  }));

  it('defaults to the last checkpoint declared', () => {
    const resolved = resolveCheckpoint(
      manifest([
        { name: 'half', afterCommandId: 1 },
        { name: 'final', afterCommandId: 3 }
      ]),
      commands,
      null
    );

    expect(resolved.name).toBe('final');
  });

  it('finds a checkpoint by name', () => {
    const resolved = resolveCheckpoint(
      manifest([
        { name: 'half', afterCommandId: 1 },
        { name: 'final', afterCommandId: 3 }
      ]),
      commands,
      'half'
    );

    expect(resolved.afterCommandId).toBe(1);
  });

  it('refuses a name no checkpoint has, and lists the ones that exist', () => {
    expect(() =>
      resolveCheckpoint(manifest([{ name: 'final', afterCommandId: 3 }]), commands, 'nope')
    ).toThrow(/Available checkpoints: final/);
  });

  it('refuses a manifest with nothing to default to', () => {
    expect(() => resolveCheckpoint(manifest([]), commands, null)).toThrow(
      /declares no checkpoints to default to/
    );
  });

  it('refuses a checkpoint naming a command the scenario does not contain', () => {
    expect(() =>
      resolveCheckpoint(manifest([{ name: 'final', afterCommandId: 9 }]), commands, null)
    ).toThrow(/which is not in the scenario's command list/);
  });

  it('accepts command id 0, which means "before anything ran"', () => {
    const resolved = resolveCheckpoint(
      manifest([{ name: 'start', afterCommandId: 0 }]),
      commands,
      null
    );

    expect(commandsUpTo(commands, resolved)).toEqual([]);
  });

  it('slices up to and including the boundary command, not up to it', () => {
    // Everything strictly before would silently drop the boundary command from every
    // checkpoint's slice — and every checkpoint would still look like it worked.
    expect(commandsUpTo(commands, { name: 'half', afterCommandId: 2 })).toHaveLength(2);
  });
});

describe('the shipped scenario tree still fits the format', () => {
  it('reads a real manifest and its commands', () => {
    const manifest = loadScenarioManifest(join(scenarioRoot, 'gate0.manifest.json'));
    const commands = loadScenarioCommands(join(scenarioRoot, 'gate0.commands.json'));
    const checkpoint = resolveCheckpoint(manifest, commands, null);

    expect(manifest.scenario).toBe('gate0');
    expect(commandsUpTo(commands, checkpoint).length).toBeGreaterThan(0);
  });

  it('creates the fixture directory for every manifest that names one', () => {
    // A `content_root` pointing at a tree nobody authored would be discovered only by
    // the run that failed to load it, in a message about content rather than about the
    // manifest that pointed there.
    mkdirSync(join(root, 'unused'), { recursive: true });
    expect(loadScenarioManifest(join(scenarioRoot, 'screen_empty.manifest.json')).contentRoot).toBe(
      'scenarios/fixtures/screen_empty'
    );
  });
});
