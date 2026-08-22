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
 * six files in `schemas/`. `scenario-manifest.schema.json` and
 * `contrast.schema.json` are read by nothing at all since the .NET stack that
 * read them was deleted, and `scenarios/contrasts/*.json` lost its only consumer
 * with `ContrastRunner.cs`. Nothing reddened, because nothing was looking.
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
    orphaned:
      'nothing reads it and nothing reads the data it describes — see CONTRAST_FIXTURES ' +
      'below. It stops being an orphan when the contrast fixtures get a consumer, or when ' +
      'both are deleted together.'
  }
};

/**
 * The contrast fixtures: declared "flip" pairs, evidence for `DEC-010`, and read
 * by nobody since `ContrastRunner.cs` went.
 *
 * They are still **shipped**: `apps/web/src/content-source.ts` globs
 * `scenarios/**` minus `*.canonical.json`, so all four travel into the browser
 * bundle. That is the part worth a check rather than a comment — dead data that
 * costs bytes at a player is different from dead data that costs a directory
 * listing.
 */
const CONTRAST_FIXTURES: Accounting = {
  orphaned:
    'the runner that executed them was C# and was deleted at cutover; they are design ' +
    'evidence cited by DEC-010 and are still bundled into the browser build. Deleting ' +
    'authored design data is the owner’s call, not a tidy-up, so they stay declared until ' +
    'that call is made.'
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

describe('the contrast fixtures are declared rather than forgotten', () => {
  it('are still on disk, and still read by nothing', () => {
    const fixtures = topLevelJson(join('scenarios', 'contrasts'));

    expect(fixtures.length, 'the contrast fixtures are gone; delete this block with them').toBe(4);
    expect(CONTRAST_FIXTURES.orphaned).toBeDefined();
  });
});
