import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { parseContentId } from '@oath-and-coin/simulation';
import { afterEach, describe, expect, it } from 'vitest';

import { INCLINATION_WEIGHT_MAX, TRAIT_MAX } from './bounds.ts';
import { loadContentSet } from './node/index.ts';
import { MAX_TRAITS_PER_HERO } from './limits.ts';

const repoRoot = resolve(import.meta.dirname, '..', '..', '..');
const shippedContent = join(repoRoot, 'content');

/**
 * The loader against the shipped tree first, and against deliberately broken trees
 * after.
 *
 * The shipped-tree assertions are parity assertions, not sanity ones. `contentVersion`
 * is the strongest of them: the corpus recorded `5d03734fd9c7abaa` for this exact tree
 * when the C# exporter froze it, so this port agreeing on it means the whole digest
 * chain — ordinal path order, the path being part of the hash, the separator byte, and
 * this repository's own SHA-256 — reproduces a value nobody here computed.
 */

const temporaryRoots: string[] = [];

afterEach(() => {
  while (temporaryRoots.length > 0) {
    rmSync(temporaryRoots.pop()!, { recursive: true, force: true });
  }
});

const HERO = {
  schema_version: 2,
  id: 'core:bram',
  display_name_key: 'hero.core.bram.name',
  greed: 60,
  caution: 30,
  pride: 45,
  trust_in_guild: 50,
  traits: [] as unknown[],
  relationships: [] as unknown[]
};

const CONTRACT = {
  schema_version: 2,
  id: 'core:cleanse_the_crypt',
  display_name_key: 'contract.core.cleanse_the_crypt.name',
  payment: 70,
  risk: 80,
  required_crew: 4,
  tags: ['target:undead']
};

const TRAIT = {
  schema_version: 2,
  id: 'core:hates_the_cult',
  display_name_key: 'trait.core.hates_the_cult.name',
  kind: 'inclination',
  tag: 'target:cult',
  weight: 14
};

/** Writes a content tree from whole files, so a test states exactly what is wrong with it. */
function writeTree(tree: Readonly<Record<string, readonly unknown[]>>): string {
  const root = mkdtempSync(join(tmpdir(), 'oath-content-'));
  temporaryRoots.push(root);

  for (const [directory, files] of Object.entries(tree)) {
    mkdirSync(join(root, directory), { recursive: true });
    files.forEach((file, index) => {
      writeFileSync(join(root, directory, `${index}.json`), JSON.stringify(file, null, 2), 'utf8');
    });
  }

  return root;
}

/** The smallest tree that loads, with one part replaced. */
function treeWith(overrides: Readonly<Record<string, readonly unknown[]>>): string {
  return writeTree({ heroes: [HERO], contracts: [CONTRACT], traits: [TRAIT], ...overrides });
}

describe('loadContentSet over the shipped tree', () => {
  const content = loadContentSet(shippedContent);

  it('reads every authored entity', () => {
    expect(content.heroes.size).toBe(6);
    expect(content.contracts.size).toBe(4);
    expect(content.traits.size).toBe(8);
  });

  it('reproduces the content version the frozen corpus recorded', () => {
    // The corpus's `inputs.content_version` for every one of its 54 entries. A
    // digest that agreed with itself but not with this value would let the whole
    // segment pass parity on a coincidence.
    expect(content.contentVersion).toBe('5d03734fd9c7abaa');
  });

  it('keys heroes, contracts and traits in content-id order', () => {
    // Enumeration order reaches the canonical artifact, and hero ids are assigned
    // from this order rather than from the order the filesystem returned files.
    expect(content.heroes.keys()).toEqual([
      'core:bram',
      'core:doran',
      'core:ilsa',
      'core:kestrel',
      'core:mira',
      'core:zara'
    ]);
    expect(content.contracts.keys()).toEqual([
      'core:cleanse_the_crypt',
      'core:collect_the_debt',
      'core:escort_the_caravan',
      'core:silence_the_cult'
    ]);
  });

  it('carries a hero through unchanged, in authored order', () => {
    // `traits` keeps the order the file lists them in. The engine sorts them when it
    // builds a decision context; the definition is not where that happens, and a
    // loader that sorted here would hide the difference.
    expect(content.heroes.get(parseContentId('core:bram'))).toEqual({
      id: 'core:bram',
      displayNameKey: 'hero.core.bram.name',
      greed: 60,
      caution: 30,
      pride: 45,
      trustInGuild: 50,
      traits: ['core:will_not_strike_a_temple', 'core:hates_the_cult'],
      relationships: [{ hero: 'core:zara', weight: -8 }]
    });
  });

  it('carries a contract through unchanged, in authored order', () => {
    expect(content.contracts.get(parseContentId('core:cleanse_the_crypt'))).toEqual({
      id: 'core:cleanse_the_crypt',
      displayNameKey: 'contract.core.cleanse_the_crypt.name',
      payment: 70,
      risk: 80,
      requiredCrew: 4,
      tags: ['target:undead', 'method:public_contract']
    });
  });

  it('gives an inclination its weight and a principle none', () => {
    // A red line has no strength, it closes the path (HERO_DECISION_SPEC §1.3), and
    // 0 is the domain's way of saying so.
    expect(content.traits.get(parseContentId('core:hates_the_cult'))).toEqual({
      id: 'core:hates_the_cult',
      displayNameKey: 'trait.core.hates_the_cult.name',
      kind: 'inclination',
      tag: 'target:cult',
      weight: 14
    });
    expect(content.traits.get(parseContentId('core:refuses_deception'))).toEqual({
      id: 'core:refuses_deception',
      displayNameKey: 'trait.core.refuses_deception.name',
      kind: 'principle',
      tag: 'method:deception',
      weight: 0
    });
  });
});

describe('loadContentSet refuses', () => {
  it('a missing content root', () => {
    expect(() => loadContentSet(join(shippedContent, 'nope'))).toThrow(/does not exist/);
  });

  it('a tree with no heroes directory, naming the directory', () => {
    expect(() => loadContentSet(writeTree({ contracts: [CONTRACT] }))).toThrow(
      /has no 'heroes' directory/
    );
  });

  it('a file authored for another format version, in preference to its missing fields', () => {
    // The version is peeked before the contract is applied, on purpose: a v1 file
    // legitimately lacks fields v2 requires, and reporting those instead would bury
    // the one diagnostic that explains them.
    const root = treeWith({ heroes: [{ schema_version: 1, id: 'core:bram' }] });
    expect(() => loadContentSet(root)).toThrow(/declares schema_version 1, but this build/);
  });

  it('a file with no schema_version at all', () => {
    const root = treeWith({ heroes: [{ id: 'core:bram' }] });
    expect(() => loadContentSet(root)).toThrow(/has no integer 'schema_version'/);
  });

  it('an unknown property rather than ignoring it', () => {
    // The rejection `UnmappedMemberHandling.Disallow` bought in C# and
    // `z.strictObject` buys here. A misspelled field that quietly does nothing is an
    // authoring mistake turned into a silently defaulted value.
    const root = treeWith({ heroes: [{ ...HERO, greeed: 60 }] });
    expect(() => loadContentSet(root)).toThrow(/greeed/);
  });

  it.each([
    { name: 'greed above its ceiling', file: { ...HERO, greed: TRAIT_MAX + 1 } },
    { name: 'greed below its floor', file: { ...HERO, greed: -1 } },
    { name: 'a fractional hero scale', file: { ...HERO, caution: 30.5 } },
    { name: 'a hero scale written as a string', file: { ...HERO, pride: '45' } },
    { name: 'an empty display_name_key', file: { ...HERO, display_name_key: '' } },
    // External review's blocker: a key travels unchanged into state and from there into
    // the canonical artifact, so the three inputs below would put a byte into it that the
    // old C# writer and RFC 8785 disagree about — under the same artifact version.
    { name: 'a non-ASCII display_name_key', file: { ...HERO, display_name_key: 'герой.имя' } },
    {
      name: 'a display_name_key with a control character',
      file: { ...HERO, display_name_key: `hero.${String.fromCharCode(1)}name` }
    },
    {
      name: "a display_name_key with the `< > & ' +` set",
      file: { ...HERO, display_name_key: 'hero+core.name' }
    },
    // And the plainer defect beside it: the C# loader refused this through
    // `IsNullOrWhiteSpace`, and `min(1)` accepted it.
    { name: 'a display_name_key of spaces', file: { ...HERO, display_name_key: '   ' } },
    { name: 'an uppercase display_name_key', file: { ...HERO, display_name_key: 'Hero.Name' } },
    { name: 'a malformed content id', file: { ...HERO, id: 'Core:Bram' } },
    {
      name: 'more traits than a hero may carry',
      file: {
        ...HERO,
        traits: Array.from({ length: MAX_TRAITS_PER_HERO + 1 }, (_, index) => `core:t${index}`)
      }
    },
    {
      name: 'a relationship weight past its bound',
      file: { ...HERO, relationships: [{ hero: 'core:zara', weight: 21 }] }
    }
  ])('$name', ({ file }) => {
    expect(() => loadContentSet(treeWith({ heroes: [file] }))).toThrow(
      /does not satisfy its contract/
    );
  });

  it('an inclination with no weight, and a principle that declares one', () => {
    expect(() =>
      loadContentSet(treeWith({ traits: [{ ...TRAIT, weight: undefined }] }))
    ).toThrow(/does not satisfy its contract/);
    expect(() =>
      loadContentSet(
        treeWith({ traits: [{ ...TRAIT, kind: 'principle', weight: INCLINATION_WEIGHT_MAX }] })
      )
    ).toThrow(/does not satisfy its contract/);
  });

  it('an unknown trait kind', () => {
    expect(() => loadContentSet(treeWith({ traits: [{ ...TRAIT, kind: 'habit' }] }))).toThrow(
      /does not satisfy its contract/
    );
  });

  it('two files defining the same id, naming both', () => {
    const root = treeWith({ heroes: [HERO, { ...HERO, greed: 10 }] });
    expect(() => loadContentSet(root)).toThrow(
      /Duplicate content id 'core:bram': defined in both 'heroes\/0.json' and 'heroes\/1.json'/
    );
  });

  it('a hero naming a trait nothing defines', () => {
    const root = treeWith({ heroes: [{ ...HERO, traits: ['core:no_such_trait'] }] });
    expect(() => loadContentSet(root)).toThrow(
      /references trait 'core:no_such_trait', which no trait file defines/
    );
  });

  it('a hero listing the same trait twice', () => {
    const root = treeWith({ heroes: [{ ...HERO, traits: [TRAIT.id, TRAIT.id] }] });
    expect(() => loadContentSet(root)).toThrow(/lists trait 'core:hates_the_cult' more than once/);
  });

  it('a hero holding a relationship to itself', () => {
    const root = treeWith({
      heroes: [{ ...HERO, relationships: [{ hero: HERO.id, weight: 5 }] }]
    });
    expect(() => loadContentSet(root)).toThrow(/holds a relationship to itself/);
  });

  it('a hero holding a relationship to a hero nothing defines', () => {
    const root = treeWith({
      heroes: [{ ...HERO, relationships: [{ hero: 'core:nobody', weight: 5 }] }]
    });
    expect(() => loadContentSet(root)).toThrow(
      /holds a relationship to 'core:nobody', which no hero file defines/
    );
  });

  it('a hero holding two relationships to the same hero', () => {
    const root = writeTree({
      heroes: [
        {
          ...HERO,
          relationships: [
            { hero: 'core:zara', weight: 5 },
            { hero: 'core:zara', weight: -5 }
          ]
        },
        { ...HERO, id: 'core:zara', display_name_key: 'hero.core.zara.name' }
      ],
      contracts: [CONTRACT],
      traits: [TRAIT]
    });

    expect(() => loadContentSet(root)).toThrow(
      /holds more than one relationship to 'core:zara'/
    );
  });

  it('a repeated object key, which the C# reader could only see in a locale file', () => {
    // `JSON.parse` collapses `{"greed":60,"greed":1}` to the last value with no way
    // to observe it, so this rejection lives in the structural pass instead. It is
    // stricter than the original by consequence: in C# only the locale loader saw
    // duplicates, because only it read through `JsonDocument`.
    const root = mkdtempSync(join(tmpdir(), 'oath-content-'));
    temporaryRoots.push(root);
    for (const directory of ['heroes', 'contracts', 'traits']) {
      mkdirSync(join(root, directory), { recursive: true });
    }
    writeFileSync(
      join(root, 'heroes', 'bram.json'),
      '{"schema_version":2,"greed":60,"greed":1}',
      'utf8'
    );

    expect(() => loadContentSet(root)).toThrow(/repeats the object key 'greed'/);
  });
});
