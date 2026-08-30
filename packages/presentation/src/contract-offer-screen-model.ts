import type {
  CausalTrace,
  Cell,
  ContentId,
  DoctrineId,
  OfferPhase
} from '@oath-and-coin/simulation';

import type { ChoiceLever, Lever, MultiChoiceLever, NumericLever, OfferBudget } from './lever.ts';
import type { AvailableAction, OfferAction } from './offer-actions.ts';
import type { QualitativeGrade } from './qualitative-scale.ts';
import { ScreenKind } from './screen-kind.ts';
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
  /**
   * A `ContentId` rather than a plain string, unlike every other identifier on this model:
   * this is the one a *command* is addressed to. Every negotiation command names the
   * contract it acts on, so a screen that has to widen or cast this before it can dispatch
   * one would be building an identifier rather than carrying the one it was handed —
   * exactly what {@link OfferLine}'s hero levers avoid for heroes.
   */
  readonly definition: ContentId;
  readonly displayNameKey: string;
  /** The patron fee in coins — an objective fact, shown as a plain number on purpose. */
  readonly patronFee: number;
  readonly risk: QualitativeGrade;
  readonly tagKeys: readonly string[];
  readonly requiredCrew: number;
  readonly acceptedCount: number;
}

/**
 * The negotiation package currently on offer for the contract this screen shows
 * (`NEGOTIATION_SPEC` §5.1) — version, phase, and the five terms a player may still move,
 * each stated as a lever rather than as a bare value.
 *
 * **Levers replaced the bare terms rather than joining them, and that is the point.** The
 * advance, the method tag, the promised bonus, the key hero and the crew each used to be
 * a value (or a value plus a list of alternatives) that said nothing about whether it
 * could be changed or how far. A screen drawing a control over one of those had two
 * choices, and both are forbidden here: work the bounds out itself (`RESOLUTION_SPEC` §6 —
 * the screen decides nothing), or offer no bounds at all and send the player into a
 * refusal the engine was always going to make. Carrying the value *and* a lever over the
 * same value would have been worse than either: two declarations of one term, free to
 * disagree the first time one of them was updated.
 *
 * `methodLever.options` names **both** alternatives of the contract's negotiable tag, not
 * only the one the current package chose: a player choosing between two things has to see
 * both of them, or there is nothing to choose between on the screen itself
 * (`NEGOTIATION_SPEC` §5.1's own phrasing — "доступные альтернативы ключами"). Empty when
 * the contract has no negotiable tag at all, in which case `chosen` is `null` too — as it
 * also is whenever a negotiable contract's package has chosen none yet.
 *
 * `keyHeroLever.options` and `crewLever.options` are the whole roster, and each option
 * carries the hero's own display-name key beside the content id: the id is the value a
 * command is built from and `TDD` §11.1 forbids it reaching a label, so the join happens
 * here, once, where the roster is.
 */
export interface OfferLine {
  readonly version: number;
  readonly phase: OfferPhase;
  readonly advanceLever: NumericLever;
  readonly bonusLever: NumericLever;
  readonly methodLever: ChoiceLever<ContentId>;
  readonly keyHeroLever: ChoiceLever<ContentId>;
  readonly crewLever: MultiChoiceLever<ContentId>;
  /**
   * What the treasury still allows this package as a whole (`NEGOTIATION_SPEC` §2.3) —
   * the constraint {@link advanceLever} and {@link bonusLever} are each a projection of,
   * shown in its own right because a player who has hit a ceiling is owed the reason.
   */
  readonly budget: OfferBudget;
  /**
   * What locking this package would reserve from the treasury — `advance ×
   * requiredCrew + promisedBonus` (`commitmentOf`, `@oath-and-coin/simulation`), the
   * exact quantity `lockOffer`'s own treasury check holds the campaign to
   * (`NEGOTIATION_SPEC` §2.3, §3.3).
   *
   * Deliberately not the same money {@link OfferLine.advanceLever}'s value times {@link
   * ContractLine.acceptedCount} would suggest, and not what drives {@link
   * ContractOfferScreenModel.treasuryForecast} during `draft`: that field is a
   * settlement forecast, faithful to `settleContract`'s own formula, which pays only
   * the seats actually filled — zero or one, before a package is locked, since only the
   * key hero can be in `acceptedBy` that early. A player composing a package sees
   * almost no price there for exactly that reason. `lockCommitment` is the other of the
   * two prices `NEGOTIATION_SPEC` §5.1 asks this screen to show "before anything is
   * signed": what committing the *whole* crew the contract has room for will cost the
   * moment `lockOffer` is pressed, which is the number a locked offer is actually
   * refused over (`rejected.treasury_cannot_cover_the_offer`) — and the one
   * `treasuryForecast` alone cannot warn a player about while the package is still a
   * draft.
   */
  readonly lockCommitment: number;
}

/**
 * Every lever on a package, in the order the screen lays them out.
 *
 * Stated once, here, so that "each lever names its reason" is a claim about a list rather
 * than five separate claims a sixth lever could quietly escape. The order is the one
 * {@link import('./rendered-ui-snapshot.ts').expectedSnapshot} walks and the one the
 * component renders — one statement, three readers.
 */
export function leversOf(offer: OfferLine): readonly Lever[] {
  return [
    offer.advanceLever,
    offer.methodLever,
    offer.bonusLever,
    offer.keyHeroLever,
    offer.crewLever
  ];
}

/**
 * Just the commands a player may press, in {@link OFFER_ACTIONS} order.
 *
 * Here rather than beside `availableActions` in `offer-actions.ts`, and not by preference:
 * this reads a `ContractOfferScreenModel`, that module is what the model's own field type
 * comes from, and the two importing each other is the cycle `lint:deps`'s `no-circular`
 * rule refuses — found by running into it, the same way `OfferPhase` ended up declared
 * beside `ContractState` rather than in `offer-state.ts`.
 */
export function enabledActions(model: ContractOfferScreenModel): readonly OfferAction[] {
  return model.availableActions
    .filter((available) => available.disabledReasonKey === null)
    .map((available) => available.action);
}

/**
 * What keeping the guild's word will mean and what breaking it will mean, stated as two
 * keys rather than one — `NEGOTIATION_SPEC` §5.1 requires both, named as the fix for
 * Football Manager's own failure mode: a promise counted broken at the moment it was
 * kept, with nothing on screen to say why. `null` exactly when {@link
 * OfferLine.bonusLever}'s value is `0` — nothing was promised, so there is nothing to
 * keep or break.
 */
export interface PromiseTermsLine {
  readonly fulfilKey: string;
  readonly breachKey: string;
  readonly bonus: number;
}

/**
 * What the promise costs and who is bound by it, shown once there is a crew to bind
 * (`NEGOTIATION_SPEC` §5.1): the phase is `settled`, or it is `locked` with every seat
 * filled. `null` before that — a package that might still change, or an empty seat, has
 * no settlement to show yet.
 *
 * `treasuryIfKept` and `treasuryIfBroken` are the two outcomes `settleContract`
 * (`NEGOTIATION_SPEC` §3.3) can produce, computed from the same terms this line
 * otherwise carries: keeping the word pays {@link promisedBonus} on top of the advance
 * already reserved, breaking it does not.
 */
export interface SettlementLine {
  readonly promisedBonus: number;
  readonly keyHeroDefinition: string | null;
  /** The accepted crew's own definitions, in the order the offer's `acceptedBy` holds them. */
  readonly crew: readonly string[];
  readonly treasuryIfKept: number;
  readonly treasuryIfBroken: number;
}

/**
 * One man to place, and the cell he stands in once he has been placed.
 *
 * A role beside the name because a formation is a decision about *jobs* (`COMBAT_SPEC` §3.3,
 * §4.1): what a man can do from a row is decided by the row, and a player choosing where to
 * put somebody without being told what he is would be guessing.
 */
export interface DeploymentSlot {
  readonly heroDefinition: ContentId;
  readonly displayNameKey: string;
  readonly roleKey: string;
  /**
   * Where he already stands, or `null` before the crew has been placed.
   *
   * The cell itself rather than a row and a column beside each other: the two are one fact
   * (`COMBAT_SPEC` §3.1) and a screen holding them apart can carry half of one.
   */
  readonly cell: Cell | null;
}

/**
 * The 3×3 and the two orders that go with it (`COMBAT_SPEC` §3.7).
 *
 * **`null` on a contract that never goes to a fight, and on one whose package is not locked
 * yet.** The formation lives on the package rather than on the send (§3.7), so it is decided
 * once the crew is known and before the crew leaves — which is exactly the window in which
 * this block exists.
 *
 * **The board is data here rather than nine cells a component draws from a loop.** A screen
 * that built its own grid would be a second declaration of §3.1's field, and the two would
 * disagree the day the field changes shape.
 */
export interface DeploymentLine {
  /** Every legal cell, in row-then-column order. */
  readonly cells: readonly Cell[];
  /** The accepted crew, in `acceptedBy`'s own order. */
  readonly crew: readonly DeploymentSlot[];
  /**
   * The three orders a crew can go out under (`COMBAT_SPEC` §7.2), as a lever.
   *
   * A `ChoiceLever` rather than a list of keys, for the reason every other choice on this
   * screen is one: `chosen` is the value the command is built from and `labelKey` is how the
   * option is drawn, and a screen holding only the key would have to turn a label back into
   * an identifier to send anything.
   */
  readonly doctrineLever: ChoiceLever<DoctrineId>;
  /**
   * The share of the crew that must be standing before they pull out on their own, in per
   * cent — `0` for "never on their own" — or `null` before the crew has been placed.
   */
  readonly retreatBelowPercent: number | null;
  /** Whether everybody has a cell, which is what `placeCrew` will and will not accept. */
  readonly placed: boolean;
}

/**
 * One ranked reason the plan looks the way it does (`COMBAT_SPEC` §10.1, `DEC-006`).
 *
 * The code is already a localization key and the ranking is its declaration order in
 * `ForecastReasonCodes` — a stated rule rather than a score, because a weighted sum here
 * would be a probability with the number filed off. What a reason *names* travels beside it
 * as keys, never as ids a screen would have to print.
 */
export interface ForecastReasonLine {
  readonly key: string;
  /** The need this is about, as a key, or `null`. */
  readonly needKey: string | null;
  /** The hero this is about, as a key, or `null`. */
  readonly heroDisplayNameKey: string | null;
  /** The column this is about, or `null`. A column is a place, and a place is a number. */
  readonly column: number | null;
}

/**
 * What the plan is risking, said **before** the crew is sent (`COMBAT_SPEC` §10.1).
 *
 * **This is the half of `DIRECTION_2026-08` §4.8 that a debrief cannot supply.** The control
 * asks that knowing a *person* change the player's *preparation*, and knowledge that arrives
 * only in the debrief cannot change a preparation that already happened. `forecast.bond_may_
 * break_the_doctrine` is the line that says it in time, and §13.2's third technical
 * prerequisite is exactly that it be said.
 *
 * **Ranked reasons and three words, never a probability** (`DEC-006`). The verdicts are the
 * same three the debrief prints, from the same function — which is what lets the debrief put
 * "promised" and "delivered" in one row.
 *
 * `null` on a contract that goes to no fight, and before the package is locked: a forecast
 * of a crew nobody has answered for would be a forecast of a guess.
 */
export interface ForecastLine {
  readonly objectives: readonly { readonly needKey: string; readonly verdictKey: string }[];
  readonly reasons: readonly ForecastReasonLine[];
}

/**
 * Everything the interface needs to draw one of its five shapes, and nothing it would
 * have to guess at or compute itself.
 */
export interface ContractOfferScreenModel {
  /**
   * Which screen this is (`ScreenKind.ContractOffer`) — the union's discriminant, and the
   * one field on this model no caller supplies: {@link createContractOfferScreenModel}
   * stamps it, so it cannot be spelled wrong and cannot be spread away.
   */
  readonly screen: typeof ScreenKind.ContractOffer;
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
  /**
   * The guild's money (`NEGOTIATION_SPEC` §2.3, §5.1) — an objective fact shown as a
   * plain number, the same treatment `GDD` §16.3 gives every other size on this screen.
   * `0` on a screen with no campaign behind it at all (`Loading`, `Error`); the real
   * figure otherwise, including `Empty`, which still has a campaign, just no contract.
   */
  readonly treasury: number;
  /**
   * The negotiation package for {@link contract}, or `null` exactly when {@link
   * contract} is — every `ContractState` carries an `OfferState`, so a screen with a
   * contract always has one to show.
   */
  readonly offer: OfferLine | null;
  /**
   * What {@link treasury} would read after settling {@link contract}'s current package
   * and keeping the word — `NEGOTIATION_SPEC` §5.1's "цена уступки", visible before
   * anything is signed. Computed term for term against `settleContract`'s own formula
   * (`NEGOTIATION_SPEC` §3.3) with `pay: true`; equal to {@link treasury} when there is
   * no {@link contract} to project.
   */
  readonly treasuryForecast: number;
  readonly promiseTerms: PromiseTermsLine | null;
  readonly settlement: SettlementLine | null;
  /** The formation and the two orders, or `null` when there is no fight to prepare for. */
  readonly deployment: DeploymentLine | null;
  /** What the plan is risking, said before the crew goes; `null` where there is no fight. */
  readonly forecast: ForecastLine | null;
  /**
   * All six commands of the protocol, each with the refusal it would get or `null` when it
   * would be taken (`NEGOTIATION_SPEC` §3.1, `RESOLUTION_SPEC` §3.1).
   *
   * Always six, on every state, so a screen never has to decide which controls exist —
   * only how to draw one that is dark. Empty exactly when {@link offer} is `null`: a screen
   * with no package behind it has no command to press against one.
   */
  readonly availableActions: readonly AvailableAction[];
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
export type ContractOfferScreenContent = Omit<ContractOfferScreenModel, 'screen'>;

export function createContractOfferScreenModel(
  model: ContractOfferScreenContent
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

      if (model.offer === null) {
        throw new Error(
          `offer must not be null when state is ${model.state}: every ContractState carries an ` +
            'OfferState, so a screen with a contract always has a package to show.'
        );
      }

      break;

    default:
      throw new Error(`Unknown screen state '${String(model.state)}'.`);
  }

  return { ...model, screen: ScreenKind.ContractOffer };
}

function requireNoErrorCode(model: ContractOfferScreenContent): void {
  if (model.errorCode !== null) {
    throw new Error(`errorCode must be null when state is ${model.state}.`);
  }
}

function requireNoContractContent(model: ContractOfferScreenContent): void {
  if (
    model.contract !== null ||
    model.roster.length > 0 ||
    model.responses.length > 0 ||
    model.offer !== null ||
    model.promiseTerms !== null ||
    model.settlement !== null ||
    model.availableActions.length > 0
  ) {
    throw new Error(
      `contract, roster, responses, offer, promiseTerms, settlement and availableActions must ` +
        `all be empty when state is ${model.state}: a screen with nothing to offer must not ` +
        'carry a roster, an offer, its terms or a command to press against it from some other ' +
        'offer.'
    );
  }
}

/**
 * Only what this layer reads off a decision. `DecisionResult` is assignable to it
 * structurally, so nothing maps.
 *
 * The shape is needed because a decision rebuilt from a save knows the action, the score
 * and the trace — and does not know `consideredActions`, which is on neither the event
 * nor the trace. `DecisionResult` makes that field mandatory, so declaring the input as
 * `DecisionResult` would leave every restorer with one honest option and one invented
 * one. A required field nobody restoring can supply is an invitation to make it up.
 *
 * `selectedScore` stays nullable for the same reason `DecisionResult` keeps it nullable:
 * a red line closes a decision before any score exists, and zero would read as consent
 * (`TDD` §8).
 */
export interface DecidedOutcome {
  readonly selectedAction: ContentId;
  readonly selectedScore: number | null;
  readonly trace: CausalTrace;
  /**
   * The hero this decision belongs to, when a step's decisions do not all belong to
   * `DecidedStep.heroDefinition` — `pollCrew` (`NEGOTIATION_SPEC` §3.1) is the one
   * command that produces this shape, several heroes answering inside a single step.
   * `undefined` for every step every other command produces: `composeOffer`,
   * `proposeContractToHero` and `lockOffer` each answer at most one hero, already
   * named by `DecidedStep.heroDefinition`, and restating it per decision there would
   * just be a second place for that one fact to drift from itself.
   *
   * Lives on the decision, not on a second, parallel array of the step's own —
   * review of `DEC-008` Task 13 found that the array design let a short array
   * silently fall back to the step's single hero on the entries it didn't cover
   * (`undefined ?? heroDefinition`), which is exactly the misattribution the
   * per-decision hero exists to prevent, returned as a silent default instead of a
   * loud one. Carried on the decision itself, a short list is not expressible: there
   * is no index to under-run.
   *
   * Optional rather than replacing `heroDefinition` outright, or making this field
   * required: `StepOutcome` (`packages/content/src/scenarios/scenario-runner.ts`) is
   * `readonly DecidedStep[]`-assignable today only because its fields line up with
   * these, and its own `decisions: readonly DecisionResult[]` (`@oath-and-coin/
   * simulation`) mentions no such field at all. An optional addition costs that
   * nothing — a source type that never mentions an optional field is still
   * assignable to a target where the field may be missing — while a required one
   * would have forced `StepOutcome` and every builder of one (`scenario-runner.ts`,
   * `restore-steps.ts`) to supply a hero per decision too, which is `pollCrew`'s
   * wiring into `ScenarioCommand` — explicitly not this task's to do.
   */
  readonly heroDefinition?: ContentId;
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
  /**
   * Every decision this step's events explain, in the same order `StepOutcome.decisions`
   * carries them — empty for a rejected step. A decision whose own
   * {@link DecidedOutcome.heroDefinition} is set names its hero directly; one that
   * doesn't is answered by this step's own {@link heroDefinition} — see that field's
   * own doc for why the per-decision hero lives there and not in a second array here.
   */
  readonly decisions: readonly DecidedOutcome[];
}
