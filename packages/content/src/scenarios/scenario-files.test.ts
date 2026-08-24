import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PATRON_FEE_MAX } from '../bounds.ts';
import { loadScenarioCommands, loadScenarioManifest } from '../node/index.ts';

import { commandsUpTo, resolveCheckpoint } from './checkpoint-resolver.ts';
import { ScenarioCommandKind, type ScenarioCommand } from './scenario-commands.ts';
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

  it('reads a well-formed one, in all five commands the protocol has', () => {
    // All five in one file rather than five one-command files: the discriminant is the
    // point of this format, and a list that mixes commands is what every real scenario
    // is. `settle_contract` (Task 20) is the last one — the engine has had it since
    // Task 14, and this is where the wire format caught up.
    const commands = loadScenarioCommands(
      writeCommands({
        commands: [
          {
            command: 'compose_offer',
            command_id: 1,
            contract: 'core:job',
            key_hero_index: 3,
            advance: 40,
            method_tag: 'method:quiet',
            promised_bonus: 5,
            expected_state_version: 0
          },
          {
            command: 'propose_contract_to_hero',
            command_id: 2,
            contract: 'core:job',
            hero_index: 3,
            expected_state_version: 1
          },
          {
            command: 'lock_offer',
            command_id: 3,
            contract: 'core:job',
            expected_state_version: 2
          },
          { command: 'poll_crew', command_id: 4, contract: 'core:job', expected_state_version: 3 },
          {
            command: 'settle_contract',
            command_id: 5,
            contract: 'core:job',
            pay: true,
            expected_state_version: 4
          }
        ]
      })
    );

    expect(commands).toEqual([
      {
        kind: 'compose_offer',
        commandId: 1,
        contract: 'core:job',
        keyHeroIndex: 3,
        advance: 40,
        methodTag: 'method:quiet',
        promisedBonus: 5,
        expectedStateVersion: 0
      },
      {
        kind: 'propose_contract_to_hero',
        commandId: 2,
        contract: 'core:job',
        heroIndex: 3,
        expectedStateVersion: 1
      },
      { kind: 'lock_offer', commandId: 3, contract: 'core:job', expectedStateVersion: 2 },
      { kind: 'poll_crew', commandId: 4, contract: 'core:job', expectedStateVersion: 3 },
      { kind: 'settle_contract', commandId: 5, contract: 'core:job', pay: true, expectedStateVersion: 4 }
    ]);
  });

  it('keeps a composed offer that chooses no method tag as null, not as an absent field', () => {
    // `null` and "not stated" must not become two ways of saying the same thing: the
    // engine's `composeOffer` takes `methodTag: ContentId | null` and a missing key would
    // arrive as `undefined`, which is neither a tag nor the explicit refusal of one.
    const commands = loadScenarioCommands(
      writeCommands({
        commands: [
          {
            command: 'compose_offer',
            command_id: 1,
            contract: 'core:job',
            key_hero_index: 0,
            advance: 0,
            method_tag: null,
            promised_bonus: 0,
            expected_state_version: 0
          }
        ]
      })
    );

    expect(commands[0]).toMatchObject({ kind: 'compose_offer', methodTag: null });
  });

  it.each(['advance', 'promised_bonus'])('refuses a negative %s', (field) => {
    // The engine's own bound is `0 ≤ x ≤ patronFee` and is content-dependent, so this
    // contract cannot state it — but "minus forty coins" is outside the domain money
    // lives in at all, whatever contract is named, and a scenario has no legitimate use
    // for it: the same `OfferTermsOutOfBounds` refusal is reachable from above, by
    // offering more than the contract pays.
    const path = writeCommands({
      commands: [
        {
          command: 'compose_offer',
          command_id: 1,
          contract: 'core:job',
          key_hero_index: 0,
          advance: 0,
          method_tag: null,
          promised_bonus: 0,
          expected_state_version: 0,
          [field]: -1
        }
      ]
    });

    expect(() => loadScenarioCommands(path)).toThrow(
      new RegExp(`\\$\\.commands\\[0\\]\\.${field}`)
    );
  });

  it('still admits an advance larger than some contract pays, which the engine refuses', () => {
    // The bound above must not swallow the refusal it leaves to the engine. `advance`
    // may reach `PATRON_FEE_MAX`, and every shipped contract pays less than that, so
    // `rejected.offer_terms_out_of_bounds` stays reachable from a scenario file.
    const commands = loadScenarioCommands(
      writeCommands({
        commands: [
          {
            command: 'compose_offer',
            command_id: 1,
            contract: 'core:job',
            key_hero_index: 0,
            advance: PATRON_FEE_MAX,
            method_tag: null,
            promised_bonus: 0,
            expected_state_version: 0
          }
        ]
      })
    );

    expect(commands[0]).toMatchObject({ advance: PATRON_FEE_MAX });
  });

  it('refuses a command no protocol has, rather than reading it as another', () => {
    const path = writeCommands({
      commands: [
        { command: 'renegotiate_terms', command_id: 1, contract: 'core:job', expected_state_version: 0 }
      ]
    });

    expect(() => loadScenarioCommands(path)).toThrow(/does not satisfy its contract/);
  });

  it('refuses a settle_contract missing pay, rather than reading it as another command', () => {
    // `pay` is the one field that separates `settle_contract` from the shared base
    // every command carries — the fixture a reader would build by copying `lock_offer`
    // and swapping the discriminant.
    const path = writeCommands({
      commands: [
        { command: 'settle_contract', command_id: 1, contract: 'core:job', expected_state_version: 0 }
      ]
    });

    expect(() => loadScenarioCommands(path)).toThrow(/does not satisfy its contract/);
  });

  it('refuses a step carrying another command’s fields', () => {
    // The failure the discriminant exists to make legible: a `poll_crew` naming a hero
    // is an author who meant `propose_contract_to_hero`, and the diagnostic has to say
    // which command's contract was violated rather than list four failures at once.
    const path = writeCommands({
      commands: [
        {
          command: 'poll_crew',
          command_id: 1,
          contract: 'core:job',
          hero_index: 2,
          expected_state_version: 0
        }
      ]
    });

    expect(() => loadScenarioCommands(path)).toThrow(/does not satisfy its contract/);
  });

  it('refuses a step that names no command at all', () => {
    // The shape every scenario in this repository had before `DEC-008` Task 11a, and the
    // one an unmigrated file would still have. No default: a file whose most important
    // field is the one it does not state is a file whose meaning is decided elsewhere.
    const path = writeCommands({
      commands: [{ command_id: 1, hero_index: 3, contract: 'core:job', expected_state_version: 0 }]
    });

    expect(() => loadScenarioCommands(path)).toThrow(/does not satisfy its contract/);
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
      commands: [
        {
          command: 'propose_contract_to_hero',
          command_id: 1,
          hero_index: 0,
          contract: 'Core:Job',
          expected_state_version: 0
        }
      ]
    });

    expect(() => loadScenarioCommands(path)).toThrow(/\$\.commands\[0\]\.contract/);
  });

  it('refuses an unknown property', () => {
    const path = writeCommands({
      commands: [
        {
          command: 'propose_contract_to_hero',
          command_id: 1,
          hero_index: 0,
          contract: 'core:job',
          expected_state_version: 0,
          why: 1
        }
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
        command: '"propose_contract_to_hero"',
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

  const commands: readonly ScenarioCommand[] = [1, 2, 3].map((commandId) => ({
    kind: ScenarioCommandKind.ProposeContractToHero,
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
