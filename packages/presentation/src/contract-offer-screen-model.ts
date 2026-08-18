import type { ContentId, DecisionResult } from '@oath-and-coin/simulation';

import type { QualitativeGrade } from './qualitative-scale.ts';
import { ScreenState, type ReasonDirection } from './screen-state.ts';

/**
 * One reason a hero's answer went the way it did, already on the qualitative scale.
 */
export interface ReasonLine {
  /** A stable code from the engine's own vocabulary — itself a localization key. */
  readonly reasonCode: string;
  /**
   * The content id text of the entity this reason came from. A plain string rather
   * than a parsed id: this crosses to a tool, a report and eventually a screen, none
   * of which should have to depend on the simulation's identifier type to read it.
   */
  readonly sourceEntity: string;
  /** The factor's magnitude on the qualitative scale — never the raw integer. */
  readonly strength: QualitativeGrade;
  /**
   * A key naming the source in a way a player reads, or `null` when the source adds
   * nothing the screen has not already said.
   *
   * `HERO_DECISION_SPEC` §3, verbatim: "Название черты в объяснении берётся не из кода
   * причины, а из `SourceEntity`: код говорит, чем мотив является, источник — чей он".
   * The code alone cannot distinguish which of a hero's two convictions actually
   * fired. `null` exactly for the codes whose source is always the offered contract or
   * the responding hero itself — both already named elsewhere on the same screen, so
   * naming them again here would repeat rather than explain. Which codes fall on which
   * side is the factory's own fact about the model, never a branch the screen makes.
   */
  readonly sourceDisplayNameKey: string | null;
  /** Which way this reason pulled relative to the answer it belongs to. */
  readonly direction: ReasonDirection;
}

/**
 * One hero in the roster, as the screen shows them.
 *
 * Neither list of keys is a trait's authored display name: the core carries a trait
 * only as a resolved `HeldTrait` (`ADR-002` forbids it referencing the content layer
 * that would know an authored name), so each key is built from the trait's own id.
 */
export interface HeroCard {
  readonly definition: string;
  readonly displayNameKey: string;
  readonly greed: QualitativeGrade;
  readonly caution: QualitativeGrade;
  readonly pride: QualitativeGrade;
  readonly principleKeys: readonly string[];
  readonly inclinationKeys: readonly string[];
}

/** One hero's answer to the offered contract. */
export interface ResponseLine {
  readonly heroDefinition: string;
  /**
   * The same key the hero's card carries elsewhere on the screen, joined on by the
   * hero's own definition. Without it, removing the raw definition from the screen —
   * which `TDD` §11.1 requires — left a response line naming no one at all.
   */
  readonly heroDisplayNameKey: string;
  readonly action: string;
  /**
   * At most three reasons: the ones that supported this answer first, strongest first,
   * then the strongest that argued against it. Empty exactly when
   * {@link blockedByEntity} is set — a red line closes the decision before any reason
   * has a magnitude to rank (`HERO_DECISION_SPEC` §2.2).
   */
  readonly reasons: readonly ReasonLine[];
  /** The entity carrying the principle that blocked this hero outright, or `null`. */
  readonly blockedByEntity: string | null;
  /** The key naming that principle, or `null` exactly when the entity is. */
  readonly blockedByDisplayNameKey: string | null;
  /**
   * The stable code of the rule that settled a dead heat, or `null` when the decision
   * was not a tie. Its own line rather than folded into {@link reasons}: a tie-break
   * has no magnitude to rank and pulled in no direction — it is what decided when
   * nothing pulled at all, and that decision is the one with no reasons to show.
   */
  readonly tieBreakCode: string | null;
  /**
   * `true` when this hero's mood flipped the answer the rest of the factors alone
   * would have given. Never set for a blocked line, which drew no mood at all.
   */
  readonly wavered: boolean;
}

/** The contract currently on offer, as the screen shows it. */
export interface ContractLine {
  readonly definition: string;
  readonly displayNameKey: string;
  /** The payment in coins — an objective fact, shown as a plain number on purpose. */
  readonly payment: number;
  readonly risk: QualitativeGrade;
  readonly tagKeys: readonly string[];
  readonly requiredCrew: number;
  readonly acceptedCount: number;
}

/**
 * Everything the interface needs to draw one of its five shapes, and nothing it would
 * have to guess at or compute itself.
 */
export interface ContractOfferScreenModel {
  readonly state: ScreenState;
  readonly titleKey: string;
  readonly contract: ContractLine | null;
  readonly roster: readonly HeroCard[];
  readonly responses: readonly ResponseLine[];
  readonly errorCode: string | null;
  /**
   * The human-readable half of an error. Deliberately outside both hashes: it can
   * carry a machine-specific path or an OS message and differs between runs of the
   * same failure, so hashing it would make "the same error" look like a mismatch. The
   * frozen corpus records the same decision — no `error_detail` in `read_model`.
   */
  readonly errorDetail: string | null;
}

/**
 * Builds a model, refusing every combination that would make it lie.
 *
 * A factory function rather than the C# original's `init` accessors with
 * assigned-tracking flags: those existed because object-initializer assignment order
 * is not guaranteed and a `with` expression re-runs only the accessors it names. A
 * function argument has neither problem, so this is the whole of it — the same
 * simplification `createDecisionResult` made in Task 8.
 *
 * Each state owns its own set of populated fields, and that ownership is enforced here
 * rather than left to callers to respect by convention.
 */
export function createContractOfferScreenModel(
  model: ContractOfferScreenModel
): ContractOfferScreenModel {
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

      requireNoContractContent(model);
      break;

    case ScreenState.Loading:
    case ScreenState.Empty:
      requireNoErrorCode(model);
      requireNoContractContent(model);
      break;

    case ScreenState.Incomplete:
    case ScreenState.Normal:
      requireNoErrorCode(model);

      if (model.contract === null) {
        throw new Error(
          `contract must not be null when state is ${model.state}: there is nothing to offer ` +
            'without one.'
        );
      }

      break;

    default:
      throw new Error(`Unknown screen state '${String(model.state)}'.`);
  }

  return model;
}

function requireNoErrorCode(model: ContractOfferScreenModel): void {
  if (model.errorCode !== null) {
    throw new Error(`errorCode must be null when state is ${model.state}.`);
  }
}

function requireNoContractContent(model: ContractOfferScreenModel): void {
  if (model.contract !== null || model.roster.length > 0 || model.responses.length > 0) {
    throw new Error(
      `contract, roster and responses must all be empty when state is ${model.state}: a screen ` +
        'with nothing to offer must not carry a roster from some other offer.'
    );
  }
}

/**
 * The minimal shape of a scenario step this package needs, declared here rather than
 * imported.
 *
 * `packages/content` owns `StepOutcome`, and `presentation-depends-only-on-simulation`
 * forbids importing it. The alternative — making the caller map a step onto some
 * presentation-owned type — would have moved a rule out of this layer: which steps
 * belong on this screen is decided by *which contract they answered*, and that filter
 * is the factory's business, not the caller's. A structural interface keeps the rule
 * here and costs no mapping at all: `readonly StepOutcome[]` is assignable to
 * `readonly DecidedStep[]` because the fields line up.
 *
 * What that trades away is named in the segment plan §1.1: the compiler checks the
 * shapes agree at the call site, not at the declaration. Both call sites — oracle
 * parity and the application session — are typed and inside the gate.
 */
export interface DecidedStep {
  /**
   * Only the one field of the command this layer needs. `ScenarioCommand` itself is
   * content's type; the contract it named is the whole of what decides whether the
   * step belongs on this screen.
   */
  readonly command: { readonly contract: ContentId };
  readonly heroDefinition: ContentId | null;
  /** The decision itself is a simulation type, so it crosses the boundary intact. */
  readonly decision: DecisionResult | null;
}
