import { CONTENT_ID_PATTERN } from '@oath-and-coin/simulation';
import { z } from 'zod';

import {
  INCLINATION_WEIGHT_MAX,
  INCLINATION_WEIGHT_MIN,
  PAYMENT_MAX,
  PAYMENT_MIN,
  RELATIONSHIP_WEIGHT_MAX,
  RELATIONSHIP_WEIGHT_MIN,
  REQUIRED_CREW_MAX,
  REQUIRED_CREW_MIN,
  RISK_MAX,
  RISK_MIN,
  TRAIT_MAX,
  TRAIT_MIN
} from './bounds.ts';
import {
  MAX_ARTIFACT_SAFE_TEXT_LENGTH,
  MAX_RELATIONSHIPS_PER_HERO,
  MAX_TAGS_PER_CONTRACT,
  MAX_TRAITS_PER_HERO
} from './limits.ts';
import { SUPPORTED_CONTENT_SCHEMA_VERSION, SUPPORTED_LOCALE_SCHEMA_VERSION } from './versions.ts';

/**
 * The on-disk shape of every data file, as Zod contracts — validation stage 1 from
 * `TDD` §11.2, and the single source the JSON Schemas in `schemas/generated/` are
 * emitted from.
 *
 * Two things the C# arrangement needed and this one does not. It had a
 * `HeroFile`/`ContractFile`/`TraitFile` record *per file type* separate from the
 * domain record, because a deserialization target is shaped by the file format
 * while a domain record is shaped by the domain — here the parsed type is inferred
 * from the contract, so there is no hand-written second declaration to drift. And
 * it had a naming policy mapping `snake_case` to properties spelled in PascalCase;
 * these contracts name the on-disk field directly, so there is no second spelling
 * for a schema to disagree with.
 *
 * `strictObject` throughout, never `object`: Zod's default strips an unknown key
 * silently, which is the `UnmappedMemberHandling.Disallow` guarantee inverted. A
 * misspelled field has to be an error, not a field that quietly does nothing.
 */

const contentIdString = z.string().regex(new RegExp(CONTENT_ID_PATTERN));

/**
 * A localization key, never a player-facing literal (`TDD` §11.1): dot-separated
 * lowercase segments, as in `hero.core.bram.name`.
 *
 * It was `z.string().min(1)` and that was a blocker external review found. A key
 * travels unchanged into `HeroState.displayNameKey` and from there into the canonical
 * determinism artifact, so `min(1)` let a Cyrillic character, a control character or a
 * string of spaces reach it — the first two being exactly where the frozen corpus
 * records that the old C# writer and RFC 8785 emit different bytes. The argument for
 * leaving the artifact version at 3 rests on that being impossible, so it has to be
 * impossible rather than merely absent from today's files.
 *
 * The whitespace-only case was a second, plainer defect: `min(1)` accepted `'   '`
 * where the C# loader refused it through `IsNullOrWhiteSpace`, so the port was laxer
 * than the original on a field that ends up on screen.
 */
export const LOCALIZATION_KEY_PATTERN = '^[a-z][a-z0-9_]*(\\.[a-z0-9_]+)*$';

/**
 * The pattern *and* a length, and the length is the half external review of Task 16
 * found missing. `display_name_key` travels unchanged into `HeroState.displayNameKey`
 * and from there into a save file, where `snapshot-codec.ts` holds the same field to
 * {@link MAX_ARTIFACT_SAFE_TEXT_LENGTH}. Stating the pattern here and the length only
 * there left content this loader accepts and this build's own save reader refuses —
 * measured, not feared: a 257-character key loaded, was written, and came back
 * `SAVE_OUT_OF_BOUNDS`. One declaration, `limits.ts`, applied at both ends.
 */
const localizationKey = z
  .string()
  .max(MAX_ARTIFACT_SAFE_TEXT_LENGTH)
  .regex(new RegExp(LOCALIZATION_KEY_PATTERN));

const contentSchemaVersion = z.literal(SUPPORTED_CONTENT_SCHEMA_VERSION);

/** A hero scale — greed, caution, pride, trust. One range, stated once (see `bounds.ts`). */
const heroScale = z.int().min(TRAIT_MIN).max(TRAIT_MAX);

export const relationshipFileSchema = z.strictObject({
  hero: contentIdString,
  weight: z.int().min(RELATIONSHIP_WEIGHT_MIN).max(RELATIONSHIP_WEIGHT_MAX)
});

export const heroFileSchema = z.strictObject({
  schema_version: contentSchemaVersion,
  id: contentIdString,
  display_name_key: localizationKey,
  greed: heroScale,
  caution: heroScale,
  pride: heroScale,
  trust_in_guild: heroScale,
  traits: z.array(contentIdString).max(MAX_TRAITS_PER_HERO),
  relationships: z.array(relationshipFileSchema).max(MAX_RELATIONSHIPS_PER_HERO)
});

export const contractFileSchema = z.strictObject({
  schema_version: contentSchemaVersion,
  id: contentIdString,
  display_name_key: localizationKey,
  payment: z.int().min(PAYMENT_MIN).max(PAYMENT_MAX),
  risk: z.int().min(RISK_MIN).max(RISK_MAX),
  required_crew: z.int().min(REQUIRED_CREW_MIN).max(REQUIRED_CREW_MAX),
  tags: z.array(contentIdString).max(MAX_TAGS_PER_CONTRACT)
});

/**
 * A trait, as a union discriminated on `kind` rather than as one object with an
 * optional weight plus a check afterwards.
 *
 * This is where the port is stricter than its original by construction instead of
 * by vigilance. The C# loader parsed a `TraitFile` with a nullable `Weight` and
 * then enforced the rule in two hand-written branches — "a principle must not
 * declare weight", "an inclination must declare weight" — which is a rule the type
 * did not hold, only the code did. Here a principle branch that has no `weight`
 * field at all rejects one through `strictObject`, and an inclination branch that
 * requires it rejects its absence, so the rule holds in the contract. It also emits
 * the same `anyOf` the hand-written JSON Schema spells as `oneOf`.
 *
 * The rule itself is `HERO_DECISION_SPEC` §1.3: a red line has no strength, it
 * closes the path.
 */
export const traitFileSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    schema_version: contentSchemaVersion,
    id: contentIdString,
    display_name_key: localizationKey,
    kind: z.literal('inclination'),
    tag: contentIdString,
    weight: z.int().min(INCLINATION_WEIGHT_MIN).max(INCLINATION_WEIGHT_MAX)
  }),
  z.strictObject({
    schema_version: contentSchemaVersion,
    id: contentIdString,
    display_name_key: localizationKey,
    kind: z.literal('principle'),
    tag: contentIdString
  })
]);

/**
 * A locale catalogue.
 *
 * The asymmetry here is deliberate and is the line `TDD` §11.1 draws: entry *keys* are
 * localization keys and are held to the same pattern content is, because they have to
 * match what content declares. Entry *values* are player-facing text and stay
 * unconstrained — they are Cyrillic today, and a rule that forbade that would forbid
 * the game having a language. Values never reach a canonical artifact: the read model
 * carries keys all the way through, precisely so its hash is a property of game state
 * rather than of the player's language.
 */
export const localeFileSchema = z.strictObject({
  schema_version: z.literal(SUPPORTED_LOCALE_SCHEMA_VERSION),
  // Left as "non-empty", matching the C# loader exactly. Tightening it to a language
  // tag would be a divergence no finding asked for, and this field never reaches an
  // artifact.
  locale: z.string().min(1),
  entries: z.record(localizationKey, z.string().min(1))
});

export type HeroFile = z.infer<typeof heroFileSchema>;
export type ContractFile = z.infer<typeof contractFileSchema>;
export type TraitFile = z.infer<typeof traitFileSchema>;
export type LocaleFile = z.infer<typeof localeFileSchema>;

/**
 * Which contract applies to a file is decided by the top-level directory it sits
 * in, exactly as the C# validator decided it: `heroes/` is a hero, `contracts/` a
 * contract, `traits/` a trait, `locale/` a locale catalogue.
 *
 * A file in a directory no contract is registered for is itself a violation, not a
 * file to skip — silently ignoring unknown content is how a validation stage
 * reports success over data it never looked at.
 */
export const CONTENT_DIRECTORIES = {
  heroes: heroFileSchema,
  contracts: contractFileSchema,
  traits: traitFileSchema,
  locale: localeFileSchema
} as const;

/** The schema file each content directory is emitted to and validated against. */
export const SCHEMA_FILE_NAMES = {
  heroes: 'hero.schema.json',
  contracts: 'contract.schema.json',
  traits: 'trait.schema.json',
  locale: 'locale.schema.json'
} as const;

export type ContentDirectory = keyof typeof CONTENT_DIRECTORIES;
