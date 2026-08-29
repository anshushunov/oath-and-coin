import type { ZodType } from 'zod';

import {
  EQUIPMENT_GRADE_NONE,
  SortedMap,
  compareContentIds,
  compareNeedIds,
  gradeFrom,
  parseContentId,
  type CombatRole,
  type ContentId,
  type HeroCapability,
  type HeroCombatLayer,
  type NeedId
} from '@oath-and-coin/simulation';

import { computeContentVersion } from './content-digest.ts';
import type { ContentFileSource } from './file-source.ts';
import {
  contractFileSchema,
  heroFileSchema,
  traitFileSchema,
  type ContractFile,
  type HeroFile,
  type TraitFile
} from './schemas.ts';
import { parseJsonFile, validateValue } from './strict-json.ts';
import { SUPPORTED_CONTENT_SCHEMA_VERSION } from './versions.ts';

/**
 * Everything the game was authored with, read from its source once. This package
 * is where files, paths and encodings live; the simulation core never touches any
 * of them (`ADR-002`), which is what lets its boundary rule ban every import
 * outright.
 *
 * "From its source", not "from disk": the loader is handed a
 * {@link ContentFileSource} rather than a directory, so the same code reads a
 * checkout under Node and a bundle in a browser. Everything below — the order the
 * three directories are read in, the version peek, the reference check — is what
 * it was; only where the bytes come from moved.
 */

/** Whether a trait contributes a strength to a decision or closes it outright (`HERO_DECISION_SPEC` §1.3). */
export type TraitKind = 'inclination' | 'principle';

/**
 * A named trait a hero can carry. `weight` is meaningful only for an inclination
 * and is always 0 for a principle: a red line has no strength, it closes the path.
 */
export interface TraitDefinition {
  readonly id: ContentId;
  readonly displayNameKey: string;
  readonly kind: TraitKind;
  readonly tag: ContentId;
  readonly weight: number;
}

/** One-directional: what the hero holding the record thinks about `hero`, never the reverse. */
export interface HeroRelationship {
  readonly hero: ContentId;
  readonly weight: number;
}

/** A hero as authored in content — the template a runtime hero is created from. */
export interface HeroDefinition {
  readonly id: ContentId;
  readonly displayNameKey: string;
  readonly greed: number;
  readonly caution: number;
  readonly pride: number;
  readonly trustInGuild: number;
  /**
   * What the hero can do (`DEC-013`, `RESOLUTION_SPEC` §2.2) — the layer kept apart
   * from the four scales above, both in the file format and here.
   *
   * `expertise` arrives as a `SortedMap` keyed by `compareNeedIds` rather than as the
   * object the file holds: declaration order, not the order the author happened to
   * type the keys in, is what reaches a canonical artifact, and a definition that
   * carried the file's own key order would make that artifact a function of authoring
   * style. An entry of `0` survives the trip — a hero answerable for a need at zero
   * skill is not the same hero as one the need is no business of (§2.2).
   */
  readonly capability: HeroCapability;
  /**
   * What the hero is made of in a fight (`DEC-016` §1) — the five attributes the file
   * states, carried through unchanged.
   *
   * This is where `capability.grade` now comes from: the file no longer states it, and
   * {@link toHeroDefinition} computes it with `gradeFrom` so that a definition and the save
   * that outlives it cannot disagree about how strong a hero is (`DEC-016` §3).
   */
  readonly combat: HeroCombatLayer;
  /** Which of the four jobs he holds (`COMBAT_SPEC` §3.3). */
  readonly role: CombatRole;
  readonly traits: readonly ContentId[];
  readonly relationships: readonly HeroRelationship[];
}

/**
 * A contract offer as authored in content. `tags` are what a hero's traits latch
 * onto (`HERO_DECISION_SPEC` §1.4) — a hero's trait names a tag, and a contract
 * carrying that same tag is where the trait has something to say.
 */
export interface ContractDefinition {
  readonly id: ContentId;
  readonly displayNameKey: string;
  readonly patronFee: number;
  readonly risk: number;
  readonly requiredCrew: number;
  /**
   * What the job asks for, and how much of each (`RESOLUTION_SPEC` §2.3): two or three
   * needs, every weight strictly positive. Keyed by `compareNeedIds` for the reason
   * {@link HeroDefinition.capability} gives — need order reaches the artifact.
   */
  readonly needs: SortedMap<NeedId, number>;
  readonly tags: readonly ContentId[];
  /**
   * The pair of mutually exclusive method tags the player chooses one of
   * (`NEGOTIATION_SPEC` §2.4). `[]`, never `undefined`, for a contract whose file
   * omits `negotiable_tags` — such a contract is negotiated on money and promise
   * only, and that is a definite fact about it, not an absent one.
   */
  readonly negotiableTags: readonly ContentId[];
}

export interface ContentSet {
  readonly heroes: SortedMap<ContentId, HeroDefinition>;
  readonly contracts: SortedMap<ContentId, ContractDefinition>;
  /**
   * Traits authored as standalone content, keyed by id. A hero's `traits` list
   * names these ids, and {@link loadContentSet} is where every such name is
   * resolved — after all three directories have been read, because until then
   * there is nothing complete to check against.
   */
  readonly traits: SortedMap<ContentId, TraitDefinition>;
  /**
   * A digest of the loaded files, not a declared constant: it is wrong to claim
   * "same content" for a tree that was edited, and this is the value a replay or a
   * bug report pins down (`TDD` §7.1).
   */
  readonly contentVersion: string;
}

/**
 * Reads `heroes/`, `contracts/` and `traits/` from `source`.
 *
 * @throws if a file is missing, unreadable, malformed, has an unknown property, has
 * a value outside its bounds, declares another format version, reuses an id another
 * file already defined, or a hero names a trait or a hero id nothing defines, twice,
 * or to itself. The message always names the file, and the JSON path when there is
 * one.
 */
export function loadContentSet(source: ContentFileSource): ContentSet {
  const seenIds = new Map<ContentId, string>();

  // Heroes and contracts before traits. The order among the three is free —
  // nothing here resolves a reference until all of them have been read — and it is
  // deliberately not "traits first": a content tree from before traits existed has
  // `heroes/` and `contracts/` and no `traits/` directory at all, and reading
  // traits first would make such a tree fail with "no 'traits' directory" before
  // ever reporting the schema_version mismatch that actually explains it.
  const heroes = SortedMap.from(
    compareContentIds,
    readDirectory(source, 'heroes', heroFileSchema).map(({ displayPath, file }) => {
      const id = parseContentId(file.id);
      requireUniqueId(seenIds, id, displayPath);
      return [id, toHeroDefinition(file)] as const;
    })
  );

  const contracts = SortedMap.from(
    compareContentIds,
    readDirectory(source, 'contracts', contractFileSchema).map(({ displayPath, file }) => {
      const id = parseContentId(file.id);
      requireUniqueId(seenIds, id, displayPath);
      return [id, toContractDefinition(file)] as const;
    })
  );

  const traits = SortedMap.from(
    compareContentIds,
    readDirectory(source, 'traits', traitFileSchema).map(({ displayPath, file }) => {
      const id = parseContentId(file.id);
      requireUniqueId(seenIds, id, displayPath);
      return [id, toTraitDefinition(file)] as const;
    })
  );

  validateReferences(heroes, traits);

  return { heroes, contracts, traits, contentVersion: computeContentVersion(source) };
}

/**
 * A `{ need: weight }` object from a file as the map the domain reads.
 *
 * The `undefined` filter is what a `partialRecord`'s type says rather than what a parse
 * produces — an absent key is absent, never present holding `undefined` — but writing it
 * out is cheaper than an assertion, and it is the one place where "no entry" and "an
 * entry of zero" could be conflated by accident. Zero is kept (`RESOLUTION_SPEC` §2.2).
 */
function toNeedMap(authored: Partial<Record<string, number>>): SortedMap<NeedId, number> {
  return SortedMap.from(
    compareNeedIds,
    Object.entries(authored)
      .filter((entry): entry is [string, number] => entry[1] !== undefined)
      .map(([need, weight]) => [need as NeedId, weight] as const)
  );
}

function toHeroDefinition(file: HeroFile): HeroDefinition {
  return {
    id: parseContentId(file.id),
    displayNameKey: file.display_name_key,
    greed: file.greed,
    caution: file.caution,
    pride: file.pride,
    trustInGuild: file.trust_in_guild,
    capability: {
      // Derived, never read from the file — `DEC-016` §3 retired the authored constant, and
      // `heroCapabilityFileSchema` refuses the key by name so a stale one cannot slip back.
      grade: gradeFrom(file.combat, EQUIPMENT_GRADE_NONE),
      expertise: toNeedMap(file.capability.expertise)
    },
    combat: file.combat,
    role: file.role,
    traits: file.traits.map((trait) => parseContentId(trait)),
    relationships: file.relationships.map((relationship) => ({
      hero: parseContentId(relationship.hero),
      weight: relationship.weight
    }))
  };
}

function toContractDefinition(file: ContractFile): ContractDefinition {
  return {
    id: parseContentId(file.id),
    displayNameKey: file.display_name_key,
    patronFee: file.patron_fee,
    risk: file.risk,
    requiredCrew: file.required_crew,
    needs: toNeedMap(file.needs),
    tags: file.tags.map((tag) => parseContentId(tag)),
    negotiableTags: (file.negotiable_tags ?? []).map((tag) => parseContentId(tag))
  };
}

/**
 * The rule that gives weight its meaning is enforced by the contract rather than
 * here: the trait contract is a union discriminated on `kind`, so a principle
 * carrying a weight and an inclination missing one are both rejected before this
 * function runs. All that is left is to state the domain's own convention — a
 * principle weighs 0, because it closes the decision instead of contributing to it.
 */
function toTraitDefinition(file: TraitFile): TraitDefinition {
  return {
    id: parseContentId(file.id),
    displayNameKey: file.display_name_key,
    kind: file.kind,
    tag: parseContentId(file.tag),
    weight: file.kind === 'inclination' ? file.weight : 0
  };
}

/**
 * Checks every hero's `traits` and `relationships` against the dictionaries built
 * from all three directories.
 *
 * @throws if a hero names a trait no trait file defines, lists the same trait
 * twice, holds a relationship to itself, holds a relationship to a hero no hero
 * file defines, or holds more than one relationship to the same hero.
 */
function validateReferences(
  heroes: SortedMap<ContentId, HeroDefinition>,
  traits: SortedMap<ContentId, TraitDefinition>
): void {
  for (const hero of heroes.values()) {
    const seenTraits = new Set<ContentId>();
    for (const trait of hero.traits) {
      if (!traits.has(trait)) {
        throw new Error(
          `Hero '${hero.id}' references trait '${trait}', which no trait file defines.`
        );
      }
      if (seenTraits.has(trait)) {
        throw new Error(`Hero '${hero.id}' lists trait '${trait}' more than once.`);
      }
      seenTraits.add(trait);
    }

    const seenTargets = new Set<ContentId>();
    for (const bond of hero.relationships) {
      if (bond.hero === hero.id) {
        throw new Error(`Hero '${hero.id}' holds a relationship to itself.`);
      }
      if (!heroes.has(bond.hero)) {
        throw new Error(
          `Hero '${hero.id}' holds a relationship to '${bond.hero}', which no hero file defines.`
        );
      }
      if (seenTargets.has(bond.hero)) {
        throw new Error(`Hero '${hero.id}' holds more than one relationship to '${bond.hero}'.`);
      }
      seenTargets.add(bond.hero);
    }
  }
}

interface ReadFile<TFile> {
  /** As the source names it in diagnostics, which is the only use this has. */
  readonly displayPath: string;
  readonly file: TFile;
}

/**
 * Reads every `*.json` under one content directory, in ordinal path order.
 *
 * The version is checked against a bare peek at the JSON, before the contract is
 * applied: a file authored for an earlier version legitimately lacks fields this
 * version requires, and validating it straight against the contract would report
 * those missing fields rather than the version mismatch that explains them.
 */
function readDirectory<TFile>(
  source: ContentFileSource,
  subdirectory: string,
  schema: ZodType<TFile>
): readonly ReadFile<TFile>[] {
  // A directory the source holds nothing under, rather than a `stat` on a
  // filesystem: a source is a set of files, and a directory that exists with
  // nothing in it is not something every source can even represent. The refusal
  // is what matters and it is unchanged — a tree from before traits existed still
  // fails naming the directory it lacks rather than loading zero traits and
  // pretending the content set is complete.
  if (source.list(subdirectory).length === 0) {
    throw new Error(`Content root has no '${subdirectory}' directory.`);
  }

  // Paths arrive relative to the source root rather than to the subdirectory, so
  // nothing here has to put two path fragments back together — and how one is
  // named in a message is the source's answer, so a diagnostic reads the way an
  // author thinks about the tree whichever source produced it.
  return source.list(subdirectory, '.json').map((path) => {
    const displayPath = source.describe(path);
    const value = parseJsonFile(source, path);
    requireSupportedSchemaVersion(peekSchemaVersion(displayPath, value), displayPath);

    return { displayPath, file: validateValue(displayPath, value, schema) };
  });
}

/** Reads only `schema_version`, without binding the rest of the file to any version's shape. */
function peekSchemaVersion(displayPath: string, value: unknown): number {
  const version =
    typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)['schema_version']
      : undefined;

  if (typeof version !== 'number' || !Number.isInteger(version)) {
    throw new Error(
      `Content file '${displayPath}' has no integer 'schema_version' property.`
    );
  }

  return version;
}

function requireSupportedSchemaVersion(schemaVersion: number, displayPath: string): void {
  if (schemaVersion !== SUPPORTED_CONTENT_SCHEMA_VERSION) {
    throw new Error(
      `Content file '${displayPath}' declares schema_version ${schemaVersion}, but this build ` +
        `reads version ${SUPPORTED_CONTENT_SCHEMA_VERSION}. Migrate the file, or run a build that ` +
        'understands its version — reading it under the wrong version would be a guess.'
    );
  }
}

function requireUniqueId(
  seenIds: Map<ContentId, string>,
  id: ContentId,
  displayPath: string
): void {
  const firstPath = seenIds.get(id);
  if (firstPath !== undefined) {
    throw new Error(
      `Duplicate content id '${id}': defined in both '${firstPath}' and '${displayPath}'.`
    );
  }

  seenIds.set(id, displayPath);
}
