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
import {
  ScreenKind,
  ScreenState,
  readModelHash,
  type ContractOfferScreenModel,
  type ScreenModel
} from '@oath-and-coin/presentation';
import {
  ReasonCodes,
  RejectionCodes,
  heroId,
  parseContentId,
  type CommandResult
} from '@oath-and-coin/simulation';
import { describe, expect, it } from 'vitest';

import type { ContentSourcePort, SaveStorePort } from './ports.ts';
import { saveChecksum } from './save/envelope.ts';
import { slotChanged, slotMayBeWritten } from './save/slot-guard.ts';
import { SAVE_SLOTS, type SaveSlot } from './save/slots.ts';
import {
  createSessionController,
  type OfferDraft,
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
  schema_version: 6,
  id: 'core:bram',
  display_name_key: 'hero.core.bram.name',
  greed: 60,
  caution: 30,
  pride: 45,
  trust_in_guild: 50,
  capability: { expertise: { frontline: 50, wilderness: 50 } },
  combat: { might: 50, guard: 50, aim: 50, focus: 50, care: 50 },
  role: 'vanguard',
  traits: ['core:greedy'],
  relationships: []
};

/** Sorts before `core:escort`, and is deliberately never the contract anyone answers. */
const ARCHIVE_RUN = {
  schema_version: 6,
  id: 'core:archive_run',
  display_name_key: 'contract.core.archive_run.name',
  patron_fee: 30,
  risk: 10,
  required_crew: 1,
  needs: { frontline: 10, wilderness: 10 },
  tags: []
};

const ESCORT = {
  schema_version: 6,
  id: 'core:escort',
  display_name_key: 'contract.core.escort.name',
  patron_fee: 70,
  risk: 30,
  required_crew: 1,
  needs: { frontline: 10, wilderness: 10 },
  tags: ['method:escort']
};

const GREEDY = {
  schema_version: 6,
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

/**
 * A three-hero roster over a two-seat contract — the one shape `contentTree`'s single
 * hero cannot produce: a `pollCrew` with somebody left to answer once the key hero's own
 * draft acceptance has already taken one of two seats. `DORAN` and `ZARA` are plain
 * copies of `BRAM` with a different id: `pollCrew`'s decision count does not depend on
 * which way either of them actually decides (`NEGOTIATION_SPEC` §3.3 asks the whole
 * remaining roster regardless of how many seats are already spoken for), only on how
 * many heroes are still owed an answer — two, here — so nothing about this fixture's
 * outcome is left to the seed.
 */
const DORAN = { ...BRAM, id: 'core:doran', display_name_key: 'hero.core.doran.name' };
const ZARA = { ...BRAM, id: 'core:zara', display_name_key: 'hero.core.zara.name' };

/**
 * Three seats, so the key hero's own draft acceptance leaves two for `pollCrew` to ask.
 * Two rather than one because the poll now asks the *invited* crew minus whoever has
 * answered (`DEC-012` as amended, `RESOLUTION_SPEC` §8), and "every decision a poll
 * produced" needs more than one decision to be a claim about a list.
 */
const CRYPT = {
  schema_version: 6,
  id: 'core:cleanse_the_crypt',
  display_name_key: 'contract.core.cleanse_the_crypt.name',
  patron_fee: 70,
  risk: 10,
  required_crew: 3,
  needs: { frontline: 10, wilderness: 10 },
  tags: []
};

function pollCrewContentTree(): ContentFileSource {
  return memoryFileSource({
    'heroes/bram.json': JSON.stringify(BRAM),
    'heroes/doran.json': JSON.stringify(DORAN),
    'heroes/zara.json': JSON.stringify(ZARA),
    'contracts/crypt.json': JSON.stringify(CRYPT),
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
    { name: 'final', after_command_id: 2 }
  ]
};

/**
 * The package every fixture below negotiates over, or tries to.
 *
 * `advance` is the contract's whole `patron_fee`: that is the number
 * `NEGOTIATION_SPEC` §4's benefit term reads, and an offer of nothing would make every
 * fixture here a hero deciding about no money.
 */
const composeEscort = {
  command: 'compose_offer',
  command_id: 1,
  contract: 'core:escort',
  key_hero_index: 0,
  invited_indexes: [0],
  advance: 70,
  method_tag: null,
  promised_bonus: 0,
  expected_state_version: 0
};

/** Bram answers the escort — the campaign has a history, a trace and a decided step. */
const answeredScenario: ScenarioFixture = {
  manifest: { ...MANIFEST, expected_screen_state: 'normal' },
  commands: {
    commands: [
      composeEscort,
      {
        command: 'propose_contract_to_hero',
        command_id: 2,
        contract: 'core:escort',
        hero_index: 0,
        expected_state_version: 1
      }
    ]
  }
};

/**
 * The same campaign `answeredScenario` reaches, with one difference load-bearing for
 * exactly one test: the second scripted command's own `command_id` is `3`, not `2` — a
 * deliberate gap. `appliedCommandIds` ends up `{1, 3}`, so its `size` (2) and its
 * maximum (3) answer differently to "what id has this campaign never applied": `size +
 * 1` is `3`, which collides with the id already spent; `max + 1` is `4`, which does
 * not. `session-controller.test.ts`'s "never reuses a command id" test is the one
 * place that distinction matters — on a dense `{1, 2}` id space the two formulas agree
 * on every step, and a controller computing the wrong one would pass unnoticed.
 */
const gappedIdScenario: ScenarioFixture = {
  manifest: {
    ...MANIFEST,
    expected_screen_state: 'normal',
    checkpoints: [
      { name: 'start', after_command_id: 0 },
      { name: 'final', after_command_id: 3 }
    ]
  },
  commands: {
    commands: [
      composeEscort,
      {
        command: 'propose_contract_to_hero',
        command_id: 3,
        contract: 'core:escort',
        hero_index: 0,
        expected_state_version: 1
      }
    ]
  }
};

/**
 * `core:escort` carried all the way through: resolved, then settled with the word kept.
 *
 * The last row of §6.4's table, and the one a save has to reopen on the board.
 */
const settledScenario: ScenarioFixture = {
  manifest: {
    ...MANIFEST,
    expected_screen_state: 'normal',
    checkpoints: [
      { name: 'start', after_command_id: 0 },
      { name: 'final', after_command_id: 5 }
    ]
  },
  commands: {
    commands: [
      composeEscort,
      {
        command: 'propose_contract_to_hero',
        command_id: 2,
        contract: 'core:escort',
        hero_index: 0,
        expected_state_version: 1
      },
      { command: 'lock_offer', command_id: 3, contract: 'core:escort', expected_state_version: 2 },
      {
        command: 'resolve_contract',
        command_id: 4,
        contract: 'core:escort',
        expected_state_version: 3
      },
      {
        command: 'settle_contract',
        command_id: 5,
        contract: 'core:escort',
        pay: true,
        // Four events land between `resolve_contract` and here: two needs closed, the
        // objective taken and the contract resolved (`RESOLUTION_SPEC` §3.4). Measured, not
        // assumed — a version one out is a silently refused command and a scenario that
        // still says `success`.
        expected_state_version: 7
      }
    ]
  }
};

/**
 * A campaign nobody has touched: two contracts, no commands, so the run applies no step.
 *
 * The one shape where "the contract the first step named" has no answer and the screen still
 * shows one — the campaign's lexicographically first, `core:archive_run`. External review of
 * the union task found the session disagreeing with the screen exactly here.
 */
const untouchedScenario: ScenarioFixture = {
  manifest: {
    ...MANIFEST,
    expected_screen_state: 'incomplete',
    checkpoints: [{ name: 'start', after_command_id: 0 }]
  }
};

/**
 * `core:escort` composed, accepted and locked — crewed, and not yet sent out.
 *
 * The state a live `resolveContract` is legal from, and the one §6.4's first row is about.
 */
const lockedScenario: ScenarioFixture = {
  manifest: {
    ...MANIFEST,
    expected_screen_state: 'normal',
    checkpoints: [
      { name: 'start', after_command_id: 0 },
      { name: 'final', after_command_id: 3 }
    ]
  },
  commands: {
    commands: [
      composeEscort,
      {
        command: 'propose_contract_to_hero',
        command_id: 2,
        contract: 'core:escort',
        hero_index: 0,
        expected_state_version: 1
      },
      { command: 'lock_offer', command_id: 3, contract: 'core:escort', expected_state_version: 2 }
    ]
  }
};

/**
 * `core:escort` composed, accepted, locked and resolved — a campaign whose contract has an
 * outcome to debrief and a promise still to answer.
 *
 * One seat, so the key hero's own acceptance fills the crew and no `poll_crew` is needed
 * (`NEGOTIATION_SPEC` §3.1). The state versions are stated rather than inferred: an
 * acceptance raises one event and a resolution raises several, so a command that declared
 * the version its predecessor *began* on would be refused as stale — the shape
 * `restored-read-model.test.ts` itemises refusals to catch.
 */
const resolvedScenario: ScenarioFixture = {
  manifest: {
    ...MANIFEST,
    expected_screen_state: 'normal',
    checkpoints: [
      { name: 'start', after_command_id: 0 },
      { name: 'final', after_command_id: 4 }
    ]
  },
  commands: {
    commands: [
      composeEscort,
      {
        command: 'propose_contract_to_hero',
        command_id: 2,
        contract: 'core:escort',
        hero_index: 0,
        expected_state_version: 1
      },
      { command: 'lock_offer', command_id: 3, contract: 'core:escort', expected_state_version: 2 },
      {
        command: 'resolve_contract',
        command_id: 4,
        contract: 'core:escort',
        expected_state_version: 3
      }
    ]
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
      composeEscort,
      {
        command: 'propose_contract_to_hero',
        command_id: 2,
        contract: 'core:escort',
        hero_index: 0,
        expected_state_version: 99
      }
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
        command: 'compose_offer',
        command_id: 1,
        contract: 'core:contract_nobody_authored',
        key_hero_index: 0,
        invited_indexes: [0],
        advance: 0,
        method_tag: null,
        promised_bonus: 0,
        expected_state_version: 0
      },
      {
        command: 'propose_contract_to_hero',
        command_id: 2,
        contract: 'core:contract_nobody_authored',
        hero_index: 0,
        expected_state_version: 0
      }
    ]
  }
};

/**
 * Stops right after `lockOffer`: the key hero (`core:bram`) has accepted in draft and
 * taken one of `CRYPT`'s two seats, and the package is locked. `core:doran` and
 * `core:zara` have not been asked yet — that is left to a live `pollCrew` dispatched
 * against the running controller, which is the one thing a scripted scenario command
 * cannot exercise (Task 16 dispatches live commands; a scenario command is composed
 * ahead of time, by definition).
 */
const pollCrewScenario: ScenarioFixture = {
  manifest: {
    ...MANIFEST,
    expected_screen_state: 'incomplete',
    checkpoints: [
      { name: 'start', after_command_id: 0 },
      { name: 'locked', after_command_id: 3 }
    ]
  },
  commands: {
    commands: [
      {
        command: 'compose_offer',
        command_id: 1,
        contract: 'core:cleanse_the_crypt',
        key_hero_index: 0,
        invited_indexes: [0, 1, 2],
        advance: 10,
        method_tag: null,
        promised_bonus: 0,
        expected_state_version: 0
      },
      {
        command: 'propose_contract_to_hero',
        command_id: 2,
        contract: 'core:cleanse_the_crypt',
        hero_index: 0,
        expected_state_version: 1
      },
      {
        command: 'lock_offer',
        command_id: 3,
        contract: 'core:cleanse_the_crypt',
        expected_state_version: 2
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

/**
 * A slot store that is nothing but a map, so what it holds is what was written — except
 * for the guard, which it honours exactly as both shipped stores do.
 *
 * A double that ignored the guard would make every test below pass whether the
 * controller passed one or not, which is the definition of a check that is not one. The
 * comparison is `slotMayBeWritten`, the same function the IndexedDB store calls, rather
 * than a second opinion written here.
 */
function fakeStore(): SaveStorePort & { readonly slots: Map<SaveSlot, Uint8Array> } {
  const slots = new Map<SaveSlot, Uint8Array>();

  return {
    slots,
    read: (slot) => Promise.resolve(slots.get(slot) ?? null),
    write: (slot, bytes, guard) => {
      if (!slotMayBeWritten(guard, slots.get(slot) ?? null)) {
        return Promise.reject(slotChanged(slot));
      }
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

interface HeldSaves {
  readonly bytes: ReadonlyMap<SaveSlot, Uint8Array>;
  /** The screen state each of the two campaigns lands on — the two must differ. */
  readonly stateOfA: string;
  readonly stateOfB: string;
}

/**
 * Two slots holding two campaigns a screen can tell apart.
 *
 * `slot-a` is the answered scenario and `slot-b` the rejected one, which land on
 * different screen states — that difference is the whole instrument for "which of two
 * overlapping loads won", and it is measured here rather than asserted from memory, so a
 * change to either fixture that made them identical reddens the test that uses it
 * instead of quietly making it prove nothing.
 */
async function twoDistinguishableSaves(): Promise<HeldSaves> {
  const answered = harness();
  await answered.controller.start();
  await answered.controller.save('slot-a');

  const rejected = harness({ scenario: rejectedScenario });
  await rejected.controller.start();
  await rejected.controller.save('slot-b');

  return {
    bytes: new Map([
      ['slot-a', answered.saves.slots.get('slot-a')!],
      ['slot-b', rejected.saves.slots.get('slot-b')!]
    ]),
    stateOfA: answered.controller.store.snapshot().screen.state,
    stateOfB: rejected.controller.store.snapshot().screen.state
  };
}

/**
 * A slot store whose reads finish when the test says so, and in the order the test says.
 *
 * A timer would express the same thing less reliably and more slowly; what the case is
 * about is the *order* two answers arrive in, and that is something to state rather than
 * to arrange and hope for.
 */
function deferredStore(
  held: HeldSaves,
  options: { readonly unreadable?: SaveSlot } = {}
): SaveStorePort & { release(slot: SaveSlot): void } {
  const waiting = new Map<SaveSlot, () => void>();

  return {
    read: (slot) =>
      new Promise<Uint8Array | null>((resolve, reject) => {
        waiting.set(slot, () => {
          if (slot === options.unreadable) {
            reject(unavailable());
            return;
          }
          resolve(held.bytes.get(slot) ?? null);
        });
      }),
    write: () => Promise.resolve(),
    list: () => Promise.resolve([...held.bytes.keys()]),
    release: (slot) => {
      const answer = waiting.get(slot);
      if (answer === undefined) {
        throw new Error(`nothing is waiting on a read of '${slot}'.`);
      }
      waiting.delete(slot);
      answer();
    }
  };
}

/** The envelope a slot holds, as JSON. */
function parseSave(bytes: Uint8Array): Record<string, unknown> {
  return JSON.parse(decodeUtf8OrThrow(bytes)) as Record<string, unknown>;
}

/**
 * The same save with `snapshot` replaced, signed honestly — an honest resign.
 *
 * `created_at` is inside the signed set, because since external review of Task 16 it is
 * inside the signature (`envelope.ts`'s `saveChecksum`). A helper that kept excluding it
 * would sign every fixture wrongly and every test below would report
 * `SAVE_CHECKSUM_MISMATCH` instead of the refusal it is about.
 */
function resigned(bytes: Uint8Array, snapshot: Record<string, unknown>): Uint8Array {
  const tampered: Record<string, unknown> = { ...parseSave(bytes), snapshot };
  const { checksum: _checksum, ...withoutChecksum } = tampered;

  return encodeUtf8(
    JSON.stringify({ ...withoutChecksum, checksum: saveChecksum(withoutChecksum) })
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

describe('отказ файла против дефекта сборки, на пути записи', () => {
  /**
   * Round 2 of the seam review measured that this distinction was held by a comment and
   * by nothing else: three mutants on `save`'s `catch` were green. The distinction is
   * real and it is the module's own header claim — a refusal is a code on a screen, a
   * defect belongs where its stack points — so it needs checks, not a paragraph.
   *
   * The three mutants these cover:
   *
   * 1. drop `if (!(cause instanceof SaveReadError)) throw cause` — a defect would be
   *    dressed as a save error and the player would be told the file was inconsistent
   *    about a build that is broken;
   * 2. record a fixed code instead of `cause.code` — every refusal would arrive under
   *    one label whatever `buildSave` actually said;
   * 3. put `buildSave` back outside the `try` — a refusal would leave `save()` as a
   *    rejected promise, which is precisely the shape the module says a screen cannot
   *    show.
   */

  it('несёт код, который назвал сам buildSave, а не заранее выбранный', async () => {
    // A stamp `buildSave` will not put on a file. It is not a store failure, not a
    // version mismatch, and not `SAVE_INCONSISTENT` either — so a `catch` reporting any
    // fixed code would answer this wrongly.
    const { controller, saves } = harness({ now: () => 'not-a-date' });
    await controller.start();

    await expect(controller.save('slot-a')).resolves.toBeUndefined();

    expect(controller.store.snapshot().saveFailure).toEqual({
      slot: 'slot-a',
      code: SaveErrorCodes.Malformed,
      detail: expect.stringContaining("'created_at' must be an ISO-8601 instant")
    });
    // Ничего не записано и хеш кампании не сдвинулся: отказ записи оставляет слот и
    // сессию ровно там, где они были.
    expect(saves.slots.size).toBe(0);
    expect(controller.store.snapshot().savedStateHash).toBeNull();
  });

  it('и код отказа кампании — тоже его, а не умолчание', async () => {
    // The other code `buildSave` can answer with, so that a `catch` hard-wired to
    // `SAVE_MALFORMED` fails as loudly as one hard-wired to `SAVE_INCONSISTENT`.
    const { controller, saves } = harness();
    await controller.start();
    const session = controller.store.snapshot();
    const state = session.state!;
    controller.store.replace({
      ...session,
      // A campaign the engine could not have produced: the counters no longer match the
      // history. `buildSave` refuses it rather than writing a file this same build would
      // refuse to read.
      state: { ...state, metadata: { ...state.metadata, stateVersion: 99 } }
    });

    await expect(controller.save('slot-a')).resolves.toBeUndefined();

    expect(controller.store.snapshot().saveFailure?.code).toBe(SaveErrorCodes.Inconsistent);
    expect(controller.store.snapshot().saveFailure?.detail).toContain('stateVersion is 99');
    expect(saves.slots.size).toBe(0);
  });

  it('а дефект сборки выходит наружу как есть, не превращаясь в отказ файла', async () => {
    // The half a `catch` is most tempting to swallow. `heroes` is not a `SortedMap` here,
    // so `validateGameState` throws a `TypeError` from inside this build's own code over
    // this build's own data — which is a defect, not something a player can do anything
    // about, and filing it under a save error code would put it under the one thing that
    // is provably not wrong.
    const { controller, saves } = harness();
    await controller.start();
    const session = controller.store.snapshot();
    controller.store.replace({
      ...session,
      state: { ...session.state!, heroes: {} as never }
    });

    await expect(controller.save('slot-a')).rejects.toBeInstanceOf(TypeError);

    expect(controller.store.snapshot().saveFailure).toBeNull();
    expect(saves.slots.size).toBe(0);
  });

  it('а SaveReadError из хранилища по-прежнему отказ, а не дефект', async () => {
    // The neighbouring path, so that "rethrow what is not a SaveReadError" cannot be
    // satisfied by rethrowing everything.
    const { controller } = harness({ saves: refusingStore(unavailable) });
    await controller.start();

    await expect(controller.save('slot-a')).resolves.toBeUndefined();

    expect(controller.store.snapshot().saveFailure?.code).toBe(SaveErrorCodes.StorageUnavailable);
  });
});

describe('the hash a session reports as its saved state', () => {
  it('is the campaign’s own hash, and not the signature on the file', async () => {
    // Two questions, two numbers, since external review of Task 16 moved `created_at`
    // inside the signature. `checksum` answers "has this file been edited since it was
    // signed" and moves with the clock; `savedStateHash` answers "which campaign is
    // this" and must not. A controller reporting the signature here would make "is this
    // slot the campaign on screen" unanswerable the moment the same campaign was saved
    // twice.
    const { controller, saves } = harness();
    await controller.start();
    await controller.save('slot-a');

    const file = parseSave(saves.slots.get('slot-a')!);

    // Against the snapshot *the file carries*, hashed by `saveChecksum` — the same
    // canonical hash over whatever JSON value it is handed. Deliberately not against
    // `snapshotHash(session.state)`, which would be the function under test compared
    // with itself and would stay green for any projection it chose.
    expect(controller.store.snapshot().savedStateHash).toBe(saveChecksum(file.snapshot));
    expect(controller.store.snapshot().savedStateHash).not.toBe(file.checksum);
  });

  it('does not move when only the moment of saving does', async () => {
    // The campaign's hash covers the snapshot and nothing else, so saving one campaign
    // twice answers identically here — while the file's own signature, which now covers
    // `created_at`, answers differently. Both halves are asserted: without the second,
    // a `snapshotHash` that quietly went back to hashing the whole envelope would still
    // pass the first only if the clock were fixed, and it is not.
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
    expect(parseSave(second.saves.slots.get('slot-a')!).checksum).not.toBe(
      parseSave(first.saves.slots.get('slot-a')!).checksum
    );
  });

  it('is the same number after a load as it was after the write', async () => {
    const { controller } = harness();
    await controller.start();
    await controller.save('slot-a');
    const written = controller.store.snapshot().savedStateHash;

    await controller.load('slot-a');

    expect(written).toMatch(/^[0-9a-f]{64}$/u);
    expect(controller.store.snapshot().savedStateHash).toBe(written);
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

    await expect(other.controller.load('slot-a')).resolves.toMatchObject({ outcome: 'refused' });

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
    expect(offerScreen(controller.store.snapshot().screen).contract).not.toBeNull();

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

    await expect(controller.load('slot-c')).resolves.toMatchObject({ outcome: 'refused' });

    const after = controller.store.snapshot();
    expect(after.saveFailure?.slot).toBe('slot-c');
    expect(after.saveFailure?.code).toBe(SaveErrorCodes.StorageUnavailable);
    expect(readModelHash(after.screen)).toBe(readModelHash(before.screen));
  });

  it('leaves the campaign the player asked for last, not the read that answered last', async () => {
    // External review of segment 5: the slots screen disables nothing while an
    // operation is in flight, so two loads overlap the moment a player clicks a
    // second slot — and until this, they committed in the order their storage
    // happened to answer in. A slow first read landing after a fast second one
    // replaced the campaign on screen with the one the player had moved on from.
    const held = await twoDistinguishableSaves();
    const store = deferredStore(held);
    const { controller } = harness({ saves: store });
    await controller.start();

    const first = controller.load('slot-a');
    const second = controller.load('slot-b');

    store.release('slot-b');
    await expect(second).resolves.toMatchObject({ outcome: 'loaded' });

    store.release('slot-a');
    await expect(first).resolves.toMatchObject({ outcome: 'superseded' });

    expect(controller.store.snapshot().screen.state).toBe(held.stateOfB);
    expect(held.stateOfA).not.toBe(held.stateOfB);
  });

  it('a superseded refusal is not written over the session either', async () => {
    // The same rule applied to the losing call's *failure*. Recording it would put a
    // refusal on the screen about a question the player has already replaced — and it
    // is not lost by being dropped: a slot that genuinely cannot be read says so on its
    // own line the next time the screen asks the storage.
    const held = await twoDistinguishableSaves();
    const store = deferredStore(held, { unreadable: 'slot-a' });
    const { controller } = harness({ saves: store });
    await controller.start();

    const first = controller.load('slot-a');
    const second = controller.load('slot-b');

    store.release('slot-b');
    await second;
    store.release('slot-a');

    await expect(first).resolves.toEqual({ outcome: 'superseded', failure: null });
    expect(controller.store.snapshot().saveFailure).toBeNull();
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

    await expect(controller.load('slot-a')).resolves.toMatchObject({ outcome: 'refused' });

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
      write: (slot, bytes, guard) =>
        slot === 'slot-c' ? Promise.reject(unavailable()) : inner.write(slot, bytes, guard),
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
      write: (slot, bytes, guard) =>
        broken.still ? Promise.reject(unavailable()) : inner.write(slot, bytes, guard),
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

describe('the three slots as the controller answers for them', () => {
  it('describes what the storage holds, slot by slot', async () => {
    const { controller } = harness();
    await controller.start();
    await controller.save('slot-b');

    const described = await controller.slots();

    expect(described.map((slot) => slot.slot)).toEqual([...SAVE_SLOTS]);
    expect(described[1]).toEqual({
      slot: 'slot-b',
      createdAt: CREATED_AT,
      // The fixture's one command decides an offer; logical time moves with the clock
      // of the campaign, not with the number of commands, and this campaign is at zero.
      logicalTime: 0,
      focusedContract: 'core:escort',
      errorCode: null
    });
    expect(described[0]?.createdAt).toBeNull();
  });

  it('carries a refused write on the slot it was about, over an intact campaign', async () => {
    // The transition the design spec calls "отказ записи → слот остаётся прежним и это
    // видно". The storage is untouched — that is what the port promises — so the slot
    // still describes perfectly, and only the session knows the write did not happen.
    // Without the overlay the screen would show a line that says nothing went wrong.
    const inner = fakeStore();
    const broken = { still: false };
    const saves: SaveStorePort = {
      read: (slot) => inner.read(slot),
      write: (slot, bytes, guard) =>
        broken.still ? Promise.reject(unavailable()) : inner.write(slot, bytes, guard),
      list: () => inner.list()
    };
    const { controller } = harness({ saves });
    await controller.start();
    await controller.save('slot-a');

    broken.still = true;
    await controller.save('slot-a');

    const [first, second, third] = await controller.slots();
    expect(first?.errorCode).toBe(SaveErrorCodes.StorageUnavailable);
    expect(first?.createdAt).toBe(CREATED_AT);
    expect(first?.logicalTime).toBe(0);

    // And nowhere else: one refusal is about one slot.
    expect([second?.errorCode, third?.errorCode]).toEqual([null, null]);
  });

  it('carries no refusal once the slot it was about has been written', async () => {
    const inner = fakeStore();
    const broken = { still: true };
    const saves: SaveStorePort = {
      read: (slot) => inner.read(slot),
      write: (slot, bytes, guard) =>
        broken.still ? Promise.reject(unavailable()) : inner.write(slot, bytes, guard),
      list: () => inner.list()
    };
    const { controller } = harness({ saves });
    await controller.start();
    await controller.save('slot-a');
    expect((await controller.slots())[0]?.errorCode).toBe(SaveErrorCodes.StorageUnavailable);

    broken.still = false;
    await controller.save('slot-a');

    expect((await controller.slots())[0]?.errorCode).toBeNull();
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

describe('сохранение поверх слота, который успели занять', () => {
  // Сценарий внешнего ревью сегмента 5 целиком, на уровне контроллера: вкладка A видит
  // слот пустым, вкладка B успевает его занять, A жмёт «Сохранить». Подтверждения A не
  // спрашивала и не должна была — пустой слот его не требует, — поэтому без сторожа
  // кампания B исчезает молча.

  it('отказывает и оставляет чужую кампанию на месте', async () => {
    const { controller, saves } = harness();
    await controller.start();

    // Вкладка A смотрит на экран сохранений: все три слота пусты.
    await controller.slots();

    // Вкладка B занимает слот-a. Хранилище то же, уведомлений нет.
    const fromAnotherTab = encodeUtf8('{"чужая":"кампания"}');
    saves.slots.set('slot-a', fromAnotherTab);

    await controller.save('slot-a');

    expect(saves.slots.get('slot-a')).toBe(fromAnotherTab);
    expect(controller.store.snapshot().saveFailure).toEqual({
      slot: 'slot-a',
      code: SaveErrorCodes.SlotChanged,
      detail: expect.stringContaining('replace a campaign nobody was shown')
    });
  });

  it('и повторное сохранение проходит, когда игрок посмотрел заново', async () => {
    // Отказ обязан быть проходимым: экран перечитывает слоты после каждой операции, а
    // сторож, который нельзя обновить, — это слот, в который больше никогда не
    // сохранить.
    const { controller, saves } = harness();
    await controller.start();
    await controller.slots();
    saves.slots.set('slot-a', encodeUtf8('{"чужая":"кампания"}'));

    await controller.save('slot-a');
    await controller.slots();
    await controller.save('slot-a');

    expect(controller.store.snapshot().saveFailure).toBeNull();
    expect(parseSave(saves.slots.get('slot-a')!).format_version).toBe(1);
  });

  it('сохраняет в тот же слот дважды подряд, не споря сам с собой', async () => {
    // Сторож после успешной записи описывает именно её результат. Иначе вторая запись
    // подряд отказывала бы, сравнивая слот с тем, что лежало до первой.
    const { controller, saves } = harness();
    await controller.start();
    await controller.slots();

    await controller.save('slot-a');
    await controller.save('slot-a');

    expect(controller.store.snapshot().saveFailure).toBeNull();
    expect(saves.slots.size).toBe(1);
  });

  it('пишет без сторожа только туда, о чём этой сессии никто ничего не говорил', async () => {
    // Честный ответ, а не лазейка: не о чем ошибаться. С экрана сохранений он
    // недостижим — тот спрашивает хранилище до отрисовки и после каждой операции.
    const { controller, saves } = harness();
    await controller.start();
    saves.slots.set('slot-a', encodeUtf8('{"чужая":"кампания"}'));

    await controller.save('slot-a');

    expect(controller.store.snapshot().saveFailure).toBeNull();
    expect(parseSave(saves.slots.get('slot-a')!).format_version).toBe(1);
  });

  it('забывает слот, о котором хранилище не смогло ответить', async () => {
    // «Ничего не увидели» — не наблюдение. Записать его как «пусто» значило бы дать
    // записи утверждать, что слот был пуст, когда туда никто не смотрел.
    const inner = fakeStore();
    const broken = { still: false };
    const saves: SaveStorePort = {
      read: (slot) => (broken.still ? Promise.reject(unavailable()) : inner.read(slot)),
      write: (slot, bytes, guard) => inner.write(slot, bytes, guard),
      list: () => inner.list()
    };
    const { controller } = harness({ saves });
    await controller.start();

    // Сначала слот увиден пустым, потом чтение ломается и наблюдение обязано пропасть.
    await controller.slots();
    inner.slots.set('slot-a', encodeUtf8('{"чужая":"кампания"}'));
    broken.still = true;
    await controller.slots();

    await controller.save('slot-a');

    // Без забывания сторож всё ещё утверждал бы «слот был пуст» и запись отказала бы;
    // с ним запись безусловна, потому что этой сессии про слот ничего не известно.
    expect(controller.store.snapshot().saveFailure).toBeNull();
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
    expect(offerScreen(before.screen).contract?.definition).toBe('core:escort');

    await controller.save('slot-a');
    await controller.load('slot-a');

    const after = controller.store.snapshot();
    expect(offerScreen(after.screen).contract?.definition).toBe('core:escort');
    expect(readModelHash(after.screen)).toBe(readModelHash(before.screen));
  });
});

describe('moving the session between screens and contracts', () => {
  const escort = parseContentId('core:escort');
  const archive = parseContentId('core:archive_run');

  it('redraws the offer on another contract when the focus moves', async () => {
    // `answeredScenario` opens on `core:escort` — the contract its first step named, not
    // the lexicographically first, which is `core:archive_run`. So a focus that did
    // nothing and a focus that worked would show two different contracts here.
    const { controller } = harness();
    await controller.start();
    expect(offerScreen(controller.store.snapshot().screen).contract?.definition).toBe(
      'core:escort'
    );

    controller.focus(archive);

    expect(offerScreen(controller.store.snapshot().screen).contract?.definition).toBe(
      'core:archive_run'
    );
    expect(controller.store.snapshot().focusedContract).toBe(archive);
  });

  it('keeps the screen it is on while the focus moves', async () => {
    const { controller } = harness();
    await controller.start();
    controller.show(ScreenKind.ContractBoard);

    controller.focus(archive);

    expect(controller.store.snapshot().screen.screen).toBe(ScreenKind.ContractBoard);
    expect(controller.store.snapshot().focusedContract).toBe(archive);
  });

  it('keeps the focus while the screen moves', async () => {
    const { controller } = harness();
    await controller.start();

    controller.show(ScreenKind.ContractBoard);

    expect(controller.store.snapshot().screen.screen).toBe(ScreenKind.ContractBoard);
    expect(controller.store.snapshot().focusedContract).toBe(escort);

    controller.show(ScreenKind.ContractOffer);

    expect(offerScreen(controller.store.snapshot().screen).contract?.definition).toBe(
      'core:escort'
    );
  });

  it('shows the debrief of the contract it is focused on', async () => {
    // The one screen `show` cannot build without a focus, and the one that proves `show`
    // reads the session's own field rather than whatever the previous screen carried.
    const { controller } = harness({ scenario: resolvedScenario });
    await controller.start();

    controller.show(ScreenKind.AfterAction);

    const { screen } = controller.store.snapshot();
    expect(screen.screen).toBe(ScreenKind.AfterAction);
    expect(screen.screen === ScreenKind.AfterAction && screen.contractDefinition).toBe(escort);
  });

  it('sends an applied command where §6.4 puts it, not where the player was standing', async () => {
    // From the board, and the command is a settlement — so "stayed where it was" and "went
    // where the table says" would agree if they were read off the same row. The first
    // assertion is the one that tells them apart: a resolution moves the player to the
    // debrief from wherever they pressed it.
    const { controller } = harness({ scenario: lockedScenario });
    await controller.start();
    controller.show(ScreenKind.ContractBoard);

    expect(controller.resolveContract({ retreatAtRound: null, contractId: escort }).applied).toBe(
      true
    );
    expect(controller.store.snapshot().screen.screen).toBe(ScreenKind.AfterAction);

    expect(controller.settleContract({ contractId: escort, pay: true }).applied).toBe(true);
    expect(controller.store.snapshot().screen.screen).toBe(ScreenKind.ContractBoard);
  });

  it('reopens a loaded campaign on the contract the file named, from any screen', async () => {
    // `focusedContract` is what a save writes and what a load has to put back (design spec
    // §2.7). The board is the case that makes it load-bearing: it names no contract, so a
    // session that read the focus off the screen would write `null` from here and reopen on
    // whatever the fallback picked. `rejectedScenario` is the fixture where the fallback and
    // the truth differ — its only step was refused, so a reloaded campaign has no step to
    // read a contract off at all.
    const { controller } = harness({ scenario: rejectedScenario });
    await controller.start();
    controller.show(ScreenKind.ContractBoard);
    expect(controller.store.snapshot().focusedContract).toBe(escort);

    await controller.save('slot-a');
    await controller.load('slot-a');

    expect(controller.store.snapshot().focusedContract).toBe(escort);
  });

  it('agrees with the screen about which contract a stepless run is on', async () => {
    // A run that applied no command still shows a contract — the campaign's first, since
    // there is no step to name one — and a session claiming no focus there would write
    // nothing into the file `ADR-006` asks to carry it. The screen and the session answer
    // the same question, so they answer it with one function.
    const { controller, saves } = harness({ scenario: untouchedScenario });
    await controller.start();

    const shown = offerScreen(controller.store.snapshot().screen).contract?.definition;
    expect(shown).toBe('core:archive_run');
    expect(controller.store.snapshot().focusedContract).toBe(archive);

    await controller.slots();
    await controller.save('slot-a');

    // The save happened at all, which is the half a `null` focus silently skipped.
    expect(saves.slots.has('slot-a')).toBe(true);
    expect(controller.store.snapshot().saveFailure).toBeNull();
  });

  it('refuses a contract the campaign does not carry', async () => {
    const { controller } = harness();
    await controller.start();

    expect(() => {
      controller.focus(parseContentId('core:nobody_authored_this'));
    }).toThrow();
  });
});

/**
 * `RESOLUTION_SPEC` §6.4's table, row by row, through the real controller.
 *
 * A direct test of the screen factories cannot answer any of this: those check what a model
 * looks like, and the table is about *which* model the application chooses. The three load
 * rows in particular are the ones the plan calls out — without them a save of a resolved
 * campaign reopens on the negotiation and its debrief is unreachable for good.
 */
describe('where the campaign puts the player', () => {
  const escort = parseContentId('core:escort');
  const archive = parseContentId('core:archive_run');

  it('sends an applied resolveContract to the debrief', async () => {
    const { controller } = harness({ scenario: lockedScenario });
    await controller.start();
    expect(controller.store.snapshot().screen.screen).toBe(ScreenKind.ContractOffer);

    expect(controller.resolveContract({ retreatAtRound: null, contractId: escort }).applied).toBe(
      true
    );

    expect(controller.store.snapshot().screen.screen).toBe(ScreenKind.AfterAction);
  });

  it('leaves a refused resolveContract where it was', async () => {
    // `core:archive_run` was never composed, so the command is refused for an offer that is
    // not locked. §6.4 gives this row to "stays on the offer", and what makes it true is
    // that a rejection touches nothing at all — the session is the same object afterwards.
    const { controller } = harness({ scenario: lockedScenario });
    await controller.start();
    const before = controller.store.snapshot();

    const refused = controller.resolveContract({ retreatAtRound: null, contractId: archive });

    expect(refused.applied).toBe(false);
    expect(refused.rejectionCode).toBe(RejectionCodes.OfferNotLocked);
    expect(controller.store.snapshot()).toBe(before);
    expect(controller.store.snapshot().screen.screen).toBe(ScreenKind.ContractOffer);
  });

  it('sends an applied settleContract to the board', async () => {
    const { controller } = harness({ scenario: resolvedScenario });
    await controller.start();
    expect(controller.store.snapshot().screen.screen).toBe(ScreenKind.AfterAction);

    expect(controller.settleContract({ contractId: escort, pay: true }).applied).toBe(true);

    expect(controller.store.snapshot().screen.screen).toBe(ScreenKind.ContractBoard);
  });

  it('leaves a refused settleContract on the debrief', async () => {
    const { controller } = harness({ scenario: resolvedScenario });
    await controller.start();
    const before = controller.store.snapshot();

    const refused = controller.settleContract({ contractId: archive, pay: true });

    expect(refused.applied).toBe(false);
    expect(controller.store.snapshot()).toBe(before);
    expect(controller.store.snapshot().screen.screen).toBe(ScreenKind.AfterAction);
  });

  it('starts a session on the screen the campaign is already at', async () => {
    // The row a direct test of the factories cannot reach: the scenario resolves its
    // contract before the player ever touches it, so the very first screen of the session
    // is a debrief. A start that always built the negotiation would pass every factory test
    // and fail this one.
    const { controller } = harness({ scenario: resolvedScenario });

    await controller.start();

    expect(controller.store.snapshot().screen.screen).toBe(ScreenKind.AfterAction);
  });

  it('starts on the negotiation while nothing has come back', async () => {
    // The counterpart, so "always the debrief" is not the rule this file agrees with.
    const { controller } = harness({ scenario: lockedScenario });

    await controller.start();

    expect(controller.store.snapshot().screen.screen).toBe(ScreenKind.ContractOffer);
  });

  it.each([
    ['unresolved', lockedScenario, ScreenKind.ContractOffer],
    ['resolved but unsettled', resolvedScenario, ScreenKind.AfterAction],
    ['settled', settledScenario, ScreenKind.ContractBoard]
  ])('reopens a %s save on the screen its campaign is at', async (_name, scenario, expected) => {
    // Three saves written by three campaigns and read back by a fresh session, so nothing
    // of the writing session survives into the reading one but the file. The screen a load
    // lands on is decided from the campaign in that file and from nothing else.
    const writing = harness({ scenario });
    await writing.controller.start();
    await writing.controller.slots();
    await writing.controller.save('slot-a');

    const bytes = writing.saves.slots.get('slot-a');
    expect(bytes).toBeDefined();

    const reading = harness({ saves: storeHolding(bytes!) });
    await reading.controller.start();
    // Pointed somewhere else first, so "read the file" and "keep what this session was
    // already on" are two different answers. Without it a load that ignored the
    // descriptor entirely would agree with every row of this table.
    reading.controller.focus(archive);
    expect(reading.controller.store.snapshot().screen.screen).toBe(ScreenKind.ContractOffer);

    const result = await reading.controller.load('slot-a');

    expect(result.outcome).toBe('loaded');
    expect(reading.controller.store.snapshot().focusedContract).toBe(escort);
    expect(reading.controller.store.snapshot().screen.screen).toBe(expected);
  });

  it('reopens on the contract the file named, not on the one that has an outcome', async () => {
    // The case the table above cannot reach: a campaign where the settled contract and the
    // focused one are *different*. `core:escort` is settled and `core:archive_run` was never
    // composed, and the file names the second — so a load that read the screen off "whichever
    // contract of this campaign has been resolved" would land on the board, and one that kept
    // the reading session's own focus would land there too, since that session is on
    // `core:escort`. Only reading `focused_contract` out of the file gives the negotiation.
    const writing = harness({ scenario: settledScenario });
    await writing.controller.start();
    expect(writing.controller.store.snapshot().screen.screen).toBe(ScreenKind.ContractBoard);

    writing.controller.focus(archive);
    writing.controller.show(ScreenKind.ContractOffer);
    await writing.controller.slots();
    await writing.controller.save('slot-a');

    const bytes = writing.saves.slots.get('slot-a');
    expect(bytes).toBeDefined();

    const reading = harness({ scenario: settledScenario, saves: storeHolding(bytes!) });
    await reading.controller.start();
    expect(reading.controller.store.snapshot().focusedContract).toBe(escort);

    expect((await reading.controller.load('slot-a')).outcome).toBe('loaded');

    expect(reading.controller.store.snapshot().focusedContract).toBe(archive);
    expect(reading.controller.store.snapshot().screen.screen).toBe(ScreenKind.ContractOffer);
  });
});

/** A slot store holding exactly these bytes in `slot-a`, for a session that only reads. */
function storeHolding(bytes: Uint8Array): SaveStorePort {
  return {
    read: (slot) => Promise.resolve(slot === 'slot-a' ? bytes : null),
    write: () => Promise.resolve(),
    list: () => Promise.resolve(['slot-a'])
  };
}

describe('dispatching the six negotiation commands', () => {
  const escort = parseContentId('core:escort');
  const bram = heroId(0);

  it('composes an offer against the version the caller was looking at', async () => {
    // `answeredScenario` has already applied two commands by the time the controller
    // hands control to the player — `composeOffer` then `proposeContractToHero` — so
    // `stateVersion` starts above zero. A controller that composed a command against a
    // stale or hard-coded `expectedStateVersion` (0, or "whatever `start` produced")
    // would have this revision refused as `rejected.stale_state` the moment the
    // campaign had moved even once before it was issued.
    const { controller } = harness();
    await controller.start();
    const versionBeforeRevision = controller.store.snapshot().state!.metadata.stateVersion;
    expect(versionBeforeRevision).toBeGreaterThan(0);
    // A run hash exists before any live command — the property `session.test.ts`'s
    // "keeps the run hash while the run is what is on screen" already pins.
    expect(controller.store.snapshot().canonicalHash).toMatch(/^[0-9a-f]{64}$/u);

    const result = controller.composeOffer({
      contractId: escort,
      keyHero: bram,
      invited: [bram],
      advance: 40,
      methodTag: null,
      promisedBonus: 0
    });

    expect(result.applied).toBe(true);
    expect(result.rejectionCode).toBeNull();
    expect(result.state.metadata.stateVersion).toBe(versionBeforeRevision + 1);
    // The screen on the store moved with it — a controller that computed the right
    // `CommandResult` but forgot to publish it would leave a player looking at the
    // package they revised away from.
    expect(offerScreen(controller.store.snapshot().screen).offer?.advanceLever.value).toBe(40);
    // `canonicalHash` is over the whole scripted `ScenarioOutcome`, and a live command
    // was never one of its steps — carrying the old hash forward would claim a
    // campaign this call just changed is still the one the run produced.
    expect(controller.store.snapshot().canonicalHash).toBeNull();
  });

  it('surfaces a rejection code instead of throwing', async () => {
    // `answeredScenario`'s Bram has already answered this exact package once, and
    // `core:escort` needs one seat, so his acceptance already left the contract
    // `crewed` — `proposeContractToHero` checks `contract.status !== Offered` before it
    // ever asks whether this hero has answered (`engine.ts`), so asking again lands on
    // `rejected.contract_already_resolved`, not `already_responded`. Either is a
    // refusal a screen has to be able to show, not an exception a caller has to
    // remember to catch — an implementation that threw on a rejection, or one that
    // quietly mutated the session before discovering the command was illegal, both
    // fail this.
    const { controller } = harness();
    await controller.start();
    const before = controller.store.snapshot();

    let result: CommandResult | undefined;
    expect(() => {
      result = controller.proposeContractToHero({ contractId: escort, heroId: bram });
    }).not.toThrow();

    expect(result?.applied).toBe(false);
    expect(result?.rejectionCode).toBe(RejectionCodes.ContractAlreadyResolved);
    // Nothing about the session moved — a rejection is the same object back, not a
    // near-miss the store was updated with anyway.
    expect(controller.store.snapshot()).toBe(before);
  });

  it('never reuses a command id across the six negotiation commands', async () => {
    // On `gappedIdScenario`'s campaign, whose two scripted commands leave
    // `appliedCommandIds` at `{1, 3}` rather than the dense `{1, 2}` `answeredScenario`
    // would — deliberately, so "the next id" computed as `size + 1` (2 spent, so 3) and
    // as `max + 1` (3 spent, so 4) disagree from the very first live command. A
    // controller taking the former would hand `composeOffer` the id `3`, which the
    // scenario already spent, and `composeOffer` would refuse it as
    // `rejected.duplicate_command` on the spot — this is what `composed.applied` below
    // actually catches, not a hypothetical.
    //
    // Five of the six commands here apply for real; the other, `pollCrew` against a
    // single-hero, single-seat contract, is refused for being late rather than for
    // colliding — but which refusal it gets is the whole instrument for the *later*
    // ids too. `pollCrew`'s own checks run `rejected.stale_state`, then
    // `rejected.duplicate_command`, and only then the phase/crew checks
    // (`NEGOTIATION_SPEC` §6.1) — so if the controller handed it a command id already
    // spent by the `lockOffer` three lines above, `pollCrew` would be refused as a
    // duplicate and this assertion would name that instead of the crew-already-filled
    // refusal the campaign is actually in.
    const { controller } = harness({ scenario: gappedIdScenario });
    await controller.start();

    const composed = controller.composeOffer({
      contractId: escort,
      keyHero: bram,
      invited: [bram],
      advance: 70,
      methodTag: null,
      promisedBonus: 0
    });
    expect(composed.applied).toBe(true);

    const proposed = controller.proposeContractToHero({ contractId: escort, heroId: bram });
    expect(proposed.applied).toBe(true);

    const locked = controller.lockOffer({ contractId: escort });
    expect(locked.applied).toBe(true);

    const polled = controller.pollCrew({ contractId: escort });
    expect(polled.applied).toBe(false);
    expect(polled.rejectionCode).toBe(RejectionCodes.CrewAlreadyFilled);

    // The sixth command, and not optional: a settlement pays against an outcome, so a
    // contract that has not been resolved is refused (`RESOLUTION_SPEC` §2.5). It also
    // spends an id of its own, which is what makes it part of what this test measures.
    const resolved = controller.resolveContract({ retreatAtRound: null, contractId: escort });
    expect(resolved.applied).toBe(true);

    const settled = controller.settleContract({ contractId: escort, pay: true });
    expect(settled.applied).toBe(true);
    // `gappedIdScenario`'s own two scripted commands (ids 1 and 3) plus the five live
    // ones dispatched above that applied: seven commands applied, so seven distinct ids
    // spent —
    // `appliedCommandIds` absorbs a repeat silently (`SortedSet.add`), so a controller
    // that had reused one anywhere in the chain would leave fewer entries than commands
    // actually applied.
    expect(settled.state.appliedCommandIds.size).toBe(7);
  });

  it('returns every decision a crew poll produced', async () => {
    // `CRYPT` has two seats; Bram's own draft acceptance took one, leaving `core:doran`
    // and `core:zara` for `pollCrew` to still ask. `NEGOTIATION_SPEC` §3.3: the poll
    // asks the whole remaining roster in one command, and the count of decisions it
    // returns does not depend on how either of them actually answers — so a controller
    // that forwarded only `decisions[0]` (the shape `CommandResult.decision` used to
    // be, singular) fails this regardless of which way the seed happens to draw either
    // hero's mood.
    const { controller } = harness({
      scenario: pollCrewScenario,
      content: pollCrewContentTree()
    });
    await controller.start();

    const result = controller.pollCrew({ contractId: parseContentId('core:cleanse_the_crypt') });

    expect(result.applied).toBe(true);
    expect(result.decisions).toHaveLength(2);
    expect(result.events).toHaveLength(2);
    // Composition, not only count: `[decisions[0], decisions[0]]` would satisfy the
    // length checks above. `NEGOTIATION_SPEC` §3.3's own roster order (`HeroId`) is
    // `core:doran` (heroId 1) then `core:zara` (heroId 2), both distinct from the key
    // hero `core:bram` (heroId 0) who already answered in draft and is not asked again.
    expect(result.events.map((event) => ('heroId' in event ? event.heroId : null))).toEqual([
      heroId(1),
      heroId(2)
    ]);
  });
});

describe('taking a package in the ids the screen actually holds', () => {
  const escort = parseContentId('core:escort');
  const bram = parseContentId('core:bram');

  /** A package the screen could have assembled: content ids throughout, no `HeroId`. */
  function draft(overrides: Partial<OfferDraft> = {}): OfferDraft {
    return {
      advance: 40,
      promisedBonus: 0,
      methodTag: null,
      keyHero: bram,
      invited: [bram],
      ...overrides
    };
  }

  it('resolves every definition to the runtime id the engine wants', async () => {
    // `HeroCard` carries no `HeroId` at all, so a component holding a selection has only
    // content ids to send. This is the one place that mapping is made, against the
    // campaign where it is unambiguous.
    const { controller } = harness();
    await controller.start();

    const result = controller.composeOfferFromDraft(escort, draft());

    expect(result.applied).toBe(true);
    expect(result.rejectionCode).toBeNull();
    expect(offerScreen(controller.store.snapshot().screen).offer?.advanceLever.value).toBe(40);
    expect(offerScreen(controller.store.snapshot().screen).offer?.keyHeroLever.chosen).toBe(bram);
  });

  it('refuses an unknown key hero instead of throwing', async () => {
    // A definition the campaign does not carry is a refusal a screen can show, never an
    // exception a React handler is left holding — the same rule every other command on
    // this controller already follows. `core:nobody` fills the whole one-seat crew here,
    // so the draft is faultless apart from naming somebody who does not exist.
    const nobody = parseContentId('core:nobody');
    const { controller } = harness();
    await controller.start();
    const before = controller.store.snapshot();

    let result: CommandResult | undefined;
    expect(() => {
      result = controller.composeOfferFromDraft(
        escort,
        draft({ keyHero: nobody, invited: [nobody] })
      );
    }).not.toThrow();

    expect(result?.applied).toBe(false);
    expect(result?.rejectionCode).toBe(RejectionCodes.UnknownHero);
    expect(controller.store.snapshot()).toBe(before);
  });

  it('refuses an unknown invitee once every earlier check has passed', async () => {
    // Three seats, so the crew can hold a real key hero *and* a stranger at once: on the
    // one-seat `core:escort` an unknown invitee is always also a key hero outside the
    // crew, and the engine would answer that instead — the earlier row in its own order.
    // This is the draft where nothing but the stranger is wrong.
    const crypt = parseContentId('core:cleanse_the_crypt');
    const { controller } = harness({ scenario: pollCrewScenario, content: pollCrewContentTree() });
    await controller.start();

    const result = controller.composeOfferFromDraft(crypt, {
      advance: 10,
      promisedBonus: 0,
      methodTag: null,
      keyHero: bram,
      invited: [bram, parseContentId('core:doran'), parseContentId('core:nobody')]
    });

    expect(result.applied).toBe(false);
    expect(result.rejectionCode).toBe(RejectionCodes.UnknownHero);
  });

  it('gives two unknown heroes two ids, so a full crew is not reported as the wrong size', async () => {
    // The sentinel allocation's own property, and the reason it is per definition rather
    // than one shared value. `composeOffer` measures the crew by its *distinct* count, so
    // a single sentinel for both strangers would turn this crew of three into a crew of
    // two and answer `crew_size_mismatch` — naming a fault the caller never made, instead
    // of the one they did.
    const crypt = parseContentId('core:cleanse_the_crypt');
    const { controller } = harness({ scenario: pollCrewScenario, content: pollCrewContentTree() });
    await controller.start();

    const result = controller.composeOfferFromDraft(crypt, {
      advance: 10,
      promisedBonus: 0,
      methodTag: null,
      keyHero: bram,
      invited: [bram, parseContentId('core:nobody'), parseContentId('core:no_one_else')]
    });

    expect(result.applied).toBe(false);
    expect(result.rejectionCode).toBe(RejectionCodes.UnknownHero);
  });

  it('refuses a contract this campaign does not carry', async () => {
    const { controller } = harness();
    await controller.start();

    const result = controller.composeOfferFromDraft(parseContentId('core:no_such'), draft());

    expect(result.applied).toBe(false);
    expect(result.rejectionCode).toBe(RejectionCodes.UnknownContract);
  });

  /**
   * `composeOffer` refuses in a stated order, and `engine.ts` says outright that the order
   * "is part of the canonical result of a command, not an implementation detail": the
   * contract, then the key hero's existence, then the terms, then whether the package may
   * be revised, then the crew's size, then the key hero's membership, and only last
   * whether each invitee exists.
   *
   * An adapter that resolved ids first and refused on its own would answer
   * `unknown_hero` to every one of these — naming the wrong one of two broken things,
   * which is exactly what that comment forbids. Each row below is a draft with **two**
   * faults, of which the engine's own order picks the earlier one.
   */
  it.each([
    [
      'an unknown contract beside an unknown invitee',
      parseContentId('core:no_such'),
      { invited: [parseContentId('core:nobody')] },
      RejectionCodes.UnknownContract
    ],
    [
      'a crew of the wrong size beside an unknown invitee',
      escort,
      { invited: [bram, parseContentId('core:nobody')] },
      RejectionCodes.CrewSizeMismatch
    ],
    [
      'a key hero outside the crew beside an unknown invitee',
      escort,
      { keyHero: bram, invited: [parseContentId('core:nobody')] },
      RejectionCodes.KeyHeroNotInvited
    ]
  ])('refuses %s in the engine’s own order', async (_name, contractId, overrides, expected) => {
    const { controller } = harness();
    await controller.start();

    const result = controller.composeOfferFromDraft(contractId, draft(overrides));

    expect(result.applied).toBe(false);
    expect(result.rejectionCode).toBe(expected);
  });

  it('asks the key hero the package already names, without being told who', async () => {
    // The screen holds no `HeroId` and does not need one here: the package itself names the
    // hero this command asks (`OfferState.keyHero`), so a screen passing one would be
    // repeating a fact the campaign already holds — and could repeat it wrongly.
    //
    // **The key hero is deliberately not the campaign's first.** `core:zara` is `heroId(2)`,
    // so an implementation that asked "the first hero" instead of "the hero the package
    // names" answers a different id here. Measured, not assumed: on the single-hero fixture
    // this file started with, that mutant stayed green — the only hero *was* the key one.
    const crypt = parseContentId('core:cleanse_the_crypt');
    const zara = parseContentId('core:zara');
    const { controller } = harness({ scenario: pollCrewScenario, content: pollCrewContentTree() });
    await controller.start();
    controller.composeOfferFromDraft(crypt, {
      advance: 10,
      promisedBonus: 0,
      methodTag: null,
      keyHero: zara,
      invited: [zara, bram, parseContentId('core:doran')]
    });

    const result = controller.askKeyHero(crypt);

    expect(result.applied).toBe(true);
    expect(result.events.map((event) => ('heroId' in event ? event.heroId : null))).toEqual([
      heroId(2)
    ]);
  });

  it('refuses to ask when the package has named nobody', async () => {
    // `keyHero` is `null` until the first `composeOffer` (`initialOffer`), and the engine's
    // own answer for every hero at that point is `not_the_key_hero` — so this refuses with
    // the code the command itself would give rather than throwing on a `null`.
    const { controller } = harness({ scenario: untouchedScenario });
    await controller.start();

    const result = controller.askKeyHero(parseContentId('core:archive_run'));

    expect(result.applied).toBe(false);
    expect(result.rejectionCode).toBe(RejectionCodes.NotTheKeyHero);
  });

  it('refuses to ask about a contract this campaign does not carry', async () => {
    // Pinned rather than left to the engine, unlike `composeOfferFromDraft`'s own contract
    // check: this command reads its hero *off* the contract, so a missing contract is
    // answered here or nowhere — there is nothing to hand the engine that would make it
    // answer for itself.
    const { controller } = harness();
    await controller.start();

    const result = controller.askKeyHero(parseContentId('core:no_such'));

    expect(result.applied).toBe(false);
    expect(result.rejectionCode).toBe(RejectionCodes.UnknownContract);
  });

  it('translates a whole crew hero by hero, not the first one several times', async () => {
    // Three seats and three distinct heroes, named in an order that is neither the
    // campaign's nor sorted — so a translation that mapped every entry to one id, dropped
    // entries, or answered the same id twice cannot produce this crew. The screen reads
    // the invited crew back in `HeroId` order (`OfferState.invited` is a `SortedSet`),
    // which is what the assertion below states.
    const crypt = parseContentId('core:cleanse_the_crypt');
    const zara = parseContentId('core:zara');
    const doran = parseContentId('core:doran');
    const { controller } = harness({ scenario: pollCrewScenario, content: pollCrewContentTree() });
    await controller.start();

    const result = controller.composeOfferFromDraft(crypt, {
      advance: 10,
      promisedBonus: 0,
      methodTag: null,
      keyHero: zara,
      invited: [zara, bram, doran]
    });

    expect(result.applied).toBe(true);
    const offer = offerScreen(controller.store.snapshot().screen).offer;
    expect(offer?.crewLever.chosen).toEqual([bram, doran, zara]);
    expect(offer?.keyHeroLever.chosen).toBe(zara);
  });
});

/**
 * The screen this session is on, as the offer screen it must be.
 *
 * `SessionState.screen` is a union of three since the contract loop grew a debrief and a
 * board, and a test asserting about a package has to say which screen it means. A throw
 * rather than a cast: a case that ended up on another screen has stopped measuring what it
 * was written to measure, and should say so rather than read `undefined`.
 */
function offerScreen(model: ScreenModel): ContractOfferScreenModel {
  if (model.screen !== ScreenKind.ContractOffer) {
    throw new Error(`Expected the contract-offer screen, got '${model.screen}'.`);
  }

  return model;
}
