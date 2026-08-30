import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { STARTING_TREASURY, parseContentId, type ContentId } from '@oath-and-coin/simulation';
import { afterEach, describe, expect, it } from 'vitest';

import { INCLINATION_WEIGHT_MAX, TRAIT_MAX } from './bounds.ts';
import type { ContentSet, ContractDefinition, TraitDefinition } from './content-set.ts';
import { MAX_TRAITS_PER_HERO } from './limits.ts';
import { loadContentSet, loadLocaleCatalogue } from './node/index.ts';

const repoRoot = resolve(import.meta.dirname, '..', '..', '..');
const shippedContent = join(repoRoot, 'content');

/**
 * The loader against the shipped tree first, and against deliberately broken trees
 * after.
 *
 * The shipped-tree assertions are parity assertions, not sanity ones. `contentVersion`
 * was the strongest of them: the corpus recorded `5d03734fd9c7abaa` for this exact tree
 * when the C# exporter froze it, so this port agreeing on it meant the whole digest
 * chain — ordinal path order, the path being part of the hash, the separator byte, and
 * this repository's own SHA-256 — reproduced a value nobody here computed.
 *
 * `DEC-008` Task 3 renamed the contract's fee field in the file format and this
 * loader's output, which moved every content-derived byte and, with it, this digest,
 * to `96aff403339c2a29` — a drift guard pinned by this repository from here on, not a
 * claim of byte-for-byte agreement with the frozen C# export — that parity ended the
 * moment the shipped tree changed on purpose.
 *
 * Task 4 moved it again, to `6ec78515d096f8f9`: every shipped file now declares
 * `schema_version: 3`, and two contracts additionally author `negotiable_tags`
 * (`NEGOTIATION_SPEC` §2.4). Same reason as before — the tree changed on purpose — and
 * the same thing this pin buys: a digest that drifted only with itself, caught rather
 * than passed by coincidence.
 *
 * Task 8 moved it a third time, to `3b2b90cfffa3bb47`: the decision rule's two new
 * factors (`hero.decision.promise_of_a_bonus`, `hero.decision.guild_broke_its_word`)
 * needed localization keys, and `content/locale/ru.json` — under `content/`, so inside
 * this digest like any other byte — is where every other reason code is already
 * translated.
 *
 * Review of that same task moved it a fourth time, to `08975dbb0d527f6e`: the broken-word
 * key's Russian text read as the odd one out among its neighbours (the only phrase in
 * the past tense with an explicit subject; every other `hero.decision.*` entry is either
 * a noun phrase or names the guild's action against an implied hero) and was reworded to
 * match — `content/locale/ru.json` moved again, so the digest did too.
 *
 * Review of Task 15 moved it a fifth time, to `6ec81ab69e9fcec3`: Task 4's
 * `negotiable_tags` on two contracts had gone half-translated since it was authored —
 * `tag.method.deception` already existed from its use as a plain `tags` entry
 * elsewhere, `tag.method.open` did not — and the gap stayed invisible until the
 * read-model's `OfferLine.methodOptionKeys` (`NEGOTIATION_SPEC` §5.1) started resolving
 * both alternatives of a negotiable tag, not only the chosen one.
 *
 * Task 18 moved it a sixth time, to `9763a54ae7dbff9c`: `NEGOTIATION_SPEC` §10.5's
 * `EveryNegotiableSetIsCarriedByAtLeastOneTrait` (`describe('the shipped content is
 * playable')` below) named the gap `tag.method.open` only closed half of — the tag was
 * translated, but nothing reacted to it, so choosing `method:open` closed a gate and
 * never attracted anyone. `core:works_in_the_open` (`content/traits/`) and its
 * localization key (`content/locale/ru.json`) close it.
 *
 * The same task's own `EveryContractCanBeCrewedBySomePackage` (§10.5) moved it a
 * seventh time, to `46416b20360bbedd`, on its very first run against the shipped
 * tree: `core:collect_the_debt` authored `patron:slavers`, `method:deception` and
 * `method:abandon_wounded` together, and five of the six shipped heroes carry a
 * *principle* matching one of those three — only `core:bram` carries none, so the
 * contract's `required_crew: 2` was unreachable by any package, a pre-existing defect
 * this check exists to catch and had never been checked until this task added the
 * check that reads it. The three tags stay — dropping one would change what the
 * contract *is*, and reassigning a hero's principle would be editing the hero to fit
 * the contract, with consequences for every other contract that principle already
 * gates — so the fix is `required_crew: 1` (`content/contracts/collect_the_debt.json`):
 * the contract reads as dirty work for the one hero with no principle against it,
 * not a patch.
 *
 * The contract-resolution engine's Task 2 moved it an eighth time, to
 * `cd159cbb2363d417`: `SUPPORTED_CONTENT_SCHEMA_VERSION` 3 → 4, a `capability` on every
 * hero and a `needs` on every contract (`RESOLUTION_SPEC` §2.2, §2.3). Unlike
 * `negotiable_tags`, both fields are *required*, which is why the version had to move
 * with them rather than merely alongside them.
 *
 * The contract-loop UI plan's task 9 moved it a ninth time, to `94470ae66b2a1061`: two
 * contracts, `core:hold_the_river_ford` and `core:burn_the_plague_barrow`, the second
 * counterbalanced pair the playtest measures the loop with (`RESOLUTION_SPEC` §8). Four
 * shipped contracts became six, which is why the counts below moved as well.
 */

const temporaryRoots: string[] = [];

afterEach(() => {
  while (temporaryRoots.length > 0) {
    rmSync(temporaryRoots.pop()!, { recursive: true, force: true });
  }
});

const HERO = {
  schema_version: 6,
  id: 'core:bram',
  display_name_key: 'hero.core.bram.name',
  greed: 60,
  caution: 30,
  pride: 45,
  trust_in_guild: 50,
  capability: { expertise: { frontline: 50, wilderness: 50 } },
  combat: { might: 50, guard: 50, aim: 50, focus: 50, care: 50 },
  role: 'vanguard',
  traits: [] as unknown[],
  relationships: [] as unknown[]
};

const CONTRACT = {
  schema_version: 6,
  id: 'core:cleanse_the_crypt',
  display_name_key: 'contract.core.cleanse_the_crypt.name',
  patron_fee: 70,
  risk: 80,
  required_crew: 4,
  needs: { frontline: 10, wilderness: 10 },
  tags: ['target:undead']
};

const TRAIT = {
  schema_version: 6,
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

const ids = {
  crypt: parseContentId('core:cleanse_the_crypt')
};

/**
 * `CONTRACT`, with one part replaced — so a negotiable-set test states only the
 * field its name is about, not every field a contract file requires.
 */
function aContractFile(overrides: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return { ...CONTRACT, ...overrides };
}

/**
 * A tree holding exactly one contract, at `contracts/a.json`, plus the minimal
 * hero and trait content every tree needs before `loadContentSet` reads past its
 * own directory check. `files` names each file by its full, root-relative path,
 * which lets a negotiable-set test add or replace `contracts/a.json` without
 * also restating the tree around it.
 */
function sourceWith(files: Readonly<Record<string, unknown>>): string {
  const root = mkdtempSync(join(tmpdir(), 'oath-content-'));
  temporaryRoots.push(root);

  const tree: Record<string, unknown> = { 'heroes/0.json': HERO, 'traits/0.json': TRAIT, ...files };

  for (const [relativePath, content] of Object.entries(tree)) {
    const fullPath = join(root, ...relativePath.split('/'));
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, JSON.stringify(content, null, 2), 'utf8');
  }

  return root;
}

describe('loadContentSet over the shipped tree', () => {
  const content = loadContentSet(shippedContent);

  it('reads every authored entity', () => {
    // Seven since `core:vela` (`COMBAT_SPEC` §16.3.1): the pair §13.2 asks for did not
    // exist in the shipped roster, and without one the control of §4.8 measures a different
    // person rather than a different bond.
    expect(content.heroes.size).toBe(7);
    expect(content.contracts.size).toBe(8);
    expect(content.traits.size).toBe(9);
  });

  it('pins the content version this repository computes for the shipped tree', () => {
    // Was the corpus's own `inputs.content_version` for every one of its 54 entries,
    // until `DEC-008` Task 3 renamed the contract's fee field and Task 4 raised the
    // schema version and authored `negotiable_tags`, each moving the shipped tree's
    // bytes on purpose. What this pin buys now is the same as before either move — a
    // digest that drifted only with itself would let the whole segment pass parity on
    // a coincidence — just no longer against the frozen C# export.
    //
    // Task 18 moved it a sixth time, to `9763a54ae7dbff9c`: `core:works_in_the_open`
    // (`inclination`, `tag: method:open`, `weight: 10`) is the trait `method:open` had
    // none of — the exact gap `ships no negotiable tag no trait reacts to` below exists
    // to catch — plus the localization key its display name needs
    // (`trait.core.works_in_the_open.name`, `content/locale/ru.json`). The same task's
    // own `ships no contract that cannot be crewed by any package` moved it a seventh
    // time, to `46416b20360bbedd`, the first time it ran against the shipped tree:
    // `core:collect_the_debt` was unreachable by any package (five of six heroes carry
    // a principle matching one of its three tags), fixed by
    // `required_crew: 2 → 1` (`content/contracts/collect_the_debt.json`) rather than by
    // touching the tags or any hero. The resolution engine's Task 2 moved it an eighth
    // time, to `cd159cbb2363d417`, raising every file to `schema_version: 5` and
    // authoring the two fields `RESOLUTION_SPEC` §2.2 and §2.3 add. The contract-loop UI
    // plan's task 9 moved it a ninth time, to `94470ae66b2a1061`, with the playtest's
    // second counterbalanced pair (`RESOLUTION_SPEC` §8).
    // The Combat Lab's first segment moved it a tenth time, to `c02e365478576dd7`
    // (`DEC-016`): every hero file lost `capability.grade` and gained `combat` and `role`,
    // and the content format went 4 → 5 with them.
    expect(content.contentVersion).toBe('ec03d8819bdf9695');
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
      'core:vela',
      'core:zara'
    ]);
    expect(content.contracts.keys()).toEqual([
      'core:break_the_siege_camp',
      'core:burn_the_plague_barrow',
      'core:cleanse_the_crypt',
      'core:collect_the_debt',
      'core:escort_the_caravan',
      'core:escort_the_relic',
      'core:hold_the_river_ford',
      'core:silence_the_cult'
    ]);
  });

  it('carries a hero through unchanged, in authored order', () => {
    // `traits` keeps the order the file lists them in. The engine sorts them when it
    // builds a decision context; the definition is not where that happens, and a
    // loader that sorted here would hide the difference.
    const bram = content.heroes.get(parseContentId('core:bram'))!;

    expect(bram).toEqual({
      id: 'core:bram',
      displayNameKey: 'hero.core.bram.name',
      greed: 60,
      caution: 30,
      pride: 45,
      trustInGuild: 50,
      // `grade` is 65 because his five attributes average 65, not because a file says so
      // (`DEC-016` §3). Written out here rather than as `expect.any(Number)` for the
      // reason the record exists: this is the assertion that would redden if a hero's
      // stated strength and his attributes ever parted company.
      capability: { grade: 65, expertise: expect.anything() },
      combat: { might: 78, guard: 80, aim: 55, focus: 55, care: 57 },
      role: 'vanguard',
      traits: ['core:will_not_strike_a_temple', 'core:hates_the_cult'],
      relationships: [{ hero: 'core:zara', weight: -8 }]
    });

    // Asserted through its own accessors rather than inside the object above: a
    // `SortedMap` compared by `toEqual` would be compared on its private fields, which
    // passes for the wrong reason and says nothing about the ordering that is the point
    // of the type. Declaration order, not the file's key order and not the alphabet —
    // this is what reaches the canonical artifact (`RESOLUTION_SPEC` §2.1).
    expect(bram.capability.expertise.entries()).toEqual([
      ['frontline', 70],
      ['wilderness', 40]
    ]);
  });

  it('keys a contract needs map in declaration order', () => {
    // `core:silence_the_cult` authors all three needs, so this is the one shipped
    // contract where the order is observable at all. It says nothing about *whose*
    // order this is — its own file already lists them this way; the tree below is what
    // separates declaration order from authored order.
    expect(
      content.contracts.get(parseContentId('core:silence_the_cult'))!.needs.entries()
    ).toEqual([
      ['frontline', 25],
      ['undead_knowledge', 30],
      ['wilderness', 20]
    ]);
  });

  it('carries a contract through unchanged, in authored order', () => {
    const crypt = content.contracts.get(parseContentId('core:cleanse_the_crypt'))!;

    expect(crypt).toEqual({
      id: 'core:cleanse_the_crypt',
      displayNameKey: 'contract.core.cleanse_the_crypt.name',
      patronFee: 70,
      risk: 80,
      requiredCrew: 4,
      needs: expect.anything(),
      tags: ['target:undead', 'method:public_contract'],
      negotiableTags: [],
      // No authored fight: the crypt is settled by the abstract resolver (`ADR-014` §1).
      battle: null
    });
    expect(crypt.needs.entries()).toEqual([
      ['frontline', 30],
      ['undead_knowledge', 35]
    ]);
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

/**
 * The largest crew that clears the gate under some admissible package
 * (`NEGOTIATION_SPEC` §10.5). A package is either the contract's authored `tags`
 * alone — the only option when it has no `negotiableTags` — or those tags plus
 * exactly one member of `negotiableTags`, because the player chooses one, never
 * both and never neither once a set exists.
 *
 * Gates test a hero's principles only, and `HERO_DECISION_SPEC` §2.2 states plainly
 * that they do not depend on money: no advance, no promised bonus, nothing but tag
 * membership decides whether a principle blocks. So none of those fields is read
 * here — reading them would be answering a question the gate itself never asks.
 */
function bestReachableCrew(contract: ContractDefinition, content: ContentSet): number {
  const packages: readonly (readonly ContentId[])[] =
    contract.negotiableTags.length === 0
      ? [contract.tags]
      : contract.negotiableTags.map((tag) => [...contract.tags, tag]);

  const crewFor = (tags: readonly ContentId[]): number =>
    content.heroes
      .values()
      .filter((hero) =>
        hero.traits.every((traitId) => {
          const trait = content.traits.get(traitId);
          return trait === undefined || trait.kind !== 'principle' || !tags.includes(trait.tag);
        })
      ).length;

  return Math.max(...packages.map(crewFor));
}

/**
 * Every trait whose `tag` equals `tag`, of any kind (`NEGOTIATION_SPEC` §10.5). A
 * principle makes choosing that tag decisive through the gate (`HERO_DECISION_SPEC`
 * §2.2); an inclination makes it decisive through its contribution (§2.3). Either is
 * enough for the choice to matter — zero of either means the tag changes no hero's
 * decision at all, i.e. there is no value-based reason to choose it over its pair.
 */
function traitsReactingTo(tag: ContentId, content: ContentSet): readonly TraitDefinition[] {
  return content.traits.values().filter((trait) => trait.tag === tag);
}

describe('the shipped content is playable', () => {
  // `NEGOTIATION_SPEC` §10.5: checks over the content `content/` ships, not over the
  // format every other `describe` in this file checks — the difference between a
  // structurally valid contract and one a game can actually run.
  const content = loadContentSet(shippedContent);
  const catalogue = loadLocaleCatalogue(join(shippedContent, 'locale', 'ru.json'));

  it('ships no contract that cannot be crewed by any package', () => {
    for (const contract of content.contracts.values()) {
      expect(bestReachableCrew(contract, content), contract.id).toBeGreaterThanOrEqual(
        contract.requiredCrew
      );
    }
  });

  it('ships no negotiable tag no trait reacts to', () => {
    for (const contract of content.contracts.values()) {
      for (const tag of contract.negotiableTags) {
        expect(traitsReactingTo(tag, content).length, tag).toBeGreaterThan(0);
      }
    }
  });

  it('ships no contract whose full crew costs more than the guild starts with', () => {
    for (const contract of content.contracts.values()) {
      expect(contract.patronFee * contract.requiredCrew, contract.id).toBeLessThanOrEqual(
        STARTING_TREASURY
      );
    }
  });

  it('names every new reason code and every new tag in the catalogue', () => {
    for (const key of [
      'hero.decision.promise_of_a_bonus',
      'hero.decision.guild_broke_its_word',
      'tag.method.open'
    ]) {
      expect(catalogue.has(key), key).toBe(true);
    }
  });
});

describe('the two fields RESOLUTION_SPEC adds, through the loader rather than the contract', () => {
  // A tree of its own, because the shipped one cannot ask either of these questions:
  // no shipped hero declares a zero expertise, and no shipped file lists its needs in
  // any order but the declared one. Both properties are about what `toNeedMap` does,
  // and `schemas.test.ts` — which stops at `parse` — cannot see past it.

  it('keeps a zero expertise and drops nothing, so answerability survives the load', () => {
    // `RESOLUTION_SPEC` §2.2: a hero answerable for `frontline` at zero skill is not
    // the same hero as one `frontline` is no business of — the first can earn
    // `faltered_early` for it and is eligible for a wound on it, the second cannot.
    // On coverage both contribute nothing, so nothing downstream can recover the
    // difference if the loader flattens it here. A `.filter(([, w]) => w !== 0)` in
    // `toNeedMap` passes every other test in this file.
    const root = treeWith({
      heroes: [{ ...HERO, capability: { expertise: { frontline: 0 } },
  combat: { might: 40, guard: 40, aim: 40, focus: 40, care: 40 },
  role: 'vanguard' }]
    });

    const expertise = loadContentSet(root).heroes.get(parseContentId('core:bram'))!.capability
      .expertise;

    expect(expertise.has('frontline')).toBe(true);
    expect(expertise.get('frontline')).toBe(0);
    expect(expertise.has('undead_knowledge')).toBe(false);
    expect(expertise.entries()).toEqual([['frontline', 0]]);
  });

  it('orders needs by the vocabulary, not by the order the file listed them', () => {
    // The shipped files all happen to list needs in declaration order, so this is the
    // only place the two orders are told apart. The order reaches the canonical
    // artifact, which is why it must be a property of the vocabulary and not of how an
    // author typed the file.
    const root = treeWith({
      contracts: [
        { ...CONTRACT, needs: { wilderness: 20, undead_knowledge: 30, frontline: 25 } }
      ]
    });

    expect(
      loadContentSet(root).contracts.get(parseContentId('core:cleanse_the_crypt'))!.needs.entries()
    ).toEqual([
      ['frontline', 25],
      ['undead_knowledge', 30],
      ['wilderness', 20]
    ]);
  });

  it('builds those maps with compareNeedIds itself, not with a comparator that agrees', () => {
    // The tripwire the ordering assertions above cannot be: on today's three literals
    // declaration order and alphabetical order coincide, so `compareStrings` would pass
    // both of them. `compareNeedIds` refuses a value outside the vocabulary and a string
    // comparator answers it happily — which is the one question that tells them apart,
    // and it is asked here, of the map the *loader* built (`need-id.test.ts` asks it of
    // the comparator itself; that one stays green if this call site passes the wrong
    // one).
    const needs = loadContentSet(treeWith({})).contracts.get(ids.crypt)!.needs;

    expect(() => needs.has('swimming' as never)).toThrow(/not part of this vocabulary/);
  });
});

describe('loadContentSet over a tree built for this test', () => {
  it('reads the patron fee under its new name', () => {
    // DEC-008 §1: the old field name stopped distinguishing anything the moment a
    // second and a third kind of money joined it, so the field the file carries is
    // `patron_fee` and the definition this loader produces carries `patronFee`. Its
    // own tree rather than the shipped one — the shipped tree already carries this
    // through `describe('loadContentSet over the shipped tree')` above — this test's
    // reason to exist is the value (55) differing from every fixture built there, so
    // a loader that read a stale cached parse could not pass it by coincidence.
    const root = treeWith({
      contracts: [
        {
          schema_version: 6,
          id: 'core:cleanse_the_crypt',
          display_name_key: 'contract.core.cleanse_the_crypt.name',
          patron_fee: 55,
          risk: 80,
          required_crew: 4,
          needs: { frontline: 10, wilderness: 10 },
          tags: ['target:undead']
        }
      ]
    });

    expect(
      loadContentSet(root).contracts.get(parseContentId('core:cleanse_the_crypt'))!.patronFee
    ).toBe(55);
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

  it.each([
    { name: 'one tag', negotiable_tags: ['method:open'] },
    { name: 'three tags', negotiable_tags: ['method:open', 'method:deception', 'method:bribe'] }
  ])('refuses a negotiable set that is not exactly two tags ($name)', ({ negotiable_tags }) => {
    expect(() =>
      loadContentSet(sourceWith({ 'contracts/a.json': aContractFile({ negotiable_tags }) }))
    ).toThrow(/exactly 2/);
  });

  it('refuses a negotiable set naming the same tag twice', () => {
    // The count check alone does not catch this: `['method:open', 'method:open']` has
    // length 2, so it passes `!== NEGOTIABLE_TAGS_COUNT`. Left uncaught, it would be a
    // legal negotiable set offering the player a choice between a tag and itself —
    // exactly the one thing the field exists to prevent.
    expect(() =>
      loadContentSet(
        sourceWith({
          'contracts/a.json': aContractFile({ negotiable_tags: ['method:open', 'method:open'] })
        })
      )
    ).toThrow(/twice/);
  });

  it('refuses a negotiable tag the contract already carries', () => {
    expect(() =>
      loadContentSet(
        sourceWith({
          'contracts/a.json': aContractFile({
            tags: ['method:open'],
            negotiable_tags: ['method:open', 'method:deception']
          })
        })
      )
    ).toThrow(/already carries/);
  });

  it('refuses a negotiable set on a contract already carrying MAX_TAGS_PER_CONTRACT tags', () => {
    // Task 6's parked obligation: `createContractState` refuses an effective tag set
    // past `MAX_TAGS_PER_CONTRACT` once a method tag is chosen (`offer-state.ts`), but a
    // contract already at that ceiling in `tags` and still offering a choice can never
    // have one *made* — every candidate pushes the count one past it. A
    // content-authoring defect, caught here rather than left for the state guard to
    // discover the first time a player tries to choose.
    expect(() =>
      loadContentSet(
        sourceWith({
          'contracts/a.json': aContractFile({
            tags: [
              'target:undead',
              'target:cult',
              'target:temple',
              'target:bandits',
              'patron:slavers',
              'patron:merchant_guild'
            ],
            negotiable_tags: ['method:open', 'method:deception']
          })
        })
      )
    ).toThrow(/no method could ever be chosen/);
  });

  it('refuses a file that still declares schema version 2', () => {
    // Not the loosely matching `/schema_version/`: that also matches this same
    // loader's *other* schema_version diagnostic — "has no integer 'schema_version'
    // property" — so a test using it would stay green even if the version-mismatch
    // branch were mutated away. `scenarios/scenario-files.test.ts` already pins the
    // analogous manifest-version case the same, tighter way.
    expect(() =>
      loadContentSet(sourceWith({ 'contracts/a.json': aContractFile({ schema_version: 2 }) }))
    ).toThrow(/declares schema_version 2/);
  });

  it('accepts a contract with no negotiable set at all', () => {
    expect(
      loadContentSet(sourceWith({ 'contracts/a.json': aContractFile({}) })).contracts.get(ids.crypt)!
        .negotiableTags
    ).toEqual([]);
  });
});
