import {
  Actions,
  SortedMap,
  SortedSet,
  compareContentIds,
  compareHeroIds,
  contractOf,
  createContractState,
  decide,
  type ContentId,
  type ContractState,
  type GameState,
  type HeldTrait,
  type HeroId,
  type HeroState
} from '@oath-and-coin/simulation';

import type { ContentSet } from '../content-set.ts';
import { createInitialState } from '../initial-state.ts';

import { ContrastExpectation, type ContrastDefinition, type ContrastVary } from './contrast-definition.ts';
import { RULESET_VERSION } from './scenario-runner.ts';

/**
 * The contrast runner (`HERO_DECISION_SPEC` §7.3, `MVP_PLAN` §5.5): builds two initial
 * states from one content set and one seed, differing only in the input a
 * {@link ContrastDefinition} names, and asks the same question — the same hero, about the
 * same contract, on the same ordinal — of both. Seed, ordinal and every field but the named
 * one match **by construction**, so a flipped answer cannot be explained by mood or by a
 * different pre-state (`ContrastRunner_UsesTheSameSeedAndOrdinalOnBothSides`).
 *
 * `decide` is called directly rather than through `proposeContractToHero`: the command
 * refuses anyone but the offer's key hero while a package is still a draft
 * (`RejectionCodes.NotTheKeyHero`, `NEGOTIATION_SPEC` §3.1), and a contrast has no
 * negotiation to stage first — it is one question, asked once, on a package built to hold
 * exactly the one difference it names.
 */

/** One side's answer, with what it was asked under. */
export interface ContrastSideResult {
  readonly seed: bigint;
  readonly ordinal: bigint;
  readonly action: ContentId;
}

/** Both sides of a contrast, and whether the answer flipped the way it was declared to. */
export interface ContrastRun {
  readonly left: ContrastSideResult;
  readonly right: ContrastSideResult;
  /**
   * Whether the answer moved from `left` to `right` in exactly the direction
   * {@link ContrastDefinition.expect} declares — never merely "the answer differed".
   * `accept → decline` on a contrast declaring `decline_to_accept` is not the declared
   * flip and this is `false` for it, the same as it is for no flip at all
   * (`ContrastRunner_DoesNotCountAMismatchedDirectionAsFlipped`).
   */
  readonly flipped: boolean;
}

/**
 * The baseline negotiation package every contrast composes before applying its one named
 * difference (`NEGOTIATION_SPEC` §2.1, §4). Not the engine's own starting offer
 * ({@link import('../initial-state.ts').createInitialState}'s `initialOffer()`, which pays
 * nothing and asks nobody) — a contrast is one question asked of one hero, and an unasked
 * question is not what any of the eight allowed inputs describe changing.
 *
 * - `advance` defaults to the contract's own `patronFee` — the guild's plain,
 *   unrenegotiated offer pays the whole published fee — unless `offer.advance` is the
 *   input under test, in which case the vary's own value is used directly. This is also
 *   what makes a `contract.patron_fee` contrast observable at all: `decide` never reads
 *   `patronFee` itself (`NEGOTIATION_SPEC` §4 — "The patron fee itself never appears"),
 *   only `offer.advance`, so varying the fee has to move what "the whole fee" means for
 *   the swing to exist.
 * - `promisedBonus` defaults to `0` — no promise on the table — unless `offer.promised_bonus`
 *   is the input under test (the vary's value), or `hero.believes_guild_promises` is (the
 *   contract's `patronFee`, so a contrast about belief has an actual promise to revoke;
 *   varying belief around a promise of zero would vary nothing `decide` reads).
 * - `methodTag` defaults to `null` — no method negotiated — unless `offer.method_tag` is
 *   the input under test.
 * - `keyHero` is always the hero being asked. Harmless where no promise is on the table
 *   (`decide`'s `trustedBonus` only reads `keyHero` at all when `promisedBonus > 0`), and
 *   required wherever one is: `createContractState` refuses `promisedBonus > 0` with
 *   `keyHero === null`.
 * - `grievance` and `believesGuildPromises` default to the campaign's own starting values
 *   (`0`, `true` — `initial-state.ts`) unless the corresponding `hero.*` input is under
 *   test.
 */
function buildSide(
  baseContract: ContractState,
  baseHero: HeroState,
  vary: ContrastVary,
  side: 'from' | 'to'
): { readonly contract: ContractState; readonly hero: HeroState } {
  let patronFee = baseContract.patronFee;
  let risk = baseContract.risk;
  let tags = baseContract.tags;
  let advanceOverride: number | null = null;
  let methodTag: ContentId | null = null;
  let promisedBonusOverride: number | null = null;
  let grievance = baseHero.grievance;
  let believesGuildPromises = baseHero.believesGuildPromises;

  switch (vary.input) {
    case 'contract.patron_fee':
      patronFee = vary[side];
      break;
    case 'contract.risk':
      risk = vary[side];
      break;
    case 'contract.tags':
      tags = SortedSet.from(compareContentIds, vary[side]);
      break;
    case 'offer.advance':
      advanceOverride = vary[side];
      break;
    case 'offer.method_tag':
      methodTag = vary[side];
      break;
    case 'offer.promised_bonus':
      promisedBonusOverride = vary[side];
      break;
    case 'hero.grievance':
      grievance = vary[side];
      break;
    case 'hero.believes_guild_promises':
      believesGuildPromises = vary[side];
      break;
  }

  const advance = advanceOverride ?? patronFee;
  const promisedBonus =
    promisedBonusOverride ?? (vary.input === 'hero.believes_guild_promises' ? patronFee : 0);

  const contract = createContractState({
    ...baseContract,
    patronFee,
    risk,
    tags,
    offer: {
      ...baseContract.offer,
      keyHero: baseHero.id,
      advance,
      methodTag,
      promisedBonus,
      respondedBy: SortedSet.empty(compareHeroIds),
      acceptedBy: SortedSet.empty(compareHeroIds)
    }
  });

  const hero: HeroState = { ...baseHero, grievance, believesGuildPromises };

  return { contract, hero };
}

/** The hero's traits, resolved through the campaign's trait rulebook, sorted by id. */
function resolveTraits(state: GameState, hero: HeroState): readonly HeldTrait[] {
  const traitIds = SortedSet.from(compareContentIds, hero.traits);

  return traitIds.values().map((traitId) => {
    const trait = state.traitRules.get(traitId);
    if (trait === undefined) {
      throw new Error(
        `Hero '${hero.definition}' carries trait id '${traitId}', but the campaign's traitRules has ` +
          'no entry for it — a content-loading bug, not a hero with no opinion.'
      );
    }

    return trait;
  });
}

/** The runtime id of the hero a contrast names, resolved by content id. */
function heroRuntimeId(state: GameState, definition: ContrastDefinition): HeroId {
  for (const [id, hero] of state.heroes.entries()) {
    if (hero.definition === definition.hero) {
      return id;
    }
  }

  throw new Error(
    `Contrast '${definition.contrast}' names hero '${definition.hero}', which the content at ` +
      `'${definition.contentRoot}' does not define.`
  );
}

function sideResult(
  state: GameState,
  heroState: HeroState,
  baseContract: ContractState,
  traits: readonly HeldTrait[],
  vary: ContrastVary,
  side: 'from' | 'to'
): ContrastSideResult {
  const { contract, hero } = buildSide(baseContract, heroState, vary, side);

  const decision = decide({
    hero,
    contract,
    traits,
    // A freshly-built contrast package has never been offered, so nobody has accepted it
    // yet — `acceptedBy` is always empty (see `buildSide`) and there is no comrade for the
    // rule's bonds term to find. A contrast about a hero's bonds is a different hero on
    // the same contract, not a mutated `acceptedBy` (`HERO_DECISION_SPEC` §7.3).
    crew: SortedMap.empty(compareHeroIds),
    campaignSeed: state.metadata.campaignSeed,
    decisionOrdinal: state.metadata.nextDecisionOrdinal,
    traceId: state.metadata.nextTraceId
  });

  return {
    seed: state.metadata.campaignSeed,
    ordinal: state.metadata.nextDecisionOrdinal,
    action: decision.result.selectedAction
  };
}

function isDeclaredFlip(
  left: ContentId,
  right: ContentId,
  expect: ContrastExpectation
): boolean {
  if (expect === ContrastExpectation.DeclineToAccept) {
    return left === Actions.Decline && right === Actions.Accept;
  }

  return left === Actions.Accept && right === Actions.Decline;
}

/**
 * Runs one contrast against `content`: builds the campaign's starting state at the
 * contrast's own seed, then asks the named hero the same question twice, differing only in
 * the one input the contrast declares.
 *
 * @throws if the contrast names a hero or contract `content` does not define, or if
 * building either side's package violates a `ContractState` invariant (`offer-state.ts`) —
 * for instance, a `contract.patron_fee` this low leaves an `offer.advance` this high outside
 * `0..patronFee`.
 */
export function runContrast(definition: ContrastDefinition, content: ContentSet): ContrastRun {
  const state = createInitialState(content, definition.seed, RULESET_VERSION);

  const heroId = heroRuntimeId(state, definition);
  const heroState = state.heroes.get(heroId);
  if (heroState === undefined) {
    throw new Error(`Contrast '${definition.contrast}' resolved hero '${definition.hero}' to no state.`);
  }

  const baseContract = contractOf(state, definition.contract);
  const traits = resolveTraits(state, heroState);

  const left = sideResult(state, heroState, baseContract, traits, definition.vary, 'from');
  const right = sideResult(state, heroState, baseContract, traits, definition.vary, 'to');

  return {
    left,
    right,
    flipped: isDeclaredFlip(left.action, right.action, definition.expect)
  };
}
