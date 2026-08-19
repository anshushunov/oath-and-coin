import {
  SaveErrorCodes,
  SaveReadError,
  decodeUtf8OrThrow,
  type SaveErrorCode
} from '@oath-and-coin/content';
import { LOADING_SCREEN, contractOfferScreenModel } from '@oath-and-coin/presentation';
import { parseContentId, type ContentId } from '@oath-and-coin/simulation';

import type { SaveStorePort } from './ports.ts';
import { buildSave, readSave } from './save/envelope.ts';
import { restoreDecidedSteps } from './save/restore-steps.ts';
import type { SaveSlot } from './save/slots.ts';
import {
  startSession,
  type SaveFailure,
  type SessionRequest,
  type SessionState
} from './session.ts';
import { createStore, type Store } from './store.ts';

/**
 * A session that can wait — the piece `startSession` alone cannot be.
 *
 * `startSession` answers a screen in one synchronous call, which is all a run ever
 * needed: the content is in the bundle and the scenario is a pair of files. A save is
 * not. IndexedDB answers through events and Electron's file store answers across an IPC
 * boundary, so "the campaign in slot A" is a question with a gap between asking and
 * knowing, and something has to hold the answer when it arrives. That something is a
 * store plus the three operations below, and this is the whole of the asynchrony the
 * segment introduces (design spec §4.2).
 *
 * **Nothing here throws at its caller.** A store's refusals arrive as codes
 * (`SaveErrorCodes`), a screen shows codes, and an exception is the one shape a screen
 * cannot show: it would leave a React event handler holding an error with nowhere to
 * put it, at which point each caller invents its own answer to a question this layer
 * has already answered. Every refusal below therefore lands in
 * {@link SessionState.saveFailure}.
 *
 * **This layer reads no clock and opens no file.** `now` is a dependency for the reason
 * `AGENTS.md` §6 gives — a save stamped from inside here would make its bytes a
 * property of when it was taken — and the slot store is a port for the reason §2.1 of
 * the design spec gives: two runtimes answer "where do a save's bytes live" in
 * genuinely different ways.
 */

export interface SessionControllerDeps {
  /**
   * The run this session starts with — including the content port it reads through.
   *
   * The plan listed a `content: ContentSourcePort` beside this one; it is deliberately
   * absent, because {@link SessionRequest} already carries the port `startSession`
   * uses. Two fields naming the content would be two answers to "which tree is this
   * session reading", and nothing could keep them the same one.
   */
  readonly request: SessionRequest;
  readonly saves: SaveStorePort;
  /** The clock, from outside: answers ISO-8601. Read once per save and never elsewhere. */
  readonly now: () => string;
  /**
   * What this build says about itself, and what a save is refused by comparing against
   * (design spec §2.4).
   *
   * It comes from the composition root rather than from the running session on purpose:
   * a session whose own run failed still has to be able to load a save — the campaign is
   * in the file, not in the content the failed run could not read — and a session that
   * ran a fixture scenario must not be able to load one, because a campaign built on a
   * fixture tree is not a campaign of this build's content.
   */
  readonly expected: { readonly rulesetVersion: string; readonly contentVersion: string };
}

export interface SessionController {
  /** The observable session. A screen subscribes here; nothing else publishes to it. */
  readonly store: Store<SessionState>;
  /** Runs the scenario the request names and publishes the screen it lands on. */
  start(): Promise<void>;
  /** Writes the campaign on screen into `slot`, or records why it could not. */
  save(slot: SaveSlot): Promise<void>;
  /** Replaces the session with the campaign in `slot`, or records why it could not. */
  load(slot: SaveSlot): Promise<void>;
}

/**
 * What a session is before its run has happened: the one screen no run produces.
 *
 * A controller could equally have run inside its own constructor, and that is the
 * option not taken — it would leave a caller no moment at which to subscribe before the
 * answer arrived, which is exactly the moment `useSyncExternalStore` needs.
 */
const PENDING_SESSION: SessionState = {
  screen: LOADING_SCREEN,
  contentVersion: null,
  canonicalHash: null,
  state: null,
  savedStateHash: null,
  saveFailure: null,
  errorDetail: null
};

export function createSessionController(deps: SessionControllerDeps): SessionController {
  const store = createStore<SessionState>(PENDING_SESSION);

  return {
    store,

    // Deliberately not an `async` function, and the difference is visible exactly once:
    // when the run itself throws. `loadAndRunScenario` reports every failure it knows
    // about as a `failed` result, so a throw from in here is a defect in this build —
    // a scenario naming a hero the roster does not have, a trait the rules do not carry
    // — and it surfaces synchronously at the call site, which is where React shows it
    // today. An `async` wrapper would turn the same defect into a rejected promise that
    // a caller writing `void controller.start()` never sees. The `Promise<void>` is what
    // this is for: one shape for all three operations, and room for a start that one day
    // has to wait for something.
    start: () => {
      store.replace(startSession(deps.request));
      return Promise.resolve();
    },

    save: (slot) => save(deps, store, slot),
    load: (slot) => load(deps, store, slot)
  };
}

/**
 * Writes the campaign that is on screen, under the contract that is on screen.
 *
 * The focused contract is read off the screen rather than tracked beside it because the
 * screen is what the field means: `focused_contract` exists so that a reloaded campaign
 * shows what the player was looking at (design spec §2.7), and what the player was
 * looking at is `screen.contract`. A session with no campaign or no contract on screen —
 * a loading screen, a failed run, a campaign with nothing on offer — has nothing to put
 * in a file, and writing one anyway would replace a real save with a record of a run
 * that failed.
 */
async function save(
  deps: SessionControllerDeps,
  store: Store<SessionState>,
  slot: SaveSlot
): Promise<void> {
  const session = store.snapshot();
  const focusedContract = focusOf(session);

  if (session.state === null || focusedContract === null) {
    return;
  }

  // Outside the `try` on purpose: everything below the store is this build's own code
  // over a campaign this build produced, so a throw from it is a defect and not a
  // refusal, and labelling it with a store's error code would file it under the one
  // thing that is provably not wrong.
  const bytes = buildSave({
    state: session.state,
    focusedContract,
    createdAt: deps.now()
  });

  try {
    await deps.saves.write(slot, bytes);
  } catch (cause) {
    record(store, portFailure(slot, cause));
    return;
  }

  record(store, null, checksumOf(bytes));
}

/**
 * Replaces the session with the campaign in `slot`.
 *
 * The screen is rebuilt rather than restored: a save carries the campaign and the
 * contract that was focused, and everything else on the screen is derived from those
 * two by the same factory a live run goes through. What cannot be rebuilt is the run —
 * `canonicalHash` is `null` here for the reason its own doc comment gives.
 */
async function load(
  deps: SessionControllerDeps,
  store: Store<SessionState>,
  slot: SaveSlot
): Promise<void> {
  let bytes: Uint8Array | null;
  try {
    bytes = await deps.saves.read(slot);
  } catch (cause) {
    record(store, portFailure(slot, cause));
    return;
  }

  // An empty slot is not a refusal (design spec §2.4, first row): there is no code for
  // it, because it is a state the slots screen shows rather than something that went
  // wrong. Nothing about the session changes, down to its identity, so a load of an
  // empty slot does not even notify a subscriber.
  if (bytes === null) {
    return;
  }

  let restored: SessionState;
  try {
    restored = restore(bytes, deps.expected);
  } catch (cause) {
    record(store, fileFailure(slot, cause));
    return;
  }

  store.replace(restored);
}

function restore(bytes: Uint8Array, expected: SessionControllerDeps['expected']): SessionState {
  const { state, descriptor } = readSave(bytes, expected);
  const steps = restoreDecidedSteps(state);

  return {
    screen: contractOfferScreenModel(state, steps, descriptor.focusedContract),
    // The save's own, checked against `expected` by `readSave` before this line runs —
    // so this is the version the file was written under and the version this build
    // reads under, which are the same number or the file was refused.
    contentVersion: state.metadata.contentVersion,
    canonicalHash: null,
    state,
    savedStateHash: checksumOf(bytes),
    saveFailure: null,
    errorDetail: null
  };
}

/**
 * Records the outcome of one slot operation against whatever the session is *now*.
 *
 * Re-read rather than closed over: a slot operation has a gap in it, and the session
 * can have moved during the gap — a second load finishing first, say. Writing a
 * remembered session back would undo that one, which is the class of bug an await is
 * for making visible.
 */
function record(
  store: Store<SessionState>,
  failure: SaveFailure | null,
  savedStateHash?: string
): void {
  const session = store.snapshot();

  store.replace({
    ...session,
    savedStateHash: savedStateHash ?? session.savedStateHash,
    saveFailure: failure
  });
}

/** The contract the screen is showing, or `null` when it is showing none. */
function focusOf(session: SessionState): ContentId | null {
  const contract = session.screen.contract;

  return contract === null ? null : parseContentId(contract.definition);
}

/**
 * A refusal from the slot store itself.
 *
 * Both shipped stores promise that every refusal arrives as a `SaveReadError` carrying
 * `SAVE_STORAGE_UNAVAILABLE`; the fallback is for a third one that breaks that promise,
 * and it says the one thing that is certainly true — this slot could not be reached,
 * and the file is not what said so.
 */
function portFailure(slot: SaveSlot, cause: unknown): SaveFailure {
  return failure(slot, cause, SaveErrorCodes.StorageUnavailable);
}

/**
 * A refusal from the bytes, after the store has already handed them over.
 *
 * `readSave` reports every condition of the refusal table as a `SaveReadError`. The
 * fallback covers the one seam it deliberately leaves open: it checks history's
 * references into the roster and the trace table, and checks no hero's *traits* against
 * the rule table — so a save can decode, pass the envelope, and still be a campaign no
 * hero card can be built from. That is a file disagreeing with itself, which is what
 * `SAVE_INCONSISTENT` already names.
 */
function fileFailure(slot: SaveSlot, cause: unknown): SaveFailure {
  return failure(slot, cause, SaveErrorCodes.Inconsistent);
}

function failure(slot: SaveSlot, cause: unknown, fallback: SaveErrorCode): SaveFailure {
  return {
    slot,
    code: cause instanceof SaveReadError ? cause.code : fallback,
    detail: cause instanceof Error ? cause.message : String(cause)
  };
}

/**
 * The checksum signing these bytes, read off the file rather than recomputed.
 *
 * `saveChecksum` is the segment's one algorithm for signing a save, and the value it
 * produced is already in the envelope — `buildSave` put it there and `readSave` has
 * checked it. Recomputing it here would mean restating the field set the signature
 * covers, and a second statement of that rule is a second answer to "what does this
 * signature cover" the day one of them is edited.
 *
 * Every caller hands this either bytes `buildSave` has just produced or bytes `readSave`
 * has just accepted, so the guard below is unreachable by construction; it is here
 * because "unreachable by construction" is a claim about today's two callers.
 */
function checksumOf(bytes: Uint8Array): string {
  const envelope = JSON.parse(decodeUtf8OrThrow(bytes)) as { readonly checksum?: unknown };

  if (typeof envelope.checksum !== 'string') {
    throw new Error(
      'A save reached the session controller with no checksum on it, having been built or ' +
        'accepted by an envelope that puts one on every file. That is a defect in this build, ' +
        'not a save a player can do anything about.'
    );
  }

  return envelope.checksum;
}
