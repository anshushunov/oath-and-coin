import {
  CoverageVerdict,
  OfferPhase,
  OutcomeReasonCodes,
  forecastReadiness,
  resolutionInputFor,
  unitNamedBy,
  divideTowardZero,
  heroNamedBy,
  multiplyInt32,
  needReasonFor,
  termsOf,
  type CanonicalValue,
  type ContentId,
  type ContractResolution,
  type ContractState,
  type DomainEvent,
  type GameState,
  type HeroId,
  type HeroSufferedConsequence,
  type NeedId,
  type OfferState
} from '@oath-and-coin/simulation';

import { battleAmount, battleDetailKey, battleEventKey } from './battle-journal.ts';
import {
  AFTER_ACTION_TITLE_KEY,
  OutcomeEventKeys,
  battleOutcomeKey,
  commitmentStateKey,
  consequenceKindKey,
  contractDisplayNameKey,
  coverageVerdictKey,
  deficitKindKey,
  needKey,
  outcomeGradeKey,
  SettlementConsequenceKeys
} from './keys.ts';
import { ScreenKind } from './screen-kind.ts';
import { ScreenState } from './screen-state.ts';
import { definitionOfHero, treasuryAfterSettling } from './settlement-line.ts';

/**
 * The debrief: what the run cost, and what it bought (`RESOLUTION_SPEC` §6.1).
 *
 * **Built from the campaign and a contract id, never from the stored result alone.** The
 * chronology lives in `GameState.history` and one saved `ContractResolution` cannot
 * reconstruct it — the result says *what* came out, the log says *in what order it
 * happened*, and the screen shows both. So this factory selects this contract's outcome
 * events out of `history`, in the order `history` holds them, and joins them to the stored
 * result.
 *
 * **Two numbers per hero, and the second one is a sum** (`DEC-014`, `ADR-015`). `amount` is
 * what a man brought; `counted` is how much of it the needs actually received once §4.3's
 * halving had been applied. This layer never applies that halving: `counted` is stored per
 * `(hero, need)` — where the halving happens — so a hero's line is the *addition* of his
 * own shares, and addition is not a second statement of §4.3. Deriving `counted` here would
 * be: it would need `2^k` and the sort order of §4.3, in the layer least able to notice
 * either drifting.
 *
 * **Coverage is qualitative and the rest is not** (`RESOLUTION_SPEC` §6.1, `DEC-006`). A
 * verdict is an assessment of preparation, so it is three words and no number; a wound, a
 * margin and a deficit are facts that happened, and `GDD` §16.3 leaves those as numbers.
 */

/** One hero, named the one way a screen may name anybody (`TDD` §11.1). */
export interface AfterActionHeroLine {
  /** Bookkeeping — the id a caller joins on, never a label. */
  readonly definition: ContentId;
  readonly displayNameKey: string;
}

/**
 * One line of the outcome feed (`RESOLUTION_SPEC` §3.4, §6.1).
 *
 * `heroDefinition` and `heroDisplayNameKey` are `null` together and exactly when the event
 * names nobody — read from the engine's own `heroNamedBy` rather than decided here, so a
 * screen cannot be handed a culprit no event produced (§6.3: a game that must always name
 * one teaches the player to look for a scapegoat).
 */
export interface AfterActionEventLine {
  readonly key: string;
  readonly heroDefinition: ContentId | null;
  readonly heroDisplayNameKey: string | null;
  readonly needKey: string | null;
  readonly reasonKey: string;
}

/** What one hero brought, how much of it counted, and why the screen may say so. */
export interface AfterActionContributionLine {
  readonly heroDefinition: ContentId;
  readonly heroDisplayNameKey: string;
  /** §4.1 — what he brought, before §4.3's halving. */
  readonly amount: number;
  /** §4.3 — the sum of his own counted shares across every need. */
  readonly counted: number;
  readonly commitmentKey: string;
  readonly provenanceKeys: readonly string[];
}

/** One need, as three words and no number (`RESOLUTION_SPEC` §6.1). */
export interface AfterActionCoverageLine {
  readonly needKey: string;
  readonly verdictKey: string;
  /**
   * What the forecast promised about this need, before the crew was sent (`COMBAT_SPEC`
   * §10.3's "новым столбцом", §10.1).
   *
   * **A disagreement between the two columns is content, not a defect.** §10.1 says the
   * forecast is not a promise, and `ADR-016` §2 makes that measurable — the share of
   * objectives the two agree about has a declared corridor, because a forecast that always
   * agrees carries no information and one that never agrees is noise.
   *
   * **Recomputed rather than stored, and that is exact rather than approximate in M2.**
   * `ADR-016` §4 closes the result's growth at three items and a stored forecast is not one
   * of them; recomputing is only honest if nothing the forecast reads has moved since, and
   * nothing has — `capability.grade` and `combat` are copied at campaign start and no
   * command moves either (`hero-state.ts` says so of both), the commitment is recorded when
   * a hero answers and never recomputed, and the formation is on the package. What a battle
   * *does* move — wounds and retreats — is read by nothing. `after-action-battle.test.ts`
   * holds that equality rather than this comment.
   *
   * `null` on a contract that never went to a fight: there was no formation to forecast
   * from, and a column of the abstract resolver's own answer beside the abstract resolver's
   * own answer would be one number printed twice.
   */
  readonly forecastVerdictKey: string | null;
}

/**
 * The battle's own section of the debrief (`COMBAT_SPEC` §10.3's "новая секция").
 *
 * `null` on a contract the abstract resolver answered. The feed is the same journal the
 * battle screen shows, in the same order, because it is the same list — what changes is that
 * the fight is over, so all of it is on the page at once.
 */
export interface AfterActionBattleLine {
  readonly outcomeKey: string;
  readonly rounds: number;
  /** The round the player pulled them out at, or `null` if he never did (`DEC-005`). */
  readonly retreatSignalledAtRound: number | null;
  readonly feed: readonly AfterActionBattleEventLine[];
}

/** One line of the battle's feed. The same shape the battle screen's journal uses. */
export interface AfterActionBattleEventLine {
  readonly key: string;
  readonly heroDisplayNameKey: string | null;
  readonly detailKey: string | null;
  readonly amount: number | null;
  readonly round: number;
}

/** One diagnosis with its sources (`RESOLUTION_SPEC` §4.7, §6.1). */
export interface AfterActionDeficitLine {
  readonly key: string;
  readonly magnitude: number;
  readonly needKeys: readonly string[];
  readonly heroes: readonly AfterActionHeroLine[];
}

/**
 * What each answer to the promise does to people, as the sentences the screen owes each
 * branch (`NEGOTIATION_SPEC` §2.2, §3.3).
 *
 * **Its own line, `null` exactly when nothing was promised** — the same gate the offer
 * screen's `toPromiseTerms` applies, and for the engine's own reason: `settleContract`
 * ignores `pay` on a package promising nothing (`NEGOTIATION_SPEC` §6, "обид не
 * возникает"), so a branch named there would be named for a consequence that cannot happen.
 * One nullable line rather than two lists that could each be empty on their own: a screen
 * holding a kept branch with no matching broken one would be describing half a choice.
 *
 * Fixed keys and no magnitudes. Which grievance a break costs is
 * `grievanceForBrokenPromise`'s arithmetic at the moment the command applies, and a figure
 * quoted here would be a numeric forecast — the one thing `DEC-006` keeps qualitative.
 */
export interface AfterActionPromiseLine {
  readonly keepConsequenceKeys: readonly string[];
  readonly breakConsequenceKeys: readonly string[];
}

/**
 * The decision the debrief exists to put in front of the player: what keeping the guild's
 * word costs and what breaking it saves (`RESOLUTION_SPEC` §6.1's "блок расчёта обещания").
 *
 * **Its own shape rather than the offer screen's `SettlementLine`, for two reasons that are
 * not stylistic.** The offer screen names its key hero and its crew by raw `ContentId` and
 * joins the names off its own roster; this model carries no roster, so a component handed
 * one would have to show the id or reach into another section for it (`TDD` §11.1). And the
 * two lines answer different questions: over there it is a forecast of a settlement whose
 * grade does not exist yet, here it is the settlement §5.3 will actually perform — the same
 * arithmetic, on a patron's share the offer screen cannot know.
 *
 * `null` once the contract is settled. The money has moved and there is nothing left to
 * choose, so a block still offering two futures would be describing a decision the player
 * already made.
 */
export interface AfterActionSettlementLine {
  readonly promisedBonus: number;
  readonly keyHero: AfterActionHeroLine | null;
  /** The accepted crew, in the order the offer's `acceptedBy` holds them. */
  readonly crew: readonly AfterActionHeroLine[];
  /** What the patron pays for this outcome — `patronFee × patronFeePercent(grade) / 100`. */
  readonly patronPays: number;
  readonly treasuryIfKept: number;
  readonly treasuryIfBroken: number;
  /** What each branch costs beyond the purse; `null` when nothing was promised. */
  readonly promise: AfterActionPromiseLine | null;
}

/** What the outcome cost one person, and the reason it names (`RESOLUTION_SPEC` §5.2). */
export interface AfterActionConsequenceLine {
  readonly heroDefinition: ContentId;
  readonly heroDisplayNameKey: string;
  readonly kindKey: string;
  readonly reasonKey: string;
  readonly magnitude: number;
}

/** Everything the debrief needs, and nothing it would have to work out for itself. */
export interface AfterActionScreenModel {
  /** The union's discriminant, stamped by {@link createAfterActionScreenModel}. */
  readonly screen: typeof ScreenKind.AfterAction;
  readonly state: ScreenState;
  readonly titleKey: string;
  /**
   * The contract this debrief is about — its id for the caller that dispatches
   * `settleContract` against it, and its key for the header. `null` exactly on the three
   * states with no outcome behind them.
   */
  readonly contractDefinition: ContentId | null;
  readonly contractDisplayNameKey: string | null;
  /** The step the outcome landed on (§4.6); `null` where {@link contractDefinition} is. */
  readonly gradeKey: string | null;
  readonly events: readonly AfterActionEventLine[];
  readonly contributions: readonly AfterActionContributionLine[];
  readonly coverage: readonly AfterActionCoverageLine[];
  /** The fight this contract went to, or `null` when it went to none (§10.3). */
  readonly battle: AfterActionBattleLine | null;
  readonly deficits: readonly AfterActionDeficitLine[];
  /** `null` when no deficit leads clearly enough to be called the reason (§4.7). */
  readonly dominantKey: string | null;
  readonly consequences: readonly AfterActionConsequenceLine[];
  readonly settlement: AfterActionSettlementLine | null;
  readonly errorCode: string | null;
  /**
   * The human-readable half of an error. Outside every hash, for the reason
   * `ContractOfferScreenModel.errorDetail` is: it can carry a machine-specific path and
   * differs between runs of the same failure.
   */
  readonly errorDetail: string | null;
}

/**
 * Builds a model, refusing every combination that would make it lie — the same gate
 * `createContractOfferScreenModel` is, and for the same reason its own comment records: a
 * TypeScript spread walks around a factory function, so `{ ...LOADING, state: 'Normal' }`
 * typechecks and would otherwise hash, render and be published as a debrief of nothing.
 */
export type AfterActionScreenContent = Omit<AfterActionScreenModel, 'screen'>;

export function createAfterActionScreenModel(
  model: AfterActionScreenContent
): AfterActionScreenModel {
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

      requireNoOutcome(model);
      break;

    case ScreenState.Loading:
    case ScreenState.Empty:
      if (model.errorCode !== null) {
        throw new Error(`errorCode must be null when state is ${model.state}.`);
      }

      requireNoOutcome(model);
      break;

    case ScreenState.Incomplete:
    case ScreenState.Normal:
      if (model.errorCode !== null) {
        throw new Error(`errorCode must be null when state is ${model.state}.`);
      }

      if (
        model.contractDefinition === null ||
        model.contractDisplayNameKey === null ||
        model.gradeKey === null
      ) {
        throw new Error(
          `contractDefinition, contractDisplayNameKey and gradeKey must all be set when state ` +
            `is ${model.state}: a debrief names the contract it is about and the step it landed ` +
            'on, or it is a debrief of nothing.'
        );
      }

      break;

    default:
      throw new Error(`Unknown screen state '${String(model.state)}'.`);
  }

  for (const line of model.events) {
    if ((line.heroDefinition === null) !== (line.heroDisplayNameKey === null)) {
      throw new Error(
        `Event line '${line.key}' carries half a hero: an event names somebody under both an id ` +
          'and a key, or under neither. A line with an id and no key is one the screen cannot ' +
          'label without showing the id itself.'
      );
    }
  }

  return { ...model, screen: ScreenKind.AfterAction };
}

function requireNoOutcome(model: AfterActionScreenContent): void {
  if (
    model.contractDefinition !== null ||
    model.contractDisplayNameKey !== null ||
    model.gradeKey !== null ||
    model.events.length > 0 ||
    model.contributions.length > 0 ||
    model.coverage.length > 0 ||
    model.battle !== null ||
    model.deficits.length > 0 ||
    model.dominantKey !== null ||
    model.consequences.length > 0 ||
    model.settlement !== null
  ) {
    throw new Error(
      `A ${model.state} debrief must carry no outcome at all: there is nothing to debrief, so a ` +
        'grade, a feed or a settlement on it belongs to some other contract.'
    );
  }
}

const NOTHING_TO_DEBRIEF = {
  titleKey: AFTER_ACTION_TITLE_KEY,
  contractDefinition: null,
  contractDisplayNameKey: null,
  gradeKey: null,
  events: [],
  contributions: [],
  coverage: [],
  battle: null,
  deficits: [],
  dominantKey: null,
  consequences: [],
  settlement: null
} as const;

/**
 * The debrief before there is an outcome to build one from — the one state
 * {@link afterActionScreenModel} never produces.
 *
 * Stated once here rather than hand-written by each side that needs it, for the reason
 * `LOADING_SCREEN` records: two hand-written copies of one value is a drift this
 * repository has already paid for.
 */
export const AFTER_ACTION_LOADING_SCREEN: AfterActionScreenModel = createAfterActionScreenModel({
  ...NOTHING_TO_DEBRIEF,
  state: ScreenState.Loading,
  errorCode: null,
  errorDetail: null
});

/** The debrief for a run that never reached a campaign at all. */
export function afterActionFailedScreen(
  errorCode: string,
  errorDetail: string
): AfterActionScreenModel {
  if (errorCode.length === 0) {
    throw new Error('errorCode must not be empty: an error screen has to name what failed.');
  }

  if (errorDetail.length === 0) {
    throw new Error('errorDetail must not be empty: an error nobody can act on is not a report.');
  }

  return createAfterActionScreenModel({
    ...NOTHING_TO_DEBRIEF,
    state: ScreenState.Error,
    errorCode,
    errorDetail
  });
}

/**
 * The debrief for `contractId` in `state` (`RESOLUTION_SPEC` §6.1).
 *
 * `Empty` when the contract carries no resolution — the crew has not come back, so there
 * is nothing to debrief. `Incomplete` while the promise has not been answered: the outcome
 * is known and its price is not, which is the moment §6.4 sends a player here for.
 * `Normal` once the contract is settled and both halves are on the screen.
 *
 * **Owner's decision of 2026-08-27.** External review asked whether calling the screen §6.4
 * routes a player *to* "incomplete" contradicts `AGENTS.md` §7's "incomplete information",
 * and proposed calling every built debrief `Normal` instead. The owner kept this reading:
 * what is incomplete is this contract's story, and the promise is the half still missing
 * from it. The same argument `saveSlotsStateKey`'s own comment makes applies — the five
 * words are the same five on every screen and the sentences are not, which is why each
 * screen owns its own state texts rather than sharing one.
 *
 * @throws when `contractId` names a contract the campaign does not carry — a routing bug,
 * not a contract with no outcome, and the same refusal the offer factory already makes.
 */
export function afterActionScreenModel(
  state: GameState,
  contractId: ContentId
): AfterActionScreenModel {
  const contract = state.contracts.get(contractId);

  if (contract === undefined) {
    throw new Error(
      `A debrief was asked for contract '${contractId}', but the campaign it was built from has ` +
        'no such contract — a routing bug, not a contract with no outcome.'
    );
  }

  const { resolution } = contract;

  if (resolution === null) {
    return createAfterActionScreenModel({
      ...NOTHING_TO_DEBRIEF,
      state: ScreenState.Empty,
      errorCode: null,
      errorDetail: null
    });
  }

  // What the forecast said about each need, or an empty map on a contract that never fought.
  const promised = forecastOf(state, contract);

  const heroes = [...state.heroes.values()];
  const definitions = new Map(heroes.map((hero) => [hero.id, hero.definition]));
  const displayNameKeys = new Map(heroes.map((hero) => [hero.definition, hero.displayNameKey]));
  const named = (heroId: HeroId): AfterActionHeroLine => {
    const definition = definitionOfHero(heroId, definitions);

    return { definition, displayNameKey: displayNameKeyOf(definition, displayNameKeys) };
  };

  return createAfterActionScreenModel({
    // The promise is what is still owed here, never the outcome — that is complete the
    // moment `resolveContract` applies. A screen that called a resolved-but-unsettled
    // contract Normal would say the campaign had finished telling this contract's story
    // while the one decision the whole loop is about was still unanswered.
    state:
      contract.offer.phase === OfferPhase.Settled ? ScreenState.Normal : ScreenState.Incomplete,
    titleKey: AFTER_ACTION_TITLE_KEY,
    contractDefinition: contract.id,
    contractDisplayNameKey: contractDisplayNameKey(contract.id),
    gradeKey: outcomeGradeKey(resolution.grade),
    events: eventLinesOf(state, contract, resolution, named),
    contributions: contributionLinesOf(resolution, named),
    coverage: resolution.coverage.map((row) => ({
      needKey: needKey(row.need),
      verdictKey: coverageVerdictKey(row.verdict),
      forecastVerdictKey:
        promised.get(row.need) === undefined ? null : coverageVerdictKey(promised.get(row.need)!)
    })),
    battle: battleLineOf(resolution, named),
    deficits: resolution.deficits.map((deficit) => ({
      key: deficitKindKey(deficit.kind),
      magnitude: deficit.magnitude,
      needKeys: deficit.needs.map(needKey),
      heroes: deficit.heroes.map(named)
    })),
    dominantKey: resolution.dominant === null ? null : deficitKindKey(resolution.dominant),
    consequences: resolution.consequences.map((consequence) => {
      const hero = named(consequence.hero);

      return {
        heroDefinition: hero.definition,
        heroDisplayNameKey: hero.displayNameKey,
        kindKey: consequenceKindKey(consequence.kind),
        reasonKey: consequence.reason,
        magnitude: consequence.magnitude
      };
    }),
    settlement: settlementDecisionOf(contract, resolution, state.treasury, named),
    errorCode: null,
    errorDetail: null
  });
}

/**
 * The promise still to be answered, priced by `settleContract`'s own formula
 * (`RESOLUTION_SPEC` §5.3, `NEGOTIATION_SPEC` §3.3).
 *
 * The patron's share follows the step the outcome landed on — the whole fee for a job done,
 * `PARTIAL_FEE_PERCENT` for one survived, nothing for a catastrophe — truncated toward zero
 * like every division in this system. The advance and the bonus are unchanged by the grade,
 * which is §5.3's own point: what the guild owes its people is not a function of how the job
 * went.
 *
 * `null` once the contract is settled: the money has already moved, and a block projecting
 * a treasury from the post-settlement one would count the same payment twice.
 */
function settlementDecisionOf(
  contract: ContractState,
  resolution: ContractResolution,
  treasury: number,
  named: (heroId: HeroId) => AfterActionHeroLine
): AfterActionSettlementLine | null {
  const { offer } = contract;

  if (offer.phase === OfferPhase.Settled) {
    return null;
  }

  const patronPays = divideTowardZero(
    multiplyInt32(contract.patronFee, termsOf(resolution.grade).patronFeePercent),
    100
  );
  const treasuryIfKept = treasuryAfterSettling(treasury, contract, patronPays);

  return {
    promisedBonus: offer.promisedBonus,
    keyHero: offer.keyHero === null ? null : named(offer.keyHero),
    crew: offer.acceptedBy.values().map(named),
    patronPays,
    treasuryIfKept,
    // The same formula with `pay: false`, which skips the bonus term rather than computing
    // it a second, independent way.
    treasuryIfBroken: treasuryIfKept + offer.promisedBonus,
    promise: promiseOf(offer)
  };
}

/**
 * What the two answers cost beyond the money, or `null` on a package that promised nothing.
 *
 * `promisedBonus <= 0` rather than `=== 0`, matching `toPromiseTerms`'s own test: the two
 * gates answer the same question on the same field, and a pair of nearly-identical
 * comparisons is where they start to differ.
 */
function promiseOf(offer: OfferState): AfterActionPromiseLine | null {
  if (offer.promisedBonus <= 0) {
    return null;
  }

  return {
    keepConsequenceKeys: [SettlementConsequenceKeys.Kept],
    // Two sentences because a break does two things to the key hero: he carries a grievance
    // — and so does everyone who was in the crew to see it — and he stops believing the
    // guild's word at all, which is the lever `composeOffer` will no longer be able to pull
    // on him (`applyBrokenPromise`).
    breakConsequenceKeys: [
      SettlementConsequenceKeys.BrokenGrievance,
      SettlementConsequenceKeys.BrokenDisbelief
    ]
  };
}

function displayNameKeyOf(
  definition: ContentId,
  displayNameKeys: ReadonlyMap<ContentId, string>
): string {
  const key = displayNameKeys.get(definition);

  if (key === undefined) {
    throw new Error(
      `An outcome names hero '${definition}', but the campaign this debrief was built from has ` +
        'no display-name key for it — a content-loading or roster-building bug, not a hero with ' +
        'no name.'
    );
  }

  return key;
}

/**
 * This contract's outcome events, in the order `history` holds them.
 *
 * The order is `history`'s and not the resolution's, and the difference is observable: a
 * campaign that resolved two contracts holds both runs' events interleaved by nothing but
 * time, and a feed rebuilt from `ContractResolution` would have no order to rebuild at all.
 */

/**
 * What the forecast promised, per need — recomputed from the campaign as it stands.
 *
 * Empty on a contract that never went to a fight: `forecastReadiness` without a formation is
 * the abstract resolver's own answer, and printing it beside the abstract resolver's own
 * answer would be one number in two columns.
 *
 * The retreat round is taken from the record rather than assumed away. It reaches the
 * forecast's input only through the deployment, and the forecast reads no part of it that
 * moves — but handing the input a `null` where the fight had a signal would be building a
 * slightly different plan than the one that was fought, which is the kind of small lie a
 * column headed "what was promised" cannot afford.
 */
function forecastOf(
  state: GameState,
  contract: ContractState
): ReadonlyMap<NeedId, CoverageVerdict> {
  if (contract.battle === null || contract.offer.deployment === null) {
    return new Map();
  }

  const forecast = forecastReadiness(
    resolutionInputFor(
      state,
      contract,
      contract.resolution?.battle?.retreatSignalledAtRound ?? null
    )
  );

  return new Map(forecast.objectives.map((one) => [one.need, one.verdict]));
}

/** The battle's section, or `null` on a contract the abstract resolver answered. */
function battleLineOf(
  resolution: ContractResolution,
  named: (heroId: HeroId) => AfterActionHeroLine
): AfterActionBattleLine | null {
  const record = resolution.battle;

  if (record === null) {
    return null;
  }

  const heroOfUnit = new Map(
    record.initial.units.flatMap((unit) => (unit.hero === null ? [] : [[unit.id, unit.hero]]))
  );

  let round = record.initial.round;

  return {
    outcomeKey: battleOutcomeKey(record.outcome),
    rounds: record.rounds,
    retreatSignalledAtRound: record.retreatSignalledAtRound,
    feed: record.events.map((event) => {
      if (event.kind === 'round_started' || event.kind === 'round_ended') {
        round = event.round;
      }

      const unit = unitNamedBy(event);
      const hero = unit === null ? undefined : heroOfUnit.get(unit);

      return {
        key: battleEventKey(event),
        heroDisplayNameKey: hero === undefined ? null : named(hero).displayNameKey,
        detailKey: battleDetailKey(event),
        amount: battleAmount(event),
        round
      };
    })
  };
}

function eventLinesOf(
  state: GameState,
  contract: ContractState,
  resolution: ContractResolution,
  named: (heroId: HeroId) => AfterActionHeroLine
): readonly AfterActionEventLine[] {
  return state.history.flatMap((event) => {
    if (event.contractId !== contract.id) {
      return [];
    }

    const line = outcomeLineOf(event, resolution);
    if (line === null) {
      return [];
    }

    // Who the event names is the engine's own answer (`heroNamedBy`), never this layer's:
    // a debrief may name a person exactly where something happened to them.
    const heroId = heroNamedBy(event);
    const hero = heroId === null ? null : named(heroId);

    return [
      {
        key: line.key,
        heroDefinition: hero?.definition ?? null,
        heroDisplayNameKey: hero?.displayNameKey ?? null,
        needKey: line.need === null ? null : needKey(line.need),
        reasonKey: line.reason
      }
    ];
  });
}

/**
 * What one outcome event is called and what it says, or `null` for an event that is not
 * part of a resolution at all.
 *
 * **An exhaustive `switch` answering positively, and that shape is the point.** Three
 * places in this repository once read an event as `kind !== 'a' && kind !== 'b'`, and seven
 * new kinds walked straight through all of them. Written this way, a fifteenth kind does
 * not build until somebody decides whether a debrief is where it belongs.
 *
 * **No reason is invented here.** A coverage line takes `needReasonFor` — the resolver's
 * own mapping, exported rather than copied; a consequence takes the code the stored result
 * already recorded; the closing line takes the objective's own code, which is what
 * `ADR-015` decided it carries.
 */
function outcomeLineOf(
  event: DomainEvent,
  resolution: ContractResolution
): { readonly key: string; readonly need: NeedId | null; readonly reason: string } | null {
  switch (event.kind) {
    case 'need_covered':
      return {
        key: OutcomeEventKeys.NeedCovered,
        need: event.need,
        reason: needReasonFor(event.verdict)
      };
    case 'need_short':
      return {
        key: OutcomeEventKeys.NeedShort,
        need: event.need,
        reason: needReasonFor(event.verdict)
      };
    case 'hero_faltered_early':
      return {
        key: OutcomeEventKeys.HeroFalteredEarly,
        need: event.need,
        reason: OutcomeReasonCodes.FalteredEarly
      };
    case 'objective_taken':
      return {
        key: OutcomeEventKeys.ObjectiveTaken,
        need: null,
        reason: OutcomeReasonCodes.ObjectiveTaken
      };
    case 'objective_lost':
      return {
        key: OutcomeEventKeys.ObjectiveLost,
        need: null,
        reason: OutcomeReasonCodes.ObjectiveLost
      };
    case 'hero_suffered_consequence':
      return {
        key: OutcomeEventKeys.HeroSufferedConsequence,
        need: null,
        reason: recordedReasonFor(event, resolution)
      };
    case 'contract_resolved':
      return {
        key: OutcomeEventKeys.ContractResolved,
        need: null,
        // `ADR-015`: the closing intent carries the objective's own code, and the grade is
        // what says which of the two — the same reading, off the event's own field.
        reason: termsOf(event.grade).objectiveTaken
          ? OutcomeReasonCodes.ObjectiveTaken
          : OutcomeReasonCodes.ObjectiveLost
      };
    // `crew_placed` is among these, and deliberately: placing the crew is a decision taken
    // before the fight, not a line of what the fight cost. The debrief shows the formation
    // in its own section (`COMBAT_SPEC` §10.3) rather than in the chronology of the outcome.
    case 'hero_accepted_contract':
    case 'hero_declined_contract':
    case 'offer_revised':
    case 'offer_locked':
    case 'crew_placed':
    case 'contract_settled':
    case 'contract_settled_promise_kept':
    case 'contract_settled_promise_broken':
      return null;
  }
}

/**
 * The reason the stored result recorded for this consequence — looked up, never derived.
 *
 * `(hero, kind)` identifies it: §5.1 allows at most one record of each kind per outcome, so
 * a wound and a grudge falling on the same man are still two distinct rows.
 */
function recordedReasonFor(event: HeroSufferedConsequence, resolution: ContractResolution): string {
  const recorded = resolution.consequences.find(
    (consequence) => consequence.hero === event.heroId && consequence.kind === event.consequence
  );

  if (recorded === undefined) {
    throw new Error(
      `The log records a '${event.consequence}' for hero#${String(event.heroId)} on contract ` +
        `'${event.contractId}', but the stored resolution has no such consequence — the file ` +
        'disagrees with itself.'
    );
  }

  return recorded.reason;
}

/**
 * One line per member of the crew, with both of `DEC-014`'s numbers.
 *
 * `counted` is added up out of `coverage`, which is where §4.3 put it, and is deliberately
 * not a second field on `HeroContribution`: one number living in two places is one number
 * that can disagree with itself (`ADR-015`).
 */
function contributionLinesOf(
  resolution: ContractResolution,
  named: (heroId: HeroId) => AfterActionHeroLine
): readonly AfterActionContributionLine[] {
  return resolution.contributions.entries().map(([heroId, contribution]) => {
    const hero = named(heroId);

    return {
      heroDefinition: hero.definition,
      heroDisplayNameKey: hero.displayNameKey,
      amount: contribution.amount,
      counted: countedBy(resolution, heroId),
      commitmentKey: commitmentStateKey(contribution.commitment),
      provenanceKeys: [...contribution.provenance]
    };
  });
}

function countedBy(resolution: ContractResolution, heroId: HeroId): number {
  return resolution.coverage.reduce(
    (sum, row) =>
      sum + (row.contributors.find((contributor) => contributor.hero === heroId)?.counted ?? 0),
    0
  );
}

/**
 * The canonical projection of a debrief, for the read-model hash (`screen-model.ts`).
 *
 * Every field a player can see except `errorDetail`, and including the screen's own name
 * and the state — the same two exclusions and the same two inclusions the offer screen's
 * projection makes, for the reasons its own comment records.
 *
 * Re-validated here, not trusted: a TypeScript spread walks around the factory, and this is
 * one of the two places a model becomes evidence about a screen.
 */
export function describeAfterActionReadModel(model: AfterActionScreenModel): CanonicalValue {
  const validated = createAfterActionScreenModel(model);

  return {
    screen: validated.screen,
    state: validated.state,
    title_key: validated.titleKey,
    error_code: validated.errorCode,
    contract_definition: validated.contractDefinition,
    contract_display_name_key: validated.contractDisplayNameKey,
    grade_key: validated.gradeKey,
    events: validated.events.map((line) => ({
      key: line.key,
      hero_definition: line.heroDefinition,
      hero_display_name_key: line.heroDisplayNameKey,
      need_key: line.needKey,
      reason_key: line.reasonKey
    })),
    contributions: validated.contributions.map((line) => ({
      hero_definition: line.heroDefinition,
      hero_display_name_key: line.heroDisplayNameKey,
      amount: line.amount,
      counted: line.counted,
      commitment_key: line.commitmentKey,
      provenance_keys: [...line.provenanceKeys]
    })),
    coverage: validated.coverage.map((line) => ({
      need_key: line.needKey,
      verdict_key: line.verdictKey,
      forecast_verdict_key: line.forecastVerdictKey
    })),
    battle:
      validated.battle === null
        ? null
        : {
            outcome_key: validated.battle.outcomeKey,
            rounds: validated.battle.rounds,
            retreat_signalled_at_round: validated.battle.retreatSignalledAtRound,
            feed: validated.battle.feed.map((line) => ({
              key: line.key,
              hero_display_name_key: line.heroDisplayNameKey,
              detail_key: line.detailKey,
              amount: line.amount,
              round: line.round
            }))
          },
    deficits: validated.deficits.map((line) => ({
      key: line.key,
      magnitude: line.magnitude,
      need_keys: [...line.needKeys],
      heroes: line.heroes.map(describeHeroLine)
    })),
    dominant_key: validated.dominantKey,
    consequences: validated.consequences.map((line) => ({
      hero_definition: line.heroDefinition,
      hero_display_name_key: line.heroDisplayNameKey,
      kind_key: line.kindKey,
      reason_key: line.reasonKey,
      magnitude: line.magnitude
    })),
    settlement:
      validated.settlement === null
        ? null
        : {
            promised_bonus: validated.settlement.promisedBonus,
            key_hero:
              validated.settlement.keyHero === null
                ? null
                : describeHeroLine(validated.settlement.keyHero),
            crew: validated.settlement.crew.map(describeHeroLine),
            patron_pays: validated.settlement.patronPays,
            treasury_if_kept: validated.settlement.treasuryIfKept,
            treasury_if_broken: validated.settlement.treasuryIfBroken,
            promise:
              validated.settlement.promise === null
                ? null
                : {
                    keep_consequence_keys: [...validated.settlement.promise.keepConsequenceKeys],
                    break_consequence_keys: [...validated.settlement.promise.breakConsequenceKeys]
                  }
          }
  };
}

function describeHeroLine(hero: AfterActionHeroLine): CanonicalValue {
  return { definition: hero.definition, display_name_key: hero.displayNameKey };
}
