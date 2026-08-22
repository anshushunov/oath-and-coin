import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Holds three statements of the content rules to each other.
 *
 * **Why the hand-written schemas outlived the stack that read them.** Until cutover
 * (Task 19) two stacks read schemas: this one validates through the Zod contracts,
 * the .NET one read the hand-written `schemas/*.schema.json`. Deleting that stack
 * removed a reader and not the reason. The generated schemas are a projection of the
 * Zod contracts, so comparing the two can only ever find a *stale artifact* — never a
 * bound that moved. The hand-written document is the one statement of the content
 * rules that is not derived from the loader's own code, which makes it the only thing
 * in the tree that can disagree with a constant somebody raised in one place. That is
 * what the second half below measures, and it is why removing these files would be a
 * decision about the content contract rather than tidying after the cutover.
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
const { LOCALIZATION_KEY_PATTERN } = await moduleAt('packages', 'content', 'src', 'schemas.ts');
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
    'properties.display_name_key.pattern': LOCALIZATION_KEY_PATTERN,
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
    'properties.display_name_key.pattern': LOCALIZATION_KEY_PATTERN,
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
    'properties.display_name_key.pattern': LOCALIZATION_KEY_PATTERN,
    'properties.kind.enum': ['inclination', 'principle'],
    'properties.weight.minimum': bounds.INCLINATION_WEIGHT_MIN,
    'properties.weight.maximum': bounds.INCLINATION_WEIGHT_MAX,
    additionalProperties: false
  },
  'locale.schema.json': {
    'properties.schema_version.const': versions.SUPPORTED_LOCALE_SCHEMA_VERSION,
    'properties.locale.minLength': 1,
    'properties.entries.additionalProperties.minLength': 1,
    // Entry keys are localization keys and are held to the same pattern content is;
    // entry *values* stay unconstrained, because they are the player-facing text.
    'properties.entries.propertyNames.pattern': LOCALIZATION_KEY_PATTERN,
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
// 3. The two documents describe the same object, not merely the same numbers.
// ---------------------------------------------------------------------------

// External review found the table above sufficient for bounds and blind to structure:
// deleting the `oneOf` from `schemas/trait.schema.json` — which lets a principle carry a
// weight and an inclination omit one, both of which Zod refuses — left this command
// green. A gate that checks only the numbers is a gate that says "the schemas agree"
// about two documents that no longer describe the same shape.

/** `integer` and `number` are the same claim when a `const` pins an integral value. */
function normalisedType(node) {
  if (node?.type === 'number' && Number.isInteger(node.const)) {
    return 'integer';
  }
  return node?.type;
}

function propertiesOf(document) {
  return document.properties ?? {};
}

const asSet = (values) => [...(values ?? [])].sort().join(',');

// The trait schema is compared separately, below: the two documents express one rule in
// two shapes. The hand-written one declares every property at the top level and refines
// them in a two-branch `oneOf`; the Zod union emits two *complete* branches and nothing at
// the top. Comparing those structurally would report a disagreement that is not one.
for (const fileName of Object.keys(expectations).filter((name) => name !== 'trait.schema.json')) {
  const handWritten = readJson(join(schemasDirectory, fileName));
  const generated = readJson(join(schemasDirectory, 'generated', fileName));

  const handWrittenProperties = Object.keys(propertiesOf(handWritten)).sort();
  const generatedProperties = Object.keys(propertiesOf(generated)).sort();
  if (handWrittenProperties.join(',') !== generatedProperties.join(',')) {
    fail(
      `${fileName}: the two documents declare different properties — hand-written ` +
        `[${handWrittenProperties.join(', ')}], generated [${generatedProperties.join(', ')}]`
    );
  }

  for (const property of handWrittenProperties) {
    const left = normalisedType(propertiesOf(handWritten)[property]);
    const right = normalisedType(propertiesOf(generated)[property]);
    if (left !== right) {
      fail(
        `${fileName}: properties.${property}.type is '${left}' in the hand-written schema and ` +
          `'${right}' in the generated one`
      );
    }
  }

  // `required` is compared as a set: order carries no meaning in JSON Schema, and a
  // reordering would otherwise read as a disagreement.
  const handWrittenRequired = [...(handWritten.required ?? [])].sort();
  const generatedRequired = [...(generated.required ?? [])].sort();
  if (handWrittenRequired.join(',') !== generatedRequired.join(',')) {
    fail(
      `${fileName}: required differs — hand-written [${handWrittenRequired.join(', ')}], ` +
        `generated [${generatedRequired.join(', ')}]`
    );
  }
}

// The trait union, compared as the rule it encodes: an inclination declares a weight, a
// principle does not. This is the check whose absence external review demonstrated by
// deleting `oneOf` from the hand-written schema and watching this command stay green.
{
  const handWritten = readJson(join(schemasDirectory, 'trait.schema.json'));
  const generated = readJson(join(schemasDirectory, 'generated', 'trait.schema.json'));

  const generatedBranches = generated.oneOf;
  const handWrittenBranches = handWritten.oneOf;

  if (!Array.isArray(handWrittenBranches) || handWrittenBranches.length !== 2) {
    fail(
      'trait.schema.json: expected a two-branch `oneOf` discriminating on `kind`. Without it the ' +
        'schema accepts a principle that declares a weight and an inclination that omits one, ' +
        'while the Zod contract refuses both.'
    );
  }

  if (!Array.isArray(generatedBranches) || generatedBranches.length !== 2) {
    fail('schemas/generated/trait.schema.json: expected a two-branch `oneOf` from the Zod union.');
  }

  if (Array.isArray(handWrittenBranches) && Array.isArray(generatedBranches)) {
    const branchFor = (branches, kind) =>
      branches.find((branch) => at(branch, 'properties.kind.const') === kind);

    for (const kind of ['inclination', 'principle']) {
      const handWrittenBranch = branchFor(handWrittenBranches, kind);
      const generatedBranch = branchFor(generatedBranches, kind);

      if (!handWrittenBranch || !generatedBranch) {
        fail(`trait schemas: no '${kind}' branch in one of the two documents`);
        continue;
      }

      // What the hand-written document *effectively* requires for this kind: its shared
      // `required` list, plus `weight` where the branch demands it.
      const effectiveRequired = new Set(handWritten.required ?? []);
      for (const name of handWrittenBranch.required ?? []) {
        effectiveRequired.add(name);
      }
      if ((at(handWrittenBranch, 'not.required') ?? []).includes('weight')) {
        effectiveRequired.delete('weight');
      }

      if (asSet([...effectiveRequired]) !== asSet(generatedBranch.required)) {
        fail(
          `trait schemas disagree for kind '${kind}': hand-written effectively requires ` +
            `[${asSet([...effectiveRequired])}], generated requires [${asSet(generatedBranch.required)}]`
        );
      }

      // And the properties each kind may carry: the shared bag, minus `weight` for a
      // principle, which is the whole point of the union.
      const effectiveProperties = new Set(Object.keys(propertiesOf(handWritten)));
      if (kind === 'principle') {
        effectiveProperties.delete('weight');
      }

      if (asSet([...effectiveProperties]) !== asSet(Object.keys(propertiesOf(generatedBranch)))) {
        fail(
          `trait schemas disagree on the properties kind '${kind}' may carry: hand-written ` +
            `[${asSet([...effectiveProperties])}], generated ` +
            `[${asSet(Object.keys(propertiesOf(generatedBranch)))}]`
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 4. One asymmetry between the two documents, recorded rather than discovered.
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
