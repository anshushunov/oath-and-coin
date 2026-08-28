import {
  Actions,
  ContractStatus,
  OfferPhase,
  ReasonCodes,
  commitmentOf,
  compareContentIds,
  compareStrings,
  divideTowardZero,
  reservedCommitments,
  type CanonicalValue,
  type ContentId,
  type ContractState,
  type GameState,
  type HeldTrait,
  type HeroId,
  type HeroState,
  type OfferState,
  type SortedMap,
  type TraceFactor
} from '@oath-and-coin/simulation';

import {
  LeverDisabledKeys,
  PromiseTermsKeys,
  TITLE_KEY,
  contractDisplayNameKey,
  tagKey,
  traitDisplayNameKey
} from './keys.ts';
import type { ChoiceLever, ChoiceOption, NumericLever, OfferBudget } from './lever.ts';
import {
  createContractOfferScreenModel,
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
import { gradeForMagnitude, gradeForValue } from './qualitative-scale.ts';
import { ReasonDirection, ScreenState } from './screen-state.ts';
import { definitionOfHero, settlementLineFor, treasuryAfterSettling } from './settlement-line.ts';

/**
 * How many reasons a response line shows at most: an explanation a player can hold in
 * mind, not the whole trace dumped verbatim. Applied after ranking, so the ones shown
 * are always the strongest of the side they were allotted to.
 */
const MAX_REASONS = 3;

/**
 * How many of {@link MAX_REASONS} belong to reasons that supported the answer the hero
 * actually gave, whenever that many exist. The remainder is what a counter-argument
 * may take.
 *
 * External review of the C# original found what ranking every factor together costs.
 * On entirely legal data a hero accepts at +3 while risk (−30), insult (−29) and a
 * dislike (−28) are the three largest magnitudes in the trace — so the screen showed
 * three reasons to refuse beneath the word "accepted" and hid the patron fee, the
 * convictions and the trust that actually carried it. A majority of the slots
 * therefore goes to the side that won, which buys two properties: a supporting reason
 * is always visible when one exists, and a win carried by several smaller motives
 * against fewer larger ones cannot vanish behind the ones it beat. One slot is
 * deliberately left for the strongest opposing motive — "took it anyway, despite the
 * risk" is the sentence this screen is for.
 */
const MIN_SUPPORTING_REASONS = 2;

/**
 * Reason codes whose source is always a trait id — the decision rule's own
 * inclination walk never puts anything else there.
 */
const TRAIT_SOURCED_REASON_CODES: ReadonlySet<string> = new Set([
  ReasonCodes.PersonalConviction,
  ReasonCodes.PersonalAversion
]);

/**
 * Reason codes whose source is always a comrade — a different hero, never the one
 * answering. The rule resolves them through the crew, which it never lets hold anyone
 * absent from the roster.
 */
const COMRADE_SOURCED_REASON_CODES: ReadonlySet<string> = new Set([
  ReasonCodes.StandsWithComrade,
  ReasonCodes.WillNotWorkWith
]);

/**
 * The screen shown before there is an outcome to build one from — the one state
 * {@link contractOfferScreenModel} never produces.
 *
 * Stated once, here, rather than hand-written by each side that needs it. The C#
 * original had it written out twice, in the game host and again in the harness's own
 * expectation, and two hand-written copies of one value is the drift this repository
 * has already paid for once.
 */
export const LOADING_SCREEN: ContractOfferScreenModel = createContractOfferScreenModel({
  state: ScreenState.Loading,
  titleKey: TITLE_KEY,
  contract: null,
  roster: [],
  responses: [],
  errorCode: null,
  errorDetail: null,
  treasury: 0,
  offer: null,
  treasuryForecast: 0,
  promiseTerms: null,
  settlement: null
});

/**
 * Builds the screen for a run that never reached a contract to offer at all — content
 * failed to load, a scenario file was malformed, or similar.
 */
export function failedScreen(errorCode: string, errorDetail: string): ContractOfferScreenModel {
  if (errorCode.length === 0) {
    throw new Error('errorCode must not be empty: an error screen has to name what failed.');
  }

  if (errorDetail.length === 0) {
    throw new Error('errorDetail must not be empty: an error nobody can act on is not a report.');
  }

  return createContractOfferScreenModel({
    state: ScreenState.Error,
    titleKey: TITLE_KEY,
    contract: null,
    roster: [],
    responses: [],
    errorCode,
    errorDetail,
    treasury: 0,
    offer: null,
    treasuryForecast: 0,
    promiseTerms: null,
    settlement: null
  });
}

/**
 * Builds the screen from a completed run.
 *
 * This screen represents one contract's offer at a time. Which contract: the one the
 * first step referenced when there is one; with no steps at all — nobody has been
 * offered anything yet, but the content set still has contracts — the
 * lexicographically first, since that map is already sorted for exactly this kind of
 * deterministic fallback.
 *
 * Responses are then filtered to steps that answered *that* contract specifically: a
 * run that offered a second contract to other heroes must not leak their answers onto
 * this screen. Completeness is read from the contract's own deduplicated
 * `respondedBy`, not from how many response lines the filter happened to keep, which
 * would double-count a hero appearing in more than one step.
 *
 * `focusedContract` names that contract outright, for the caller who already knows which
 * screen is being drawn — a session reopened from a save, where the steps are rebuilt
 * from history and history holds no rejected step at all, so "the contract the first step
 * named" is not the same question there as it is after a live run. Optional rather than
 * required: without it the rule above is exactly what it was, and every existing caller —
 * including corpus parity — keeps its own answer unchanged.
 *
 * **The corpus does not distinguish the argument, and two hand-made inputs do.** On the
 * frozen corpus it is degenerate: measured over all 50 entries that reached a state, none
 * has a rejected first step and none has a `read_model.contract` differing from the
 * contract of its first applied step, so `tests/oracle/src/restored-read-model.test.ts`
 * passes with this parameter ignored. The two cases that redden when it is ignored are
 * `contract-offer-screen-model-factory.test.ts`'s "is the one the caller named, over the
 * lexicographically first fallback" and "…over the contract the first step answered"
 * (Task 16.8). The round trip through a real envelope is `session-controller.test.ts`'s
 * "is the screen that was on it when the only step was rejected", which is what already
 * held this argument up from one layer above, in another package's suite. Written down
 * because segment 4 already paid for the opposite habit — a comment that declared a check
 * to exist before it did.
 */
export function contractOfferScreenModel(
  state: GameState,
  steps: readonly DecidedStep[],
  focusedContract?: ContentId
): ContractOfferScreenModel {
  // Both halves of the spec's rule for this state: nothing to offer, or nobody to
  // offer it to. The C# original implemented only the first, so a campaign with
  // contracts and an empty roster fell through to the path below, where
  // `respondedBy.size >= roster.length` reads 0 >= 0 and reported Normal — a screen
  // telling the player everyone had answered, above an empty table.
  if (state.contracts.size === 0 || state.heroes.size === 0) {
    return createContractOfferScreenModel({
      state: ScreenState.Empty,
      titleKey: TITLE_KEY,
      contract: null,
      roster: [],
      responses: [],
      errorCode: null,
      errorDetail: null,
      // A real campaign, just one with nothing to offer — unlike Loading and Error,
      // where there is no state to read a figure off at all.
      treasury: state.treasury,
      offer: null,
      treasuryForecast: state.treasury,
      promiseTerms: null,
      settlement: null
    });
  }

  const contract = resolveContract(state, steps, focusedContract);
  const heroes = [...state.heroes.values()];
  const roster = heroes.map((hero) => toHeroCard(hero, state.traitRules));

  // A response line carries no display key of its own — hero state has one, a step
  // does not — so it is joined here, by the hero's own definition, against the same
  // roster this factory already built.
  const heroDisplayNameKeys = new Map(heroes.map((hero) => [hero.definition, hero.displayNameKey]));
  // The offer and the settlement name their key hero and their crew by `HeroId`
  // (`OfferState.keyHero`, `OfferState.acceptedBy`), not by content id — this is the
  // second join a hero needs, from the number the engine tracks answers by back to the
  // definition the rest of the screen already shows.
  const heroDefinitionByHeroId = new Map(heroes.map((hero) => [hero.id, hero.definition]));

  const responses = steps
    .filter((step) => step.command.contract === contract.id)
    .flatMap((step) =>
      step.decisions.map((decision) => toResponseLine(step, decision, heroDisplayNameKeys))
    );

  return createContractOfferScreenModel({
    // "Everyone who was going to answer has" — measured against the crew the package
    // invited, not against the whole roster (`DEC-012` as amended 2026-08-25,
    // `RESOLUTION_SPEC` §8). A roster-sized comparison stopped being the right question
    // the moment the crew became part of the package: heroes nobody invited will never
    // answer, so a screen waiting for them waits forever.
    //
    // An uncomposed offer invites nobody, and `0 >= 0` would call that Normal — the
    // exact shape of the empty-roster defect the guard above records. So an offer with
    // no crew yet is Incomplete: nobody has been asked, which is the opposite of
    // everybody having answered.
    state:
      contract.offer.invited.size > 0 &&
      contract.offer.respondedBy.size >= contract.offer.invited.size
        ? ScreenState.Normal
        : ScreenState.Incomplete,
    titleKey: TITLE_KEY,
    contract: toContractLine(contract),
    roster,
    responses,
    errorCode: null,
    errorDetail: null,
    treasury: state.treasury,
    offer: toOfferLine(state, contract, heroes, heroDefinitionByHeroId),
    // The whole fee, deliberately: this screen forecasts a settlement whose grade does not
    // exist yet (`RESOLUTION_SPEC` §5.3 sets the share from the outcome), and the price a
    // player is weighing while composing a package is what the job pays when it is done.
    // The debrief, which knows the grade, passes the share instead.
    treasuryForecast: treasuryAfterSettling(state.treasury, contract, contract.patronFee),
    promiseTerms: toPromiseTerms(contract.offer),
    settlement: settlementLineFor(
      contract,
      state.treasury,
      contract.patronFee,
      heroDefinitionByHeroId
    )
  });
}

/**
 * Which contract a screen built from `state` and `steps` is about.
 *
 * Named outright when the caller knows; otherwise the contract the first step answered;
 * otherwise — nothing has been offered yet — the lexicographically first, since the map is
 * already sorted and the fallback is deterministic rather than "whichever came out first".
 * `null` only for a campaign with no contracts at all, which is the `Empty` screen.
 *
 * **Exported because the session has to agree with it.** `SessionState.focusedContract` is
 * what a save writes and what `focus` moves, and it used to be worked out separately — which
 * left a real gap on a run that applied no step: the screen fell back to the campaign's first
 * contract while the session said there was no focus at all, so a save from that screen wrote
 * nothing (`ADR-006` requires the file to carry the contract the player was looking at).
 * External review of this task found it. One statement, two readers.
 */
export function focusedContractOf(
  state: GameState,
  steps: readonly DecidedStep[],
  focusedContract?: ContentId
): ContentId | null {
  return focusedContract ?? steps[0]?.command.contract ?? state.contracts.keys()[0] ?? null;
}

function resolveContract(
  state: GameState,
  steps: readonly DecidedStep[],
  focusedContract: ContentId | undefined
): ContractState {
  const contractId = focusedContractOf(state, steps, focusedContract);
  const contract = contractId === null ? undefined : state.contracts.get(contractId);

  if (contract === undefined) {
    throw new Error(
      `A step named contract '${String(contractId)}', but the state this screen was built from ` +
        'has no such contract — a scenario-running bug, not a contract with no terms.'
    );
  }

  return contract;
}

function toContractLine(contract: ContractState): ContractLine {
  return {
    definition: contract.id,
    displayNameKey: contractDisplayNameKey(contract.id),
    patronFee: contract.patronFee,
    risk: gradeForValue(contract.risk),
    tagKeys: [...contract.tags.values()].map(tagKey),
    requiredCrew: contract.requiredCrew,
    acceptedCount: contract.offer.acceptedBy.size
  };
}

/**
 * The negotiation package currently on {@link contract} (`NEGOTIATION_SPEC` §5.1), with
 * every term stated as a lever a player may or may not move.
 *
 * `methodLever.options` puts the chosen tag first when one is chosen, the alternative
 * second — the order the player made a choice in, and the one `contract-offer-screen-
 * model-factory.test.ts` pins. Natural `SortedSet` order is not it: `method:deception`
 * sorts ordinally before `method:open` regardless of which one the package picked, so a
 * plain iteration would silently reorder itself out from under whichever tag the player
 * actually chose. Sorted order otherwise, when nothing has been chosen yet — there is no
 * "the chosen one" to lead with.
 *
 * The roster's own order — `HeroId`, the order `GameState.heroes` is sorted in — is what
 * the hero levers offer, because it is the order the roster is already drawn in and
 * because it is the order `pollCrew` asks in (`NEGOTIATION_SPEC` §3.3).
 */
function toOfferLine(
  state: GameState,
  contract: ContractState,
  heroes: readonly HeroState[],
  heroDefinitionByHeroId: ReadonlyMap<HeroId, ContentId>
): OfferLine {
  const { offer } = contract;
  const budget = budgetFor(state, contract);
  const disabledReasonKey = leverDisabledReasonKey(contract);
  const heroOptions = heroes.map((hero): ChoiceOption<ContentId> => ({
    value: hero.definition,
    labelKey: hero.displayNameKey
  }));

  return {
    version: offer.version,
    phase: offer.phase,
    advanceLever: {
      value: offer.advance,
      min: 0,
      // Both ceilings at once: the patron fee `composeOffer` bounds a term by, and the
      // treasury `lockOffer` bounds the whole package by. Whichever binds first is the
      // one a player can actually reach.
      max: Math.min(contract.patronFee, budget.maxAdvance),
      disabledReasonKey
    },
    bonusLever: {
      value: offer.promisedBonus,
      min: 0,
      max: Math.min(contract.patronFee, budget.maxBonus),
      disabledReasonKey
    },
    methodLever: methodLeverOf(contract, disabledReasonKey),
    keyHeroLever: {
      chosen:
        offer.keyHero === null ? null : definitionOfHero(offer.keyHero, heroDefinitionByHeroId),
      options: heroOptions,
      disabledReasonKey
    },
    crewLever: {
      chosen: offer.invited
        .values()
        .map((heroId) => definitionOfHero(heroId, heroDefinitionByHeroId)),
      options: heroOptions,
      exactly: contract.requiredCrew,
      disabledReasonKey
    },
    budget,
    lockCommitment: commitmentOf(contract)
  };
}

/**
 * The money this package may still commit, and the ceiling that puts on each of its two
 * terms (`NEGOTIATION_SPEC` §2.3, §3.3).
 *
 * **This contract's own reserve is added back.** `reservedCommitments` counts every
 * `locked` offer including this one, and a package being revised is on its way back to
 * `draft` (`RESOLUTION_SPEC` §6.2), where it reserves nothing — so subtracting its own
 * commitment would tell a player they cannot afford money they are already holding.
 *
 * The two ceilings are each computed against the *current* value of the other term, which
 * is what makes them a joint constraint rather than two independent ones: `lockOffer`
 * refuses on `advance × requiredCrew + promisedBonus` as a single sum, so raising the
 * promise has to lower what is left for the advance and vice versa.
 *
 * `divideTowardZero`, never `/`: this layer produces the same integers on every host
 * (`RESOLUTION_SPEC` §4.8), and a ceiling rounded up would be a ceiling the engine
 * refuses. Clamped at zero because a campaign can be poorer than its own commitments are
 * large — a negative ceiling is not a bound a control can express.
 */
function budgetFor(state: GameState, contract: ContractState): OfferBudget {
  const ownReserve = contract.offer.phase === OfferPhase.Locked ? commitmentOf(contract) : 0;
  const available = Math.max(0, state.treasury - reservedCommitments(state) + ownReserve);
  const { advance, promisedBonus } = contract.offer;

  return {
    available,
    maxAdvance: Math.max(0, divideTowardZero(available - promisedBonus, contract.requiredCrew)),
    maxBonus: Math.max(0, available - advance * contract.requiredCrew)
  };
}

/**
 * Why this package's levers cannot be moved, or `null` when they can.
 *
 * Read straight off `composeOffer`'s own permission (`NEGOTIATION_SPEC` §3.1's table): a
 * `draft` may always be revised, and so may a `locked` package whose crew never filled —
 * that second row is `RESOLUTION_SPEC` §6.2's way out of a dead end, and treating it as
 * disabled would lock a contract forever the first time an invitee declined.
 */
function leverDisabledReasonKey(contract: ContractState): string | null {
  switch (contract.offer.phase) {
    case OfferPhase.Draft:
      return null;
    case OfferPhase.Locked:
      return contract.status === ContractStatus.Crewed ? LeverDisabledKeys.Locked : null;
    case OfferPhase.Settled:
      return LeverDisabledKeys.Settled;
    default:
      return contract.offer.phase satisfies never;
  }
}

function methodLeverOf(
  contract: ContractState,
  disabledReasonKey: string | null
): ChoiceLever<ContentId> {
  const { negotiableTags } = contract;
  const { methodTag } = contract.offer;

  if (negotiableTags === undefined || negotiableTags.size === 0) {
    return { chosen: methodTag, options: [], disabledReasonKey };
  }

  const tags = [...negotiableTags.values()];
  const ordered =
    methodTag === null ? tags : [methodTag, ...tags.filter((tag) => tag !== methodTag)];

  return {
    chosen: methodTag,
    options: ordered.map((tag) => ({ value: tag, labelKey: tagKey(tag) })),
    disabledReasonKey
  };
}

/**
 * What keeping the word will mean and what breaking it will mean (`NEGOTIATION_SPEC`
 * §5.1) — `null` exactly when nothing was promised, the same gate `settleContract`
 * itself applies before it will touch a hero's grievance at all (`NEGOTIATION_SPEC`
 * §3.3, §6: "Расчёт без обещания — законен; ... обид не возникает").
 *
 * Shown from the moment a promise exists, in every phase, not only once the package is
 * locked: `DIRECTION_2026-08` §6.3 requires the two predicates be visible **before**
 * signing, which is the whole point of the screen this task builds.
 */
function toPromiseTerms(offer: OfferState): PromiseTermsLine | null {
  if (offer.promisedBonus <= 0) {
    return null;
  }

  return {
    fulfilKey: PromiseTermsKeys.Fulfil,
    breachKey: PromiseTermsKeys.Breach,
    bonus: offer.promisedBonus
  };
}

function toHeroCard(hero: HeroState, traitRules: SortedMap<ContentId, HeldTrait>): HeroCard {
  return {
    definition: hero.definition,
    displayNameKey: hero.displayNameKey,
    greed: gradeForValue(hero.greed),
    caution: gradeForValue(hero.caution),
    pride: gradeForValue(hero.pride),
    principleKeys: traitKeys(hero, traitRules, 'principle'),
    inclinationKeys: traitKeys(hero, traitRules, 'inclination')
  };
}

/**
 * A hero's own principle or inclination keys, named from each trait's own identifier
 * rather than its tag — see {@link traitDisplayNameKey}.
 */
function traitKeys(
  hero: HeroState,
  traitRules: SortedMap<ContentId, HeldTrait>,
  kind: 'principle' | 'inclination'
): readonly string[] {
  return hero.traits
    .map((id) => resolveTrait(hero, id, traitRules))
    .filter((trait) => (kind === 'principle') === trait.isPrinciple)
    .map((trait) => trait.id)
    .sort(compareContentIds)
    .map(traitDisplayNameKey);
}

/**
 * A bare lookup here would surface a missing id with no clue which id, which hero, or
 * where the rulebook is even filled. A hero naming a trait absent from the rules is a
 * content-loading bug, not a hero with no opinion.
 */
function resolveTrait(
  hero: HeroState,
  traitId: ContentId,
  traitRules: SortedMap<ContentId, HeldTrait>
): HeldTrait {
  const trait = traitRules.get(traitId);

  if (trait === undefined) {
    throw new Error(
      `Hero '${hero.definition}' carries trait id '${traitId}', but the state's trait rules have ` +
        'no entry for it — a content-loading bug, not a hero with no opinion.'
    );
  }

  return trait;
}

/**
 * The hero behind `decision` (`DecidedOutcome.heroDefinition`'s own doc): that
 * decision's own hero when it names one, `step.heroDefinition` otherwise. Every
 * decision but a `pollCrew` one names no hero of its own and falls through to the
 * step's single hero, so this is `step.heroDefinition` for every existing caller —
 * the per-decision field exists for the one step shape where a single hero cannot
 * name every decision.
 */
function heroDefinitionOf(step: DecidedStep, decision: DecidedOutcome): ContentId | null {
  return decision.heroDefinition ?? step.heroDefinition;
}

function toResponseLine(
  step: DecidedStep,
  decision: DecidedOutcome,
  heroDisplayNameKeys: ReadonlyMap<ContentId, string>
): ResponseLine {
  const hero = heroDefinitionOf(step, decision);

  if (hero === null) {
    throw new Error(
      'A step produced a decision without a resolved hero — the scenario runner should never ' +
        'return that combination.'
    );
  }

  const heroDisplayNameKey = heroDisplayNameKeys.get(hero);

  if (heroDisplayNameKey === undefined) {
    throw new Error(
      `A step answered for hero '${hero}', but the roster this factory built has no display-name ` +
        'key for it — a content-loading or roster-building bug, not a hero with no name.'
    );
  }

  const block = decision.trace.blockedBy[0];

  if (block !== undefined) {
    // A red line closes the decision before any score or mood exists
    // (`HERO_DECISION_SPEC` §2.2): no reasons to rank, no tie for a tie-break to
    // settle, and `wavered` is false without computing anything — never a guess. The
    // block's source is always a principle's trait id, so it resolves the same way a
    // trait-sourced reason does.
    return {
      heroDefinition: hero,
      heroDisplayNameKey,
      action: decision.selectedAction,
      reasons: [],
      blockedByEntity: block.sourceEntity,
      blockedByDisplayNameKey: traitDisplayNameKey(block.sourceEntity),
      tieBreakCode: null,
      wavered: false
    };
  }

  return {
    heroDefinition: hero,
    heroDisplayNameKey,
    action: decision.selectedAction,
    reasons: rankReasons(decision, heroDisplayNameKeys),
    blockedByEntity: null,
    blockedByDisplayNameKey: null,
    // Carried through as the rule stated it, never re-derived from the score: which
    // ties exist and how they are settled is the decision rule's business, and a
    // second implementation of it in this layer is exactly the invented explanation
    // `TDD` §8 forbids.
    tieBreakCode: decision.trace.tieBreak,
    wavered: computeWavered(decision)
  };
}

/**
 * The reasons this answer shows, in the order a player reads them: the motives that
 * supported the chosen action first, strongest first, then the strongest that argued
 * against it.
 *
 * Which side a factor is on is decided here, once, from the action the hero actually
 * chose — positive factors pull toward accepting and negative ones toward declining
 * (`HERO_DECISION_SPEC` §2.3), so on a refusal it is the negative list that supported
 * the answer. The screen never repeats this reasoning: it reads the direction.
 *
 * Inside each side the order is the full one the read-model hash needs: strongest
 * first, ties broken ordinally by reason code, and — because two factors can share
 * both a magnitude and a code, two comrades pulling the same way by the same weight —
 * ties on both of those broken by source entity. Without every tie-break stated, two
 * identical runs could rank a tied pair in either order and disagree with themselves.
 * Each side is capped only after sorting, so the ones shown are always that side's
 * strongest and never whichever the trace happened to compute first.
 */
function rankReasons(
  decision: DecidedOutcome,
  heroDisplayNameKeys: ReadonlyMap<ContentId, string>
): readonly ReasonLine[] {
  const accepted = decision.selectedAction === Actions.Accept;
  const { positiveFactors, negativeFactors } = decision.trace;
  const supporting = ranked(accepted ? positiveFactors : negativeFactors);
  const opposing = ranked(accepted ? negativeFactors : positiveFactors);

  // Read in this order: the counter-argument may take what is left once the
  // supporting side has had its share, and then the supporting side takes back
  // anything the counter-argument could not fill — and vice versa. Both directions
  // are needed, because either list can be shorter than its allowance.
  let opposingShown = Math.min(opposing.length, MAX_REASONS - MIN_SUPPORTING_REASONS);
  const supportingShown = Math.min(supporting.length, MAX_REASONS - opposingShown);
  opposingShown = Math.min(opposing.length, MAX_REASONS - supportingShown);

  return [
    ...supporting
      .slice(0, supportingShown)
      .map((factor) => toReasonLine(factor, ReasonDirection.Supported, heroDisplayNameKeys)),
    ...opposing
      .slice(0, opposingShown)
      .map((factor) => toReasonLine(factor, ReasonDirection.Opposed, heroDisplayNameKeys))
  ];
}

function ranked(factors: readonly TraceFactor[]): readonly TraceFactor[] {
  return [...factors].sort(
    (left, right) =>
      right.magnitude - left.magnitude ||
      compareStrings(left.reasonCode, right.reasonCode) ||
      compareContentIds(left.sourceEntity, right.sourceEntity)
  );
}

function toReasonLine(
  factor: TraceFactor,
  direction: ReasonDirection,
  heroDisplayNameKeys: ReadonlyMap<ContentId, string>
): ReasonLine {
  return {
    reasonCode: factor.reasonCode,
    sourceEntity: factor.sourceEntity,
    strength: gradeForMagnitude(factor.magnitude),
    sourceDisplayNameKey: resolveSourceDisplayNameKey(factor, heroDisplayNameKeys),
    direction
  };
}

/**
 * Whether a reason's source is worth naming depends only on which kind of thing the
 * source is, and this is the one place that classification lives — closed over the
 * decision rule's own five source shapes: the contract, the responding hero itself, a
 * trait, a comrade, and a blocking principle that never reaches here at all.
 *
 * Contract- and self-sourced reasons resolve to `null`: both are already named
 * elsewhere on the same screen, so repeating either here would not explain anything a
 * player does not already see.
 */
function resolveSourceDisplayNameKey(
  factor: TraceFactor,
  heroDisplayNameKeys: ReadonlyMap<ContentId, string>
): string | null {
  if (TRAIT_SOURCED_REASON_CODES.has(factor.reasonCode)) {
    return traitDisplayNameKey(factor.sourceEntity);
  }

  if (COMRADE_SOURCED_REASON_CODES.has(factor.reasonCode)) {
    const key = heroDisplayNameKeys.get(factor.sourceEntity);

    if (key === undefined) {
      throw new Error(
        `Reason '${factor.reasonCode}' names comrade '${factor.sourceEntity}' as its source, but ` +
          'the roster this factory built has no display-name key for it — a content-loading or ' +
          'roster-building bug, not a comrade with no name.'
      );
    }

    return key;
  }

  // Patron fee/risk name the contract; trust and mood name the responding hero. Both are
  // already on screen under their own key.
  return null;
}

/**
 * Whether this hero's mood flipped the answer the rest of the factors alone would
 * have given (`HERO_DECISION_SPEC` §2.4).
 *
 * Mood already sits in the trace as an ordinary factor, and every factor sums to the
 * selected score — so the score *before* mood is exactly `final − mood`, computed from
 * data that already went into the decision and never guessed. "Wavered" is then just:
 * did crossing zero change between that reconstructed score and the final one.
 */
function computeWavered(decision: DecidedOutcome): boolean {
  const finalScore = decision.selectedScore;

  if (finalScore === null) {
    throw new Error(
      'computeWavered must not be called for a blocked decision — the caller returns before ' +
        'reaching here for that case.'
    );
  }

  const moodPositive = decision.trace.positiveFactors.find(
    (factor) => factor.reasonCode === ReasonCodes.UnpredictableMood
  );
  const moodNegative = decision.trace.negativeFactors.find(
    (factor) => factor.reasonCode === ReasonCodes.UnpredictableMood
  );

  const mood =
    moodPositive !== undefined
      ? moodPositive.magnitude
      : moodNegative !== undefined
        ? -moodNegative.magnitude
        : 0;

  const scoreBeforeMood = finalScore - mood;

  return scoreBeforeMood >= 0 !== finalScore >= 0;
}

/**
 * The canonical projection the read-model hash is taken over: every field a player can
 * see except `errorDetail`, and including the state itself.
 *
 * The state has to be in here. Two models that differ only in which of the five states
 * they are — `Incomplete` versus `Normal` with the same roster — must never hash
 * equal, or a screen that has not finished asking everyone would be indistinguishable
 * from one that has. The frozen corpus is built on that: `screen_loading` and
 * `screen_empty` carry identical content and different hashes.
 *
 * Exposed, not private: oracle parity compares these bytes against the corpus's own
 * recorded `read_model` minus its `sha256`, and a comparison that could only see the
 * hash could not say *where* two screens disagreed.
 */
export function describeContractOfferReadModel(model: ContractOfferScreenModel): CanonicalValue {
  // Re-validated here, not trusted. In C# the cross-field rules lived in `init`
  // accessors and survived a `with` expression, so a copy could not weaken them; a
  // TypeScript spread has no such property, and external review reproduced it:
  // `{ ...LOADING_SCREEN, state: 'Normal' }` is a Normal screen with no contract on
  // offer, and it hashed without complaint. The factory function cannot be the only
  // gate when the type system lets a caller step around it, so the two places that
  // turn a model into evidence — this projection and the expected snapshot — check it
  // again at the point the claim is made.
  const validated = createContractOfferScreenModel(model);

  return {
    screen: validated.screen,
    state: validated.state,
    title_key: validated.titleKey,
    error_code: validated.errorCode,
    contract: validated.contract === null ? null : describeContract(validated.contract),
    roster: validated.roster.map(describeHero),
    responses: validated.responses.map(describeResponse),
    treasury: validated.treasury,
    offer: validated.offer === null ? null : describeOffer(validated.offer),
    treasury_forecast: validated.treasuryForecast,
    promise_terms:
      validated.promiseTerms === null ? null : describePromiseTerms(validated.promiseTerms),
    settlement: validated.settlement === null ? null : describeSettlement(validated.settlement)
  };
}

function describeContract(contract: ContractLine): CanonicalValue {
  return {
    definition: contract.definition,
    display_name_key: contract.displayNameKey,
    patron_fee: contract.patronFee,
    risk: contract.risk,
    tag_keys: [...contract.tagKeys],
    required_crew: contract.requiredCrew,
    accepted_count: contract.acceptedCount
  };
}

function describeHero(hero: HeroCard): CanonicalValue {
  return {
    definition: hero.definition,
    display_name_key: hero.displayNameKey,
    greed: hero.greed,
    caution: hero.caution,
    pride: hero.pride,
    principle_keys: [...hero.principleKeys],
    inclination_keys: [...hero.inclinationKeys]
  };
}

function describeResponse(response: ResponseLine): CanonicalValue {
  return {
    hero_definition: response.heroDefinition,
    hero_display_name_key: response.heroDisplayNameKey,
    action: response.action,
    reasons: response.reasons.map(describeReason),
    blocked_by_entity: response.blockedByEntity,
    blocked_by_display_name_key: response.blockedByDisplayNameKey,
    tie_break_code: response.tieBreakCode,
    wavered: response.wavered
  };
}

function describeReason(reason: ReasonLine): CanonicalValue {
  return {
    reason_code: reason.reasonCode,
    source_entity: reason.sourceEntity,
    strength: reason.strength,
    source_display_name_key: reason.sourceDisplayNameKey,
    direction: reason.direction
  };
}

/**
 * The package, lever by lever.
 *
 * Every field of every lever is projected, not only the value it currently carries: a
 * ceiling that moved is a different screen — the player can press somewhere they could
 * not before — and a lever that became disabled is a different screen for the same
 * reason. A projection carrying only the values would call all three the same run.
 */
function describeOffer(offer: OfferLine): CanonicalValue {
  return {
    version: offer.version,
    phase: offer.phase,
    advance_lever: describeNumericLever(offer.advanceLever),
    bonus_lever: describeNumericLever(offer.bonusLever),
    method_lever: describeChoiceLever(offer.methodLever),
    key_hero_lever: describeChoiceLever(offer.keyHeroLever),
    crew_lever: {
      chosen: [...offer.crewLever.chosen],
      options: offer.crewLever.options.map(describeOption),
      exactly: offer.crewLever.exactly,
      disabled_reason_key: offer.crewLever.disabledReasonKey
    },
    budget: {
      available: offer.budget.available,
      max_advance: offer.budget.maxAdvance,
      max_bonus: offer.budget.maxBonus
    },
    lock_commitment: offer.lockCommitment
  };
}

function describeNumericLever(lever: NumericLever): CanonicalValue {
  return {
    value: lever.value,
    min: lever.min,
    max: lever.max,
    disabled_reason_key: lever.disabledReasonKey
  };
}

function describeChoiceLever(lever: ChoiceLever<ContentId>): CanonicalValue {
  return {
    chosen: lever.chosen,
    options: lever.options.map(describeOption),
    disabled_reason_key: lever.disabledReasonKey
  };
}

function describeOption(option: ChoiceOption<ContentId>): CanonicalValue {
  return { value: option.value, label_key: option.labelKey };
}

function describePromiseTerms(promiseTerms: PromiseTermsLine): CanonicalValue {
  return {
    fulfil_key: promiseTerms.fulfilKey,
    breach_key: promiseTerms.breachKey,
    bonus: promiseTerms.bonus
  };
}

function describeSettlement(settlement: SettlementLine): CanonicalValue {
  return {
    promised_bonus: settlement.promisedBonus,
    key_hero_definition: settlement.keyHeroDefinition,
    crew: [...settlement.crew],
    treasury_if_kept: settlement.treasuryIfKept,
    treasury_if_broken: settlement.treasuryIfBroken
  };
}
