import { SaveErrorCodes, SaveReadError, type SaveErrorCode } from '@oath-and-coin/content';
import { LOADING_SCREEN, contractOfferScreenModel } from '@oath-and-coin/presentation';
import { parseContentId, type ContentId } from '@oath-and-coin/simulation';

import type { SaveStorePort } from './ports.ts';
import { buildSave, readSave, snapshotHash } from './save/envelope.ts';
import { restoreDecidedSteps } from './save/restore-steps.ts';
import {
  describeSaveSlots,
  saveErrorCodeOf,
  type SaveSlotDescription
} from './save/slot-descriptions.ts';
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
 * **No refusal of a store or of a file leaves here as an exception.** Those arrive as
 * codes (`SaveErrorCodes`), a screen shows codes, and an exception is the one shape a
 * screen cannot show: it would leave a React event handler holding an error with nowhere
 * to put it, at which point each caller invents its own answer to a question this layer
 * has already answered. Every such refusal lands in {@link SessionState.saveFailure}.
 *
 * The claim is deliberately not "nothing here throws". Two calls stand outside a `try` —
 * `focusOf`'s `parseContentId` and `snapshotHash` — and each is this build's own code
 * over data this build produced, so a throw from one is a defect rather than a refusal.
 * `buildSave` used to stand there for the same reason and no longer can: since external
 * review of Task 16 it *refuses* a campaign it cannot write readably, so `save` catches
 * it, records a `SaveReadError` as a refusal, and rethrows anything else untouched. The
 * distinction the paragraph draws is the same one; what enforces it moved from where the
 * call sits to what it throws. Both `start`'s comment and `save`'s say the same thing:
 * a defect belongs where its stack points, and dressing it as a save error would file it
 * under the one thing that is provably not wrong.
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
  /**
   * The three slots as the storage answers about them now, with whatever this session
   * has since found out about one of them.
   *
   * Not on the store, and deliberately: a slot's contents belong to the storage rather
   * than to the session, and two players' worth of tabs would be publishing into one
   * another's `SessionState` if they were the same value. A screen asks this when it
   * opens and again after every operation, which is also the only way it can be right —
   * a save written by another tab moves the storage and notifies nothing.
   */
  slots(): Promise<readonly SaveSlotDescription[]>;
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
    // about as a `failed` result, so a throw from in here is a defect in this build — a
    // scenario whose first command names a contract the content does not have, say — and
    // it surfaces synchronously at the call site, which is where React shows it today.
    // An `async` wrapper would turn the same defect into a rejected promise that a caller
    // writing `void controller.start()` never sees.
    //
    // **Do not "tidy" this into an `async` method.** The property has a test with teeth:
    // `session-controller.test.ts`'s "a run this build cannot make a screen out of"
    // asserts a *synchronous* throw, and it is what reddens if the `async` is added back.
    // A start that genuinely has to wait for something is a different function with a
    // different contract, and its caller in `App.tsx` would have to grow a `.catch` in
    // the same commit.

    start: () => {
      store.replace(startSession(deps.request));
      return Promise.resolve();
    },

    save: (slot) => save(deps, store, slot),
    load: (slot) => load(deps, store, slot),
    slots: () => slots(deps, store)
  };
}

/**
 * The storage's answer about the three slots, with this session's own refusal laid over
 * the one slot it is about.
 *
 * The overlay is the whole reason this is not `describeSaveSlots` called directly from a
 * screen. A refused *write* leaves the storage exactly as it was — that is what the port
 * promises — so the slot still lists, still reads and still describes perfectly, and a
 * screen built from the storage alone would show the player a line saying nothing
 * happened after a save that did not happen. The session is the only place that knows,
 * and `saveFailure` is where it keeps it.
 *
 * The session is read *after* the storage has answered, for the reason {@link record}
 * re-reads rather than closing over: there is a gap, and a save can have failed inside
 * it. Reading first would answer with a session older than the storage.
 */
async function slots(
  deps: SessionControllerDeps,
  store: Store<SessionState>
): Promise<readonly SaveSlotDescription[]> {
  const described = await describeSaveSlots(deps.saves, deps.expected);
  const failure = store.snapshot().saveFailure;

  if (failure === null) {
    return described;
  }

  // Only the slot it names. There are three slots and one `saveFailure`, and a refusal
  // about slot A says nothing whatsoever about the other two.
  return described.map((description) =>
    description.slot === failure.slot ? { ...description, errorCode: failure.code } : description
  );
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
 *
 * **A campaign this build could not read back is not written at all.** `deps.expected` is
 * what `load` refuses a foreign save by, and applying it to reading and not to writing
 * left a real trap: a run against a fixture content root — `accept_by_payment`,
 * `decline_by_comrade`, `zero_sum_tie` all have one — produces a campaign with a contract
 * on screen and a `contentVersion` this build does not read under, so the save would go
 * to disk, overwrite whatever was in the slot, and then be refused by this same build on
 * the next load. The confirmation Task 16.8 puts in front of overwriting an occupied slot
 * cannot help with that: the player would be confirming an exchange of a readable save
 * for an unreadable one.
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

  const unwritable = refusalToWrite(slot, session.state.metadata, deps.expected);
  if (unwritable !== null) {
    record(store, slot, unwritable);
    return;
  }

  // `buildSave` is the one call here that can refuse rather than merely fail, and the
  // two are told apart by what it throws. It now applies every content check `readSave`
  // applies (external review of Task 16: a producer must not be able to write what the
  // reader rejects), so a `SaveReadError` from it is a *refusal* about this campaign and
  // belongs on the screen beside the store's own refusals. Anything else out of it is
  // still a defect in this build, and rethrowing it unchanged is what keeps a defect
  // from being filed under a save error code — the distinction the paragraph in this
  // module's header draws, now enforced by the type of the throw instead of by the call
  // being outside a `try`.
  let bytes: Uint8Array;
  try {
    bytes = buildSave({ state: session.state, focusedContract, createdAt: deps.now() });
  } catch (cause) {
    if (!(cause instanceof SaveReadError)) {
      throw cause;
    }
    record(store, slot, fileFailure(slot, cause));
    return;
  }

  try {
    await deps.saves.write(slot, bytes);
  } catch (cause) {
    record(store, slot, portFailure(slot, cause));
    return;
  }

  record(store, slot, null, snapshotHash(session.state));
}

/**
 * Why this campaign may not be written, or `null` when it may.
 *
 * The same two comparisons `readSave` makes and in the same order, so that a save
 * refused at write time is refused for the reason it would have been refused at read
 * time — one rule, stated where the two sides of it can be compared, rather than a write
 * check that drifts from the read one.
 */
function refusalToWrite(
  slot: SaveSlot,
  metadata: { readonly rulesetVersion: string; readonly contentVersion: string },
  expected: SessionControllerDeps['expected']
): SaveFailure | null {
  if (metadata.rulesetVersion !== expected.rulesetVersion) {
    return {
      slot,
      code: SaveErrorCodes.RulesetMismatch,
      detail:
        `this campaign runs under ruleset '${metadata.rulesetVersion}', not the running build's ` +
        `'${expected.rulesetVersion}', so a save of it is one this build could not read back.`
    };
  }

  if (metadata.contentVersion !== expected.contentVersion) {
    return {
      slot,
      code: SaveErrorCodes.ContentMismatch,
      detail:
        `this campaign was built on content '${metadata.contentVersion}', not the running ` +
        `build's '${expected.contentVersion}', so a save of it is one this build could not ` +
        'read back.'
    };
  }

  return null;
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
    record(store, slot, portFailure(slot, cause));
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
    record(store, slot, fileFailure(slot, cause));
    return;
  }

  // A load replaces the whole session, and the one thing that does not belong to the
  // session is a refusal recorded about a *different* slot: that slot is still
  // unreadable, and the screen still owes the player that line.
  store.replace({ ...restored, saveFailure: failureNotAbout(store.snapshot(), slot) });
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
    savedStateHash: snapshotHash(state),
    saveFailure: null,
    errorDetail: null
  };
}

/**
 * Records the outcome of one operation on `slot` against whatever the session is *now*.
 *
 * Re-read rather than closed over: a slot operation has a gap in it, and the session
 * can have moved during the gap — a second load finishing first, say. Writing a
 * remembered session back would undo that one, which is the class of bug an await is
 * for making visible.
 *
 * A success clears the refusal for *its own* slot and no other. There are three slots
 * and one `saveFailure`, and a save to slot A that wiped the refusal recorded for slot
 * C would take a line off the screen that is still true — slot C is still unreadable,
 * and nothing about writing A found that out.
 */
function record(
  store: Store<SessionState>,
  slot: SaveSlot,
  failure: SaveFailure | null,
  savedStateHash?: string
): void {
  const session = store.snapshot();

  store.replace({
    ...session,
    savedStateHash: savedStateHash ?? session.savedStateHash,
    saveFailure: failure ?? failureNotAbout(session, slot)
  });
}

/** The session's refusal, unless it is the one about `slot` that the caller just settled. */
function failureNotAbout(session: SessionState, slot: SaveSlot): SaveFailure | null {
  const failure = session.saveFailure;

  return failure === null || failure.slot === slot ? null : failure;
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
 * `readSave` reports every condition of the refusal table as a `SaveReadError`, and the
 * fallback is the second echelon behind it rather than the first line of defence. It was
 * the first line for one seam — a hero holding a trait the rule table does not carry —
 * and review of this task was right that a default is the wrong place for a condition:
 * `checkReferentialIntegrity` names it now, beside the four references it already
 * checked, so that refusal arrives here as a `SaveReadError` like every other.
 *
 * What is left for the fallback is the class the envelope cannot check from where it
 * stands: a trace factor whose `sourceEntity` names a comrade absent from the roster.
 * Which reason codes are comrade-sourced is `packages/presentation`'s vocabulary and not
 * a fact the envelope has access to, so the screen factory is where that reference is
 * resolved and where it throws. `SAVE_INCONSISTENT` is the honest code for it: the file
 * disagrees with itself, which is exactly what it already names for a dangling reference.
 */
function fileFailure(slot: SaveSlot, cause: unknown): SaveFailure {
  return failure(slot, cause, SaveErrorCodes.Inconsistent);
}

function failure(slot: SaveSlot, cause: unknown, fallback: SaveErrorCode): SaveFailure {
  return {
    slot,
    // Through the same one rule the slot descriptions read a code by, rather than a
    // second `instanceof` written here: which exception carries a code this build named
    // is one question, and two answers to it drift the day a third store appears.
    code: saveErrorCodeOf(cause, fallback),
    detail: cause instanceof Error ? cause.message : String(cause)
  };
}
