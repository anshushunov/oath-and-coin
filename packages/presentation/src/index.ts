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

export {
  ACTION_KEYS,
  FIELD_KEYS,
  FieldKeys,
  REASON_DIRECTION_KEYS,
  SCREEN_STATE_KEYS,
  TITLE_KEY,
  WAVERED_FALSE_KEY,
  WAVERED_KEYS,
  WAVERED_TRUE_KEY,
  actionKey,
  contractDisplayNameKey,
  errorKey,
  reasonDirectionKey,
  screenStateKey,
  tagKey,
  traitDisplayNameKey,
  waveredKey
} from './keys.ts';

export {
  createContractOfferScreenModel,
  type ContractLine,
  type ContractOfferScreenModel,
  type DecidedStep,
  type HeroCard,
  type ReasonLine,
  type ResponseLine
} from './contract-offer-screen-model.ts';

export {
  LOADING_SCREEN,
  contractOfferScreenModel,
  describeReadModel,
  failedScreen,
  readModelHash
} from './contract-offer-screen-model-factory.ts';

export { expectedSnapshot, snapshotHash } from './rendered-ui-snapshot.ts';
