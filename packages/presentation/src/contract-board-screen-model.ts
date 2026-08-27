import {
  OfferPhase,
  type ContentId,
  type ContractState,
  type GameState
} from '@oath-and-coin/simulation';

import { ContractAvailability } from './contract-availability.ts';
import { CONTRACT_BOARD_TITLE_KEY, contractDisplayNameKey, needKey } from './keys.ts';
import { ScreenState } from './screen-state.ts';

/**
 * The board the loop returns to: every contract of the campaign, how far each has got, and
 * what the guild has to spend (`RESOLUTION_SPEC` §6.4 — where a settlement sends the
 * player).
 *
 * **One row per contract, in the campaign's own order.** `GameState.contracts` is a
 * `SortedMap` keyed by content id, so the order is already deterministic and already the
 * one the canonical artifact writes; re-sorting here would be a second ordering with
 * nothing to check it against.
 *
 * **What a row shows and what it does not.** The fee, the seats and the treasury are
 * facts that happened and stay numbers (`GDD` §16.3); what the job asks for stays a list of
 * names, because a weight is the contract's arithmetic and not the board's subject; and how
 * far the contract has got is one word from this layer's own vocabulary rather than the
 * three engine fields a screen would otherwise have to combine for itself.
 */

/** One contract, as the board shows it. */
export interface ContractBoardRow {
  /** Bookkeeping — what a caller focuses on, never a label (`TDD` §11.1). */
  readonly definition: ContentId;
  readonly displayNameKey: string;
  readonly patronFee: number;
  readonly requiredCrew: number;
  readonly needKeys: readonly string[];
  readonly availability: ContractAvailability;
}

export interface ContractBoardScreenModel {
  readonly state: ScreenState;
  readonly titleKey: string;
  readonly rows: readonly ContractBoardRow[];
  readonly treasury: number;
  readonly errorCode: string | null;
  /** Outside every hash, for the reason `AfterActionScreenModel.errorDetail` is. */
  readonly errorDetail: string | null;
}

/**
 * Builds a model, refusing every combination that would make it lie — the same gate the
 * other two screens keep, and for the reason `createContractOfferScreenModel` records: a
 * spread walks around a factory, and this one would otherwise publish a board of rows
 * under a state that says there are none.
 */
export function createContractBoardScreenModel(
  model: ContractBoardScreenModel
): ContractBoardScreenModel {
  if (model.errorDetail !== null && model.errorCode === null) {
    throw new Error(
      'errorDetail must not be set without errorCode: a detail with nothing to detail is not ' +
        'an error, it is an orphaned string.'
    );
  }

  switch (model.state) {
    case ScreenState.Error:
      if (model.errorCode === null) {
        throw new Error('errorCode must be set when state is Error.');
      }

      requireNoBoard(model);
      break;

    case ScreenState.Loading:
    case ScreenState.Empty:
      if (model.errorCode !== null) {
        throw new Error(`errorCode must be null when state is ${model.state}.`);
      }

      requireNoBoard(model);
      break;

    case ScreenState.Incomplete:
    case ScreenState.Normal:
      if (model.errorCode !== null) {
        throw new Error(`errorCode must be null when state is ${model.state}.`);
      }

      if (model.rows.length === 0) {
        throw new Error(
          `A ${model.state} board must carry at least one row: a board with nothing on it is ` +
            'Empty, and the distinction is the whole of what those two states say.'
        );
      }

      // The state is a fact about the rows, not a field a caller may set against them —
      // the same gate `createSaveSlotsScreenModel` keeps, and external review of this task
      // found it missing here: a spread from a valid `Normal` board with `state:
      // 'Incomplete'` typechecked, passed the row-count rule above and would have told the
      // player there was nothing to take while an open contract sat on the screen.
      if (stateOf(model.rows) !== model.state) {
        throw new Error(
          `This board claims state ${model.state}, but its ${String(model.rows.length)} rows are ` +
            `a ${stateOf(model.rows)} board: Normal is a board with something still open to ` +
            'take, Incomplete is one where every contract has been started already.'
        );
      }

      break;

    default:
      throw new Error(`Unknown screen state '${String(model.state)}'.`);
  }

  return model;
}

function requireNoBoard(model: ContractBoardScreenModel): void {
  if (model.rows.length > 0) {
    throw new Error(
      `A ${model.state} board must carry no rows: there is no campaign behind it to have read ` +
        'them from, so every row on it belongs to some other campaign.'
    );
  }
}

/**
 * The board before a campaign has been read — the one state
 * {@link contractBoardScreenModel} never produces.
 *
 * `treasury` is `0` because there is nothing to read one off, the same claim
 * `LOADING_SCREEN` makes about the offer screen's own figure.
 */
export const CONTRACT_BOARD_LOADING_SCREEN: ContractBoardScreenModel =
  createContractBoardScreenModel({
    state: ScreenState.Loading,
    titleKey: CONTRACT_BOARD_TITLE_KEY,
    rows: [],
    treasury: 0,
    errorCode: null,
    errorDetail: null
  });

/** The board for a run that never reached a campaign at all. */
export function contractBoardFailedScreen(
  errorCode: string,
  errorDetail: string
): ContractBoardScreenModel {
  if (errorCode.length === 0) {
    throw new Error('errorCode must not be empty: an error screen has to name what failed.');
  }

  if (errorDetail.length === 0) {
    throw new Error('errorDetail must not be empty: an error nobody can act on is not a report.');
  }

  return createContractBoardScreenModel({
    state: ScreenState.Error,
    titleKey: CONTRACT_BOARD_TITLE_KEY,
    rows: [],
    treasury: 0,
    errorCode,
    errorDetail
  });
}

/**
 * The board for `state`.
 *
 * `Empty` when the campaign carries no contract at all. `Normal` while at least one
 * contract is still open to take — the board has something to offer. `Incomplete`
 * otherwise: contracts exist and none of them can be started, which is a board that cannot
 * answer "what next" and is exactly the shape `ScreenState.Incomplete` is for.
 */
export function contractBoardScreenModel(state: GameState): ContractBoardScreenModel {
  const rows = state.contracts.values().map(toRow);

  if (rows.length === 0) {
    return createContractBoardScreenModel({
      state: ScreenState.Empty,
      titleKey: CONTRACT_BOARD_TITLE_KEY,
      rows: [],
      // A real campaign, just one with nothing on the board — unlike Loading and Error,
      // where there is no campaign to read a figure off at all.
      treasury: state.treasury,
      errorCode: null,
      errorDetail: null
    });
  }

  return createContractBoardScreenModel({
    state: stateOf(rows),
    titleKey: CONTRACT_BOARD_TITLE_KEY,
    rows,
    treasury: state.treasury,
    errorCode: null,
    errorDetail: null
  });
}

/**
 * Which of the two populated shapes a set of rows is — stated once, so the factory and the
 * validator cannot answer it differently.
 *
 * `Normal` while something is still open to take; `Incomplete` when contracts exist and
 * every one of them has been started, resolved or settled — a board that cannot answer
 * "what next". **Owner's decision of 2026-08-27**, taken when external review asked whether
 * this reading of `Incomplete` matches the offer screen's (there it is a hero who has not
 * answered): it does not have to, for the reason `saveSlotsStateKey`'s own comment gives —
 * the five words are the same five and the sentences are not, which is why each screen owns
 * its own state texts.
 */
function stateOf(rows: readonly ContractBoardRow[]): ScreenState {
  return rows.some((row) => row.availability === ContractAvailability.Open)
    ? ScreenState.Normal
    : ScreenState.Incomplete;
}

function toRow(contract: ContractState): ContractBoardRow {
  return {
    definition: contract.id,
    displayNameKey: contractDisplayNameKey(contract.id),
    patronFee: contract.patronFee,
    requiredCrew: contract.requiredCrew,
    needKeys: contract.needs.keys().map(needKey),
    availability: availabilityOf(contract)
  };
}

/**
 * How far one contract has got, read in the order the lifecycle runs.
 *
 * Settled first, because a settled contract also carries a resolution and a key hero and
 * would answer to either of the tests below; then the stored outcome; then a package that
 * exists at all, which is what `keyHero` says — `initialOffer` leaves it `null`, and only
 * `composeOffer` fills it, so "somebody has started on this" needs no second field to
 * check. Anything else is a contract nobody has touched.
 */
function availabilityOf(contract: ContractState): ContractAvailability {
  if (contract.offer.phase === OfferPhase.Settled) {
    return ContractAvailability.Settled;
  }

  if (contract.resolution !== null) {
    return ContractAvailability.Resolved;
  }

  if (contract.offer.keyHero !== null) {
    return ContractAvailability.InProgress;
  }

  return ContractAvailability.Open;
}
