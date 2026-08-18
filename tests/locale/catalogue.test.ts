import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ERROR_CODES,
  KNOWN_SCREEN_STATES,
  loadContentSet,
  loadLocaleCatalogue
} from '@oath-and-coin/content';
import {
  ACTION_KEYS,
  FIELD_KEYS,
  QUALITATIVE_KEYS,
  REASON_DIRECTION_KEYS,
  SCREEN_STATES,
  SCREEN_STATE_KEYS,
  TITLE_KEY,
  WAVERED_KEYS,
  contractDisplayNameKey,
  errorKey,
  tagKey,
  traitDisplayNameKey
} from '@oath-and-coin/presentation';
import { REASON_CODES } from '@oath-and-coin/simulation';

/**
 * The completeness check that has nowhere else to live.
 *
 * `presentation-depends-only-on-simulation` keeps the presentation layer away from
 * `packages/content`, so the layer that knows every key a screen can produce cannot see
 * the shipped catalogue, the shipped content or the list of stable error codes. This
 * member is allowed to see all four, and that is its whole reason for existing — the
 * segment plan §1.2 named the alternative and rejected it: copying the five error codes
 * into the presentation layer would be a second declaration of a closed set with
 * nothing to check it against.
 *
 * What it protects against is a screen showing an untranslated key to a player. The
 * failure is invisible to every other gate: the model is right, both hashes are right,
 * and the label reads `field.hero.greed`.
 */

const repositoryRoot = resolve(import.meta.dirname, '..', '..');
const catalogue = loadLocaleCatalogue(join(repositoryRoot, 'content', 'locale', 'ru.json'));
const content = loadContentSet(join(repositoryRoot, 'content'));

/** Every key the presentation layer can produce for the shipped content tree. */
function everyKeyTheScreenCanShow(): readonly string[] {
  return [
    TITLE_KEY,
    ...SCREEN_STATE_KEYS,
    ...ACTION_KEYS,
    ...REASON_DIRECTION_KEYS,
    ...WAVERED_KEYS,
    ...FIELD_KEYS,
    ...QUALITATIVE_KEYS,
    // A reason code is itself a localization key, and the engine's vocabulary is
    // closed — so this list is the engine's, not a copy of it.
    ...REASON_CODES,
    ...ERROR_CODES.map(errorKey),
    // Content-derived keys. The contract and trait conventions are rebuilt from each
    // id, which is exactly the reconstruction that has to agree with what an author
    // actually wrote — see `contractDisplayNameKey`.
    ...content.contracts.keys().map(contractDisplayNameKey),
    ...content.traits.keys().map(traitDisplayNameKey),
    ...content.heroes.values().map((hero) => hero.displayNameKey),
    ...content.contracts.values().flatMap((contract) => contract.tags.map(tagKey))
  ];
}

describe('the shipped catalogue', () => {
  it('answers every key the contract-offer screen can produce', () => {
    const missing = everyKeyTheScreenCanShow().filter((key) => catalogue.get(key) === undefined);

    expect(missing, `keys with no entry in content/locale/ru.json: ${missing.join(', ')}`).toEqual(
      []
    );
  });

  it('answers each of them with text a person reads, not with the key again', () => {
    // A catalogue that echoed its keys back would pass the check above while the screen
    // showed `field.hero.greed` to a player.
    for (const key of everyKeyTheScreenCanShow()) {
      expect(catalogue.get(key), key).not.toBe(key);
      expect((catalogue.get(key) ?? '').trim(), key).not.toBe('');
    }
  });

  it('names every contract and trait by the convention the screen rebuilds', () => {
    // The screen has no authored key for either — state carries neither — so it builds
    // one from the id. An author who spells `display_name_key` differently fails here
    // rather than shipping a key nobody translated.
    for (const contract of content.contracts.values()) {
      expect(contract.displayNameKey).toBe(contractDisplayNameKey(contract.id));
    }

    for (const trait of content.traits.values()) {
      expect(trait.displayNameKey).toBe(traitDisplayNameKey(trait.id));
    }
  });
});

describe('the two declarations of the five screen states', () => {
  it('agree', () => {
    // `packages/content` declares them because a scenario manifest names an expected
    // state; `packages/presentation` declares them because a read model carries one.
    // The boundary forbids the import that would collapse the two into one, so the
    // agreement is asserted here instead — the alternative is a sixth state added on
    // one side and silently unrepresentable on the other.
    // Lowercased on one side: a manifest writes `normal`, a read model carries
    // `Normal`, and the wire form is what a scenario author types. The set is what has
    // to agree, not the spelling.
    expect(SCREEN_STATES.map((state) => state.toLowerCase()).sort()).toEqual(
      [...KNOWN_SCREEN_STATES].sort()
    );
  });
});
