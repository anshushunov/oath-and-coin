/**
 * The presentation package's public surface.
 *
 * This layer answers one question: what does a screen need in order to draw a
 * decision, given that it may invent nothing and resolve nothing? It produces read
 * models and localization *keys* — never text — and it depends on the simulation and
 * on nothing else (`ADR-010`: `simulation ← presentation`).
 *
 * Two consequences of that boundary are visible from here. There is no `ERROR_CODES`
 * list, because the codes are content's: {@link errorKey} builds a key from whatever
 * code it is handed, and the check that the catalogue names every one of them lives in
 * `tests/locale`, which may see both sides. And nothing here hashes with `node:crypto`
 * — the pure SHA-256 Task 6 put in the simulation is what both hashes use, which is
 * also what lets a browser compute them.
 */

export {
  QUALITATIVE_GRADES,
  QUALITATIVE_KEYS,
  QualitativeGrade,
  gradeForMagnitude,
  gradeForValue,
  qualitativeKey
} from './qualitative-scale.ts';

export { REASON_DIRECTIONS, ReasonDirection, SCREEN_STATES, ScreenState } from './screen-state.ts';

export { CONTRACT_AVAILABILITIES, ContractAvailability } from './contract-availability.ts';

export {
  ACTION_KEYS,
  AFTER_ACTION_FIELD_KEYS,
  AFTER_ACTION_STATE_KEYS,
  AFTER_ACTION_TITLE_KEY,
  COMMITMENT_STATE_KEYS,
  CONSEQUENCE_KIND_KEYS,
  CONTRACT_AVAILABILITY_KEYS,
  CONTRACT_BOARD_FIELD_KEYS,
  CONTRACT_BOARD_STATE_KEYS,
  CONTRACT_BOARD_TITLE_KEY,
  COVERAGE_VERDICT_KEYS,
  DEFICIT_KIND_KEYS,
  FIELD_KEYS,
  LEVER_DISABLED_KEYS,
  LeverDisabledKeys,
  NEED_KEYS,
  OUTCOME_EVENT_KEYS,
  OUTCOME_GRADE_KEYS,
  OutcomeEventKeys,
  AfterActionFieldKeys,
  ContractBoardFieldKeys,
  afterActionStateKey,
  commitmentStateKey,
  consequenceKindKey,
  contractAvailabilityKey,
  contractBoardStateKey,
  coverageVerdictKey,
  deficitKindKey,
  needKey,
  outcomeGradeKey,
  FieldKeys,
  OFFER_FIELD_KEYS,
  OFFER_PHASE_KEYS,
  OfferFieldKeys,
  PROMISE_TERMS_KEYS,
  PromiseTermsKeys,
  REASON_DIRECTION_KEYS,
  SAVES_TITLE_KEY,
  SAVE_FIELD_KEYS,
  SAVE_OVERWRITE_KEYS,
  SAVE_SLOTS_STATE_KEYS,
  SAVE_SLOT_STATUS_KEYS,
  SCREEN_LINK_KEYS,
  SCREEN_STATE_KEYS,
  SETTLEMENT_ACTION_KEYS,
  SETTLEMENT_FIELD_KEYS,
  ScreenLinkKeys,
  SaveFieldKeys,
  SaveOverwriteKeys,
  SaveSlotStatusKeys,
  SettlementActionKeys,
  SettlementFieldKeys,
  TITLE_KEY,
  TREASURY_FIELD_KEYS,
  TreasuryFieldKeys,
  WAVERED_FALSE_KEY,
  WAVERED_KEYS,
  WAVERED_TRUE_KEY,
  actionKey,
  contractDisplayNameKey,
  errorKey,
  offerPhaseKey,
  reasonDirectionKey,
  saveSlotDisplayNameKey,
  saveSlotLoadKey,
  saveSlotSaveKey,
  saveSlotsStateKey,
  screenStateKey,
  tagKey,
  traitDisplayNameKey,
  waveredKey
} from './keys.ts';

/**
 * The identifier type this package's own models are written in, re-exported so a consumer
 * can name it without depending on the simulation directly.
 *
 * `apps/web` declares no dependency on `@oath-and-coin/simulation` and must not gain one
 * (`ADR-010`'s chain is `simulation ← presentation ← application`), yet a component holding
 * a player's crew selection has to give that state a type — and the values in it come
 * straight off {@link OfferLine}'s levers, which are `ContentId`. A type-only re-export is
 * the whole of what that needs: nothing runtime crosses, and no component ever *builds* an
 * id, it only carries one the model handed it.
 */
export type { ContentId } from '@oath-and-coin/simulation';

export type {
  ChoiceLever,
  ChoiceOption,
  Lever,
  MultiChoiceLever,
  NumericLever,
  OfferBudget
} from './lever.ts';

export {
  createContractOfferScreenModel,
  leversOf,
  type ContractOfferScreenContent,
  type ContractLine,
  type ContractOfferScreenModel,
  type DecidedOutcome,
  type DecidedStep,
  type HeroCard,
  type OfferLine,
  type PromiseTermsLine,
  type ReasonLine,
  type ResponseLine,
  type SettlementLine
} from './contract-offer-screen-model.ts';

export {
  LOADING_SCREEN,
  contractOfferScreenModel,
  describeContractOfferReadModel,
  focusedContractOf,
  failedScreen
} from './contract-offer-screen-model-factory.ts';

export { SCREEN_KINDS, ScreenKind } from './screen-kind.ts';

export { describeReadModel, readModelHash, type ScreenModel } from './screen-model.ts';

export {
  AFTER_ACTION_LOADING_SCREEN,
  afterActionFailedScreen,
  afterActionScreenModel,
  createAfterActionScreenModel,
  describeAfterActionReadModel,
  type AfterActionScreenContent,
  type AfterActionConsequenceLine,
  type AfterActionContributionLine,
  type AfterActionCoverageLine,
  type AfterActionDeficitLine,
  type AfterActionEventLine,
  type AfterActionHeroLine,
  type AfterActionScreenModel,
  type AfterActionSettlementLine
} from './after-action-screen-model.ts';

export {
  CONTRACT_BOARD_LOADING_SCREEN,
  contractBoardFailedScreen,
  contractBoardScreenModel,
  createContractBoardScreenModel,
  describeContractBoardReadModel,
  type ContractBoardScreenContent,
  type ContractBoardRow,
  type ContractBoardScreenModel
} from './contract-board-screen-model.ts';

export {
  SAVE_SLOTS_LOADING_SCREEN,
  createSaveSlotsScreenModel,
  saveSlotsScreenModel,
  type SaveSlotInput,
  type SaveSlotLine,
  type SaveSlotsScreenModel
} from './save-slots-screen-model.ts';

export { expectedSnapshot, snapshotHash } from './rendered-ui-snapshot.ts';
