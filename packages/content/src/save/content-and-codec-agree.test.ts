import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { memoryFileSource } from '../file-source.ts';
import { createInitialState } from '../initial-state.ts';
import { MAX_ARTIFACT_SAFE_TEXT_LENGTH } from '../limits.ts';
import { loadContentSet as loadFromMemory } from '../content-set.ts';
import { loadContentSet } from '../node/index.ts';

import {
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
 * class is the same shape one level up: `MAX_HEROES_PER_CONTRACT` is a multiple of
 * *today's* content volume, so content growing past it turns the same corner without
 * anybody editing a line of save code.
 *
 * The length is now one declaration (`limits.ts`) applied at both ends, which is what
 * the two cases below measure at the boundary.
 *
 * **What used to stand in for the third ceiling, `MAX_APPLIED_COMMANDS`, no longer
 * does.** A test here once asserted `shipped.heroes.size * shipped.contracts.size <=
 * MAX_APPLIED_COMMANDS` on the premise that a hero answers each contract at most once,
 * ever. `composeOffer` broke that premise — a revision is itself an applied command,
 * and `respondedBy` resets on every version bump (`NEGOTIATION_SPEC` §2.1), so a player
 * free to revise a draft indefinitely can produce arbitrarily many applied commands on
 * one hero/contract pair. Removed rather than kept green on a premise that no longer
 * held (`DEC-008` Task 22's whole-branch fix wave); see the comment where it used to be,
 * below.
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
  // `MAX_HEROES_PER_CONTRACT` is a multiple of today's volume rather than today's volume
  // itself, so there is real headroom — but headroom is a number, and content is a thing
  // that grows. What must not happen is content growing past it silently: the first save
  // of a campaign that big would be refused by this same build, at a player's save
  // button, with `SAVE_OUT_OF_BOUNDS`.

  it('has no more heroes than a contract’s respondedBy may name', () => {
    expect(shipped.heroes.size).toBeLessThanOrEqual(MAX_HEROES_PER_CONTRACT);
  });

  // No test here asserts `shipped.heroes.size * shipped.contracts.size <=
  // MAX_APPLIED_COMMANDS` any more (removed in the whole-branch fix wave, `DEC-008`
  // Task 22). It stood on "a hero answers each contract at most once, ever"
  // (`ContractState.respondedBy`), which `composeOffer` broke: a revision is itself an
  // applied command, `respondedBy` resets to empty on every version bump
  // (`NEGOTIATION_SPEC` §2.1), and a player free to revise a draft indefinitely can
  // produce arbitrarily many applied commands on a single hero/contract pair. The
  // assertion still passed — 6 heroes × 4 contracts = 24 sits well under 96 — but it was
  // proving a bound that no longer follows from the premise it cited, which is worse than
  // proving nothing: it read as a guard against a campaign outgrowing
  // `MAX_APPLIED_COMMANDS`, and was not one. `MAX_APPLIED_COMMANDS`'s own comment
  // (`snapshot-codec.ts`) already retracts the same premise and states the constant is a
  // generous ceiling against today's content, not one derived from it — this test
  // restated a derivation the codec had already disowned. A real content-vs-ceiling
  // guard, if the shipped tree ever needs one, would have to bound the number of
  // `composeOffer` revisions a playable campaign can reach, which nothing here
  // measures; that is a new check, not a fix to this one, and is left for its own task.
});
