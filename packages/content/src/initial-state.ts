import {
  ContractStatus,
  SortedMap,
  SortedSet,
  compareContentIds,
  compareHeroIds,
  compareNumbers,
  freezeDeep,
  heroId,
  requireArtifactSafeText,
  requireUint64,
  type CausalTrace,
  type ContentId,
  type ContractState,
  type GameState,
  type HeldTrait,
  type HeroId,
  type HeroState
} from '@oath-and-coin/simulation';

import type { ContentSet } from './content-set.ts';
import { SAVE_SCHEMA_VERSION } from './versions.ts';

/**
 * Builds the campaign's starting state: one hero per definition, one offered contract
 * per definition, and the trait rulebook the engine weighs decisions against.
 *
 * Hero ids are assigned in **content-id order**, not in the order the filesystem
 * returned the files. Filesystem order is not a property of the content — it varies by
 * platform, by filesystem and by how the tree was checked out — so deriving ids from it
 * would make the same content produce different states on different machines, and every
 * "same seed, same result" claim built on top would be false in a way no test on one
 * machine could see.
 *
 * This function lives in the content package rather than in the simulation because it is
 * the bridge across the boundary: it is the one place a trait *definition* becomes a
 * plain `HeldTrait` the engine can read. The engine needs kind, tag and weight to build
 * a decision context but cannot reference the package that defines them (`ADR-002`), so
 * the resolution happens exactly once, here, and only the result crosses over.
 */
export function createInitialState(
  content: ContentSet,
  campaignSeed: bigint,
  rulesetVersion: string
): GameState {
  // Both checks are the second half of a pair, and both were added after external
  // review: the content contracts hold authored strings to the artifact's character
  // set, and this holds the strings that arrive from somewhere other than a content
  // file — a ruleset version a tool passed in — to the same set. `!== ''` was all this
  // used to be, which let a version string put anything at all into every artifact the
  // campaign would ever produce.
  requireArtifactSafeText('rulesetVersion', rulesetVersion);
  requireUint64('campaignSeed', campaignSeed);

  const heroes = SortedMap.from(
    compareHeroIds,
    content.heroes.values().map((definition, index): readonly [HeroId, HeroState] => {
      const id = heroId(index);

      return [
        id,
        {
          id,
          definition: definition.id,
          displayNameKey: definition.displayNameKey,
          greed: definition.greed,
          caution: definition.caution,
          pride: definition.pride,
          trustInGuild: definition.trustInGuild,
          traits: definition.traits,
          relationships: SortedMap.from(
            compareContentIds,
            definition.relationships.map(
              (relationship) => [relationship.hero, relationship.weight] as const
            )
          )
        }
      ];
    })
  );

  const contracts = SortedMap.from(
    compareContentIds,
    content.contracts.values().map((definition): readonly [ContentId, ContractState] => [
      definition.id,
      {
        id: definition.id,
        payment: definition.payment,
        risk: definition.risk,
        requiredCrew: definition.requiredCrew,
        tags: SortedSet.from(compareContentIds, definition.tags),
        status: ContractStatus.Offered,
        respondedBy: SortedSet.empty<HeroId>(compareHeroIds),
        acceptedBy: SortedSet.empty<HeroId>(compareHeroIds)
      }
    ])
  );

  const traitRules = SortedMap.from(
    compareContentIds,
    content.traits.values().map((trait): readonly [ContentId, HeldTrait] => [
      trait.id,
      {
        id: trait.id,
        tag: trait.tag,
        isPrinciple: trait.kind === 'principle',
        weight: trait.weight
      }
    ])
  );

  // The whole starting tree frozen at construction, so every later transition inherits
  // runtime immutability instead of re-establishing it (see `freeze.ts`).
  return freezeDeep({
    metadata: {
      saveSchemaVersion: SAVE_SCHEMA_VERSION,
      rulesetVersion,
      contentVersion: content.contentVersion,
      campaignSeed,
      stateVersion: 0,
      logicalTime: 0,
      nextEventId: 0,
      nextTraceId: 0,
      nextDecisionOrdinal: 0n
    },
    heroes,
    contracts,
    appliedCommandIds: SortedSet.empty<number>(compareNumbers),
    traitRules,
    traces: SortedMap.empty<number, CausalTrace>(compareNumbers),
    history: []
  });
}
