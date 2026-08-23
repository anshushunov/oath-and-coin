import { SortedMap } from '../collections/sorted-map.ts';
import { SortedSet } from '../collections/sorted-set.ts';
import type { DecisionContext } from '../decisions/context.ts';
import type { ContentId } from '../ids/content-id.ts';
import type { HeroId } from '../ids/hero-id.ts';

import {
  aContext,
  aContract,
  aHero,
  anOffer,
  aTrait,
  compareContentIds,
  compareHeroIds,
  heroId,
  ids
} from './fixtures.ts';

/**
 * The one place a `DecisionContext` sweep is generated from, for `DEC-008`'s
 * negotiation slice. `contract-decision-rule.test.ts`'s sum-identity sweep and
 * `decision-properties.test.ts`'s `NEGOTIATION_SPEC` §10.1 properties pose
 * different questions over the same admissible input, and a second hand-rolled
 * generator would let the two silently drift into disagreeing about what "a
 * context" even is. Everything here is deliberately hand-built rather than drawn
 * from a fuzzer: global randomness is banned in this package (`ADR-002`), and an
 * enumeration is reproducible on top of that — a failure names the same context on
 * every run.
 *
 * Not exported through `src/index.ts`: these are test-only, and `index.ts` is the
 * package's production surface (`ADR-002`'s single entry point). A consumer in
 * another package that needs the same shape builds its own, the way
 * `packages/content/src/decision-score-at-content-bounds.test.ts` already does
 * against its own loader-bound ranges — this file cannot reach those either
 * (`simulation-depends-on-nothing`), so the two were always going to state their
 * own axes independently.
 */

/**
 * Hero profiles the sweeps below walk, chosen to put each scale at both ends of
 * its own behaviour and at an ordinary middle — not to reproduce any authored
 * hero.
 */
export const HERO_SCALE_PROFILES: readonly (readonly [number, number, number, number])[] = [
  [0, 0, 0, 0],
  [100, 100, 100, 100],
  [60, 30, 45, 50],
  [99, 1, 1, 9],
  [1, 99, 99, 91]
];

/**
 * `offer.advance` and `offer.promisedBonus` share one domain, `0..patronFee`
 * (`NEGOTIATION_SPEC` §2.1). This is the four-point sample used whenever a sweep
 * needs that domain at meaningful resolution — as the axis a property test is
 * actually sweeping, or as `fullContextSweep()`'s own `advance` axis.
 */
export const OFFER_TERM_VALUES: readonly number[] = [0, 15, 40, 100];

/**
 * The same shared offer-term domain, at the coarser two points a sweep needs only
 * as *background* — present and absent, not the axis the sweep is actually
 * about. `fullContextSweep()` uses this for `promisedBonus`; `decision-properties.
 * test.ts` also uses it for `advance` when the property being stated is about
 * `promisedBonus` instead, so raising the swept term is measured against a
 * background that still varies rather than one pinned to a single value.
 */
export const OFFER_TERM_FLAGS: readonly number[] = [0, 30];

export const RISKS: readonly number[] = [0, 9, 55, 80, 100];

export const INCLINATION_WEIGHTS: readonly number[] = [-30, -3, 0, 7, 30];

export const RELATIONSHIP_WEIGHTS: readonly number[] = [-20, -5, 0, 5, 20];

export const GRIEVANCES: readonly number[] = [0, 25];

/**
 * `null` (nothing chosen) and a cult tag that is never among the contract's own
 * authored tags — present only so a sweep can tell "inclinations read the
 * contract's tags alone" apart from "inclinations read `effectiveTags`"
 * (`NEGOTIATION_SPEC` §2.4).
 */
export const METHOD_TAGS: readonly (ContentId | null)[] = [null, ids.cult];

/** Three ordinals, so mood contributes positively, negatively and not at all. */
export const MOOD_ORDINALS: readonly bigint[] = [0n, 3n, 6n];

/** A `SortedMap<HeroId, ContentId>` built from raw ids, for a context's `crew`. */
export function crewOf(
  entries: readonly (readonly [number, ContentId])[]
): SortedMap<HeroId, ContentId> {
  return SortedMap.from<HeroId, ContentId>(
    compareHeroIds,
    entries.map(([id, definition]) => [heroId(id), definition] as const)
  );
}

/** The two comrades every sweep context below carries, always in this crew. */
const SWEEP_CREW: SortedMap<HeroId, ContentId> = crewOf([
  [1, ids.doran],
  [2, ids.zara]
]);

/**
 * The nine axes a scored (non-gated) sweep context varies: the deciding hero's
 * four scales, `contract.risk`, one inclination weight (mirrored across two
 * traits so both directions are live at once), one bond weight (same mirroring
 * across two comrades), `offer.promisedBonus`, `hero.grievance`, a chosen method
 * tag, and the mood ordinal. `offer.advance` is named separately, at the call
 * site, because different sweeps use it in different roles (the swept axis, or
 * background).
 */
export interface ContextAxes {
  readonly heroScales: readonly [number, number, number, number];
  readonly advance: number;
  readonly risk: number;
  readonly traitWeight: number;
  readonly bondWeight: number;
  readonly promisedBonus: number;
  readonly grievance: number;
  readonly methodTag: ContentId | null;
  readonly decisionOrdinal: bigint;
}

/** Who is deciding, distinct from the nine swept axes above. */
export interface ContextDecider {
  readonly heroId?: HeroId;
  readonly keyHero?: HeroId;
  readonly believesGuildPromises?: boolean;
}

/**
 * One `DecisionContext` built from {@link ContextAxes}, in the shape
 * `contract-decision-rule.test.ts`'s own sweep established: every term
 * `NEGOTIATION_SPEC` §4 names is moved by something here, the deciding hero is
 * `heroId(0)` and also `offer.keyHero` unless {@link ContextDecider} overrides
 * either, and the contract's tags are `[temple, undead]` so a swept `methodTag`
 * of `cult` reaches a trait no authored tag does.
 */
export function contextAt(axes: ContextAxes, decider: ContextDecider = {}): DecisionContext {
  const [greed, caution, pride, trustInGuild] = axes.heroScales;

  return aContext({
    hero: aHero({
      id: decider.heroId ?? heroId(0),
      greed,
      caution,
      pride,
      trustInGuild,
      grievance: axes.grievance,
      believesGuildPromises: decider.believesGuildPromises ?? true,
      relationships: SortedMap.from(compareContentIds, [
        [ids.doran, axes.bondWeight],
        [ids.zara, -axes.bondWeight]
      ])
    }),
    contract: aContract({
      risk: axes.risk,
      tags: SortedSet.from(compareContentIds, [ids.temple, ids.undead]),
      offer: anOffer({
        keyHero: decider.keyHero ?? heroId(0),
        advance: axes.advance,
        promisedBonus: axes.promisedBonus,
        methodTag: axes.methodTag,
        acceptedBy: SortedSet.from(compareHeroIds, [heroId(1), heroId(2)])
      })
    }),
    traits: [
      // Tagged `cult`, which is never among the contract's own tags above — it
      // fires only when `methodTag` adds it to `effectiveTags`.
      aTrait({ id: ids.cultCurious, tag: ids.cult, weight: 12 }),
      aTrait({ id: ids.loyal, tag: ids.undead, weight: axes.traitWeight }),
      aTrait({ id: ids.squeamish, tag: ids.temple, weight: -axes.traitWeight })
    ],
    crew: SWEEP_CREW,
    decisionOrdinal: axes.decisionOrdinal
  });
}

/** The four axes a gated (principle-blocked) sweep context varies. */
export interface GatedContextAxes {
  readonly heroScales: readonly [number, number, number, number];
  readonly advance: number;
  readonly promisedBonus: number;
  readonly decisionOrdinal: bigint;
}

/**
 * A context the gate closes before any arithmetic runs, with `advance` and
 * `promisedBonus` still free to vary: the whole point of
 * `PrincipleHoldsAtEveryAdvanceAndBonus` (`NEGOTIATION_SPEC` §10.1) is that the
 * gate does not read either one, so no value of them can buy past it.
 */
export function aGatedContext(axes: GatedContextAxes): DecisionContext {
  const [greed, caution, pride, trustInGuild] = axes.heroScales;

  return aContext({
    hero: aHero({ greed, caution, pride, trustInGuild }),
    contract: aContract({
      tags: SortedSet.from(compareContentIds, [ids.temple]),
      offer: anOffer({ advance: axes.advance, promisedBonus: axes.promisedBonus })
    }),
    traits: [aTrait({ id: ids.refusesTemples, tag: ids.temple, isPrinciple: true, weight: 0 })],
    decisionOrdinal: axes.decisionOrdinal
  });
}

/**
 * The full nine-axis sweep, `contract-decision-rule.test.ts`'s
 * `'записанный счёт равен сумме записанных факторов'` and `decision-properties.
 * test.ts`'s `'the same inputs produce the same decision, offer included'` both
 * walk — the score-equals-factors identity over every scored context this
 * generator can build, plus the gate closing three of its own regardless of
 * `decisionOrdinal` (`HERO_DECISION_SPEC` §2.2 trap 3).
 *
 * `HERO_SCALE_PROFILES.length * OFFER_TERM_VALUES.length * RISKS.length *
 * INCLINATION_WEIGHTS.length * RELATIONSHIP_WEIGHTS.length *
 * OFFER_TERM_FLAGS.length * GRIEVANCES.length * METHOD_TAGS.length *
 * MOOD_ORDINALS.length + MOOD_ORDINALS.length` = `5*4*5*5*5*2*2*2*3 + 3` = `60003`.
 * Named as a product at both call sites rather than assumed here: a caller that
 * only checked `.length > 0` would not notice an axis silently collapsing to one
 * point.
 */
export function fullContextSweep(): readonly DecisionContext[] {
  const contexts: DecisionContext[] = [];

  for (const heroScales of HERO_SCALE_PROFILES) {
    for (const advance of OFFER_TERM_VALUES) {
      for (const risk of RISKS) {
        for (const traitWeight of INCLINATION_WEIGHTS) {
          for (const bondWeight of RELATIONSHIP_WEIGHTS) {
            for (const promisedBonus of OFFER_TERM_FLAGS) {
              for (const grievance of GRIEVANCES) {
                for (const methodTag of METHOD_TAGS) {
                  for (const decisionOrdinal of MOOD_ORDINALS) {
                    contexts.push(
                      contextAt({
                        heroScales,
                        advance,
                        risk,
                        traitWeight,
                        bondWeight,
                        promisedBonus,
                        grievance,
                        methodTag,
                        decisionOrdinal
                      })
                    );
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  // A red line closes the decision before any score exists, so these carry the
  // score every sweep here must skip rather than sum. Present on purpose: an
  // invariant stated only over scored decisions would not say what it does about
  // the other kind.
  for (const decisionOrdinal of MOOD_ORDINALS) {
    contexts.push(
      aGatedContext({ heroScales: [0, 0, 0, 0], advance: 0, promisedBonus: 0, decisionOrdinal })
    );
  }

  return contexts;
}
