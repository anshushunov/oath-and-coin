import {
  CommitmentState,
  compareContentIds,
  compareHeroIds,
  ConsequenceKind,
  CoverageVerdict,
  DeficitKind,
  heroId,
  NeedId,
  OutcomeGrade,
  OutcomeReasonCodes,
  parseContentId,
  SortedMap,
  SortedSet,
  type ContractResolution,
  type ContractState,
  type GameState,
  type HeroContribution,
  type HeroId,
  type HeroState
} from '@oath-and-coin/simulation';
import { aContract, aHero, aState } from '@oath-and-coin/simulation/testing/fixtures';
import { describe, expect, it } from 'vitest';

import { describeContract, describeHero, describeState } from './determinism-artifact.ts';

/**
 * A resolution with **every branch of `ContractResolution` non-empty** — the shape a
 * shallow projection cannot survive.
 *
 * `aContract()`'s own offer has nobody accepted, but that costs nothing here: this
 * fixture is handed straight to the projection, never to `createContractState`, so the
 * §2.5 invariant tying `contributions` to `acceptedBy` is not this file's to satisfy.
 *
 * **Filled, not empty, and that is the whole point.** External review of PR #33: the
 * earlier fixture left `contributions`, `deficits` and `consequences` empty and
 * `dominant` null, so deleting the projection of any of them changed nothing an empty
 * array or a `null` would not have produced anyway — three of the five branches of
 * `describeResolution` were unmeasured, and the "writes a resolution deeply" case below
 * only ever moved a coverage number.
 */
function aResolution(): ContractResolution {
  return {
    grade: OutcomeGrade.Costly,
    coverage: [
      {
        need: NeedId.Frontline,
        weight: 30,
        required: 54,
        supplied: 40,
        effective: 40,
        verdict: CoverageVerdict.Weak,
        contributors: [{ hero: heroId(0), amount: 40 }]
      }
    ],
    contributions: SortedMap.from<HeroId, HeroContribution>(compareHeroIds, [
      [
        heroId(0),
        {
          amount: 40,
          commitment: CommitmentState.Fragile,
          provenance: [OutcomeReasonCodes.NeedWeak]
        }
      ]
    ]),
    deficits: [
      {
        kind: DeficitKind.Capability,
        magnitude: 14,
        needs: [NeedId.Frontline],
        heroes: [heroId(0)]
      }
    ],
    dominant: DeficitKind.Capability,
    consequences: [
      {
        hero: heroId(0),
        kind: ConsequenceKind.Wound,
        reason: OutcomeReasonCodes.WoundOnThePoint,
        magnitude: 1
      }
    ]
  };
}

/**
 * One perturbation per *nested* key `describeResolution` writes, named by its path.
 *
 * The top-level guard below proves only that `resolution` is read at all; a projection
 * that wrote the grade and dropped everything under it would still differ from "not
 * resolved" and pass. These are what hold each branch individually: drop the `deficits`
 * projection and exactly the three `deficits.*` rows go red, drop `dominant` and exactly
 * that one does.
 */
const NESTED_RESOLUTION_PERTURBATIONS: readonly [
  string,
  (resolution: ContractResolution) => ContractResolution
][] = [
  ['grade', (r) => ({ ...r, grade: OutcomeGrade.Failed })],
  ['coverage[].need', (r) => ({ ...r, coverage: [{ ...r.coverage[0]!, need: NeedId.Wilderness }] })],
  ['coverage[].weight', (r) => ({ ...r, coverage: [{ ...r.coverage[0]!, weight: 31 }] })],
  ['coverage[].required', (r) => ({ ...r, coverage: [{ ...r.coverage[0]!, required: 55 }] })],
  ['coverage[].supplied', (r) => ({ ...r, coverage: [{ ...r.coverage[0]!, supplied: 41 }] })],
  ['coverage[].effective', (r) => ({ ...r, coverage: [{ ...r.coverage[0]!, effective: 39 }] })],
  [
    'coverage[].verdict',
    (r) => ({ ...r, coverage: [{ ...r.coverage[0]!, verdict: CoverageVerdict.Uncovered }] })
  ],
  [
    'coverage[].contributors',
    (r) => ({
      ...r,
      coverage: [{ ...r.coverage[0]!, contributors: [{ hero: heroId(0), amount: 39 }] }]
    })
  ],
  [
    'contributions[].amount',
    (r) => ({
      ...r,
      contributions: r.contributions.set(heroId(0), {
        ...r.contributions.get(heroId(0))!,
        amount: 39
      })
    })
  ],
  [
    'contributions[].commitment',
    (r) => ({
      ...r,
      contributions: r.contributions.set(heroId(0), {
        ...r.contributions.get(heroId(0))!,
        commitment: CommitmentState.Resentful
      })
    })
  ],
  [
    'contributions[].provenance',
    (r) => ({
      ...r,
      contributions: r.contributions.set(heroId(0), {
        ...r.contributions.get(heroId(0))!,
        provenance: [OutcomeReasonCodes.NeedUncovered]
      })
    })
  ],
  ['deficits[].kind', (r) => ({ ...r, deficits: [{ ...r.deficits[0]!, kind: DeficitKind.Coverage }] })],
  ['deficits[].magnitude', (r) => ({ ...r, deficits: [{ ...r.deficits[0]!, magnitude: 15 }] })],
  [
    'deficits[].needs',
    (r) => ({ ...r, deficits: [{ ...r.deficits[0]!, needs: [NeedId.Wilderness] }] })
  ],
  ['deficits[].heroes', (r) => ({ ...r, deficits: [{ ...r.deficits[0]!, heroes: [heroId(1)] }] })],
  ['dominant', (r) => ({ ...r, dominant: DeficitKind.Commitment })],
  [
    'consequences[].hero',
    (r) => ({ ...r, consequences: [{ ...r.consequences[0]!, hero: heroId(1) }] })
  ],
  [
    'consequences[].kind',
    (r) => ({ ...r, consequences: [{ ...r.consequences[0]!, kind: ConsequenceKind.Grudge }] })
  ],
  [
    'consequences[].reason',
    (r) => ({
      ...r,
      consequences: [
        { ...r.consequences[0]!, reason: OutcomeReasonCodes.GrudgeAfterFaltering }
      ]
    })
  ],
  [
    'consequences[].magnitude',
    (r) => ({ ...r, consequences: [{ ...r.consequences[0]!, magnitude: 2 }] })
  ]
];

/**
 * Minor 3 from Task 20's own review: a mechanical guard against the class of gap
 * `grievance`/`believesGuildPromises` and `treasury` both were — a field that exists on
 * `HeroState`/`GameState`, that a command already writes, and that
 * `determinism-artifact.ts`'s projection silently never read. Both were found by
 * accident, once each, by a human comparing a mutant's output to a snapshot by hand.
 * This file replaces "measured" with "enforced": for every field on the fixture object
 * not named in a declared exception list, perturbing that one field alone must change
 * the projected canonical value. A field the projection never reads would leave the
 * perturbation invisible and this test red — which is exactly the shape both real gaps
 * had.
 *
 * Deliberately narrow: only the *top-level* fields of `HeroState`, `ContractState` and
 * `GameState` are exercised. `GameState.metadata`'s own sub-fields are not walked here
 * — `determinism-artifact.test.ts`'s existing property-based comparisons already cover
 * metadata by running two full scenarios and diffing the state trees, and a second,
 * shallower version of the same claim would not add coverage, only upkeep.
 */

function jsonOf(value: unknown): string {
  // `CanonicalValue` carries `bigint` (`campaign_seed`, `mood_ordinals`' values), which
  // `JSON.stringify` refuses outright — stringified rather than dropped, so two values
  // differing only in a bigint field still compare unequal below.
  return JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? `${v.toString()}n` : v));
}

describe('describeHero reads every field of HeroState', () => {
  const base = aHero();
  // No exceptions, and the count moved to thirteen with `capability` and `wounds`
  // (`RESOLUTION_SPEC` §2.2, §2.6). `wounds` is projected although nothing writes it
  // yet, which is the whole point of this guard existing before the command does:
  // `grievance` is in this list because it was found *missing* long after the command
  // that moves it shipped.
  const EXCEPTIONS: readonly (keyof HeroState)[] = [];

  const perturbations: { readonly [K in keyof HeroState]?: (value: HeroState) => HeroState } = {
    id: (h) => ({ ...h, id: heroId(h.id + 1) }),
    definition: (h) => ({ ...h, definition: parseContentId('core:a_different_hero') }),
    displayNameKey: (h) => ({ ...h, displayNameKey: `${h.displayNameKey}.perturbed` }),
    greed: (h) => ({ ...h, greed: h.greed + 1 }),
    caution: (h) => ({ ...h, caution: h.caution + 1 }),
    pride: (h) => ({ ...h, pride: h.pride + 1 }),
    trustInGuild: (h) => ({ ...h, trustInGuild: h.trustInGuild + 1 }),
    traits: (h) => ({ ...h, traits: [...h.traits, parseContentId('core:an_extra_trait')] }),
    relationships: (h) => ({
      ...h,
      relationships: h.relationships.set(parseContentId('core:an_extra_relationship'), 1)
    }),
    believesGuildPromises: (h) => ({ ...h, believesGuildPromises: !h.believesGuildPromises }),
    grievance: (h) => ({ ...h, grievance: h.grievance + 1 }),
    // Perturbs `expertise`, not `grade`: a projection that wrote the grade and dropped
    // the map would still pass a `grade`-only perturbation, and the map is the half a
    // resolution actually reads.
    capability: (h) => ({
      ...h,
      capability: {
        ...h.capability,
        expertise: h.capability.expertise.set(NeedId.UndeadKnowledge, 7)
      }
    }),
    wounds: (h) => ({ ...h, wounds: h.wounds + 1 })
  };

  const fields = Object.keys(base) as (keyof HeroState)[];
  expect(fields).toHaveLength(13);

  it.each(fields.filter((f) => !EXCEPTIONS.includes(f)))('perturbing %s changes the projection', (field) => {
    const perturb = perturbations[field];
    if (perturb === undefined) {
      throw new Error(`No perturbation registered for HeroState.${field} — this guard cannot cover it.`);
    }

    expect(jsonOf(describeHero(perturb(base)))).not.toBe(jsonOf(describeHero(base)));
  });
});

describe('describeContract reads every field of ContractState except the declared exceptions', () => {
  const base = aContract();

  // `negotiableTags` (`NEGOTIATION_SPEC` §2.4) is the one field `determinism-artifact.ts`
  // documents leaving out on purpose: no command in this build ever mutates it, so its
  // omission is invisible today — see the comment on `describeContract` itself.
  const EXCEPTIONS: readonly (keyof ContractState)[] = ['negotiableTags'];

  const perturbations: {
    readonly [K in keyof ContractState]?: (value: ContractState) => ContractState;
  } = {
    id: (c) => ({ ...c, id: parseContentId('core:a_different_contract') }),
    patronFee: (c) => ({ ...c, patronFee: c.patronFee + 1 }),
    risk: (c) => ({ ...c, risk: c.risk + 1 }),
    requiredCrew: (c) => ({ ...c, requiredCrew: c.requiredCrew + 1 }),
    tags: (c) => ({
      ...c,
      tags: SortedSet.from(compareContentIds, [...c.tags.values(), parseContentId('target:extra')])
    }),
    status: (c) => ({ ...c, status: c.status === 'offered' ? 'crewed' : 'offered' }),
    offer: (c) => ({ ...c, offer: { ...c.offer, version: c.offer.version + 1 } }),
    moodOrdinals: (c) => ({ ...c, moodOrdinals: c.moodOrdinals.set(heroId(9), 1n) }),
    needs: (c) => ({ ...c, needs: c.needs.set(NeedId.UndeadKnowledge, 11) }),
    // From `null` to a real result: the interesting perturbation, because a projection
    // that wrote a bare `grade` and dropped everything under it would still differ from
    // "not resolved" and pass. The two resolutions below differ only in a *coverage*
    // number, so this case fails unless the whole structure is written.
    resolution: (c) => ({ ...c, resolution: aResolution() })
  };

  const fields = (Object.keys(base) as (keyof ContractState)[]).filter((f) => !EXCEPTIONS.includes(f));
  expect(fields).toHaveLength(10);

  it.each(NESTED_RESOLUTION_PERTURBATIONS)(
    'writes a resolution deeply: perturbing %s changes the projection',
    (_path, perturb) => {
      const unchanged = { ...base, resolution: aResolution() };
      const changed = { ...base, resolution: perturb(aResolution()) };

      expect(jsonOf(describeContract(changed))).not.toBe(jsonOf(describeContract(unchanged)));
    }
  );

  it.each(fields)('perturbing %s changes the projection', (field) => {
    const perturb = perturbations[field];
    if (perturb === undefined) {
      throw new Error(
        `No perturbation registered for ContractState.${field} — this guard cannot cover it.`
      );
    }

    expect(jsonOf(describeContract(perturb(base)))).not.toBe(jsonOf(describeContract(base)));
  });
});

describe('describeState reads every top-level field of GameState', () => {
  const base = aState();

  // `metadata`'s own sub-fields are exercised elsewhere (see this file's header); this
  // guard only needs `metadata` itself to be read at all, which perturbing one
  // sub-field already proves.
  const EXCEPTIONS: readonly (keyof GameState)[] = [];

  const perturbations: { readonly [K in keyof GameState]?: (value: GameState) => GameState } = {
    metadata: (s) => ({ ...s, metadata: { ...s.metadata, stateVersion: s.metadata.stateVersion + 1 } }),
    heroes: (s) => ({ ...s, heroes: s.heroes.set(heroId(99), aHero({ id: heroId(99) })) }),
    contracts: (s) => ({
      ...s,
      contracts: s.contracts.set(
        parseContentId('core:an_extra_contract'),
        aContract({ id: parseContentId('core:an_extra_contract') })
      )
    }),
    appliedCommandIds: (s) => ({ ...s, appliedCommandIds: s.appliedCommandIds.add(999) }),
    traitRules: (s) => ({
      ...s,
      traitRules: s.traitRules.set(parseContentId('core:an_extra_trait_rule'), {
        id: parseContentId('core:an_extra_trait_rule'),
        tag: parseContentId('target:extra'),
        isPrinciple: false,
        weight: 1
      })
    }),
    traces: (s) => ({
      ...s,
      traces: s.traces.set(999, {
        traceId: 999,
        positiveFactors: [],
        negativeFactors: [],
        blockedBy: [],
        tieBreak: null
      })
    }),
    history: (s) => ({
      ...s,
      history: [
        ...s.history,
        {
          kind: 'offer_revised',
          eventId: 999,
          logicalTime: 0,
          causalTraceId: null,
          contractId: parseContentId('core:an_extra_contract')
        }
      ]
    }),
    treasury: (s) => ({ ...s, treasury: s.treasury + 1 })
  };

  const fields = (Object.keys(base) as (keyof GameState)[]).filter((f) => !EXCEPTIONS.includes(f));
  expect(fields).toHaveLength(8);

  it.each(fields)('perturbing %s changes the projection', (field) => {
    const perturb = perturbations[field];
    if (perturb === undefined) {
      throw new Error(`No perturbation registered for GameState.${field} — this guard cannot cover it.`);
    }

    expect(jsonOf(describeState(perturb(base)))).not.toBe(jsonOf(describeState(base)));
  });
});
