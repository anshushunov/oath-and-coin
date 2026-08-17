import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Writes `schemas/generated/**` from the Zod contracts.
 *
 * A plain `node` script, importing TypeScript directly. Node 24 strips types, so the
 * contracts run as they are — no bundler, no second toolchain, and no risk of the
 * generator seeing a different build of the contracts than the tests do. It is why
 * every relative import under `packages/**` names its `.ts` file
 * (`allowImportingTsExtensions` in tsconfig.base.json) and why `erasableSyntaxOnly`
 * is set: Node refuses TypeScript syntax that has a runtime effect.
 *
 * The generated files are committed. `pnpm schema:check` is what makes that safe —
 * it regenerates in memory and fails if the committed bytes differ, so a contract
 * edited without regenerating is a red gate rather than a stale artifact.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = join(repoRoot, 'schemas', 'generated');

// `pathToFileURL`, not the bare path: on Windows an absolute path starts with a
// drive letter, and the ESM loader reads `c:` as a URL scheme it does not support.
const { generateJsonSchemas, renderJsonSchema } = await import(
  pathToFileURL(join(repoRoot, 'packages', 'content', 'src', 'json-schema.ts')).href
);

mkdirSync(outputDirectory, { recursive: true });

for (const [fileName, document] of Object.entries(generateJsonSchemas())) {
  const path = join(outputDirectory, fileName);
  writeFileSync(path, renderJsonSchema(document), 'utf8');
  console.log(`wrote schemas/generated/${fileName}`);
}
