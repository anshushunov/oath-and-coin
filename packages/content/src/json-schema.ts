import { z } from 'zod';

import { CONTENT_DIRECTORIES, SCHEMA_FILE_NAMES, type ContentDirectory } from './schemas.ts';

/**
 * JSON Schema emitted from the Zod contracts, which is what makes Zod the single
 * source of truth `ADR-010` asks for rather than one of two.
 *
 * Until cutover (Task 19) the C# stack still validates against the hand-written
 * `schemas/*.schema.json`, so there are two schema documents per content type. That
 * is exactly the arrangement `bounds.ts` describes and `schema:check` polices: two
 * independent statements of one rule are safe only while something checks that they
 * still say the same thing. What is *not* allowed is a third statement, and this
 * module is what keeps the generated half from becoming one — it is derived, never
 * edited.
 *
 * `$id` and `title` are added here rather than as Zod metadata because they are
 * facts about the file, not about the contract: the same contract validating a
 * stream instead of a file would want neither.
 */

const TITLES: Readonly<Record<ContentDirectory, string>> = {
  heroes: 'Hero definition',
  contracts: 'Contract definition',
  traits: 'Trait definition',
  locale: 'Locale catalogue'
};

const DESCRIPTION =
  'Generated from the Zod contracts in packages/content/src/schemas.ts — do not edit. ' +
  'Regenerate with `pnpm schema:generate`; `pnpm schema:check` fails if this file and ' +
  'the contracts disagree, or if the numbers here drift from the hand-written schema ' +
  'the .NET stack still reads until cutover.';

/** The generated document for one content directory. */
export function jsonSchemaFor(directory: ContentDirectory): Record<string, unknown> {
  const generated = z.toJSONSchema(CONTENT_DIRECTORIES[directory], {
    target: 'draft-2020-12',
    // A contract this repository cannot represent as a schema has to be a visible
    // failure, not a schema quietly missing a constraint the loader enforces.
    unrepresentable: 'throw'
  }) as Record<string, unknown>;

  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: `https://oath-and-coin.invalid/schemas/generated/${SCHEMA_FILE_NAMES[directory]}`,
    title: TITLES[directory],
    description: DESCRIPTION,
    ...generated
  };
}

/** Every generated document, keyed by the file name it is written to. */
export function generateJsonSchemas(): Readonly<Record<string, Record<string, unknown>>> {
  const generated: Record<string, Record<string, unknown>> = {};

  for (const directory of Object.keys(CONTENT_DIRECTORIES) as readonly ContentDirectory[]) {
    generated[SCHEMA_FILE_NAMES[directory]] = jsonSchemaFor(directory);
  }

  return generated;
}

/**
 * The exact bytes a generated schema file holds: two-space JSON with a trailing
 * newline.
 *
 * Rendered in one place so the generator and the check cannot disagree about
 * formatting — a check that re-rendered differently would report a diff on every
 * run and be switched off within a week.
 */
export function renderJsonSchema(document: Record<string, unknown>): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}
