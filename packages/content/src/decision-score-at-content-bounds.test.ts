import {
  ContractStatus,
  GRIEVANCE_MAX,
  SortedMap,
  SortedSet,
  compareContentIds,
  compareHeroIds,
  decide,
  heroId,
  initialOffer,
  parseContentId,
  type ContentId,
  type ContractState,
  type DecisionContext,
  type HeldTrait,
  type HeroId,
  type HeroState
} from '@oath-and-coin/simulation';
import { describe, expect, it } from 'vitest';

import {
  INCLINATION_WEIGHT_MAX,
  INCLINATION_WEIGHT_MIN,
  PATRON_FEE_MAX,
  PATRON_FEE_MIN,
  RELATIONSHIP_WEIGHT_MAX,
  RELATIONSHIP_WEIGHT_MIN,
  RISK_MAX,
  RISK_MIN,
  TRAIT_MAX,
  TRAIT_MIN
} from './bounds.ts';
import {
  MAX_RELATIONSHIPS_PER_HERO,
  MAX_TAGS_PER_CONTRACT,
  MAX_TRAITS_PER_HERO
} from './limits.ts';

/**
 * "Счёт равен сумме факторов" — held over everything the loader will let through, not
 * over a sample that happened to hold it.
 *
 * The engine's own suite states the same identity on contexts it builds by hand
 * (`packages/simulation/src/decisions/contract-decision-rule.test.ts`). That test cannot
 * reach for these numbers: `simulation-depends-on-nothing` is absolute and bites inside a
 * `*.test.ts`, and copying the ranges into it would be the third statement of one range
 * that `bounds.ts` forbids in as many words. This package sees both sides — the ranges
 * and `@oath-and-coin/simulation` — so this is where the two meet.
 *
 * The distinction matters because the identity is not free. It holds only while every
 * one-sided term the score subtracts is non-negative: a negative advance pull, promised
 * bonus, risk aversion, insult, trust or grievance would be *subtracted from* the score
 * while appearing in neither factor list, and the two paths would part. That
 * non-negativity is a property of the ranges below, and it is the property the sweep here
 * measures — one decision per corner of the space the loader admits, at the maximum
 * trait, relationship and tag counts `limits.ts` allows.
 *
 * `DEC-008` Task 8 moved the benefit term from `patronFee` onto `offer.advance`, added a
 * promised-bonus term, and added a flat `grievance` subtraction (`NEGOTIATION_SPEC` §4);
 * external review of that task found this sweep still varying only the now-inert
 * `patronFee` and pinning `advance`, `promisedBonus` and `grievance` at zero, which held
 * the identity over a strictly narrower space than the sweep claimed to cover — the four
 * new terms never went negative because they never went anywhere. `advance` and
 * `promisedBonus` now sweep the same edges `patronFee` used to (both live in `0..patronFee`
 * per `NEGOTIATION_SPEC` §2.1), against a contract whose own `patronFee` sits fixed at
 * `PATRON_FEE_MAX` so neither is ever asked to exceed it; `grievance` sweeps its own
 * `0..GRIEVANCE_MAX`. `offer.keyHero` is fixed at the sweep's one hero id, so a nonzero
 * `promisedBonus` always reaches a nonzero `trustedBonus` — whether a promise reaches the
 * *right* hero is a question this sweep was never in the business of asking; that is
 * `contract-decision-rule.test.ts`'s own dedicated cases.
 *
 * `offer.methodTag` does **not** join this sweep. `TAG_IDS` below already authors
 * `MAX_TAGS_PER_CONTRACT` tags, one per trait, so every inclination fires — the ceiling
 * `limits.ts` sets and the third case below asserts this fixture sits exactly on. A
 * method tag added on top would carry the contract past that ceiling, which is not a
 * corner the loader admits at all (`createContractState` refuses it) — sweeping it here
 * would be measuring a shape no campaign can produce, not a wider one it can.
 * `NEGOTIATION_SPEC` §2.4's method-tag-joins-the-gate claim is `contract-decision-rule.
 * test.ts`'s "lets the chosen method tag..." cases to hold, not this file's.
 *
 * A frozen-corpus measurement is a different claim and a weaker one: §1.3 of the segment
 * spec asks for the mechanism, not for 88 observations of it.
 */

/** Both ends of a range and its middle — every axis below reuses this rather than only
 * stating its two ends, because `insult` exists only while what a hero actually stands to
 * receive falls short of the risk, and an enumeration of the ends alone would not
 * necessarily switch that term off and on inside one sweep. */
function edgesOf(min: number, max: number): readonly number[] {
  return [min, Math.trunc((min + max) / 2), max];
}

const HERO_SCALES = edgesOf(TRAIT_MIN, TRAIT_MAX);
/** `offer.advance` and `offer.promisedBonus` share this domain — both live in
 * `0..patronFee` (`NEGOTIATION_SPEC` §2.1), and this contract's own `patronFee` is fixed
 * at `PATRON_FEE_MAX`, so both terms may reach as high as `PATRON_FEE_MAX` without ever
 * exceeding it. */
const OFFER_TERM_EDGES = edgesOf(PATRON_FEE_MIN, PATRON_FEE_MAX);
const ADVANCES = OFFER_TERM_EDGES;
const PROMISED_BONUSES = OFFER_TERM_EDGES;
const RISKS = edgesOf(RISK_MIN, RISK_MAX);
const INCLINATION_WEIGHTS = edgesOf(INCLINATION_WEIGHT_MIN, INCLINATION_WEIGHT_MAX);
const RELATIONSHIP_WEIGHTS = edgesOf(RELATIONSHIP_WEIGHT_MIN, RELATIONSHIP_WEIGHT_MAX);
/** `HeroState.grievance`'s own domain (`0..GRIEVANCE_MAX`) — `bounds.ts` states no
 * `GRIEVANCE_MIN`, because there is nothing content-authored about it to bound: every
 * hero starts a campaign at `0`, and only `settleContract` ever raises it. */
const GRIEVANCES = edgesOf(0, GRIEVANCE_MAX);

/** Three ordinals, so mood contributes positively, negatively and not at all. */
const ORDINALS: readonly bigint[] = [0n, 3n, 6n];

const CAMPAIGN_SEED = 7n;

/** Ids built from their index, so the trait list is strictly sorted by construction. */
const TRAIT_IDS: readonly ContentId[] = Array.from({ length: MAX_TRAITS_PER_HERO }, (_, index) =>
  parseContentId(`core:trait_${String(index)}`)
);

const TAG_IDS: readonly ContentId[] = Array.from({ length: MAX_TAGS_PER_CONTRACT }, (_, index) =>
  parseContentId(`tag:target_${String(index)}`)
);

const COMRADES: readonly (readonly [HeroId, ContentId])[] = Array.from(
  { length: MAX_RELATIONSHIPS_PER_HERO },
  (_, index) =>
    [heroId(index + 1), parseContentId(`core:comrade_${String(index)}`)] as readonly [
      HeroId,
      ContentId
    ]
);

const CREW = SortedMap.from<HeroId, ContentId>(compareHeroIds, COMRADES);

/** The one hero this sweep ever decides for — also `aContractAt`'s `offer.keyHero`, so a
 * swept `promisedBonus` always reaches a `trustedBonus` and never goes moot on a hero-id
 * mismatch this file is not asking about. */
const DECIDER = heroId(0);

function aHeroAt(scales: {
  readonly greed: number;
  readonly caution: number;
  readonly pride: number;
  readonly trustInGuild: number;
  readonly bondWeight: number;
  readonly grievance: number;
}): HeroState {
  return {
    id: DECIDER,
    definition: parseContentId('core:decider'),
    displayNameKey: 'hero.core.decider.name',
    greed: scales.greed,
    caution: scales.caution,
    pride: scales.pride,
    trustInGuild: scales.trustInGuild,
    traits: TRAIT_IDS,
    // Every comrade carries an opinion, and the two signs are both present at once, so a
    // sweep value of 0 is not the only case where the two bond lists are both non-empty.
    relationships: SortedMap.from(
      compareContentIds,
      COMRADES.map(([, definition], index) => [
        definition,
        index % 2 === 0 ? scales.bondWeight : -scales.bondWeight
      ])
    ),
    // `NEGOTIATION_SPEC` §2.2's starting value — this sweep is not about a promise this
    // hero has stopped believing, only about the ones still standing.
    believesGuildPromises: true,
    grievance: scales.grievance
  };
}

function aContractAt(risk: number, advance: number, promisedBonus: number): ContractState {
  // Built as a raw literal and handed straight to `decide()`, never through
  // `createContractState` — this sweep poses a question about the decision rule's
  // arithmetic, not about offer invariants, and `acceptedBy` here deliberately holds
  // more heroes than `requiredCrew` allows so every comrade contributes a bond.
  return {
    id: parseContentId('core:the_offer'),
    // Fixed at the ceiling, not swept: `advance` and `promisedBonus` are what the score
    // reads now (`NEGOTIATION_SPEC` §4), and both need patronFee held at its own maximum
    // so neither is ever asked to exceed the offer's ceiling while sweeping up to it.
    patronFee: PATRON_FEE_MAX,
    risk,
    requiredCrew: 1,
    tags: SortedSet.from(compareContentIds, TAG_IDS),
    status: ContractStatus.Offered,
    offer: {
      ...initialOffer(),
      keyHero: DECIDER,
      advance,
      promisedBonus,
      respondedBy: SortedSet.empty<HeroId>(compareHeroIds),
      acceptedBy: SortedSet.from(
        compareHeroIds,
        COMRADES.map(([id]) => id)
      )
    },
    moodOrdinals: SortedMap.empty<HeroId, bigint>(compareHeroIds)
  };
}

/** Every trait an inclination, each on a tag the contract carries, so all of them fire. */
function traitsAt(weight: number): readonly HeldTrait[] {
  return TRAIT_IDS.map((id, index) => ({
    id,
    tag: TAG_IDS[index]!,
    isPrinciple: false,
    // Alternating signs for the same reason the bonds alternate: at a single swept value
    // both inclination lists stay populated.
    weight: index % 2 === 0 ? weight : -weight
  }));
}

function contextsAtBounds(): readonly DecisionContext[] {
  const contexts: DecisionContext[] = [];

  for (const greed of HERO_SCALES) {
    for (const caution of HERO_SCALES) {
      for (const pride of HERO_SCALES) {
        for (const trustInGuild of HERO_SCALES) {
          for (const advance of ADVANCES) {
            for (const promisedBonus of PROMISED_BONUSES) {
              for (const risk of RISKS) {
                for (const traitWeight of INCLINATION_WEIGHTS) {
                  for (const bondWeight of RELATIONSHIP_WEIGHTS) {
                    for (const grievance of GRIEVANCES) {
                      for (const decisionOrdinal of ORDINALS) {
                        contexts.push({
                          hero: aHeroAt({ greed, caution, pride, trustInGuild, bondWeight, grievance }),
                          contract: aContractAt(risk, advance, promisedBonus),
                          traits: traitsAt(traitWeight),
                          crew: CREW,
                          campaignSeed: CAMPAIGN_SEED,
                          decisionOrdinal,
                          traceId: 0
                        });
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  return contexts;
}

describe('the score equals its factors everywhere the loader admits', () => {
  it('держится на краях всех диапазонов и на предельных длинах', () => {
    const contexts = contextsAtBounds();

    // Названо числом, потому что молчаливо сжавшийся перебор прошёл бы цикл ниже
    // целиком, и «зелено» означало бы «нечего было проверять».
    expect(contexts).toHaveLength(
      HERO_SCALES.length ** 4 *
        ADVANCES.length *
        PROMISED_BONUSES.length *
        RISKS.length *
        INCLINATION_WEIGHTS.length *
        RELATIONSHIP_WEIGHTS.length *
        GRIEVANCES.length *
        ORDINALS.length
    );
    expect(contexts).toHaveLength(177147);

    for (const context of contexts) {
      const { result } = decide(context);

      // Ни один контекст здесь не блокируется: принципов нет, значит счёт есть всегда, и
      // `continue` не может незаметно съесть весь перебор.
      expect(result.selectedScore).not.toBeNull();

      const positive = result.trace.positiveFactors.reduce((sum, f) => sum + f.magnitude, 0);
      const negative = result.trace.negativeFactors.reduce((sum, f) => sum + f.magnitude, 0);

      expect(positive - negative).toBe(result.selectedScore);
    }
  });

  it('перебирает именно края диапазонов из bounds.ts, а не просто столько же точек', () => {
    // Внешнее ревью вскрыло дыру мутантом: замена `edgesOf` на `[min + 1, mid, max - 1]`
    // оставляла проверку выше зелёной, потому что и формула, и число точек считают
    // количество точек, а не то, что среди них есть края. Тест, который не краснеет на
    // подмене того самого свойства, ради которого написан, проверкой не считается —
    // поэтому принадлежность краёв утверждается прямо.
    expect(HERO_SCALES).toContain(TRAIT_MIN);
    expect(HERO_SCALES).toContain(TRAIT_MAX);

    expect(ADVANCES).toContain(PATRON_FEE_MIN);
    expect(ADVANCES).toContain(PATRON_FEE_MAX);

    expect(PROMISED_BONUSES).toContain(PATRON_FEE_MIN);
    expect(PROMISED_BONUSES).toContain(PATRON_FEE_MAX);

    expect(RISKS).toContain(RISK_MIN);
    expect(RISKS).toContain(RISK_MAX);

    expect(INCLINATION_WEIGHTS).toContain(INCLINATION_WEIGHT_MIN);
    expect(INCLINATION_WEIGHTS).toContain(INCLINATION_WEIGHT_MAX);

    expect(RELATIONSHIP_WEIGHTS).toContain(RELATIONSHIP_WEIGHT_MIN);
    expect(RELATIONSHIP_WEIGHTS).toContain(RELATIONSHIP_WEIGHT_MAX);

    expect(GRIEVANCES).toContain(0);
    expect(GRIEVANCES).toContain(GRIEVANCE_MAX);
  });

  it('перебирает ровно те длины, которые разрешает limits.ts', () => {
    // Иначе «предельные длины» — это утверждение о фикстуре, а не о загрузчике: список
    // мог бы усохнуть до одной черты, и проверка выше осталась бы зелёной.
    const [context] = contextsAtBounds();

    expect(context?.traits).toHaveLength(MAX_TRAITS_PER_HERO);
    expect(context?.hero.relationships.size).toBe(MAX_RELATIONSHIPS_PER_HERO);
    expect(context?.contract.tags.size).toBe(MAX_TAGS_PER_CONTRACT);
  });
});
