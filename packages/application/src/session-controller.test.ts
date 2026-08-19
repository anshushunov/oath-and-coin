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
import { ReasonCodes } from '@oath-and-coin/simulation';
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
 * - `readSave` now checks a hero's traits against the rule table as well as history's
 *   references (review of this task moved that condition into the envelope, where it
 *   belongs), and it still cannot check which reason codes name a comrade — that
 *   vocabulary is `packages/presentation`'s. `withGhostComrade` walks through the seam
 *   that is left, and it is how a save that decodes but cannot be turned into a screen
 *   is still reachable at all.
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

/**
 * A scenario whose first command names a contract the content does not carry.
 *
 * The engine refuses the command — there is nothing to offer — but the *step* is still
 * recorded, so the screen factory reads a contract id off it that the campaign has no
 * entry for and throws. That is a defect in a scenario file rather than one of the five
 * error codes, which is exactly the shape `start` promises to surface synchronously.
 */
const unscreenableScenario: ScenarioFixture = {
  manifest: { ...MANIFEST, expected_screen_state: 'normal' },
  commands: {
    commands: [
      {
        command_id: 1,
        hero_index: 0,
        contract: 'core:contract_nobody_authored',
        expected_state_version: 0
      }
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

/** The same save with `snapshot` replaced, signed honestly — an honest resign. */
function resigned(bytes: Uint8Array, snapshot: Record<string, unknown>): Uint8Array {
  const tampered: Record<string, unknown> = { ...parseSave(bytes), snapshot };
  const { checksum: _checksum, created_at: createdAt, ...withoutChecksum } = tampered;

  return encodeUtf8(
    JSON.stringify({
      ...withoutChecksum,
      created_at: createdAt,
      checksum: saveChecksum(withoutChecksum)
    })
  );
}

interface RawFactor {
  reasonCode: string;
  sourceEntity: string;
  magnitude: number;
}

/**
 * The same save with every trace factor attributed to a comrade who is not in the roster.
 *
 * The one seam the envelope cannot close from where it stands: which reason codes name a
 * comrade is `packages/presentation`'s vocabulary, so nothing below the screen factory
 * can tell that `core:ghost` had to be a hero. The file decodes, passes referential
 * integrity, and throws a plain `Error` out of `resolveSourceDisplayNameKey` — which is
 * what the controller's second-echelon default is for.
 *
 * Every factor rather than the first: `rankReasons` shows at most three of them, chosen
 * by magnitude, so tampering with one and hoping it is displayed would be a test that
 * passes for a reason it does not state.
 */
function withGhostComrade(bytes: Uint8Array): Uint8Array {
  const snapshot = parseSave(bytes).snapshot as Record<string, unknown>;
  const traces = snapshot.traces as {
    value: { positiveFactors: RawFactor[]; negativeFactors: RawFactor[] };
  }[];

  const haunt = (factor: RawFactor): RawFactor => ({
    ...factor,
    reasonCode: ReasonCodes.StandsWithComrade,
    sourceEntity: 'core:ghost'
  });

  return resigned(bytes, {
    ...snapshot,
    traces: traces.map((trace) => ({
      ...trace,
      value: {
        ...trace.value,
        positiveFactors: trace.value.positiveFactors.map(haunt),
        negativeFactors: trace.value.negativeFactors.map(haunt)
      }
    }))
  });
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

describe('a run this build cannot make a screen out of', () => {
  it('throws where its stack points, synchronously, rather than into a lost promise', () => {
    // The property `start` is a non-`async` function for. `loadAndRunScenario` reports
    // every failure it knows about as a `failed` result, so a throw from in here is a
    // defect in this build — and a defect has to land where a stack trace is still
    // attached to it. As an `async` method the same throw becomes a rejected promise,
    // and `App.tsx` writes `void controller.start()`, where a rejection is seen by
    // nobody at all. This assertion is what reddens if the `async` is put back.
    const { controller } = harness({ scenario: unscreenableScenario });

    expect(() => controller.start()).toThrow(/no such contract/u);
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

  it('refuse a campaign this build could not read back, before it is written', async () => {
    // The trap review found: `expected` was applied to reading and not to writing. Five
    // shipped scenarios run against a fixture content root, so this state is reachable
    // by opening a URL — and the save would have gone to disk, overwritten whatever was
    // in the slot, and then been refused by this same build on the next load. The
    // confirmation Task 16.8 puts in front of an occupied slot cannot help: the player
    // would be confirming an exchange of a readable save for an unreadable one.
    const { controller, saves } = harness({
      expected: { rulesetVersion: RULESET_VERSION, contentVersion: 'ffffffffffffffff' }
    });
    await controller.start();
    expect(controller.store.snapshot().screen.contract).not.toBeNull();

    await expect(controller.save('slot-a')).resolves.toBeUndefined();

    expect(saves.slots.size).toBe(0);
    expect(controller.store.snapshot().savedStateHash).toBeNull();
    expect(controller.store.snapshot().saveFailure).toEqual({
      slot: 'slot-a',
      code: SaveErrorCodes.ContentMismatch,
      detail: expect.stringContaining('could not read back')
    });
  });

  it('refuse it for the ruleset first, as reading does', async () => {
    // Same order as `readSave`'s, so that a save refused at write time is refused for
    // the reason it would have been refused at read time. Both versions are wrong here,
    // and the ruleset is what is named.
    const { controller, saves } = harness({
      expected: { rulesetVersion: 'm0-nothing/0', contentVersion: 'ffffffffffffffff' }
    });
    await controller.start();

    await controller.save('slot-a');

    expect(saves.slots.size).toBe(0);
    expect(controller.store.snapshot().saveFailure?.code).toBe(SaveErrorCodes.RulesetMismatch);
  });

  it('do not overwrite a readable save with one this build could not read', async () => {
    // The whole of why the check is before `buildSave` rather than after the write.
    const written = harness();
    await written.controller.start();
    await written.controller.save('slot-a');
    const readable = written.saves.slots.get('slot-a')!;

    const foreign = harness({
      saves: written.saves,
      expected: { rulesetVersion: RULESET_VERSION, contentVersion: 'ffffffffffffffff' }
    });
    await foreign.controller.start();
    await foreign.controller.save('slot-a');

    expect(written.saves.slots.get('slot-a')).toBe(readable);
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
    // The second echelon, on the one input that still reaches it. A hero holding a trait
    // the rule table does not carry used to land here too; review of this task moved
    // that one into `checkReferentialIntegrity`, where it is a named condition rather
    // than a default deciding what a stranger's exception meant.
    const { controller, saves } = harness();
    await controller.start();
    await controller.save('slot-a');
    const before = controller.store.snapshot();
    saves.slots.set('slot-a', withGhostComrade(saves.slots.get('slot-a')!));

    await expect(controller.load('slot-a')).resolves.toBeUndefined();

    const after = controller.store.snapshot();
    expect(after.saveFailure?.code).toBe(SaveErrorCodes.Inconsistent);
    expect(after.saveFailure?.detail).toContain('core:ghost');
    expect(after.state).toBe(before.state);
  });

  it('refuses a hero holding a trait the save carries no rule for, from the envelope', async () => {
    // The same class, one layer lower now, and the code a player sees is the same one.
    const { controller, saves } = harness();
    await controller.start();
    await controller.save('slot-a');
    const snapshot = parseSave(saves.slots.get('slot-a')!).snapshot as Record<string, unknown>;
    saves.slots.set(
      'slot-a',
      resigned(saves.slots.get('slot-a')!, { ...snapshot, traitRules: [] })
    );

    await controller.load('slot-a');

    const failure = controller.store.snapshot().saveFailure;
    expect(failure?.code).toBe(SaveErrorCodes.Inconsistent);
    expect(failure?.detail).toContain('core:greedy');
    // From the envelope, not from the screen factory three layers up: the message a
    // player's refusal carries is the file's own, and `resolveTrait`'s talks about a
    // content-loading bug.
    expect(failure?.detail).toContain('the save carries no rule for it');
  });
});

describe('a refusal recorded for one slot', () => {
  /** A store that refuses `slot-c` and answers normally for everything else. */
  function refusingOneSlot(): SaveStorePort & { readonly slots: Map<SaveSlot, Uint8Array> } {
    const inner = fakeStore();

    return {
      slots: inner.slots,
      read: (slot) =>
        slot === 'slot-c'
          ? Promise.reject(unavailable())
          : Promise.resolve(inner.slots.get(slot) ?? null),
      write: (slot, bytes) =>
        slot === 'slot-c' ? Promise.reject(unavailable()) : inner.write(slot, bytes),
      list: () => inner.list()
    };
  }

  it('survives a successful save to another slot', async () => {
    // There are three slots and one `saveFailure`. A save to slot A that cleared the
    // refusal recorded for slot C would take a line off the slots screen that is still
    // true — slot C is still unreadable, and nothing about writing A found that out.
    const saves = refusingOneSlot();
    const { controller } = harness({ saves });
    await controller.start();
    await controller.load('slot-c');
    expect(controller.store.snapshot().saveFailure?.slot).toBe('slot-c');

    await controller.save('slot-a');

    expect(controller.store.snapshot().savedStateHash).not.toBeNull();
    expect(controller.store.snapshot().saveFailure?.slot).toBe('slot-c');
  });

  it('survives a successful load of another slot', async () => {
    const saves = refusingOneSlot();
    const { controller } = harness({ saves });
    await controller.start();
    await controller.save('slot-a');
    await controller.load('slot-c');
    expect(controller.store.snapshot().saveFailure?.slot).toBe('slot-c');

    await controller.load('slot-a');

    expect(controller.store.snapshot().canonicalHash).toBeNull();
    expect(controller.store.snapshot().saveFailure?.slot).toBe('slot-c');
  });

  it('is cleared by a success on the slot it was about', async () => {
    // The other half of the same rule, and the reason it is not "never clear anything":
    // a slot that has just been written successfully is not a slot with a refusal to
    // report, and a stale line saying otherwise is the same defect in the other
    // direction.
    const inner = fakeStore();
    const broken = { still: true };
    const saves: SaveStorePort = {
      read: (slot) => inner.read(slot),
      write: (slot, bytes) =>
        broken.still ? Promise.reject(unavailable()) : inner.write(slot, bytes),
      list: () => inner.list()
    };
    const { controller } = harness({ saves });
    await controller.start();
    await controller.save('slot-b');
    expect(controller.store.snapshot().saveFailure?.slot).toBe('slot-b');

    broken.still = false;
    await controller.save('slot-b');

    expect(controller.store.snapshot().saveFailure).toBeNull();
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
