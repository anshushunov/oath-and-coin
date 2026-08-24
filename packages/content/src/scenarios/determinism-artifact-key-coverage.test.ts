import {
  compareContentIds,
  heroId,
  parseContentId,
  SortedSet,
  type ContractState,
  type GameState,
  type HeroState
} from '@oath-and-coin/simulation';
import { aContract, aHero, aState } from '@oath-and-coin/simulation/testing/fixtures';
import { describe, expect, it } from 'vitest';

import { describeContract, describeHero, describeState } from './determinism-artifact.ts';

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
  // No exceptions: the review that asked for this guard confirmed all eleven fields of
  // `HeroState` are covered.
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
    grievance: (h) => ({ ...h, grievance: h.grievance + 1 })
  };

  const fields = Object.keys(base) as (keyof HeroState)[];
  expect(fields).toHaveLength(11);

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
    moodOrdinals: (c) => ({ ...c, moodOrdinals: c.moodOrdinals.set(heroId(9), 1n) })
  };

  const fields = (Object.keys(base) as (keyof ContractState)[]).filter((f) => !EXCEPTIONS.includes(f));
  expect(fields).toHaveLength(8);

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
