import {
  ContractStatus,
  SortedMap,
  SortedSet,
  compareContentIds,
  compareHeroIds,
  decide,
  heroId,
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
 * one-sided term the score subtracts is non-negative: a negative patron-fee pull, risk
 * aversion, insult or trust would be *subtracted from* the score while appearing in
 * neither factor list, and the two paths would part. That non-negativity is a property of
 * the ranges below, and it is the property the sweep here measures — one decision per
 * corner of the space the loader admits, at the maximum trait, relationship and tag
 * counts `limits.ts` allows.
 *
 * A frozen-corpus measurement is a different claim and a weaker one: §1.3 of the segment
 * spec asks for the mechanism, not for 88 observations of it.
 */

/** Both ends of a range and its middle — the middle because `insult` exists only while
 * the patron fee is below risk, so an enumeration of the ends alone would never switch
 * that term off and on inside one sweep. */
function edgesOf(min: number, max: number): readonly number[] {
  return [min, Math.trunc((min + max) / 2), max];
}

const HERO_SCALES = edgesOf(TRAIT_MIN, TRAIT_MAX);
const PATRON_FEES = edgesOf(PATRON_FEE_MIN, PATRON_FEE_MAX);
const RISKS = edgesOf(RISK_MIN, RISK_MAX);
const INCLINATION_WEIGHTS = edgesOf(INCLINATION_WEIGHT_MIN, INCLINATION_WEIGHT_MAX);
const RELATIONSHIP_WEIGHTS = edgesOf(RELATIONSHIP_WEIGHT_MIN, RELATIONSHIP_WEIGHT_MAX);

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

function aHeroAt(scales: {
  readonly greed: number;
  readonly caution: number;
  readonly pride: number;
  readonly trustInGuild: number;
  readonly bondWeight: number;
}): HeroState {
  return {
    id: heroId(0),
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
    )
  };
}

function aContractAt(patronFee: number, risk: number): ContractState {
  return {
    id: parseContentId('core:the_offer'),
    patronFee,
    risk,
    requiredCrew: 1,
    tags: SortedSet.from(compareContentIds, TAG_IDS),
    status: ContractStatus.Offered,
    respondedBy: SortedSet.empty<HeroId>(compareHeroIds),
    acceptedBy: SortedSet.from(
      compareHeroIds,
      COMRADES.map(([id]) => id)
    )
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
          for (const patronFee of PATRON_FEES) {
            for (const risk of RISKS) {
              for (const traitWeight of INCLINATION_WEIGHTS) {
                for (const bondWeight of RELATIONSHIP_WEIGHTS) {
                  for (const decisionOrdinal of ORDINALS) {
                    contexts.push({
                      hero: aHeroAt({ greed, caution, pride, trustInGuild, bondWeight }),
                      contract: aContractAt(patronFee, risk),
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

  return contexts;
}

describe('the score equals its factors everywhere the loader admits', () => {
  it('держится на краях всех диапазонов и на предельных длинах', () => {
    const contexts = contextsAtBounds();

    // Названо числом, потому что молчаливо сжавшийся перебор прошёл бы цикл ниже
    // целиком, и «зелено» означало бы «нечего было проверять».
    expect(contexts).toHaveLength(
      HERO_SCALES.length ** 4 *
        PATRON_FEES.length *
        RISKS.length *
        INCLINATION_WEIGHTS.length *
        RELATIONSHIP_WEIGHTS.length *
        ORDINALS.length
    );
    expect(contexts).toHaveLength(19683);

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
    // оставляла проверку выше зелёной, потому что и формула, и число 19683 считают
    // количество точек, а не то, что среди них есть края. Тест, который не краснеет на
    // подмене того самого свойства, ради которого написан, проверкой не считается —
    // поэтому принадлежность краёв утверждается прямо.
    expect(HERO_SCALES).toContain(TRAIT_MIN);
    expect(HERO_SCALES).toContain(TRAIT_MAX);

    expect(PATRON_FEES).toContain(PATRON_FEE_MIN);
    expect(PATRON_FEES).toContain(PATRON_FEE_MAX);

    expect(RISKS).toContain(RISK_MIN);
    expect(RISKS).toContain(RISK_MAX);

    expect(INCLINATION_WEIGHTS).toContain(INCLINATION_WEIGHT_MIN);
    expect(INCLINATION_WEIGHTS).toContain(INCLINATION_WEIGHT_MAX);

    expect(RELATIONSHIP_WEIGHTS).toContain(RELATIONSHIP_WEIGHT_MIN);
    expect(RELATIONSHIP_WEIGHTS).toContain(RELATIONSHIP_WEIGHT_MAX);
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
