import {
  ContractStatus,
  STARTING_TREASURY,
  SortedMap,
  SortedSet,
  compareContentIds,
  compareHeroIds,
  compareNumbers,
  createContractState,
  freezeDeep,
  heroId,
  initialOffer,
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
import { MAX_ARTIFACT_SAFE_TEXT_LENGTH } from './limits.ts';
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
  // The third check in that pair, and it closes the same circle from the other side.
  // `requireArtifactSafeText` states a character set and no length; the save codec
  // states both (`limits.ts`, `MAX_ARTIFACT_SAFE_TEXT_LENGTH`), so a ruleset version
  // longer than that produced a campaign this build could write and then refuse to read
  // back. Applied here rather than inside `requireArtifactSafeText` because the ceiling
  // is this package's — `packages/simulation` knows nothing about save files.
  requireWithinArtifactTextLength('rulesetVersion', rulesetVersion);
  requireWithinArtifactTextLength('contentVersion', content.contentVersion);

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
          // Carried through from the definition unchanged (`RESOLUTION_SPEC` §2.2). The
          // loader has already keyed `expertise` by `compareNeedIds`, so this is a copy
          // and not a rebuild — the artifact's need order is the vocabulary's either way.
          capability: definition.capability,
          // `RESOLUTION_SPEC` §2.6's starting value. Campaign state, not content: no
          // hero is authored wounded, and only a `Wound` consequence raises it.
          wounds: 0,
          traits: definition.traits,
          relationships: SortedMap.from(
            compareContentIds,
            definition.relationships.map(
              (relationship) => [relationship.hero, relationship.weight] as const
            )
          ),
          // `NEGOTIATION_SPEC` §2.2's starting values — campaign state, not content, so
          // no hero definition carries them.
          believesGuildPromises: true,
          grievance: 0
        }
      ];
    })
  );

  const contracts = SortedMap.from(
    compareContentIds,
    content.contracts.values().map((definition): readonly [ContentId, ContractState] => [
      definition.id,
      createContractState({
        id: definition.id,
        patronFee: definition.patronFee,
        risk: definition.risk,
        requiredCrew: definition.requiredCrew,
        // Authored, and never moved by any command (`RESOLUTION_SPEC` §2.3).
        needs: definition.needs,
        tags: SortedSet.from(compareContentIds, definition.tags),
        // Already resolved by the content loader (`content-set.ts`, `DEC-012`/Task 4);
        // simply not carried into simulation state until now. `composeOffer`
        // (`NEGOTIATION_SPEC` §3.3) is the first reader.
        negotiableTags: SortedSet.from(compareContentIds, definition.negotiableTags),
        status: ContractStatus.Offered,
        offer: initialOffer(),
        moodOrdinals: SortedMap.empty<HeroId, bigint>(compareHeroIds),
        // Nothing has been resolved at campaign start, and `null` says so definitely —
        // the same reason `negotiableTags` is `[]` rather than absent.
        resolution: null
      })
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
    history: [],
    // `NEGOTIATION_SPEC` §2.3's starting treasury; no command moves it yet.
    treasury: STARTING_TREASURY
  });
}

function requireWithinArtifactTextLength(field: string, value: string): void {
  if (value.length > MAX_ARTIFACT_SAFE_TEXT_LENGTH) {
    throw new Error(
      `${field} is ${String(value.length)} characters long; a campaign's save file accepts at ` +
        `most ${String(MAX_ARTIFACT_SAFE_TEXT_LENGTH)} (limits.ts), so a longer one would build ` +
        'a campaign this build could write and then refuse to read back.'
    );
  }
}
