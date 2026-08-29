import { COMBAT_ROLES, CONTENT_ID_PATTERN, NEED_IDS } from '@oath-and-coin/simulation';
import { z } from 'zod';

import {
  CAPABILITY_EXPERTISE_MAX,
  CAPABILITY_EXPERTISE_MIN,
  COMBAT_ATTRIBUTE_MAX,
  COMBAT_ATTRIBUTE_MIN,
  INCLINATION_WEIGHT_MAX,
  INCLINATION_WEIGHT_MIN,
  NEED_WEIGHT_MAX,
  NEED_WEIGHT_MIN,
  PATRON_FEE_MAX,
  PATRON_FEE_MIN,
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
  MAX_NEEDS_PER_CONTRACT,
  MAX_RELATIONSHIPS_PER_HERO,
  MAX_TAGS_PER_CONTRACT,
  MAX_TRAITS_PER_HERO,
  MIN_NEEDS_PER_CONTRACT,
  NEGOTIABLE_TAGS_COUNT
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

/**
 * One combat attribute (`DEC-016` §1).
 *
 * Its own bounds rather than `heroScale`'s, and the two are deliberately not the same
 * declaration even though the numbers coincide: `BQ-013`'s instruction is that the combat
 * layer must not be raisable by an edit aimed at a motivational scale, and sharing this
 * line would make exactly that edit one keystroke.
 */
const combatAttribute = z.int().min(COMBAT_ATTRIBUTE_MIN).max(COMBAT_ATTRIBUTE_MAX);

export const relationshipFileSchema = z.strictObject({
  hero: contentIdString,
  weight: z.int().min(RELATIONSHIP_WEIGHT_MIN).max(RELATIONSHIP_WEIGHT_MAX)
});

/**
 * A map keyed by the engine's need vocabulary, with any subset of the keys present.
 *
 * `z.partialRecord`, never `z.record(z.enum(NEED_IDS), …)`. The second form is the one
 * that reads right and is wrong: in Zod 4 a record over an enum requires *every* member
 * of that enum, so a contract naming two needs of the three — the ordinary shape, and
 * the one `RESOLUTION_SPEC` §2.3 describes — would be refused for the need it
 * deliberately does not ask for, and a hero would have to declare expertise in
 * everything. What both fields need is the closed key set without the completeness:
 * an unknown key is an error (a misspelled need is a need nothing can ever cover), a
 * missing key is a fact.
 *
 * The vocabulary itself comes from `@oath-and-coin/simulation`, the same one-directional
 * import `CONTENT_ID_PATTERN` already arrives through (`ADR-002`): needs are engine
 * lexicon, and content authors a *weight* per need, never a need.
 */
const needKeyedMap = (value: z.ZodType<number>): z.ZodType<Partial<Record<string, number>>> =>
  z.partialRecord(z.enum(NEED_IDS), value);

/**
 * What a hero can do (`DEC-013`, `RESOLUTION_SPEC` §2.2) — required, which is why the
 * content format version moves with it.
 *
 * `expertise` may name any subset of the needs, including none, and an entry of `0` is
 * kept rather than treated as absence: `expertise.has(need)` means the hero is
 * *answerable* for that need even at zero skill, and answerability is what decides which
 * need can earn him `faltered_early` and whether he is eligible for a wound. On the
 * arithmetic of coverage the two forms are identical — both contribute nothing — which
 * is exactly why the distinction has to survive the file rather than be inferred from
 * the number.
 */
export const heroCapabilityFileSchema = z.strictObject({
  expertise: needKeyedMap(z.int().min(CAPABILITY_EXPERTISE_MIN).max(CAPABILITY_EXPERTISE_MAX))
});

/**
 * What a hero is made of in a fight (`DEC-016` §1, `COMBAT_SPEC` §3.6) — five attributes,
 * all required, all `0..100`.
 *
 * **`grade` left `capability` in the same change and is not here either.** It is now
 * derived from these five plus equipment (`DEC-016` §3), and a file that still stated it
 * would be the second, independently editable truth about a hero's strength that
 * `DEC-013` §Проверка made it an obligation to remove. `strictObject` refuses it by name,
 * which is what turns "should not be authored" into "cannot be".
 */
export const heroCombatFileSchema = z.strictObject({
  might: combatAttribute,
  guard: combatAttribute,
  aim: combatAttribute,
  focus: combatAttribute,
  care: combatAttribute
});

export const heroFileSchema = z.strictObject({
  schema_version: contentSchemaVersion,
  id: contentIdString,
  display_name_key: localizationKey,
  greed: heroScale,
  caution: heroScale,
  pride: heroScale,
  trust_in_guild: heroScale,
  capability: heroCapabilityFileSchema,
  combat: heroCombatFileSchema,
  /**
   * Which of the four jobs he holds (`COMBAT_SPEC` §3.3). The vocabulary is the engine's,
   * like `NEED_IDS`: content states a role, never invents one.
   */
  role: z.enum(COMBAT_ROLES),
  traits: z.array(contentIdString).max(MAX_TRAITS_PER_HERO),
  relationships: z.array(relationshipFileSchema).max(MAX_RELATIONSHIPS_PER_HERO)
});

/**
 * `negotiable_tags`: the pair of mutually exclusive method tags a contract offers
 * the player a choice between (`NEGOTIATION_SPEC` §2.4). Optional — most contracts
 * are negotiated on money and promise only — but when present it is exactly two
 * *distinct* tags, neither of which the contract already carries in `tags`: a tag
 * the contract already has is not a choice, a set of one or three is not the
 * either/or the spec describes, and two copies of the same tag is a choice between
 * a thing and itself — which is the one case the field exists to rule out and the
 * count check alone does not catch (`['x','x']` has length 2).
 *
 * A fourth check joins them below: a contract that already authors
 * `MAX_TAGS_PER_CONTRACT` tags in `tags` and still declares `negotiable_tags` can
 * never have a method chosen, because the choice would push the effective tag count
 * one past the ceiling `createContractState` enforces at runtime
 * (`offer-state.ts`) — a content-authoring defect this loader can see before play
 * ever reaches it.
 *
 * All four checks live in `superRefine` rather than on the array alone: the count
 * check could stand on its own, but the other three each need the rest of the
 * object (the contract's own `id`, and — for the intersection and tag-ceiling
 * checks — `tags`) to produce a message that names what is wrong, not just that
 * something is.
 */
export const contractFileSchema = z
  .strictObject({
    schema_version: contentSchemaVersion,
    id: contentIdString,
    display_name_key: localizationKey,
    patron_fee: z.int().min(PATRON_FEE_MIN).max(PATRON_FEE_MAX),
    risk: z.int().min(RISK_MIN).max(RISK_MAX),
    required_crew: z.int().min(REQUIRED_CREW_MIN).max(REQUIRED_CREW_MAX),
    needs: needKeyedMap(z.int().min(NEED_WEIGHT_MIN).max(NEED_WEIGHT_MAX)),
    tags: z.array(contentIdString).max(MAX_TAGS_PER_CONTRACT),
    negotiable_tags: z.array(contentIdString).optional()
  })
  .superRefine((file, ctx) => {
    // How many needs, checked here rather than on the field: `partialRecord` states
    // which keys are legal and says nothing about how many of them a file must use, and
    // a contract naming one need is the degenerate case `RESOLUTION_SPEC` §2.3 refuses —
    // "take the strongest" becomes the optimal answer and the coverage model stops
    // deciding anything. The ceiling is checked alongside it for symmetry; today the
    // vocabulary already enforces it, and the day a fourth need is authored it will not.
    const needCount = Object.keys(file.needs).length;
    if (needCount < MIN_NEEDS_PER_CONTRACT || needCount > MAX_NEEDS_PER_CONTRACT) {
      ctx.addIssue({
        code: 'custom',
        path: ['needs'],
        message:
          `Contract '${file.id}' names ${String(needCount)} need(s); a contract must name ` +
          `between ${String(MIN_NEEDS_PER_CONTRACT)} and ${String(MAX_NEEDS_PER_CONTRACT)} ` +
          '— one need makes taking the strongest hero the answer to every contract, which ' +
          'is the kill-criterion the coverage model exists to avoid (RESOLUTION_SPEC §2.3).'
      });
    }

    const negotiableTags = file.negotiable_tags;
    if (negotiableTags === undefined) {
      return;
    }

    if (negotiableTags.length !== NEGOTIABLE_TAGS_COUNT) {
      ctx.addIssue({
        code: 'custom',
        path: ['negotiable_tags'],
        message:
          `Contract '${file.id}' declares ${negotiableTags.length} negotiable tag(s); ` +
          `'negotiable_tags' must name exactly ${NEGOTIABLE_TAGS_COUNT} — a player choice needs ` +
          'two mutually exclusive options, not one and not three (NEGOTIATION_SPEC §2.4).'
      });
      return;
    }

    const repeated = negotiableTags.find(
      (tag, index) => negotiableTags.indexOf(tag) !== index
    );
    if (repeated !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['negotiable_tags'],
        message:
          `Contract '${file.id}' names tag '${repeated}' twice in 'negotiable_tags'; the two ` +
          'entries must be distinct, or the player would be offered a choice between one thing ' +
          'and itself.'
      });
      return;
    }

    for (const tag of negotiableTags) {
      if (file.tags.includes(tag)) {
        ctx.addIssue({
          code: 'custom',
          path: ['negotiable_tags'],
          message:
            `Contract '${file.id}' already carries tag '${tag}' in 'tags'; a negotiable tag must ` +
            'be one the contract does not already carry, or there would be nothing left to choose ' +
            'between.'
        });
      }
    }

    // A chosen method tag joins `tags` (`NEGOTIATION_SPEC` §2.4), and `createContractState`
    // refuses an effective tag set past `MAX_TAGS_PER_CONTRACT` (`offer-state.ts`) — defence
    // in depth, not the only place this has to be caught. A contract that already carries
    // the ceiling in `tags` and still declares `negotiable_tags` can never have a method
    // chosen at all: every one of the two candidates would push the count to
    // `MAX_TAGS_PER_CONTRACT + 1` the instant it was picked, so the state-level guard would
    // fire on the very first `chooseMethod`, in play, on content that loaded without
    // complaint. Ruled a content-authoring defect rather than a runtime one, so it is
    // caught here, at load, the same way the other three shapes above are.
    if (file.tags.length + 1 > MAX_TAGS_PER_CONTRACT) {
      ctx.addIssue({
        code: 'custom',
        path: ['negotiable_tags'],
        message:
          `Contract '${file.id}' authors ${String(file.tags.length)} tags and also declares ` +
          `'negotiable_tags'; choosing either candidate would carry the contract's effective ` +
          `tags to ${String(file.tags.length + 1)}, past the ceiling of ` +
          `${String(MAX_TAGS_PER_CONTRACT)} (MAX_TAGS_PER_CONTRACT) — no method could ever be ` +
          "chosen. Reduce 'tags' before this contract can offer a choice."
      });
    }
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
