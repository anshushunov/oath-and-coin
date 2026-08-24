import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Every hand-written data document in the tree is either checked by something or
 * declared unchecked with a reason.
 *
 * **Why this exists.** External review of the cutover segment found the claim
 * beside `scripts/check-schemas.mjs` broader than the mechanism under it: the
 * docblock says the hand-written schemas are the one statement of the content
 * rules not derived from the loader's own code, and the script reads four of the
 * six files in `schemas/`. `scenario-manifest.schema.json` is read by nothing at
 * all since the .NET stack that read it was deleted, and — until DEC-008 Task
 * 19 built one — the same was true of `contrast.schema.json` and
 * `scenarios/contrasts/*.json`, whose only reader (`ContrastRunner.cs`) went
 * with it. Nothing reddened, because nothing was looking.
 *
 * That is the same shape as `release-gate.test.ts` and `workspace.test.ts`: a
 * disappearance nothing reports. The cure is the same one — an accounting that
 * has to be a bijection, so that a document added without a reader, or a reader
 * deleted from under a document, is a red test rather than a quiet gap.
 *
 * **This file does not decide what to do about an orphan.** Declaring one is not
 * approving it; it is refusing to let it be invisible. Each `orphaned` entry
 * carries what would have to happen for it to stop being one, and §21.6 of
 * `FULL_TYPESCRIPT_MIGRATION` carries the same list as a named debt.
 */

const repoRoot = resolve(import.meta.dirname, '..', '..');

interface Accounting {
  /** A file that reads this document. Its existence and its mention are both checked. */
  readonly checkedBy?: string;
  /** Why nothing reads it, and what would change that. */
  readonly orphaned?: string;
}

/**
 * The top-level hand-written schemas, and what holds each of them honest.
 *
 * `schemas/generated/**` is deliberately not in this list: those are a projection
 * of the Zod contracts, regenerated and compared byte for byte by the same
 * script, so they cannot state anything the contracts do not.
 */
const SCHEMAS: Readonly<Record<string, Accounting>> = {
  'hero.schema.json': { checkedBy: 'scripts/check-schemas.mjs' },
  'contract.schema.json': { checkedBy: 'scripts/check-schemas.mjs' },
  'trait.schema.json': { checkedBy: 'scripts/check-schemas.mjs' },
  'locale.schema.json': { checkedBy: 'scripts/check-schemas.mjs' },
  'scenario-manifest.schema.json': {
    orphaned:
      'the .NET loader that validated manifests against it was deleted at cutover; the ' +
      'TypeScript loader states the same contract in Zod (packages/content/src/scenarios/' +
      'scenario-manifest.ts) and nothing holds the two to each other. It stops being an ' +
      'orphan when check-schemas.mjs asserts its fields against that contract, the way it ' +
      'already does for the four above.'
  },
  'contrast.schema.json': {
    // DEC-008 Task 19 gave the fixtures this schema describes their first consumer:
    // `loadContrastDefinition` (`packages/content/src/scenarios/contrast-definition.ts`)
    // states the same rules in Zod, and `contrast-runner.ts` is what now reads
    // `scenarios/contrasts/*.json` for real — `tools/scenario-runner/src/cli.ts`'s
    // `contrast` subcommand and `contrast-runner.test.ts`'s
    // `EveryShippedContrastFlipsAsDeclared`-equivalent both exercise it. Not held to the
    // stricter bar `scenario-manifest.schema.json` above still fails — nothing here
    // cross-checks this document's fields against the Zod contract the way
    // `check-schemas.mjs` does for the four fully `checkedBy` schemas — because that bar
    // was never this entry's stated exit condition; "the contrast fixtures get a
    // consumer" was.
    checkedBy: 'packages/content/src/scenarios/contrast-definition.ts'
  }
};

function topLevelJson(directory: string): readonly string[] {
  return readdirSync(join(repoRoot, directory), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort();
}

describe('every hand-written schema is accounted for', () => {
  it('the accounting names exactly the files on disk', () => {
    // Both directions. A schema added without an entry is a document nobody
    // checks; an entry left behind by a deleted schema is an accounting that
    // describes a tree that no longer exists.
    expect(topLevelJson('schemas')).toEqual(Object.keys(SCHEMAS).sort());
  });

  it.each(Object.entries(SCHEMAS))('%s is checked or declared, never neither', (name, entry) => {
    expect(
      entry.checkedBy ?? entry.orphaned,
      `${name} is in the accounting with neither a checker nor a reason`
    ).toBeDefined();
    expect(
      entry.checkedBy !== undefined && entry.orphaned !== undefined,
      `${name} claims to be both checked and orphaned`
    ).toBe(false);
  });

  it.each(
    Object.entries(SCHEMAS).filter(([, entry]) => entry.checkedBy !== undefined) as [
      string,
      Required<Pick<Accounting, 'checkedBy'>>
    ][]
  )('%s is actually mentioned by the file that claims to check it', (name, entry) => {
    // Not merely that the checker exists. `check-schemas.mjs` reads its schemas by
    // name out of one object literal, so a file dropped from that literal keeps
    // the script green and stops being checked — which is exactly how two of the
    // six came to be orphans without anybody noticing.
    //
    // **Quoted, not `toContain`.** The first version asked for the bare name and a
    // mutant renaming the key to `locale.schema.jsonX` stayed green, because the
    // name is a substring of the typo. That is the same trap this repository
    // already measured on `pnpm lint` inside `pnpm lint:deps`
    // (`release-gate.test.ts`), reached a second time through a different door.
    const checker = readFileSync(join(repoRoot, entry.checkedBy), 'utf8');

    expect(
      checker,
      `${entry.checkedBy} does not name ${name} as a key, so the accounting claims a check that is not there`
    ).toContain(`'${name}'`);
  });
});
