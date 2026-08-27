import {
  CommitmentState,
  NeedId,
  OfferPhase,
  SortedMap,
  SortedSet,
  compareHeroIds,
  compareNeedIds,
  heroId,
  parseContentId,
  settleContract,
  type ContractState,
  type GameState
} from '@oath-and-coin/simulation';
import { describe, expect, it } from 'vitest';

import { ContractAvailability } from './contract-availability.ts';
import {
  CONTRACT_BOARD_LOADING_SCREEN,
  contractBoardFailedScreen,
  contractBoardScreenModel,
  createContractBoardScreenModel
} from './contract-board-screen-model.ts';
import { CONTRACT_BOARD_TITLE_KEY } from './keys.ts';
import { SCREEN_STATES, ScreenState } from './screen-state.ts';
import {
  aCapableHero,
  aContract,
  aCrewedContract,
  anOffer,
  aResolvedCampaign,
  aState,
  ids,
  withContracts,
  withHeroes
} from './testing/fixtures.ts';

/**
 * The board the loop returns to.
 *
 * The campaign below deliberately carries one contract at each point of the lifecycle, and
 * their ids are chosen so that the row order (`ContentId`) and the lifecycle order do not
 * coincide: `core:archive_run` sorts first and is the untouched one, the resolved contract
 * sorts second, the composed one third and the settled one last. A model reading a row's
 * state off its position would agree with the lifecycle on none of them.
 */

const archiveId = parseContentId('core:archive_run');
const debtId = parseContentId('core:collect_the_debt');

const soldier = aCapableHero({
  id: 0,
  definition: ids.bram,
  grade: 100,
  expertise: [
    [NeedId.Frontline, 100],
    [NeedId.Wilderness, 100]
  ]
});

const TWO_EASY_NEEDS: readonly (readonly [NeedId, number])[] = [
  [NeedId.Frontline, 40],
  [NeedId.Wilderness, 40]
];

/** A contract nobody has composed a package for: `initialOffer` names no key hero. */
function anUntouchedContract(id = archiveId): ContractState {
  return aContract({
    id,
    patronFee: 30,
    requiredCrew: 1,
    needs: SortedMap.from<NeedId, number>(compareNeedIds, TWO_EASY_NEEDS)
  });
}

/** A contract whose package exists and whose crew has not come back. */
function aComposedContract(): ContractState {
  return aContract({
    id: debtId,
    patronFee: 50,
    requiredCrew: 1,
    needs: SortedMap.from<NeedId, number>(compareNeedIds, TWO_EASY_NEEDS),
    offer: anOffer({
      keyHero: heroId(0),
      phase: OfferPhase.Draft,
      invited: SortedSet.from(compareHeroIds, [heroId(0)])
    })
  });
}

/**
 * A campaign holding one contract at each of the four points: the crypt resolved, the
 * caravan resolved and then settled, the debt composed, the archive run untouched.
 */
function aCampaignAtEveryStage(): GameState {
  const resolved = aResolvedCampaign({
    heroes: [soldier],
    contracts: [
      aCrewedContract({
        id: ids.crypt,
        needs: TWO_EASY_NEEDS,
        risk: 0,
        crew: [{ hero: soldier, commitment: CommitmentState.Committed }]
      }),
      aCrewedContract({
        id: ids.caravan,
        needs: TWO_EASY_NEEDS,
        risk: 0,
        crew: [{ hero: soldier, commitment: CommitmentState.Committed }]
      })
    ]
  });

  const paid = settleContract(resolved, {
    commandId: 50,
    contractId: ids.caravan,
    pay: true,
    expectedStateVersion: resolved.metadata.stateVersion
  });

  if (!paid.applied) {
    throw new Error(`The fixture could not settle the caravan: ${String(paid.rejectionCode)}`);
  }

  return withContracts(paid.state, [
    ...paid.state.contracts.values(),
    aComposedContract(),
    anUntouchedContract()
  ]);
}

function modelIn(state: ScreenState) {
  switch (state) {
    case ScreenState.Loading:
      return CONTRACT_BOARD_LOADING_SCREEN;
    case ScreenState.Error:
      return contractBoardFailedScreen('CONTENT_ROOT_NOT_FOUND', 'nowhere on this disk');
    case ScreenState.Empty:
      return contractBoardScreenModel(withContracts(aState(), []));
    case ScreenState.Incomplete:
      return contractBoardScreenModel(
        withContracts(aState(), [aComposedContract(), aComposedContract2()])
      );
    case ScreenState.Normal:
      return contractBoardScreenModel(withContracts(aState(), [anUntouchedContract()]));
    default:
      throw new Error(`No fixture for screen state '${String(state)}'.`);
  }
}

describe('the five shapes the board takes', () => {
  it.each(SCREEN_STATES)('builds a model in state %s', (state) => {
    expect(modelIn(state).state).toBe(state);
  });

  it.each(SCREEN_STATES)('titles the model in state %s under its own key', (state) => {
    expect(modelIn(state).titleKey).toBe(CONTRACT_BOARD_TITLE_KEY);
  });

  it('is Normal while something is still open to take, whatever its position', () => {
    // The open contract is the *last* row here: `core:collect_the_debt` sorts before
    // `core:escort_the_caravan`, and it is the composed one. A model that decided the
    // state from `rows[0]` would call this board Incomplete.
    const board = contractBoardScreenModel(
      withContracts(aState(), [aComposedContract(), anUntouchedContract(ids.caravan)])
    );

    expect(board.rows.map((row) => row.availability)).toEqual([
      ContractAvailability.InProgress,
      ContractAvailability.Open
    ]);
    expect(board.state).toBe(ScreenState.Normal);
  });

  it('is Incomplete when contracts exist and none of them can be started', () => {
    const board = contractBoardScreenModel(
      withContracts(aState(), [aComposedContract(), aComposedContract2()])
    );

    expect(board.rows).toHaveLength(2);
    expect(board.rows.every((row) => row.availability !== ContractAvailability.Open)).toBe(true);
    expect(board.state).toBe(ScreenState.Incomplete);
  });

  it('reads the treasury on every state that has a campaign behind it', () => {
    expect(modelIn(ScreenState.Empty).treasury).toBe(aState().treasury);
    expect(modelIn(ScreenState.Normal).treasury).toBe(aState().treasury);
    // Loading and Error have no campaign to read a figure off at all, so a number on
    // either would be one this screen invented.
    expect(modelIn(ScreenState.Loading).treasury).toBe(0);
    expect(modelIn(ScreenState.Error).treasury).toBe(0);
  });

  it('refuses an error screen with nothing to say', () => {
    expect(() => contractBoardFailedScreen('', 'detail')).toThrow(/name what failed/u);
    expect(() => contractBoardFailedScreen('CODE', '')).toThrow(/not a report/u);
  });

  it('refuses a Normal board assembled by a spread around the factory', () => {
    expect(() =>
      createContractBoardScreenModel({
        ...CONTRACT_BOARD_LOADING_SCREEN,
        state: ScreenState.Normal
      })
    ).toThrow(/at least one row/u);
  });

  it.each([
    ['Normal claiming Incomplete', [anUntouchedContract()], ScreenState.Incomplete],
    ['Incomplete claiming Normal', [aComposedContract()], ScreenState.Normal]
  ])('refuses a board whose state disagrees with its rows: %s', (_name, contracts, claimed) => {
    // Both directions, on non-empty boards. The row-count rule catches neither: a spread
    // from a real board keeps its rows, so the only thing wrong with it is the word it
    // uses about them — and that word is what the player reads.
    expect(() =>
      createContractBoardScreenModel({
        ...contractBoardScreenModel(withContracts(aState(), contracts)),
        state: claimed
      })
    ).toThrow(/rows are a/u);
  });

  it('refuses an Empty board carrying rows', () => {
    expect(() =>
      createContractBoardScreenModel({
        ...contractBoardScreenModel(withContracts(aState(), [anUntouchedContract()])),
        state: ScreenState.Empty
      })
    ).toThrow(/must carry no rows/u);
  });
});

describe('a row', () => {
  it('says how far its own contract has got', () => {
    const board = contractBoardScreenModel(aCampaignAtEveryStage());

    expect(board.rows.map((row) => [row.definition, row.availability])).toEqual([
      [archiveId, ContractAvailability.Open],
      [ids.crypt, ContractAvailability.Resolved],
      [debtId, ContractAvailability.InProgress],
      [ids.caravan, ContractAvailability.Settled]
    ]);
  });

  it('names its contract by key and keeps the id for the caller alone', () => {
    const [row] = contractBoardScreenModel(withContracts(aState(), [anUntouchedContract()])).rows;

    expect(row?.definition).toBe(archiveId);
    expect(row?.displayNameKey).toBe('contract.core.archive_run.name');
  });

  it('shows the fee and the seats as the plain numbers they are', () => {
    const [row] = contractBoardScreenModel(withContracts(aState(), [anUntouchedContract()])).rows;

    expect(row?.patronFee).toBe(30);
    expect(row?.requiredCrew).toBe(1);
  });

  it('names what the job asks for and never how much of it', () => {
    const [row] = contractBoardScreenModel(withContracts(aState(), [anUntouchedContract()])).rows;

    expect(row?.needKeys).toEqual(['need.frontline', 'need.wilderness']);
    expect(row).not.toHaveProperty('needs');
    expect(row).not.toHaveProperty('risk');
  });
});

/** A second composed contract, so a board can hold two with nothing open on it. */
function aComposedContract2(): ContractState {
  return { ...aComposedContract(), id: archiveId };
}

describe('the campaign behind the board', () => {
  it('draws one row per contract, in the campaign’s own order', () => {
    const state = withHeroes(aCampaignAtEveryStage(), [soldier]);

    expect(contractBoardScreenModel(state).rows.map((row) => row.definition)).toEqual(
      state.contracts.keys()
    );
  });
});
