import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Holds three statements of the content rules to each other.
 *
 * Until cutover (Task 19) two stacks read schemas: this one validates through the Zod
 * contracts, the .NET one still reads the hand-written `schemas/*.schema.json`. That
 * is two documents plus the TypeScript constants the loader enforces — three
 * statements of one rule, which `bounds.ts` says is only safe while something checks
 * that they still agree. This is that something, and it is the successor to the C#
 * side's `SchemaAgreementTests`.
 *
 * Two independent failures are reported:
 *
 * 1. **The generated schemas are stale.** Regenerated in memory and compared byte for
 *    byte against what is committed, so a contract edited without running
 *    `pnpm schema:generate` cannot ship an artifact that describes the previous rules.
 * 2. **The hand-written schemas drift from the constants.** Every number, pattern and
 *    pin below is asserted against the value the loader actually enforces. A range
 *    raised in one place and not the other is how content becomes valid for one stack
 *    and invalid for the other.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const schemasDirectory = join(repoRoot, 'schemas');

// `pathToFileURL`, not the bare path: on Windows an absolute path starts with a
// drive letter, and the ESM loader reads `c:` as a URL scheme it does not support.
const moduleAt = (...segments) => import(pathToFileURL(join(repoRoot, ...segments)).href);

const { generateJsonSchemas, renderJsonSchema } = await moduleAt(
  'packages',
  'content',
  'src',
  'json-schema.ts'
);
const bounds = await moduleAt('packages', 'content', 'src', 'bounds.ts');
const limits = await moduleAt('packages', 'content', 'src', 'limits.ts');
const versions = await moduleAt('packages', 'content', 'src', 'versions.ts');
const { CONTENT_ID_PATTERN } = await moduleAt(
  'packages',
  'simulation',
  'src',
  'ids',
  'content-id.ts'
);

const failures = [];

function fail(message) {
  failures.push(message);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** The value at a dotted path, or `undefined` — reported as a failure by the caller. */
function at(document, path) {
  return path.split('.').reduce((value, key) => (value == null ? undefined : value[key]), document);
}

function expect(file, path, actual, expected) {
  const rendered = JSON.stringify(expected);
  if (JSON.stringify(actual) !== rendered) {
    fail(`${file}: ${path} is ${JSON.stringify(actual)}, expected ${rendered}`);
  }
}

// ---------------------------------------------------------------------------
// 1. The committed generated schemas are what the contracts produce right now.
// ---------------------------------------------------------------------------

for (const [fileName, document] of Object.entries(generateJsonSchemas())) {
  const path = join(schemasDirectory, 'generated', fileName);
  let committed;
  try {
    committed = readFileSync(path, 'utf8');
  } catch {
    fail(`schemas/generated/${fileName} is missing; run \`pnpm schema:generate\`.`);
    continue;
  }

  if (committed !== renderJsonSchema(document)) {
    fail(
      `schemas/generated/${fileName} is stale — the Zod contracts produce different bytes. ` +
        'Run `pnpm schema:generate`.'
    );
  }
}

// ---------------------------------------------------------------------------
// 2. The hand-written schemas the .NET stack reads state the same rules.
// ---------------------------------------------------------------------------

const heroScale = { minimum: bounds.TRAIT_MIN, maximum: bounds.TRAIT_MAX };

const expectations = {
  'hero.schema.json': {
    'properties.schema_version.const': versions.SUPPORTED_CONTENT_SCHEMA_VERSION,
    'properties.id.pattern': CONTENT_ID_PATTERN,
    'properties.display_name_key.minLength': 1,
    'properties.greed.minimum': heroScale.minimum,
    'properties.greed.maximum': heroScale.maximum,
    'properties.caution.minimum': heroScale.minimum,
    'properties.caution.maximum': heroScale.maximum,
    'properties.pride.minimum': heroScale.minimum,
    'properties.pride.maximum': heroScale.maximum,
    'properties.trust_in_guild.minimum': heroScale.minimum,
    'properties.trust_in_guild.maximum': heroScale.maximum,
    'properties.traits.maxItems': limits.MAX_TRAITS_PER_HERO,
    'properties.traits.items.pattern': CONTENT_ID_PATTERN,
    'properties.relationships.maxItems': limits.MAX_RELATIONSHIPS_PER_HERO,
    'properties.relationships.items.properties.hero.pattern': CONTENT_ID_PATTERN,
    'properties.relationships.items.properties.weight.minimum': bounds.RELATIONSHIP_WEIGHT_MIN,
    'properties.relationships.items.properties.weight.maximum': bounds.RELATIONSHIP_WEIGHT_MAX,
    'properties.relationships.items.additionalProperties': false,
    additionalProperties: false
  },
  'contract.schema.json': {
    'properties.schema_version.const': versions.SUPPORTED_CONTENT_SCHEMA_VERSION,
    'properties.id.pattern': CONTENT_ID_PATTERN,
    'properties.display_name_key.minLength': 1,
    'properties.payment.minimum': bounds.PAYMENT_MIN,
    'properties.payment.maximum': bounds.PAYMENT_MAX,
    'properties.risk.minimum': bounds.RISK_MIN,
    'properties.risk.maximum': bounds.RISK_MAX,
    'properties.required_crew.minimum': bounds.REQUIRED_CREW_MIN,
    'properties.required_crew.maximum': bounds.REQUIRED_CREW_MAX,
    'properties.tags.maxItems': limits.MAX_TAGS_PER_CONTRACT,
    'properties.tags.items.pattern': CONTENT_ID_PATTERN,
    additionalProperties: false
  },
  'trait.schema.json': {
    'properties.schema_version.const': versions.SUPPORTED_CONTENT_SCHEMA_VERSION,
    'properties.id.pattern': CONTENT_ID_PATTERN,
    'properties.tag.pattern': CONTENT_ID_PATTERN,
    'properties.display_name_key.minLength': 1,
    'properties.kind.enum': ['inclination', 'principle'],
    'properties.weight.minimum': bounds.INCLINATION_WEIGHT_MIN,
    'properties.weight.maximum': bounds.INCLINATION_WEIGHT_MAX,
    additionalProperties: false
  },
  'locale.schema.json': {
    'properties.schema_version.const': versions.SUPPORTED_LOCALE_SCHEMA_VERSION,
    'properties.locale.minLength': 1,
    'properties.entries.additionalProperties.minLength': 1,
    additionalProperties: false
  }
};

for (const [fileName, paths] of Object.entries(expectations)) {
  const document = readJson(join(schemasDirectory, fileName));
  for (const [path, expected] of Object.entries(paths)) {
    expect(fileName, path, at(document, path), expected);
  }
}

// ---------------------------------------------------------------------------
// 3. One asymmetry between the two documents, recorded rather than discovered.
// ---------------------------------------------------------------------------

// Zod has no way to express "every item is distinct", so the generated schema does
// not carry `uniqueItems` and the hand-written one does. That is a real difference,
// and it is stated here so it stays a known limit instead of turning into "somebody
// forgot". The loader's own behaviour is not symmetric either and is pinned by tests:
// a repeated *trait* is refused by name, while a repeated *tag* is absorbed by the
// set the contract state holds — which is what the C# loader did too.
for (const [fileName, arrayProperty] of [
  ['hero.schema.json', 'traits'],
  ['contract.schema.json', 'tags']
]) {
  const handWritten = readJson(join(schemasDirectory, fileName));
  if (at(handWritten, `properties.${arrayProperty}.uniqueItems`) !== true) {
    fail(
      `${fileName}: properties.${arrayProperty}.uniqueItems is expected to stay true — it is the ` +
        'one constraint the hand-written schema carries and the generated one cannot.'
    );
  }

  const generated = readJson(join(schemasDirectory, 'generated', fileName));
  if (at(generated, `properties.${arrayProperty}.uniqueItems`) !== undefined) {
    fail(
      `schemas/generated/${fileName}: properties.${arrayProperty}.uniqueItems appeared. Zod cannot ` +
        'express it, so either the contracts gained a way to and this check is out of date, or the ' +
        'generated file was edited by hand.'
    );
  }
}

if (failures.length > 0) {
  console.error(`schema:check found ${failures.length} disagreement(s):`);
  for (const failure of failures) {
    console.error(`  ${failure}`);
  }
  process.exit(1);
}

console.log(
  'schema:check: the Zod contracts, the generated schemas and the hand-written schemas agree.'
);
