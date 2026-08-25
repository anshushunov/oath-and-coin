import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { validateContentTree, validateContentTreeOrThrow } from './node/index.ts';

const repoRoot = resolve(import.meta.dirname, '..', '..', '..');
const shippedContent = join(repoRoot, 'content');

const temporaryRoots: string[] = [];

afterEach(() => {
  while (temporaryRoots.length > 0) {
    rmSync(temporaryRoots.pop()!, { recursive: true, force: true });
  }
});

function writeTree(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), 'oath-validate-'));
  temporaryRoots.push(root);

  for (const [relativePath, text] of Object.entries(files)) {
    const path = join(root, ...relativePath.split('/'));
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, text, 'utf8');
  }

  return root;
}

const VALID_HERO = JSON.stringify({
  schema_version: 4,
  id: 'core:bram',
  display_name_key: 'hero.core.bram.name',
  greed: 60,
  caution: 30,
  pride: 45,
  trust_in_guild: 50,
  capability: { grade: 50, expertise: { frontline: 50, wilderness: 50 } },
  traits: [],
  relationships: []
});

describe('validateContentTree', () => {
  it('reports nothing for the shipped tree', () => {
    // The tree the .NET stack validates green today. If this ever disagrees, one of
    // the two stacks has drifted and the content is valid for exactly one of them.
    expect(validateContentTree(shippedContent)).toEqual([]);
  });

  it('reports every violation rather than stopping at the first', () => {
    // The reason validation is a separate function from loading. The loader throws on
    // the first problem because it has to produce a value or nothing; validation
    // exists so an author learns everything that is wrong in one run.
    const violations = validateContentTree(
      writeTree({
        'heroes/a.json': JSON.stringify({ schema_version: 2, id: 'nope' }),
        'heroes/b.json': JSON.stringify({ schema_version: 2, id: 'also-nope' })
      })
    );

    expect(violations.length).toBeGreaterThan(2);
    expect(new Set(violations.map((violation) => violation.relativePath))).toEqual(
      new Set(['heroes/a.json', 'heroes/b.json'])
    );
  });

  it('locates a violation by JSON path inside the file', () => {
    const violations = validateContentTree(
      writeTree({
        'heroes/a.json': JSON.stringify({
          schema_version: 4,
          id: 'core:bram',
          display_name_key: 'hero.core.bram.name',
          greed: 60,
          caution: 30,
          pride: 45,
          trust_in_guild: 50,
          capability: { grade: 50, expertise: { frontline: 50, wilderness: 50 } },
          traits: [],
          relationships: [{ hero: 'core:zara', weight: 999 }]
        })
      })
    );

    expect(violations).toHaveLength(1);
    expect(violations[0]?.instanceLocation).toBe('$.relationships[0].weight');
  });

  it('treats a file in an unregistered directory as a violation, not a file to skip', () => {
    // Silently ignoring unknown content is how a validation stage reports success over
    // data it never looked at.
    const violations = validateContentTree(
      writeTree({ 'heroes/a.json': VALID_HERO, 'factions/iron.json': '{"schema_version":2}' })
    );

    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toMatch(/No contract is registered for content directory/);
    expect(violations[0]?.relativePath).toBe('factions/iron.json');
  });

  it('reports a malformed file as a violation instead of throwing out of the run', () => {
    // One unreadable file must not stop the report for every other file, or the
    // "report everything" property holds only for trees that are already parseable.
    const violations = validateContentTree(
      writeTree({ 'heroes/a.json': '{ not json', 'heroes/b.json': VALID_HERO })
    );

    expect(violations).toHaveLength(1);
    expect(violations[0]?.relativePath).toBe('heroes/a.json');
    expect(violations[0]?.message).toMatch(/not valid JSON/);
  });

  it('reads validated files under the same ceilings the loader does', () => {
    // A second reading path with laxer limits is the same as having no limits:
    // external data only has to arrive through the laxest one.
    const violations = validateContentTree(
      writeTree({ 'heroes/a.json': `{"a":${'['.repeat(40)}${']'.repeat(40)}}` })
    );

    expect(violations[0]?.message).toMatch(/nests deeper than 32 levels/);
  });

  it('returns violations in ordinal path order', () => {
    const violations = validateContentTree(
      writeTree({
        'heroes/z.json': '{"schema_version":2}',
        'heroes/a.json': '{"schema_version":2}',
        'contracts/m.json': '{"schema_version":2}'
      })
    );

    const paths = violations.map((violation) => violation.relativePath);
    expect([...paths].sort((left, right) => (left < right ? -1 : 1))).toEqual(paths);
  });

  it('refuses a content root that does not exist', () => {
    expect(() => validateContentTree(join(shippedContent, 'nope'))).toThrow(/does not exist/);
  });
});

describe('validateContentTreeOrThrow', () => {
  it('says nothing about a valid tree', () => {
    expect(() => validateContentTreeOrThrow(shippedContent)).not.toThrow();
  });

  it('names every violation in one message', () => {
    const root = writeTree({ 'heroes/a.json': '{"schema_version":2}' });

    expect(() => validateContentTreeOrThrow(root)).toThrow(/does not satisfy its contracts/);
    expect(() => validateContentTreeOrThrow(root)).toThrow(/heroes\/a.json \$\./);
  });
});
