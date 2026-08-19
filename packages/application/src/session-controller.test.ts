import {
  RULESET_VERSION,
  SaveErrorCodes,
  SaveReadError,
  computeContentVersion,
  decodeUtf8OrThrow,
  encodeUtf8,
  memoryFileSource,
  type ContentFileSource
} from '@oath-and-coin/content';
import { ScreenState, readModelHash } from '@oath-and-coin/presentation';
import { describe, expect, it } from 'vitest';

import type { ContentSourcePort, SaveStorePort } from './ports.ts';
import { saveChecksum } from './save/envelope.ts';
import type { SaveSlot } from './save/slots.ts';
import {
  createSessionController,
  type SessionController,
  type SessionControllerDeps
} from './session-controller.ts';

/**
 * The session that can wait for a store, tested with no store and no clock in sight.
 *
 * Every dependency the controller has is handed to it here — the content it runs, the
 * slots it writes to, the clock it stamps a save with, and the pair of versions it
 * refuses a foreign save by. That is the point of the shape rather than a convenience
 * of the test: `packages/application` reads no clock and opens no file, so a suite that
 * had to reach for either would be measuring something this layer is not allowed to do.
 *
 * Two facts this file leans on, both measured rather than assumed:
 *
 * - the fixture answers the *second* contract of the two it holds, and
 *   `core:archive_run` sorts before `core:escort`, so the contract a screen focuses is
 *   never the one the map's fallback would pick. Without that the round trip below
 *   would pass with the envelope's `focused_contract` thrown away (design spec §2.7);
 * - `readSave` checks history's references into the roster and the trace table, and
 *   checks no hero's *traits* against the rule table. That seam is what
 *   `withoutTraitRules` walks through, and it is how a save that decodes but cannot be
 *   turned into a screen is reachable at all.
 */

const BRAM = {
  schema_version: 2,
  id: 'core:bram',
  display_name_key: 'hero.core.bram.name',
  greed: 60,
  caution: 30,
  pride: 45,
  trust_in_guild: 50,
  traits: ['core:greedy'],
  relationships: []
};

/** Sorts before `core:escort`, and is deliberately never the contract anyone answers. */
const ARCHIVE_RUN = {
  schema_version: 2,
  id: 'core:archive_run',
  display_name_key: 'contract.core.archive_run.name',
  payment: 30,
  risk: 10,
  required_crew: 1,
  tags: []
};

const ESCORT = {
  schema_version: 2,
  id: 'core:escort',
  display_name_key: 'contract.core.escort.name',
  payment: 70,
  risk: 30,
  required_crew: 1,
  tags: ['method:escort']
};

const GREEDY = {
  schema_version: 2,
  id: 'core:greedy',
  display_name_key: 'trait.core.greedy.name',
  kind: 'inclination',
  tag: 'method:escort',
  weight: 20
};

function contentTree(): ContentFileSource {
  return memoryFileSource({
    'heroes/bram.json': JSON.stringify(BRAM),
    'contracts/archive-run.json': JSON.stringify(ARCHIVE_RUN),
    'contracts/escort.json': JSON.stringify(ESCORT),
    'traits/greedy.json': JSON.stringify(GREEDY)
  });
}

interface ScenarioFixture {
  readonly manifest: Record<string, unknown>;
  readonly commands?: Record<string, unknown>;
}

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

const MANIFEST = {
  schema_version: 1,
  scenario: 'fixture',
  expected_outcome: 'success',
  content_root: 'fixture-content',
  checkpoints: [
    { name: 'start', after_command_id: 0 },
    { name: 'final', after_command_id: 1 }
  ]
};

/** Bram answers the escort — the campaign has a history, a trace and a decided step. */
const answeredScenario: ScenarioFixture = {
  manifest: { ...MANIFEST, expected_screen_state: 'normal' },
  commands: {
    commands: [{ command_id: 1, hero_index: 0, contract: 'core:escort', expected_state_version: 0 }]
  }
};

/**
 * The same offer, refused by the engine before it reached Bram: the command states a
 * state version the campaign is not at.
 *
 * A rejected step produces no event, so it leaves nothing in the campaign to rebuild —
 * which makes this the one scenario where "the contract the first step named" and "the
 * contract a reloaded campaign would guess" are different answers.
 */
const rejectedScenario: ScenarioFixture = {
  manifest: { ...MANIFEST, expected_screen_state: 'incomplete' },
  commands: {
    commands: [
      { command_id: 1, hero_index: 0, contract: 'core:escort', expected_state_version: 99 }
    ]
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

const CREATED_AT = '2026-08-19T09:41:00.000Z';

const EXPECTED_VERSIONS = {
  rulesetVersion: RULESET_VERSION,
  contentVersion: computeContentVersion(contentTree())
};

/** A slot store that is nothing but a map, so what it holds is what was written. */
function fakeStore(): SaveStorePort & { readonly slots: Map<SaveSlot, Uint8Array> } {
  const slots = new Map<SaveSlot, Uint8Array>();

  return {
    slots,
    read: (slot) => Promise.resolve(slots.get(slot) ?? null),
    write: (slot, bytes) => {
      slots.set(slot, bytes);
      return Promise.resolve();
    },
    list: () => Promise.resolve([...slots.keys()])
  };
}

/** A store that answers every question with the same refusal. */
function refusingStore(refusal: () => unknown): SaveStorePort {
  return {
    read: () => Promise.reject(refusal()),
    write: () => Promise.reject(refusal()),
    list: () => Promise.reject(refusal())
  };
}

function unavailable(): SaveReadError {
  return new SaveReadError(SaveErrorCodes.StorageUnavailable, 'the fixture store is closed.');
}

interface Harness {
  readonly controller: SessionController;
  /** The store the controller writes to, unless the test handed it another one. */
  readonly saves: SaveStorePort & { readonly slots: Map<SaveSlot, Uint8Array> };
  /** How many times the controller asked what time it is. */
  readonly clockReads: number;
}

function harness(
  options: {
    readonly scenario?: ScenarioFixture;
    readonly content?: ContentFileSource | null;
    readonly saves?: SaveStorePort;
    readonly expected?: SessionControllerDeps['expected'];
    readonly now?: () => string;
  } = {}
): Harness {
  const scenario = options.scenario ?? answeredScenario;
  const content = options.content === undefined ? contentTree() : options.content;
  const saves = fakeStore();
  const clock = { reads: 0 };

  const controller = createSessionController({
    request: {
      content: portOver(scenario, content),
      scenario: 'fixture',
      checkpoint: null,
      seed: 424242n
    },
    saves: options.saves ?? saves,
    now:
      options.now ??
      (() => {
        clock.reads += 1;
        return CREATED_AT;
      }),
    expected: options.expected ?? EXPECTED_VERSIONS
  });

  return {
    controller,
    saves,
    get clockReads() {
      return clock.reads;
    }
  };
}

/** The envelope a slot holds, as JSON. */
function parseSave(bytes: Uint8Array): Record<string, unknown> {
  return JSON.parse(decodeUtf8OrThrow(bytes)) as Record<string, unknown>;
}

/**
 * The same save with an empty rule table, signed honestly.
 *
 * Bram holds `core:greedy`, so the campaign still decodes, still passes the envelope's
 * referential integrity — which looks at history, not at traits — and still cannot be
 * turned into a screen, because a hero card names every trait its hero holds.
 */
function withoutTraitRules(bytes: Uint8Array): Uint8Array {
  const file = parseSave(bytes);
  const snapshot = file.snapshot as Record<string, unknown>;
  const tampered: Record<string, unknown> = {
    ...file,
    snapshot: { ...snapshot, traitRules: [] }
  };
  const { checksum: _checksum, created_at: createdAt, ...withoutChecksum } = tampered;

  return encodeUtf8(
    JSON.stringify({
      ...withoutChecksum,
      created_at: createdAt,
      checksum: saveChecksum(withoutChecksum)
    })
  );
}

describe('a controller before and after it starts', () => {
  it('shows the loading screen until the run happens', () => {
    // The one screen no run produces, and the honest answer while there is nothing to
    // show: a controller that started its run inside its constructor would leave a
    // caller no moment at which it could subscribe before the answer arrived.
    const { controller } = harness();

    expect(controller.store.snapshot().screen.state).toBe(ScreenState.Loading);
    expect(controller.store.snapshot().state).toBeNull();
  });

  it('publishes the run through the store the screen subscribes to', async () => {
    const { controller } = harness();
    const seen: ScreenState[] = [];
    controller.store.subscribe(() => {
      seen.push(controller.store.snapshot().screen.state);
    });

    await controller.start();

    expect(seen).toEqual([ScreenState.Normal]);
    expect(controller.store.snapshot().state).not.toBeNull();
  });
});

describe('the hashes a loaded session reports', () => {
  it('does not answer a run hash for a run that never happened', async () => {
    // `canonicalHash` is computed over a whole `ScenarioOutcome` — rejected steps and
    // entire commands included. A loaded session has none of that: a refused command
    // produces no event, so nothing about it survives in the campaign. A hash computed
    // over the incomplete steps would still be 64 hex characters, would still be
    // published by `RunReport`, and would simply be a different number claiming to be
    // that one.
    const { controller } = harness();
    await controller.start();
    await controller.save('slot-a');
    await controller.load('slot-a');

    const session = controller.store.snapshot();

    expect(session.canonicalHash).toBeNull();
    expect(session.savedStateHash).not.toBeNull();
  });

  it('keeps the run hash while the run is what is on screen', async () => {
    const { controller } = harness();
    await controller.start();
    await controller.save('slot-a');

    expect(controller.store.snapshot().canonicalHash).toMatch(/^[0-9a-f]{64}$/u);
  });
});

describe('the checksum a session reports as its saved state', () => {
  it('is the one signing the file, not a second hash of its own', async () => {
    // The segment signs a save with exactly one algorithm. A controller computing its
    // own would produce a number nothing in the file could be compared against, and the
    // divergence would only show the day a screen tried to say "this slot holds what is
    // on screen".
    const { controller, saves } = harness();
    await controller.start();
    await controller.save('slot-a');

    const file = parseSave(saves.slots.get('slot-a')!);
    const { checksum: _checksum, created_at: _createdAt, ...signed } = file;

    expect(controller.store.snapshot().savedStateHash).toBe(file.checksum);
    expect(controller.store.snapshot().savedStateHash).toBe(saveChecksum(signed));
  });

  it('does not move when only the moment of saving does', async () => {
    // The checksum covers the campaign and not `created_at` (design spec §2.3), so
    // saving one campaign twice signs it identically. A hash that moved with the clock
    // would make "is this slot the campaign on screen" unanswerable.
    const first = harness({ now: () => '2026-08-19T09:41:00.000Z' });
    await first.controller.start();
    await first.controller.save('slot-a');

    const second = harness({ now: () => '2031-01-01T00:00:00.000Z' });
    await second.controller.start();
    await second.controller.save('slot-a');

    expect(second.controller.store.snapshot().savedStateHash).toBe(
      first.controller.store.snapshot().savedStateHash
    );
    expect(parseSave(second.saves.slots.get('slot-a')!).created_at).not.toBe(
      parseSave(first.saves.slots.get('slot-a')!).created_at
    );
  });

  it("is the file's own checksum after a load, too", async () => {
    const { controller, saves } = harness();
    await controller.start();
    await controller.save('slot-a');
    const written = controller.store.snapshot().savedStateHash;

    await controller.load('slot-a');

    expect(controller.store.snapshot().savedStateHash).toBe(written);
    expect(controller.store.snapshot().savedStateHash).toBe(
      parseSave(saves.slots.get('slot-a')!).checksum
    );
  });
});

describe('the clock', () => {
  it('is the one handed in, and is read once per save', async () => {
    // `packages/application` may not read a clock at all (`AGENTS.md` §6): wall-clock
    // time inside this layer would make a save's bytes a property of when it was taken
    // rather than of what was taken. The stamp below can only be here if `now` put it
    // here.
    const state = harness();
    await state.controller.start();
    await state.controller.save('slot-a');

    expect(parseSave(state.saves.slots.get('slot-a')!).created_at).toBe(CREATED_AT);
    expect(state.clockReads).toBe(1);
  });

  it('is not read at all by a load', async () => {
    const state = harness();
    await state.controller.start();
    await state.controller.save('slot-a');
    await state.controller.load('slot-a');

    expect(state.clockReads).toBe(1);
  });
});

describe('the versions this build reads saves under', () => {
  /** A store already holding one save, written by a controller of this build. */
  async function storeHoldingASave(): Promise<SaveStorePort> {
    const { controller, saves } = harness();
    await controller.start();
    await controller.save('slot-a');

    return saves;
  }

  it("refuses another build's content, as a state rather than as a throw", async () => {
    // `expected` is what a build says about itself, and a save is refused by comparing
    // the file against it. A controller that never passed it on would read any file at
    // all — including one whose numbers were produced by content this build no longer
    // has, which is the silent wrong answer the version fields exist to prevent.
    const other = harness({
      saves: await storeHoldingASave(),
      expected: { rulesetVersion: RULESET_VERSION, contentVersion: 'ffffffffffffffff' }
    });
    await other.controller.start();

    await expect(other.controller.load('slot-a')).resolves.toBeUndefined();

    expect(other.controller.store.snapshot().saveFailure).toEqual({
      slot: 'slot-a',
      code: SaveErrorCodes.ContentMismatch,
      detail: expect.stringContaining('ffffffffffffffff')
    });
  });

  it("refuses another build's ruleset the same way", async () => {
    const other = harness({
      saves: await storeHoldingASave(),
      expected: { rulesetVersion: 'm0-nothing/0', contentVersion: EXPECTED_VERSIONS.contentVersion }
    });
    await other.controller.start();

    await other.controller.load('slot-a');

    expect(other.controller.store.snapshot().saveFailure?.code).toBe(
      SaveErrorCodes.RulesetMismatch
    );
  });
});

describe('a store that refuses', () => {
  it('makes a failed write a state, and leaves the campaign where it was', async () => {
    const { controller } = harness({ saves: refusingStore(unavailable) });
    await controller.start();
    const before = controller.store.snapshot();

    await expect(controller.save('slot-b')).resolves.toBeUndefined();

    const after = controller.store.snapshot();
    expect(after.saveFailure).toEqual({
      slot: 'slot-b',
      code: SaveErrorCodes.StorageUnavailable,
      detail: expect.stringContaining('the fixture store is closed.')
    });
    expect(after.savedStateHash).toBeNull();
    expect(after.screen).toBe(before.screen);
    expect(after.state).toBe(before.state);
  });

  it('makes a failed read a state, and does not leave the screen', async () => {
    const { controller } = harness({ saves: refusingStore(unavailable) });
    await controller.start();
    const before = controller.store.snapshot();

    await expect(controller.load('slot-c')).resolves.toBeUndefined();

    const after = controller.store.snapshot();
    expect(after.saveFailure?.slot).toBe('slot-c');
    expect(after.saveFailure?.code).toBe(SaveErrorCodes.StorageUnavailable);
    expect(readModelHash(after.screen)).toBe(readModelHash(before.screen));
  });

  it('reports a port that threw something it never named as an unavailable store', async () => {
    // Both shipped stores promise every refusal arrives as a `SaveReadError`. A third
    // one breaking that promise must not become an exception the screen cannot show —
    // and "the store did something it did not name" is what this code means.
    const { controller } = harness({
      saves: refusingStore(() => new TypeError('db.transaction is not a function'))
    });
    await controller.start();

    await controller.load('slot-a');

    expect(controller.store.snapshot().saveFailure).toEqual({
      slot: 'slot-a',
      code: SaveErrorCodes.StorageUnavailable,
      detail: 'db.transaction is not a function'
    });
  });
});

describe('a slot holding a save this build cannot make a screen out of', () => {
  it('refuses it as an inconsistent file rather than throwing out of the controller', async () => {
    const { controller, saves } = harness();
    await controller.start();
    await controller.save('slot-a');
    const before = controller.store.snapshot();
    saves.slots.set('slot-a', withoutTraitRules(saves.slots.get('slot-a')!));

    await expect(controller.load('slot-a')).resolves.toBeUndefined();

    const after = controller.store.snapshot();
    expect(after.saveFailure?.code).toBe(SaveErrorCodes.Inconsistent);
    expect(after.saveFailure?.detail).toContain('core:greedy');
    expect(after.state).toBe(before.state);
  });
});

describe('an empty slot', () => {
  it('is a state and not a refusal, and loading one changes nothing', async () => {
    // Design spec §2.4, first row of the refusal table. Identity, not equality: a
    // controller that rebuilt the same session out of nothing would make every
    // subscriber re-render on a load of an empty slot.
    const { controller } = harness();
    await controller.start();
    const before = controller.store.snapshot();

    await controller.load('slot-b');

    expect(controller.store.snapshot()).toBe(before);
  });
});

describe('a session with nothing to save', () => {
  it('writes no slot from a run that produced no campaign', async () => {
    // A failed run has no campaign and no contract on screen, so there is nothing to
    // put in a file. Writing a slot anyway would replace a real save with a record of
    // a run that failed.
    const { controller, saves } = harness({ scenario: failingScenario, content: null });
    await controller.start();
    const before = controller.store.snapshot();

    await controller.save('slot-a');

    expect(saves.slots.size).toBe(0);
    expect(controller.store.snapshot()).toBe(before);
  });
});

describe('the screen a save and a load put back', () => {
  it('is the screen that was on it, for a campaign with an answered step', async () => {
    const { controller } = harness();
    await controller.start();
    const before = controller.store.snapshot();
    await controller.save('slot-a');
    await controller.load('slot-a');

    const after = controller.store.snapshot();

    expect(readModelHash(after.screen)).toBe(readModelHash(before.screen));
    expect(after.contentVersion).toBe(before.contentVersion);
  });

  it('is the screen that was on it when the only step was rejected', async () => {
    // The one case where the two rules part company: a rejected step leaves no event,
    // so a reloaded campaign has no first step to read the contract off and would fall
    // back to the lexicographically first — `core:archive_run`, which nobody was ever
    // offered. The envelope carries the focus for exactly this (design spec §2.7).
    const { controller } = harness({ scenario: rejectedScenario });
    await controller.start();
    const before = controller.store.snapshot();
    expect(before.screen.contract?.definition).toBe('core:escort');

    await controller.save('slot-a');
    await controller.load('slot-a');

    const after = controller.store.snapshot();
    expect(after.screen.contract?.definition).toBe('core:escort');
    expect(readModelHash(after.screen)).toBe(readModelHash(before.screen));
  });
});
