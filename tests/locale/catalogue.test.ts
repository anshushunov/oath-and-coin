import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SAVE_SLOTS } from '@oath-and-coin/application';
import { ERROR_CODES, KNOWN_SCREEN_STATES, SAVE_ERROR_CODES } from '@oath-and-coin/content';
import {
  computeContentVersion,
  loadContentSet,
  loadLocaleCatalogue,
  loadUiTextCatalogue
} from '@oath-and-coin/content/node';
import {
  ACTION_KEYS,
  FIELD_KEYS,
  QUALITATIVE_KEYS,
  REASON_DIRECTION_KEYS,
  SAVES_TITLE_KEY,
  SAVE_FIELD_KEYS,
  SAVE_OVERWRITE_KEYS,
  SAVE_SLOTS_STATE_KEYS,
  SAVE_SLOT_STATUS_KEYS,
  SCREEN_LINK_KEYS,
  SCREEN_STATES,
  SCREEN_STATE_KEYS,
  TITLE_KEY,
  WAVERED_KEYS,
  contractDisplayNameKey,
  errorKey,
  saveSlotDisplayNameKey,
  saveSlotLoadKey,
  saveSlotSaveKey,
  tagKey,
  traitDisplayNameKey
} from '@oath-and-coin/presentation';
import { REASON_CODES } from '@oath-and-coin/simulation';

/**
 * The completeness check that has nowhere else to live, now holding two catalogues
 * against one another as well as against the keys the code can produce.
 *
 * `presentation-depends-only-on-simulation` keeps the presentation layer away from
 * `packages/content`, so the layer that knows every key a screen can produce cannot see
 * the shipped catalogue, the shipped content or the lists of stable error codes. This
 * member is allowed to see all of them, and that is its whole reason for existing — the
 * segment plan §1.2 named the alternative and rejected it: copying the error codes into
 * the presentation layer would be a second declaration of a closed set with nothing to
 * check it against.
 *
 * What it protects against is a screen showing an untranslated key to a player. The
 * failure is invisible to every other gate: the model is right, both hashes are right,
 * and the label reads `field.hero.greed`.
 *
 * `ADR-012` added the second catalogue and, with it, three things to check that a single
 * catalogue did not need. A key must exist in **exactly one** of the two; no key may sit
 * in both, because two declarations of one text on opposite sides of a boundary drift
 * apart silently — the shape segment 4 closed for `KNOWN_SCREEN_STATES` against
 * `SCREEN_STATES` a few lines below; and the content catalogue must not have grown at
 * all, because every byte under `content/` is inside `content_version` and the frozen
 * corpus pins that number for all 54 entries.
 */

const repositoryRoot = resolve(import.meta.dirname, '..', '..');
const shippedContent = join(repositoryRoot, 'content');

const contentCatalogue = loadLocaleCatalogue(join(shippedContent, 'locale', 'ru.json'));
const interfaceCatalogue = loadUiTextCatalogue(join(repositoryRoot, 'ui-text', 'ru.json'));
const content = loadContentSet(shippedContent);

/**
 * The content version the frozen corpus recorded, and the number of keys the content
 * catalogue held when `ADR-012` froze it.
 *
 * Both are assertions rather than observations. The version alone would not name what
 * went wrong — a moved digest says "something under `content/` changed" — and the key
 * count alone would miss an *edited* text. Together they say "the content catalogue is
 * closed and nothing else in the tree moved either", which is the rule `ADR-012` set.
 *
 * `FROZEN_CONTENT_VERSION` is the **second** literal of this hash in the workspace:
 * `packages/content/src/source-agreement.test.ts` holds it as `RECORDED_CONTENT_VERSION`,
 * where it says something different — that the Node source and an in-memory one answer
 * the same number. The two are not merged because neither file may own the other's
 * claim, and a shared constant would put the pin in a place where deleting one test
 * would quietly weaken the other. Task 19 retires **both**, not only this one; `ADR-012`
 * records that.
 *
 * The number itself has moved three times already, off what the corpus originally
 * recorded: `DEC-008` Task 3 renamed the contract's fee field, Task 4 raised every
 * file's `schema_version` and authored `negotiable_tags` on two contracts, and Task 8
 * added the two reason-code keys the decision rule's new factors need —
 * `hero.decision.promise_of_a_bonus` and `hero.decision.guild_broke_its_word` — the
 * first keys this file's `content/locale/ru.json` half has grown since `ADR-012` froze
 * it, because Task 8 is the first point in the plan where a producer exists for them
 * (`vocabulary.test.ts` holds every reason code to a localization key, and the closed
 * engine vocabulary those two codes belong in has nowhere else to be translated). Each
 * move was deliberate and reviewed, not the drift this test exists to catch — the guard
 * below is against the *next* unreviewed one.
 */
const FROZEN_CONTENT_VERSION = '3b2b90cfffa3bb47';
const FROZEN_CONTENT_KEY_COUNT = 96;

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

/**
 * Every key the interface itself can produce — the texts the screens invent rather than
 * the ones content authors (`ADR-012`).
 *
 * The save refusals: nine closed codes, each of which a player can be shown when a slot
 * refuses to load. Derived from the engine-side list rather than typed again here, for
 * the same reason `ERROR_CODES` is above — a tenth code must not be able to arrive
 * unchecked against either catalogue.
 *
 * Then the save-slots screen (Task 16.8), whose per-slot keys are the one place this
 * file needs both sides at once in a new way: `packages/presentation` builds a key from
 * whatever slot name it is handed and cannot know the closed set they come from, because
 * `SAVE_SLOTS` is `packages/application`'s. Neither package can state these nine keys on
 * its own, so they are stated here — which is the same reason `errorKey` has no list
 * beside it either.
 */
function everyKeyTheInterfaceCanShow(): readonly string[] {
  return [
    ...SAVE_ERROR_CODES.map(errorKey),
    SAVES_TITLE_KEY,
    ...SAVE_SLOTS_STATE_KEYS,
    ...SAVE_SLOT_STATUS_KEYS,
    ...SAVE_FIELD_KEYS,
    ...SAVE_OVERWRITE_KEYS,
    ...SCREEN_LINK_KEYS,
    ...SAVE_SLOTS.map(saveSlotDisplayNameKey),
    ...SAVE_SLOTS.map(saveSlotSaveKey),
    ...SAVE_SLOTS.map(saveSlotLoadKey)
  ];
}

function everyKeyEitherLayerCanShow(): readonly string[] {
  return [...everyKeyTheScreenCanShow(), ...everyKeyTheInterfaceCanShow()];
}

/** Which of the two catalogues hold `key` — none, one, or (the failure) both. */
function cataloguesHolding(key: string): readonly string[] {
  return [
    ...(contentCatalogue.get(key) === undefined ? [] : ['content/locale/ru.json']),
    ...(interfaceCatalogue.get(key) === undefined ? [] : ['ui-text/ru.json'])
  ];
}

function textFor(key: string): string {
  return (contentCatalogue.get(key) ?? interfaceCatalogue.get(key) ?? '').trim();
}

describe('the two shipped catalogues', () => {
  it('answer every key either layer can produce, and answer it from exactly one catalogue', () => {
    const produced = everyKeyEitherLayerCanShow();
    const missing = produced.filter((key) => cataloguesHolding(key).length === 0);
    const doubled = produced.filter((key) => cataloguesHolding(key).length > 1);

    expect(
      missing,
      `keys with no entry in either catalogue: ${missing.join(', ')}. A key the interface ` +
        'invents belongs in ui-text/ru.json; content/locale/ru.json is frozen (ADR-012).'
    ).toEqual([]);
    expect(doubled, `keys answered by both catalogues at once: ${doubled.join(', ')}`).toEqual([]);
  });

  it('answer nothing nobody asks for, on the side that has no other guard', () => {
    // The asymmetry `ADR-012` left open and Task 16.8 closes. `content/locale/ru.json`
    // is held closed by the two pins below — its size and `content_version` — so a key
    // nobody produces cannot be added to it unnoticed. `ui-text/ru.json` had no such
    // guard at all: it is outside `content_version` by design, which is the whole point
    // of it, so until this check existed a key could be added, never produced by any
    // code, and sit there being translated and reviewed for nothing.
    //
    // Stated as an exact equality rather than "no orphans", because both directions are
    // failures worth naming: a key with no producer is dead text, and a producer with no
    // key is a screen that throws on the first player who reaches it (the completeness
    // check above says the same thing, and says it about both catalogues at once).
    const produced = new Set(everyKeyTheInterfaceCanShow());
    const orphans = interfaceCatalogue.keys().filter((key) => !produced.has(key));

    expect(
      orphans,
      `declared in ui-text/ru.json and produced by nothing: ${orphans.join(', ')}. A key no code ` +
        'builds is not an interface text, it is a leftover.'
    ).toEqual([]);
  });

  it('declare no key on both sides of the boundary', () => {
    // Over the whole of both catalogues, not only over the keys some layer produces
    // today: a doubled entry nothing reads yet is still two declarations of one text,
    // and the day something reads it, which of the two it gets is decided by lookup
    // order rather than by an author. The check above is the same claim narrowed to the
    // keys something produces; this one is what catches a pair nothing reads yet.
    const inBoth = contentCatalogue
      .keys()
      .filter((key) => interfaceCatalogue.get(key) !== undefined);

    expect(
      inBoth,
      `declared in content/locale/ru.json and in ui-text/ru.json at once: ${inBoth.join(', ')}`
    ).toEqual([]);
  });

  it('answer each key with text a person reads, not with a key of any kind', () => {
    // A catalogue that echoed its keys back would pass the completeness check above
    // while the screen showed `field.hero.greed` to a player.
    //
    // "Not the key itself" is not enough, and external review reproduced why:
    // `field.hero.greed: "field.hero.caution"` passes that test and still puts an
    // untranslated key in front of a player. What has to be rejected is the *shape* of
    // a key — a dotted lowercase path with no spaces — because no Russian sentence
    // looks like one.
    const looksLikeAKey = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/u;

    for (const key of everyKeyEitherLayerCanShow()) {
      const text = textFor(key);

      expect(text, key).not.toBe('');
      expect(text, `'${key}' is answered with '${text}', which is itself a key`).not.toMatch(
        looksLikeAKey
      );
    }
  });

  it('name every contract and trait by the convention the screen rebuilds', () => {
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

describe('the content tree the corpus is the oracle for', () => {
  it('has not been added to, and neither has its catalogue', () => {
    // The guard that reddens before parity does. `pnpm scenario:parity` catches the same
    // edit, and catches it as 54 failed entries with a page of structural diffs; this is
    // one line that names the cause. It is here rather than beside the digest because
    // this is the file that knows why somebody would have been tempted: a new
    // player-facing string, which now has somewhere else to go.
    expect(
      contentCatalogue.size,
      'a key was added to content/locale/ru.json. New interface keys go to ui-text/ru.json ' +
        '(ADR-012); content/locale/ru.json is frozen until Task 19 retires the corpus.'
    ).toBe(FROZEN_CONTENT_KEY_COUNT);

    expect(
      computeContentVersion(shippedContent),
      'something under content/ changed, so content_version moved and all 54 corpus entries ' +
        'are about to fail parity. Interface text belongs in ui-text/ (ADR-012).'
    ).toBe(FROZEN_CONTENT_VERSION);
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
