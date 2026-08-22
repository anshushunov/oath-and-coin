import {
  Actions,
  ReasonCodes,
  canonicalSha256,
  compareContentIds,
  compareStrings,
  type CanonicalValue,
  type ContentId,
  type ContractState,
  type GameState,
  type HeldTrait,
  type HeroState,
  type SortedMap,
  type TraceFactor
} from '@oath-and-coin/simulation';

import { requireCorpusComparableText } from './corpus-comparable-text.ts';
import { TITLE_KEY, contractDisplayNameKey, tagKey, traitDisplayNameKey } from './keys.ts';
import {
  createContractOfferScreenModel,
  type ContractLine,
  type ContractOfferScreenModel,
  type DecidedOutcome,
  type DecidedStep,
  type HeroCard,
  type ReasonLine,
  type ResponseLine
} from './contract-offer-screen-model.ts';
import { gradeForMagnitude, gradeForValue } from './qualitative-scale.ts';
import { ReasonDirection, ScreenState } from './screen-state.ts';

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
  errorDetail: null
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
    errorDetail
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
      errorDetail: null
    });
  }

  const contract = resolveContract(state, steps, focusedContract);
  const heroes = [...state.heroes.values()];
  const roster = heroes.map((hero) => toHeroCard(hero, state.traitRules));

  // A response line carries no display key of its own — hero state has one, a step
  // does not — so it is joined here, by the hero's own definition, against the same
  // roster this factory already built.
  const heroDisplayNameKeys = new Map(heroes.map((hero) => [hero.definition, hero.displayNameKey]));

  const responses = steps
    .filter((step) => step.command.contract === contract.id)
    .flatMap((step) =>
      step.decisions.map((decision) => toResponseLine(step, decision, heroDisplayNameKeys))
    );

  return createContractOfferScreenModel({
    state: contract.respondedBy.size >= roster.length ? ScreenState.Normal : ScreenState.Incomplete,
    titleKey: TITLE_KEY,
    contract: toContractLine(contract),
    roster,
    responses,
    errorCode: null,
    errorDetail: null
  });
}

function resolveContract(
  state: GameState,
  steps: readonly DecidedStep[],
  focusedContract: ContentId | undefined
): ContractState {
  const first = steps[0];
  // Named outright when the caller knows; otherwise the contract the first step
  // answered; otherwise — nothing has been offered yet — the lexicographically first,
  // since the map is already sorted and the fallback is deterministic rather than
  // "whichever came out first".
  const contractId =
    focusedContract ?? (first === undefined ? state.contracts.keys()[0] : first.command.contract);
  const contract = contractId === undefined ? undefined : state.contracts.get(contractId);

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
    acceptedCount: contract.acceptedBy.size
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

function toResponseLine(
  step: DecidedStep,
  decision: DecidedOutcome,
  heroDisplayNameKeys: ReadonlyMap<ContentId, string>
): ResponseLine {
  const hero = step.heroDefinition;

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
 * Walks a finished projection and refuses any string the frozen corpus and this
 * repository would canonicalize into different bytes.
 *
 * Over the whole tree rather than over the one field that is loose today. External
 * review found `errorCode` — the only string in the projection a caller supplies
 * freely — but a field added to a later projection would reopen the same hole without
 * anyone noticing, and the walk costs one traversal of an object that is about to be
 * serialized anyway.
 */
function requireComparableStrings(value: CanonicalValue, path: string): void {
  if (typeof value === 'string') {
    requireCorpusComparableText(path, value);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((element, index) => {
      requireComparableStrings(element, `${path}[${String(index)}]`);
    });
    return;
  }

  if (typeof value === 'object' && value !== null) {
    for (const [key, element] of Object.entries(value)) {
      if (element !== undefined) {
        requireComparableStrings(element, `${path}.${key}`);
      }
    }
  }
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
export function describeReadModel(model: ContractOfferScreenModel): CanonicalValue {
  // Re-validated here, not trusted. In C# the cross-field rules lived in `init`
  // accessors and survived a `with` expression, so a copy could not weaken them; a
  // TypeScript spread has no such property, and external review reproduced it:
  // `{ ...LOADING_SCREEN, state: 'Normal' }` is a Normal screen with no contract on
  // offer, and it hashed without complaint. The factory function cannot be the only
  // gate when the type system lets a caller step around it, so the two places that
  // turn a model into evidence — this projection and the expected snapshot — check it
  // again at the point the claim is made.
  const validated = createContractOfferScreenModel(model);

  const projection: CanonicalValue = {
    state: validated.state,
    title_key: validated.titleKey,
    error_code: validated.errorCode,
    contract: validated.contract === null ? null : describeContract(validated.contract),
    roster: validated.roster.map(describeHero),
    responses: validated.responses.map(describeResponse)
  };

  requireComparableStrings(projection, '$');

  return projection;
}

/** SHA-256 of the canonical bytes of {@link describeReadModel}, lowercase hex. */
export function readModelHash(model: ContractOfferScreenModel): string {
  return canonicalSha256(describeReadModel(model));
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
