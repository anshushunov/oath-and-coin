import { compareContentIds, type ContentId } from '../ids/content-id.ts';
import { divideTowardZero, multiplyInt32, toInt32 } from '../integer-division.ts';
import { drawInt32, type Int32Draw } from '../random/deterministic-rng.ts';
import { RngStream } from '../random/rng-stream.ts';
import { effectiveTags } from '../state/offer-state.ts';

import { Actions } from './actions.ts';
import {
  createDecisionResult,
  type CausalTrace,
  type DecisionResult,
  type TraceBlock,
  type TraceFactor
} from './causal-trace.ts';
import type { DecisionContext } from './context.ts';
import { ReasonCodes } from './reason-codes.ts';
import { TRAIT_SCALE } from './trait-scale.ts';

/**
 * A decision together with what it cost the campaign's randomness.
 *
 * `decide` returning a bare `DecisionResult` would leave the caller with no source for
 * `withEvent`'s `drawsConsumed` other than typing `1n` and hoping. Rejection sampling
 * can burn more than one ordinal, and an under-reported count leaves
 * `GameMetadata.nextDecisionOrdinal` pointing at an ordinal that was already drawn *and
 * accepted* — so the next decision silently reproduces this one's mood, and nothing in a
 * replay disagrees, because every run repeats the same mistake identically. Same
 * argument that produced `Int32Draw` one layer down: the count has to keep travelling
 * with the value that cost it.
 */
export interface HeroDecision {
  readonly result: DecisionResult;
  /** Ordinals burned on `RngStream.HeroDecision`; `0n` when the gate closed the decision. */
  readonly ordinalsConsumed: bigint;
}

/**
 * Mood's range, bounded by exactly what it can and cannot overturn.
 *
 * A decision whose sum of motives — everything {@link decide} computes before drawing
 * mood — falls outside `[MOOD_MIN, -MOOD_MIN]` cannot change sign no matter what mood
 * draws, because mood adds at most {@link MOOD_MAX} or subtracts at most `-MOOD_MIN`.
 * That is arithmetic, not a promise about specific heroes. Inside the band mood
 * genuinely can decide, and that is not a case this rule tries to close: a hero whose
 * motives are already near indifferent *should* read as having wavered from one day to
 * the next, while one who sits decisively for or against never flips because of the
 * weather (`DEC-006`).
 */
export const MOOD_MIN = -5;

export const MOOD_MAX = 5;

/**
 * Trust is a hero scale on `0..TRAIT_SCALE` and contributes on mood's own order of
 * magnitude, so it is scaled down by a tenth rather than by {@link TRAIT_SCALE}.
 *
 * Named rather than left as the bare `/ 10` the C# original carried, and deliberately
 * *not* expressed in terms of `TRAIT_SCALE`: it is not a second statement of that range
 * — the rule `TRAIT_SCALE` exists to keep — but an independent weight, and writing it as
 * `TRAIT_SCALE / 10` would tie a hero's trust to the trait ceiling for no reason and
 * silently re-weight trust the day that ceiling moved.
 */
const TRUST_DIVISOR = 10;

const CONSIDERED: readonly ContentId[] = Object.freeze([Actions.Accept, Actions.Decline]);

/**
 * How a hero answers a contract offer (`TDD` §8, `DEC-010`, `HERO_DECISION_SPEC` §2,
 * `NEGOTIATION_SPEC` §4).
 *
 * `score = advance*greed/TRAIT_SCALE + bonus*greed/TRAIT_SCALE − risk*caution/TRAIT_SCALE
 * − insult + inclinations + trust/10 + bonds − grievance + mood`; refused below zero,
 * taken above it, and at exactly zero settled by an explicit tie-break. `insult` is
 * `(risk − expected)*pride/TRAIT_SCALE` when `expected = advance + bonus` is below risk,
 * and otherwise absent entirely — not a zero term. The patron fee itself never appears:
 * what a hero weighs is what the offer actually promises to pay, not the ceiling that
 * bounds it (`NEGOTIATION_SPEC` §4).
 *
 * `bonus` here is `trustedBonus` (`NEGOTIATION_SPEC` §4): `contract.offer.promisedBonus`
 * when this hero is `contract.offer.keyHero` and still `hero.believesGuildPromises`,
 * zero otherwise. Computed once and read in both the benefit term and `expected` — a
 * promise the hero has stopped believing, or one made to someone else, moves nothing
 * and shields nothing.
 *
 * Every term divides on its own, before being added into the sum: dividing the sum
 * instead rounds differently under integer division (`HERO_DECISION_SPEC` §2.3), and the
 * difference reaches the decision at the boundary. Every term is integer arithmetic
 * (`TDD` §7.4) — {@link divideTowardZero}, never `/`. `grievance` is not divided at all:
 * `NEGOTIATION_SPEC` §4 states it as a flat `−hero.grievance`, present only while it is
 * above zero.
 *
 * Every term that contributed also appears in the trace, with the magnitude the score
 * used, never negative: which list a factor lives in already says which way it pulled.
 * The explanation is not reconstructed after the fact from the outcome — it is the
 * arithmetic itself, written down (`DEC-004`, `DEC-006`). The promised bonus is its own
 * factor, never folded into the advance's — a player who saw only one enlarged payment
 * line could not tell a promise moved this hero rather than money already on the table.
 *
 * The gate runs first, before any arithmetic, against {@link effectiveTags} — the
 * contract's authored tags plus the offer's chosen method tag, if any
 * (`NEGOTIATION_SPEC` §2.4): a violated principle closes the decision on the spot, with
 * no score and **no mood draw**. Nothing after the gate can overturn it because nothing
 * after the gate runs at all — a red line is not a very large negative contribution
 * money could outweigh, it is the absence of a sum to outweigh (`HERO_DECISION_SPEC`
 * §2.2). Inclinations are checked against the same effective tags, for the same reason:
 * a chosen method has to move a hero exactly like an authored one, not through a second
 * code path.
 */
export function decide(context: DecisionContext): HeroDecision {
  assertTraitsAreSortedById(context.traits);

  const { hero, contract } = context;
  const tags = effectiveTags(contract);

  const blocks: TraceBlock[] = [];
  for (const trait of context.traits) {
    if (trait.isPrinciple && tags.has(trait.tag)) {
      blocks.push({ reasonCode: ReasonCodes.PrincipleForbids, sourceEntity: trait.id });
    }
  }

  if (blocks.length > 0) {
    const blockedResult = createDecisionResult({
      selectedAction: Actions.Decline,
      consideredActions: CONSIDERED,
      selectedScore: null,
      trace: {
        traceId: context.traceId,
        positiveFactors: [],
        negativeFactors: [],
        blockedBy: blocks,
        tieBreak: null
      }
    });

    // No mood draw happened on this path: a decision the gate closes must not spend
    // randomness it never needed. An ordinal burned here would shift every later
    // decision in the campaign (`HERO_DECISION_SPEC` §2.2).
    return { result: blockedResult, ordinalsConsumed: 0n };
  }

  const positive: TraceFactor[] = [];
  const negative: TraceFactor[] = [];

  // The order below is the `NEGOTIATION_SPEC` §4 table, verbatim: advance, promised
  // bonus, risk, insult, inclinations (by trait id — already the order `traits` is
  // sorted in), trust, bonds (by hero id), the guild's broken word, mood last. That
  // order is not cosmetic: it is what ends up in the trace, and the trace is a
  // canonical artifact.

  // Everything the promise does flows through this one value, computed once: a
  // promise moves only the hero it was made to, and only while that hero still
  // believes it (`NEGOTIATION_SPEC` §4). Zero for everyone else — the bonus contributes
  // nothing to their benefit and shields nothing in their insult, exactly as if it had
  // never been offered.
  const trustedBonus =
    hero.id === contract.offer.keyHero && hero.believesGuildPromises
      ? contract.offer.promisedBonus
      : 0;

  // Выгода: what the offer actually pays every hero who accepts, pulled toward
  // acceptance by greed. The patron fee is a ceiling on the offer, not itself a term —
  // `NEGOTIATION_SPEC` §4 replaces it here with `offer.advance`.
  const advancePull = divideTowardZero(
    multiplyInt32(contract.offer.advance, hero.greed),
    TRAIT_SCALE
  );
  if (advancePull > 0) {
    positive.push({
      reasonCode: ReasonCodes.PaymentAttractive,
      sourceEntity: contract.id,
      magnitude: advancePull
    });
  }

  // Надбавка: a separate contribution, never added into the advance before dividing —
  // folding the two would leave only one enlarged "payment" line, and the player could
  // no longer see that a promise, not money already on the table, moved this hero
  // (`NEGOTIATION_SPEC` §4).
  const bonusPull = divideTowardZero(multiplyInt32(trustedBonus, hero.greed), TRAIT_SCALE);
  if (bonusPull > 0) {
    positive.push({
      reasonCode: ReasonCodes.PromiseOfABonus,
      sourceEntity: contract.id,
      magnitude: bonusPull
    });
  }

  // Риск: what the contract risks, pushed toward refusal by caution.
  const riskAversion = divideTowardZero(multiplyInt32(contract.risk, hero.caution), TRAIT_SCALE);
  if (riskAversion > 0) {
    negative.push({
      reasonCode: ReasonCodes.RiskTooHigh,
      sourceEntity: contract.id,
      magnitude: riskAversion
    });
  }

  // Обида: only when what the hero actually stands to receive — the advance plus a
  // trusted bonus — does not even cover the risk being asked. A believed promise
  // defends against the insult exactly as hard cash would, because the hero it was
  // made to counts it as already theirs (`NEGOTIATION_SPEC` §4). Paid fairly or better
  // there is no insult at all, not a zero-magnitude one.
  const expected = toInt32(contract.offer.advance + trustedBonus);
  const insult =
    expected < contract.risk
      ? divideTowardZero(multiplyInt32(toInt32(contract.risk - expected), hero.pride), TRAIT_SCALE)
      : 0;
  if (insult > 0) {
    negative.push({
      reasonCode: ReasonCodes.PaymentInsulting,
      sourceEntity: contract.id,
      magnitude: insult
    });
  }

  // Склонности: every non-principle trait whose tag the contract's *effective* tags
  // carry, walked in the hero's own trait order (id-sorted, asserted above). A chosen
  // method tag reaches this loop exactly like an authored one (`NEGOTIATION_SPEC`
  // §2.4). Principles were consumed by the gate and never reach here.
  let inclinationSum = 0;
  for (const trait of context.traits) {
    if (trait.isPrinciple || !tags.has(trait.tag)) {
      continue;
    }

    inclinationSum = toInt32(inclinationSum + trait.weight);

    if (trait.weight > 0) {
      positive.push({
        reasonCode: ReasonCodes.PersonalConviction,
        sourceEntity: trait.id,
        magnitude: trait.weight
      });
    } else if (trait.weight < 0) {
      negative.push({
        reasonCode: ReasonCodes.PersonalAversion,
        sourceEntity: trait.id,
        magnitude: toInt32(-trait.weight)
      });
    }
  }

  // Доверие: the hero's own trust in the guild.
  const guildTrust = divideTowardZero(hero.trustInGuild, TRUST_DIVISOR);
  if (guildTrust > 0) {
    positive.push({
      reasonCode: ReasonCodes.TrustsTheGuild,
      sourceEntity: hero.definition,
      magnitude: guildTrust
    });
  }

  // Связи: only heroes who have already accepted this same contract, walked in
  // `offer.acceptedBy`'s own hero-id order. A hero listed there with no matching crew
  // entry is a context-assembly bug — the engine forgot to carry that hero along — not
  // an absent relationship, so it fails loudly instead of reading as "no opinion".
  let bondSum = 0;
  for (const acceptedHeroId of contract.offer.acceptedBy.values()) {
    const comrade = context.crew.get(acceptedHeroId);
    if (comrade === undefined) {
      throw new Error(
        `Contract '${contract.id}' lists hero hero#${acceptedHeroId} in acceptedBy, but ` +
          `DecisionContext.crew has no entry for hero hero#${acceptedHeroId} — an accepted ` +
          'hero missing from crew is a context-assembly bug, not an absent relationship.'
      );
    }

    const weight = hero.relationships.get(comrade);
    if (weight === undefined) {
      continue;
    }

    bondSum = toInt32(bondSum + weight);

    if (weight > 0) {
      positive.push({
        reasonCode: ReasonCodes.StandsWithComrade,
        sourceEntity: comrade,
        magnitude: weight
      });
    } else if (weight < 0) {
      negative.push({
        reasonCode: ReasonCodes.WillNotWorkWith,
        sourceEntity: comrade,
        magnitude: toInt32(-weight)
      });
    }
  }

  // Слово: the guild's own broken promise, weighed against this hero specifically.
  // Not divided by `TRAIT_SCALE` — `NEGOTIATION_SPEC` §4 states it as a flat
  // `−hero.grievance` — and present only while the grievance is above zero, the same
  // rule every other term here follows: a hero never betrayed carries no such factor,
  // not one at strength zero.
  const grievance = hero.grievance;
  if (grievance > 0) {
    negative.push({
      reasonCode: ReasonCodes.GuildBrokeItsWord,
      sourceEntity: hero.definition,
      magnitude: grievance
    });
  }

  const mood = drawMood(context.campaignSeed, context.decisionOrdinal);

  // Magnitudes are strengths, never signed contributions: which list a factor is in
  // already says which way it pulled, and a negative magnitude inside `negativeFactors`
  // would mean the opposite of itself.
  if (mood.value > 0) {
    positive.push({
      reasonCode: ReasonCodes.UnpredictableMood,
      sourceEntity: hero.definition,
      magnitude: mood.value
    });
  } else if (mood.value < 0) {
    negative.push({
      reasonCode: ReasonCodes.UnpredictableMood,
      sourceEntity: hero.definition,
      magnitude: toInt32(-mood.value)
    });
  }

  // Wrapped once, not after each term — see `toInt32`. Every `int` operation in the
  // original wraps on overflow, and a port that computed this in doubles answered
  // `46116860141324210` where C# answers `0` on inputs C# accepts (external review's
  // counterexample: the patron fee and greed both `2147483647`).
  const score = toInt32(
    advancePull +
      bonusPull -
      riskAversion -
      insult +
      inclinationSum +
      guildTrust +
      bondSum -
      grievance +
      mood.value
  );

  // Exactly zero is a tie, not an acceptance with a very small margin: nothing weighed
  // either way, so taking the contract and refusing it scored the same. The rule still
  // resolves it toward accepting — a hero with no reason to refuse goes along with the
  // guild — but it now says so, with a stable code the screen shows.
  const tieBreak = score === 0 ? ReasonCodes.NoReasonToRefuse : null;

  const trace: CausalTrace = {
    traceId: context.traceId,
    positiveFactors: positive,
    negativeFactors: negative,
    blockedBy: [],
    tieBreak
  };

  const result = createDecisionResult({
    selectedAction: score < 0 ? Actions.Decline : Actions.Accept,
    consideredActions: CONSIDERED,
    selectedScore: score,
    trace
  });

  return { result, ordinalsConsumed: mood.ordinalsConsumed };
}

/**
 * The mood draw, in one place. Exported rather than inlined at its single call site so a
 * test can ask what mood a given `(seed, ordinal)` produces without restating the range
 * — a test that restated it would keep passing after the range moved underneath it.
 */
export function drawMood(campaignSeed: bigint, ordinal: bigint): Int32Draw {
  return drawInt32(campaignSeed, RngStream.HeroDecision, ordinal, MOOD_MIN, MOOD_MAX + 1);
}

/**
 * The order principles are checked in is the order blocks appear in the trace, and that
 * order is a canonical artifact — so it is checked here, on every call, not assumed.
 *
 * The C# original spells out why this is a plain throw and not `Debug.Assert`: an assert
 * compiles away entirely under Release, which is the exact configuration the canonical
 * artifact is produced under. There is no Release/Debug split here, but the same
 * property is what matters — this runs in the shipped build or it guards nothing.
 */
function assertTraitsAreSortedById(traits: readonly { readonly id: ContentId }[]): void {
  for (let index = 1; index < traits.length; index++) {
    const previous = traits[index - 1]!.id;
    const current = traits[index]!.id;
    if (compareContentIds(current, previous) <= 0) {
      throw new Error(
        `DecisionContext.traits must be strictly sorted by id; '${previous}' is not before ` +
          `'${current}'.`
      );
    }
  }
}
