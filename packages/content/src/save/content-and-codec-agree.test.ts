import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { memoryFileSource } from '../file-source.ts';
import { createInitialState } from '../initial-state.ts';
import { MAX_ARTIFACT_SAFE_TEXT_LENGTH } from '../limits.ts';
import { loadContentSet as loadFromMemory } from '../content-set.ts';
import { loadContentSet } from '../node/index.ts';

import {
  MAX_APPLIED_COMMANDS,
  MAX_HEROES_PER_CONTRACT,
  decodeSnapshot,
  encodeSnapshot
} from './snapshot-codec.ts';

/**
 * The circle this project's own producer closes: content this loader accepts must
 * survive this codec, and every ceiling the codec states about a collection must still
 * be true of the tree that ships.
 *
 * External review of Task 16 found the circle open in one measured place and named the
 * class in another. `schemas.ts`'s `localizationKey` stated a pattern and no length
 * while `snapshot-codec.ts` cut at 256, so a hero file with a 257-character
 * `display_name_key` loaded, was written by `encodeSnapshot`, and came back
 * `SAVE_OUT_OF_BOUNDS` — a save this build produced and this build refused. The named
 * class is the same shape one level up: `MAX_APPLIED_COMMANDS` and
 * `MAX_HEROES_PER_CONTRACT` are multiples of *today's* content volume, so content
 * growing past them turns the same corner without anybody editing a line of save code.
 *
 * The length is now one declaration (`limits.ts`) applied at both ends, which is what
 * the first two cases below measure at the boundary. The ceilings cannot be one
 * declaration — they are derived from a volume no constant knows — so the third case is
 * what stands in for that: it reddens in CI when content grows past what a save can
 * carry, rather than at a player's save button.
 */

// Тот же способ добыть настоящее дерево, что у `snapshot-codec.test.ts`: тестовые
// файлы пакета исключены из правила «никаких node:*».
const repoRoot = resolve(import.meta.dirname, '..', '..', '..', '..');
const shipped = loadContentSet(join(repoRoot, 'content'));

const CONTRACT_FILE = JSON.stringify({
  schema_version: 3,
  id: 'core:cleanse_the_crypt',
  display_name_key: 'contract.core.cleanse_the_crypt.name',
  patron_fee: 70,
  risk: 30,
  required_crew: 1,
  tags: []
});

const TRAIT_FILE = JSON.stringify({
  schema_version: 3,
  id: 'core:greedy',
  display_name_key: 'trait.core.greedy.name',
  kind: 'inclination',
  tag: 'method:escort',
  weight: 20
});

/** A legitimate localization key of exactly `length` characters. */
function keyOfLength(length: number): string {
  const prefix = 'hero.core.';
  return prefix + 'x'.repeat(length - prefix.length);
}

function treeWithHeroNamed(displayNameKey: string): Record<string, string> {
  return {
    'heroes/bram.json': JSON.stringify({
      schema_version: 3,
      id: 'core:bram',
      display_name_key: displayNameKey,
      greed: 60,
      caution: 30,
      pride: 45,
      trust_in_guild: 50,
      traits: [],
      relationships: []
    }),
    'contracts/crypt.json': CONTRACT_FILE,
    'traits/greedy.json': TRAIT_FILE
  };
}

describe('what the content contract accepts, the save codec reads back', () => {
  it('at the longest localization key the contract allows — a value no corpus record has', () => {
    // The boundary, on purpose, and outside the corpus on purpose: the shipped tree's
    // longest key is nowhere near this, so nothing already frozen exercises it. This is
    // the case that reddens if either end moves without the other.
    const displayNameKey = keyOfLength(MAX_ARTIFACT_SAFE_TEXT_LENGTH);
    expect(displayNameKey).toHaveLength(MAX_ARTIFACT_SAFE_TEXT_LENGTH);

    const content = loadFromMemory(memoryFileSource(treeWithHeroNamed(displayNameKey)));
    const state = createInitialState(content, 7n, 'm1-negotiation/1');

    const decoded = decodeSnapshot(JSON.parse(JSON.stringify(encodeSnapshot(state))));

    expect([...decoded.heroes.values()][0]?.displayNameKey).toBe(displayNameKey);
  });

  it('and refuses one character further, at the loader rather than at the save file', () => {
    // Measured before the fix: this tree loaded, and the round trip threw
    // `SAVE_OUT_OF_BOUNDS: heroes.0.value.displayNameKey: Too big`. The refusal belongs
    // to whoever authored the content, at the moment they authored it.
    const displayNameKey = keyOfLength(MAX_ARTIFACT_SAFE_TEXT_LENGTH + 1);

    expect(() => loadFromMemory(memoryFileSource(treeWithHeroNamed(displayNameKey)))).toThrow();
  });

  it('and refuses a ruleset version longer than a save can carry', () => {
    // The other string that reaches `displayNameKey`'s ceiling without going through a
    // content file: `rulesetVersion` arrives from a tool. `requireArtifactSafeText`
    // states a character set and no length, so this is the check beside it.
    const content = loadFromMemory(
      memoryFileSource(treeWithHeroNamed('hero.core.bram.name'))
    );

    expect(() =>
      createInitialState(content, 7n, 'm'.repeat(MAX_ARTIFACT_SAFE_TEXT_LENGTH + 1))
    ).toThrow(/save file accepts at most/u);
    expect(() =>
      createInitialState(content, 7n, 'm'.repeat(MAX_ARTIFACT_SAFE_TEXT_LENGTH))
    ).not.toThrow();
  });
});

describe('the shipped tree fits the ceilings a save states about it', () => {
  // These two constants are `4 ×` today's volume rather than today's volume itself, so
  // there is real headroom — but headroom is a number, and content is a thing that
  // grows. What must not happen is content growing past them silently: the first save
  // of a campaign that big would be refused by this same build, at a player's save
  // button, with `SAVE_OUT_OF_BOUNDS`.

  it('has no more heroes than a contract’s respondedBy may name', () => {
    expect(shipped.heroes.size).toBeLessThanOrEqual(MAX_HEROES_PER_CONTRACT);
  });

  it('cannot produce more decisions than the applied-command ceiling allows', () => {
    // A hero answers each contract at most once, ever (`ContractState.respondedBy`), so
    // heroes × contracts is the achievable ceiling on a campaign's whole length — and on
    // its history, and on its traces, all three of which reuse this constant.
    expect(shipped.heroes.size * shipped.contracts.size).toBeLessThanOrEqual(
      MAX_APPLIED_COMMANDS
    );
  });
});
