import {
  artifactHash,
  loadAndRunScenario,
  type SaveErrorCode,
  type ScenarioRunResult
} from '@oath-and-coin/content';
import {
  LOADING_SCREEN,
  ScreenKind,
  afterActionScreenModel,
  contractBoardScreenModel,
  contractOfferScreenModel,
  failedScreen,
  focusedContractOf,
  type DecidedStep,
  type ScreenModel
} from '@oath-and-coin/presentation';
import { OfferPhase, type ContentId, type GameState } from '@oath-and-coin/simulation';

import type { ContentSourcePort } from './ports.ts';
import type { SaveSlot } from './save/slots.ts';

/**
 * The load sequence turned into a screen — `game/app/Main.cs` without Godot.
 *
 * The C# host did this inside `_Ready`: read the scenario, run it, hand the outcome to
 * the screen factory, and show whichever of the five states came out. Everything but
 * the last step already lived in `packages/content` after Task 10; this is where the
 * last step goes, and it is the only place in the workspace where content and
 * presentation meet. That is not a coincidence of layout — `packages/presentation` may
 * not import `packages/content` at all (`ADR-010`), so the layer that joins them has to
 * be a third one.
 */

export interface SessionRequest {
  readonly content: ContentSourcePort;
  readonly scenario: string;
  /** The checkpoint to stop at, or `null` for the manifest's last one. */
  readonly checkpoint: string | null;
  readonly seed: bigint;
}

/**
 * One refusal from the save store, as a session reports it rather than as an exception.
 *
 * A refusal is something a player is shown — the slots screen turns {@link code} into a
 * locale key (design spec §2.4) — so it has to be a value the screen can read, and a
 * thrown `SaveReadError` is not: it would leave the session controller's caller holding
 * an error with nowhere to put it, at which point every caller invents its own answer.
 *
 * {@link slot} is here because the code alone does not say which of the three slots
 * refused, and the screen shows three lines. {@link detail} is for a human reading a
 * console and is deliberately not hashed anywhere, for the same reason
 * {@link SessionState.errorDetail} is not.
 */
export interface SaveFailure {
  readonly slot: SaveSlot;
  readonly code: SaveErrorCode;
  readonly detail: string;
}

/**
 * Everything a screen needs, the campaign behind it, and the facts a bug report needs
 * beside both.
 *
 * `contentVersion`, `canonicalHash` and `state` are `null` exactly when no run produced
 * them — a loading screen has read no content, a failed one produced neither an artifact
 * nor a campaign. Reported as `null` rather than as an empty string because "this run has
 * no artifact" and "this run has an artifact with no bytes" are different claims, and
 * only one of them is ever true.
 */
export interface SessionState {
  readonly screen: ScreenModel;
  /**
   * The contract every screen of this session is about, or `null` when no run has reached
   * one.
   *
   * Its own field since the session grew a second and a third screen. It used to be read
   * back off `screen.contract`, which worked while there was one screen and stops working
   * the moment there are three: a board is about the whole campaign and names no contract at
   * all, so a session that only knew what was on screen would forget which contract the
   * player had been working on the instant they looked at the board — and `save` would have
   * nothing to write into `focused_contract` (design spec §2.7).
   */
  readonly focusedContract: ContentId | null;
  readonly contentVersion: string | null;
  /**
   * The artifact hash of the run behind this screen, or `null` when there was no run.
   *
   * `null` for a session obtained by loading a save, and that is a decision rather than
   * an omission (design spec §4.4). This hash is computed over a whole `ScenarioOutcome`
   * — rejected steps and entire commands included — and a save carries none of that: a
   * refused command produces no event, so nothing about it survives in the campaign. A
   * hash computed over the incomplete steps would still be 64 hex characters and would
   * still be published by `RunReport`, where oracle parity reads it; it would simply be
   * a different number claiming to be that one.
   */
  readonly canonicalHash: string | null;
  /**
   * The campaign itself, or `null` where {@link contentVersion} already is.
   *
   * A session kept only the screen until Task 16, and a screen cannot be saved: it is a
   * lossy projection of the campaign by design (design spec §1.1). Saving needs the
   * campaign, so the campaign is what a session now carries — the screen beside it stays
   * exactly what it was.
   */
  readonly state: GameState | null;
  /**
   * The hash of the campaign this session was loaded from or last wrote, and `null` when
   * neither has happened.
   *
   * `snapshotHash` — over the snapshot alone — and not the file's own `checksum`, which
   * is what it was until external review of Task 16 moved `created_at` inside the
   * signature. The question this field answers is "which campaign is this", so saving
   * one unchanged campaign twice a minute apart has to answer the same value; the file's
   * signature now answers a different question (has anything in this file been edited
   * since it was signed) and deliberately moves with the clock. Two questions, two
   * functions, both in `save/envelope.ts` beside each other.
   */
  readonly savedStateHash: string | null;
  /** The last refusal from the save store, or `null` when the last save or load worked. */
  readonly saveFailure: SaveFailure | null;
  /**
   * The underlying failure message, kept beside the screen and never inside what gets
   * hashed.
   *
   * It can name an absolute path, so it is machine-dependent — the frozen corpus
   * records `read_model` with no `error_detail` for exactly that reason. A session that
   * carried it into the projection would make the read-model hash a property of where
   * the game was installed.
   */
  readonly errorDetail: string | null;
}

/** Runs one scenario to one checkpoint and answers the screen it lands on. */
export function startSession(request: SessionRequest): SessionState {
  const result = loadAndRunScenario({
    scenarios: request.content.scenarios,
    openContentRoot: (path) => request.content.openContentRoot(path),
    scenario: request.scenario,
    checkpoint: request.checkpoint,
    seed: request.seed
  });

  const focusedContract = result.kind === 'ran' ? focusOfRun(result) : null;

  return {
    screen: screenFor(result),
    focusedContract,
    contentVersion:
      result.kind === 'ran' ? result.outcome.finalState.metadata.contentVersion : null,
    canonicalHash: result.kind === 'ran' ? artifactHash(result.outcome) : null,
    state: result.kind === 'ran' ? result.outcome.finalState : null,
    // A run has written no save and been refused by no store: both are facts about a
    // session's history with the slot store, and this session has none yet.
    savedStateHash: null,
    saveFailure: null,
    errorDetail: result.kind === 'failed' ? result.errorDetail : null
  };
}

/**
 * The screen a run produces, by the three-way split the load sequence reports.
 *
 * This lived in `tools/scenario-runner/src/parity.ts` until Task 12, and it lived there
 * because there was no application layer yet — not because a parity tool is where the
 * rule belongs. It is one rule with one home now, and parity calls it: a second copy
 * would be a second answer to "which screen does a failed run show", and the corpus
 * would only ever measure one of them.
 *
 * `loading` is the one state no run computes — it is a fact about the scenario's
 * manifest — so it comes from the single stated constant rather than being inferred
 * from an absence of content, which would make it indistinguishable from `Empty`. The
 * corpus tells the two apart: `screen_loading` and `screen_empty` carry the same
 * content and different `read_model.sha256`.
 */
export function screenFor(result: ScenarioRunResult): ScreenModel {
  switch (result.kind) {
    case 'loading':
      return LOADING_SCREEN;
    case 'failed':
      return failedScreen(result.errorCode, result.errorDetail);
    case 'ran':
      return campaignScreen(result.outcome.finalState, focusOfRun(result), result.outcome.steps);
    default:
      return result satisfies never;
  }
}

/**
 * Which of the three screens a campaign belongs on — `RESOLUTION_SPEC` §6.4's table, as one
 * pure function of the campaign and the contract the player is working on.
 *
 * **One place, and the whole table.** §6.4 answers for a started session, for a loaded save
 * and for every applied command at once, and the three used to be different code paths: a
 * run always opened the negotiation, a load always rebuilt it, and a dispatch redrew
 * whatever was already there. Three answers to one question is how a save of a resolved
 * campaign came back on the offer screen with its debrief unreachable — the failure the
 * table's last three rows exist to prevent.
 *
 * The rows are read in lifecycle order, because a settled contract also carries a
 * resolution and would answer to the row below it:
 *
 * - `phase === Settled` → the board. The money has moved and this contract is closed.
 * - `resolution !== null` → the debrief. The crew came back; the promise has not been
 *   answered.
 * - otherwise → the negotiation.
 *
 * A campaign with no contract focused is on the negotiation too: there is nothing resolved
 * to show and nothing settled to have moved on from.
 *
 * **The two "rejected" rows are not here, and that is not an omission.** §6.4 says a refused
 * `resolveContract` leaves the offer and a refused `settleContract` leaves the debrief —
 * both are "nothing happens", and nothing happening is what a rejection already does: the
 * store is untouched, so the screen a player is looking at stays the screen they are looking
 * at. A rule that re-derived the screen on a rejection would be a second chance to get it
 * wrong.
 */
export function screenKindFor(state: GameState, focusedContract: ContentId | null): ScreenKind {
  const contract = focusedContract === null ? undefined : state.contracts.get(focusedContract);

  if (contract === undefined) {
    return ScreenKind.ContractOffer;
  }

  if (contract.offer.phase === OfferPhase.Settled) {
    return ScreenKind.ContractBoard;
  }

  return contract.resolution === null ? ScreenKind.ContractOffer : ScreenKind.AfterAction;
}

/**
 * The screen `state` belongs on, built.
 *
 * The one place a `ScreenModel` is made from a live campaign, so a run, a load, a dispatch
 * and a manual move cannot answer with differently-shaped screens. The `switch` is
 * exhaustive and has no `default`: a fourth screen does not build until this function has
 * been told how to make one.
 *
 * `steps` is passed rather than recovered here because the two callers hold different
 * things: a finished run has its own step list, including the commands that were refused,
 * while a loaded or command-advanced campaign has only history to rebuild one from. Both
 * draw the same screen — `tests/oracle/src/restored-read-model.test.ts` measures exactly
 * that over every shipped scenario at both seeds — and the difference is which of the two
 * the caller already has in hand.
 */
export function campaignScreen(
  state: GameState,
  focusedContract: ContentId | null,
  steps: readonly DecidedStep[],
  screen: ScreenKind = screenKindFor(state, focusedContract)
): ScreenModel {
  switch (screen) {
    case ScreenKind.ContractOffer:
      return contractOfferScreenModel(state, steps, focusedContract ?? undefined);
    case ScreenKind.AfterAction:
      if (focusedContract === null) {
        throw new Error(
          'A debrief was asked for with no contract focused. The debrief is about one ' +
            "contract's outcome, so a session with none to name has nothing to debrief — a " +
            'defect in the caller, not a campaign without an outcome.'
        );
      }

      return afterActionScreenModel(state, focusedContract);
    case ScreenKind.ContractBoard:
      return contractBoardScreenModel(state);
  }
}

/**
 * The contract a finished run leaves the player on — the screen factory's own rule, called
 * rather than restated.
 *
 * This used to answer "the contract the first step named, or nothing", which disagreed with
 * the screen on a real path: a run that applied no step still shows the campaign's first
 * contract, and a session claiming no focus there made `save` write nothing at all. Found by
 * external review of this task; the fix is to ask the one function that decides it.
 */
function focusOfRun(result: Extract<ScenarioRunResult, { kind: 'ran' }>): ContentId | null {
  return focusedContractOf(result.outcome.finalState, result.outcome.steps);
}
