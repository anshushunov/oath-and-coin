import { SaveErrorCodes, SaveReadError, type SaveErrorCode } from '@oath-and-coin/content';
import { LOADING_SCREEN, contractOfferScreenModel } from '@oath-and-coin/presentation';
import {
  composeOffer as applyComposeOffer,
  lockOffer as applyLockOffer,
  parseContentId,
  pollCrew as applyPollCrew,
  proposeContractToHero as applyProposeContractToHero,
  resolveContract as applyResolveContract,
  settleContract as applySettleContract,
  type CommandResult,
  type ComposeOffer,
  type ContentId,
  type GameState,
  type LockOffer,
  type PollCrew,
  type ProposeContractToHero,
  type ResolveContract,
  type SettleContract
} from '@oath-and-coin/simulation';

import type { SaveStorePort } from './ports.ts';
import { buildSave, readSave, snapshotHash } from './save/envelope.ts';
import { restoreDecidedSteps } from './save/restore-steps.ts';
import {
  observeSaveSlots,
  saveErrorCodeOf,
  type SaveSlotDescription
} from './save/slot-descriptions.ts';
import { UNCHECKED_SLOT, asSeen } from './save/slot-guard.ts';
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

/**
 * What became of one call to {@link SessionController.load}.
 *
 * **Why a return value and not a look at the session.** The page used to decide
 * whether a load had worked by reading `store.snapshot().saveFailure` once the promise
 * settled, and external review of segment 5 was right that two loads in flight then read
 * each other's answer: there is one `saveFailure`, both callbacks look at it, and
 * neither can tell whose it is. A result belongs to the call that produced it.
 *
 * `superseded` is the outcome that only exists because loads can overlap: the player
 * clicked a second slot while the first was still being read, so this call's campaign is
 * no longer the one asked for and it deliberately touches nothing. Its slot is not left
 * undescribed — a slot that genuinely cannot be read says so on its own line the next
 * time the screen asks the storage (`describeSaveSlots`), which it does after every
 * operation.
 */
export interface SessionLoadResult {
  readonly outcome: 'loaded' | 'empty' | 'refused' | 'superseded';
  /** Present exactly when `outcome` is `refused`. */
  readonly failure: SaveFailure | null;
}

/**
 * What a caller supplies for one of the five negotiation commands — the engine's own
 * command shape (`ComposeOffer` and the rest, `@oath-and-coin/simulation`) minus the two
 * fields this controller generates itself. `Omit` over the engine's own type rather than
 * a hand-written mirror of it: there is one declaration of what `composeOffer` (say)
 * takes, and this is what is left of it once `commandId` and `expectedStateVersion` —
 * this layer's own to supply, see {@link dispatchNegotiationCommand} — are removed. A
 * second, hand-written parameter list here could drift from the engine's the day either
 * command grows a field.
 */
type NegotiationCommandInput<
  TCommand extends { readonly commandId: number; readonly expectedStateVersion: number }
> = Omit<TCommand, 'commandId' | 'expectedStateVersion'>;

export interface SessionController {
  /** The observable session. A screen subscribes here; nothing else publishes to it. */
  readonly store: Store<SessionState>;
  /** Runs the scenario the request names and publishes the screen it lands on. */
  start(): Promise<void>;
  /**
   * Dispatches one of the six negotiation commands this build implements
   * (`m1-resolution/2`; `NEGOTIATION_SPEC` §3.1 and `RESOLUTION_SPEC` §3.1) against
   * the campaign currently on screen, the same way `packages/content`'s scenario runner
   * already applies a scripted one: `commandId` and `expectedStateVersion` are supplied
   * here rather than by the caller, read off the campaign this session is holding right
   * now — never invented at the call site, never carried over from an earlier call.
   *
   * **A rejection is a value, never a throw.** `result.rejectionCode` is a
   * `RejectionCodes` member a screen can show; the engine already answers this way
   * (`CommandResult`), and wrapping it in a second, throwing surface here would be
   * exactly the "invent an answer per caller" failure {@link SessionState.saveFailure}'s
   * own doc comment names for a save refusal. Nothing about the session moves on a
   * rejection: the store is untouched, and a caller may compare `store.snapshot()`
   * before and after by reference to confirm it.
   *
   * Synchronous, like every other read of a `GameState` in this layer: the engine
   * functions underneath are pure and every input already lives in memory, so there is
   * nothing here to await.
   */
  composeOffer(input: NegotiationCommandInput<ComposeOffer>): CommandResult;
  proposeContractToHero(input: NegotiationCommandInput<ProposeContractToHero>): CommandResult;
  lockOffer(input: NegotiationCommandInput<LockOffer>): CommandResult;
  /**
   * Answers with **every** decision the poll produced (`CommandResult.decisions`), not
   * the first: one poll asks many heroes in one command — the package's invited crew,
   * since the 2026-08-25 amendment to `NEGOTIATION_SPEC` §3.3 narrowed it from the whole
   * remaining roster `m1-negotiation/1` asked — so several heroes' worth of decisions sit
   * behind one `commandId`, and a caller reading only `decisions[0]` would show one hero's
   * answer and silently drop the rest. Neither reading changes what this method returns.
   */
  pollCrew(input: NegotiationCommandInput<PollCrew>): CommandResult;
  /**
   * Sends the crew out and asks what came back (`RESOLUTION_SPEC` §3.1) — the command
   * between the poll and the settlement, and not an optional one: since
   * `phase === Settled ⇒ resolution !== null` (§2.5), a settlement without a resolution
   * before it is refused (`NotResolved`).
   *
   * Answers with several events and no decisions, which no other command in this protocol
   * does: an outcome is not anybody's choice, so there is nothing for a trace to explain
   * (`ADR-007`). A caller reading `decisions` will correctly find it empty.
   */
  resolveContract(input: NegotiationCommandInput<ResolveContract>): CommandResult;
  settleContract(input: NegotiationCommandInput<SettleContract>): CommandResult;
  /** Writes the campaign on screen into `slot`, or records why it could not. */
  save(slot: SaveSlot): Promise<void>;
  /**
   * Replaces the session with the campaign in `slot`, or records why it could not —
   * and answers what became of **this call**, not what the session looks like
   * afterwards.
   *
   * The distinction is the whole of {@link SessionLoadResult}'s reason for existing.
   */
  load(slot: SaveSlot): Promise<SessionLoadResult>;
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

/**
 * Which load the player started most recently — the one fact `load` needs and cannot
 * work out from the session.
 *
 * A load is not cancellable: a storage read is already in flight and there is nothing
 * to tell it to stop. What *is* decidable is whether the answer that just arrived is
 * still the answer to the question the player is asking, and a monotonic ticket is the
 * whole of that decision. Without it, two loads commit in the order their storage
 * happened to answer in — so a slow first read lands *after* a fast second one and
 * replaces the campaign the player is looking at with the one they moved on from.
 * External review of segment 5 named exactly this, and the UI offers no protection
 * against it: the slots screen does not disable its buttons while an operation runs.
 */
interface LoadTurnstile {
  /** Claims the next ticket. The caller holding the highest one owns the session. */
  begin(): number;
  isCurrent(ticket: number): boolean;
}

function createLoadTurnstile(): LoadTurnstile {
  let latest = 0;

  return {
    begin: () => {
      latest += 1;
      return latest;
    },
    isCurrent: (ticket) => ticket === latest
  };
}

export function createSessionController(deps: SessionControllerDeps): SessionController {
  const store = createStore<SessionState>(PENDING_SESSION);
  const turnstile = createLoadTurnstile();

  /**
   * What this session last saw in each slot — the guard a write to it is held to.
   *
   * On the controller rather than on {@link SessionState} on purpose, and for the reason
   * {@link SessionController.slots} gives about itself: a slot's contents belong to the
   * storage, not to the session, and putting them on a store a screen subscribes to
   * would make every listing a render.
   */
  const observed = new Map<SaveSlot, Uint8Array | null>();

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

    save: (slot) => save(deps, store, observed, slot),
    load: (slot) => load(deps, store, slot, turnstile),
    slots: () => slots(deps, store, observed),

    composeOffer: (input) =>
      dispatchNegotiationCommand(
        store,
        input.contractId,
        (state, commandId, expectedStateVersion) =>
          applyComposeOffer(state, { ...input, commandId, expectedStateVersion })
      ),
    proposeContractToHero: (input) =>
      dispatchNegotiationCommand(
        store,
        input.contractId,
        (state, commandId, expectedStateVersion) =>
          applyProposeContractToHero(state, { ...input, commandId, expectedStateVersion })
      ),
    lockOffer: (input) =>
      dispatchNegotiationCommand(
        store,
        input.contractId,
        (state, commandId, expectedStateVersion) =>
          applyLockOffer(state, { ...input, commandId, expectedStateVersion })
      ),
    pollCrew: (input) =>
      dispatchNegotiationCommand(
        store,
        input.contractId,
        (state, commandId, expectedStateVersion) =>
          applyPollCrew(state, { ...input, commandId, expectedStateVersion })
      ),
    resolveContract: (input) =>
      dispatchNegotiationCommand(
        store,
        input.contractId,
        (state, commandId, expectedStateVersion) =>
          applyResolveContract(state, { ...input, commandId, expectedStateVersion })
      ),
    settleContract: (input) =>
      dispatchNegotiationCommand(
        store,
        input.contractId,
        (state, commandId, expectedStateVersion) =>
          applySettleContract(state, { ...input, commandId, expectedStateVersion })
      )
  };
}

/**
 * The one place a negotiation command becomes an engine call — every one of the five
 * goes through here, for the same reason `packages/content`'s scenario runner has a
 * single `apply` rather than five near-duplicates of the read-decide-write sequence.
 *
 * `apply` is handed the campaign, a fresh `commandId` and the campaign's own current
 * `expectedStateVersion`, and builds the concrete command itself — this function never
 * sees the command's own shape, only the `CommandResult` it produces, which is what lets
 * one implementation serve `composeOffer` through `settleContract` alike.
 *
 * **A rejection leaves the store untouched.** `result.state` is the same object the
 * campaign already was (`CommandResult.rejected`'s own contract), so there is nothing to
 * publish and nothing to compare — the caller's `store.snapshot()` before and after a
 * rejected dispatch are `Object.is`-equal by construction, without this function having
 * to assert it.
 *
 * **An applied command rebuilds the screen the same way a loaded save does**
 * (`restore`, below): `restoreDecidedSteps` reads the whole answered history back out of
 * the resulting `GameState` rather than this layer accumulating a parallel `StepOutcome`
 * list across calls, which is exactly the second-source-of-truth `restoreDecidedSteps`'s
 * own doc comment already rejects for a reloaded save. `focusedContract` is the command's
 * own `contractId`, not whatever the screen happened to be showing before: a dispatch is
 * always about one contract, and keeping the screen pointed at it is what lets a player
 * watch their own action land.
 *
 * `canonicalHash` moves to `null` on every applied command, the same way it already does
 * for a loaded save (`restore`, `SessionState.canonicalHash`'s own doc comment): that
 * hash is computed over a whole scripted `ScenarioOutcome`, and a live command was never
 * one of that run's steps, so carrying the old number forward would claim a campaign this
 * layer has since changed is still the one the run produced.
 */
function dispatchNegotiationCommand(
  store: Store<SessionState>,
  focusedContract: ContentId,
  apply: (state: GameState, commandId: number, expectedStateVersion: number) => CommandResult
): CommandResult {
  const session = store.snapshot();
  const state = activeState(session);
  const result = apply(state, nextCommandId(state), state.metadata.stateVersion);

  if (!result.applied) {
    return result;
  }

  store.replace({
    ...session,
    screen: contractOfferScreenModel(
      result.state,
      restoreDecidedSteps(result.state),
      focusedContract
    ),
    state: result.state,
    canonicalHash: null
  });

  return result;
}

/**
 * The campaign a negotiation command is dispatched against, or a thrown defect when
 * there is none.
 *
 * Not a refusal: a screen with no campaign behind it (`Loading`, `Empty`, `Error`) offers
 * no negotiation action to press in the first place, so a caller reaching this with
 * `session.state === null` did not follow a screen the player could see — the same class
 * of bug `focusOf`'s callers already treat as a defect in this build rather than
 * something a player did.
 */
function activeState(session: SessionState): GameState {
  if (session.state === null) {
    throw new Error(
      'A negotiation command was dispatched against a session with no campaign — a defect in ' +
        'the caller, which must not offer a negotiation command with nothing behind it to apply ' +
        'one to.'
    );
  }

  return session.state;
}

/**
 * A `commandId` this campaign has never applied, read off the campaign itself rather
 * than counted by this controller.
 *
 * `state.appliedCommandIds` is exactly the set every engine command already checks a
 * `commandId` against (`RejectionCodes.DuplicateCommand`), so reading its own maximum is
 * what keeps a live command from colliding with one a scripted scenario already spent to
 * reach this screen — `start()` can hand a session a campaign whose `appliedCommandIds`
 * already holds any ids at all, and a counter kept in this module, starting fresh at 1,
 * would know nothing about them. Read anew on every dispatch rather than cached, for the
 * same reason `record` re-reads the session instead of closing over it: a fixed offset
 * computed once would go stale the moment a second command applied.
 */
function nextCommandId(state: GameState): number {
  const applied = state.appliedCommandIds.values();

  return (applied.at(-1) ?? 0) + 1;
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
  store: Store<SessionState>,
  observed: Map<SaveSlot, Uint8Array | null>
): Promise<readonly SaveSlotDescription[]> {
  const answers = await observeSaveSlots(deps.saves, deps.expected);

  // What the player is about to be shown, remembered so that a save can be held to it
  // (`SlotGuard`). A slot the storage could not answer about at all is *forgotten*
  // rather than recorded as empty: "nothing was seen" is not an observation, and
  // recording it as one would let a write claim the slot was empty when nobody looked.
  for (const { description, seen } of answers) {
    if (seen === undefined) {
      observed.delete(description.slot);
    } else {
      observed.set(description.slot, seen);
    }
  }

  const described = answers.map((answer) => answer.description);
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
  observed: Map<SaveSlot, Uint8Array | null>,
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
  // being outside a `try`. Round 2 of the seam review was right that "enforced by the
  // type" was a statement about the code and not a guarantee: three mutants on these
  // lines were green. `session-controller.test.ts`'s "отказ файла против дефекта
  // сборки" is what holds them now.
  let bytes: Uint8Array;
  try {
    bytes = buildSave({ state: session.state, focusedContract, createdAt: deps.now() });
  } catch (cause) {
    if (!(cause instanceof SaveReadError)) {
      throw cause;
    }

    // `cause.code`, not `saveErrorCodeOf(cause, fallback)`: the line above has already
    // established what this is, so there is nothing left for a fallback to answer.
    // `fileFailure` stood here and `portFailure` would have behaved identically — the
    // only thing the two disagree about is a fallback that cannot be reached on this
    // path, which is why a mutant swapping one for the other stayed green and could
    // never have done otherwise. Removed rather than covered: an equivalent mutant is a
    // sign of dead code, not of a missing test.
    record(store, slot, { slot, code: cause.code, detail: cause.message });
    return;
  }

  // **The write is held to what this session last showed the player about this slot.**
  // External review of segment 5 measured what an unconditional write costs: a tab that
  // read slot A as empty destroys the campaign a second tab put there since, and does it
  // without asking, because an empty slot is exactly the one the confirmation is skipped
  // for. `observed` is what the slots screen was drawn from, and the store compares it
  // inside whatever makes the write atomic.
  //
  // A slot this session has been told nothing about writes unchecked, and that is the
  // honest answer rather than a hole: there is no belief to be wrong about. It is not a
  // reachable state from the slots screen, which asks the storage before it draws and
  // again after every operation.
  const seen = observed.get(slot);
  const guard = seen === undefined ? UNCHECKED_SLOT : asSeen(seen);

  try {
    await deps.saves.write(slot, bytes, guard);
  } catch (cause) {
    record(store, slot, portFailure(slot, cause));
    return;
  }

  // The slot now holds exactly these bytes, so this session's belief about it moves with
  // it. Without this, saving the same slot twice in a row would refuse the second time —
  // the guard would still be describing what was there before the first write.
  observed.set(slot, bytes);

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
 *
 * **Only the load the player started last may commit** (see {@link LoadTurnstile}). The
 * ticket is checked after the storage has answered and again after the bytes have been
 * turned into a session, because both are moments this function was suspended and a
 * second click could have happened in either.
 */
async function load(
  deps: SessionControllerDeps,
  store: Store<SessionState>,
  slot: SaveSlot,
  turnstile: LoadTurnstile
): Promise<SessionLoadResult> {
  const ticket = turnstile.begin();

  let bytes: Uint8Array | null;
  try {
    bytes = await deps.saves.read(slot);
  } catch (cause) {
    return onlyIfCurrent(turnstile, ticket, () => {
      const failure = portFailure(slot, cause);
      record(store, slot, failure);
      return { outcome: 'refused', failure };
    });
  }

  // An empty slot is not a refusal (design spec §2.4, first row): there is no code for
  // it, because it is a state the slots screen shows rather than something that went
  // wrong. Nothing about the session changes, down to its identity, so a load of an
  // empty slot does not even notify a subscriber.
  if (bytes === null) {
    return turnstile.isCurrent(ticket) ? EMPTY_LOAD : SUPERSEDED_LOAD;
  }

  return onlyIfCurrent(turnstile, ticket, () => {
    let restored: SessionState;
    try {
      restored = restore(bytes, deps.expected);
    } catch (cause) {
      const failure = fileFailure(slot, cause);
      record(store, slot, failure);
      return { outcome: 'refused', failure };
    }

    // A load replaces the whole session, and the one thing that does not belong to the
    // session is a refusal recorded about a *different* slot: that slot is still
    // unreadable, and the screen still owes the player that line.
    store.replace({ ...restored, saveFailure: failureNotAbout(store.snapshot(), slot) });

    return { outcome: 'loaded', failure: null };
  });
}

const EMPTY_LOAD: SessionLoadResult = { outcome: 'empty', failure: null };
const SUPERSEDED_LOAD: SessionLoadResult = { outcome: 'superseded', failure: null };

/**
 * Runs `apply` only if `ticket` is still the load the player is waiting for.
 *
 * A superseded load writes nothing at all — not the session, not a refusal about its own
 * slot. Both would be answers to a question the player has replaced, and a refusal in
 * particular is not lost by being dropped here: a slot that genuinely cannot be read
 * says so on its own line the next time the screen asks the storage.
 */
function onlyIfCurrent(
  turnstile: LoadTurnstile,
  ticket: number,
  apply: () => SessionLoadResult
): SessionLoadResult {
  return turnstile.isCurrent(ticket) ? apply() : SUPERSEDED_LOAD;
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
 * A refusal from the bytes, after the store has already handed them over — **the read
 * path only.**
 *
 * `save` briefly used this for a `buildSave` refusal too, and that was wrong twice over:
 * there are no bytes at that point, and the fallback below is unreachable there because
 * the throw has already been narrowed to a `SaveReadError`. That call records
 * `cause.code` directly now; this function is `load`'s alone again.
 *
 * `readSave` reports every condition of the refusal table as a `SaveReadError`, and the
 * fallback is the second echelon behind it rather than the first line of defence. It was
 * the first line for one seam — a hero holding a trait the rule table does not carry —
 * and review of this task was right that a default is the wrong place for a condition:
 * `validateGameState` names it now, beside the five references it already checked, so
 * that refusal arrives here as a `SaveReadError` like every other.
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
