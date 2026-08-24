import { describe, expect, it } from 'vitest';

import { memoryFileSource } from '../file-source.ts';

import {
  ALLOWED_CONTRAST_INPUTS,
  SUPPORTED_CONTRAST_SCHEMA_VERSION,
  loadContrastDefinition
} from './contrast-definition.ts';

/**
 * The contrast format's own rules — every one of them a refusal, and every refusal named
 * for the wrong implementation it would let through: a loader that does not consult
 * {@link ALLOWED_CONTRAST_INPUTS} at all, one that checks the list but not the shape `from`/
 * `to` must have for the input it names, one that lets a contrast declare nothing to
 * compare, or one that never checks the file names the contrast it holds.
 */

const CONTRAST: Readonly<Record<string, unknown>> = {
  schema_version: SUPPORTED_CONTRAST_SCHEMA_VERSION,
  contrast: 'c',
  content_root: 'content',
  seed: 1,
  hero: 'core:kestrel',
  contract: 'core:escort_the_caravan',
  vary: { input: 'contract.risk', from: 0, to: 100 },
  expect: 'accept_to_decline'
};

function aContrastFile(overrides: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return { ...CONTRAST, ...overrides };
}

function sourceWith(file: Record<string, unknown>): ReturnType<typeof memoryFileSource> {
  return memoryFileSource({ 'c.json': JSON.stringify(file) });
}

describe('a contrast is refused rather than read on a guess', () => {
  it('reads a well-formed one', () => {
    const definition = loadContrastDefinition(sourceWith(aContrastFile({})), 'c.json');

    expect(definition).toEqual({
      schemaVersion: SUPPORTED_CONTRAST_SCHEMA_VERSION,
      contrast: 'c',
      contentRoot: 'content',
      seed: 1n,
      hero: 'core:kestrel',
      contract: 'core:escort_the_caravan',
      vary: { input: 'contract.risk', from: 0, to: 100 },
      expect: 'accept_to_decline'
    });
  });

  it('refuses a file that is not there', () => {
    expect(() => loadContrastDefinition(sourceWith(aContrastFile({})), 'absent.json')).toThrow(
      /does not exist/
    );
  });

  it('refuses a schema version this build does not read', () => {
    const source = sourceWith(aContrastFile({ schema_version: 2 }));

    expect(() => loadContrastDefinition(source, 'c.json')).toThrow(/declares schema_version 2/);
  });

  it('refuses an unknown property', () => {
    const source = sourceWith(aContrastFile({ surprise: true }));

    expect(() => loadContrastDefinition(source, 'c.json')).toThrow(/does not satisfy its contract/);
  });

  it('refuses a contrast id that disagrees with its own file name', () => {
    const source = sourceWith(aContrastFile({ contrast: 'other' }));

    expect(() => loadContrastDefinition(source, 'c.json')).toThrow(
      /but its file name names 'c'/
    );
  });

  // The property Step 2 names first, and the one an implementation forgetting to consult
  // `ALLOWED_CONTRAST_INPUTS` at all would let straight through: `hero.greed` is a real
  // `HeroDefinition` field and a real `DecisionContext` input, but not one of the nine a
  // player can perceive changing (`HERO_DECISION_SPEC` §7.3) — closed lists exist to refuse
  // exactly the input that would otherwise look plausible.
  it('refuses an input outside the closed list', () => {
    const source = sourceWith(
      aContrastFile({ vary: { input: 'hero.greed', from: 0, to: 1 } })
    );

    expect(() => loadContrastDefinition(source, 'c.json')).toThrow(/allowed inputs/);
  });

  it('refuses a value of the wrong shape for its input', () => {
    // `hero.believes_guild_promises` takes a boolean; a loader that checked only the
    // closed list and not the per-input shape would read `0`/`1` as if they meant
    // something, rather than refusing them.
    const source = sourceWith(
      aContrastFile({
        vary: { input: 'hero.believes_guild_promises', from: 0, to: 1 }
      })
    );

    expect(() => loadContrastDefinition(source, 'c.json')).toThrow(/takes a boolean/);
  });

  it('refuses an array where an input wants a content id', () => {
    const source = sourceWith(
      aContrastFile({ vary: { input: 'offer.method_tag', from: [], to: 'method:deception' } })
    );

    expect(() => loadContrastDefinition(source, 'c.json')).toThrow(
      /takes a content id or null/
    );
  });

  it('accepts null for offer.method_tag, distinct from an absent property', () => {
    const source = sourceWith(
      aContrastFile({
        vary: { input: 'offer.method_tag', from: null, to: 'method:deception' }
      })
    );

    expect(loadContrastDefinition(source, 'c.json').vary).toEqual({
      input: 'offer.method_tag',
      from: null,
      to: 'method:deception'
    });
  });

  it('reads contract.accepted_by as an array of content ids, the same shape contract.tags takes', () => {
    const source = sourceWith(
      aContrastFile({
        vary: { input: 'contract.accepted_by', from: [], to: ['fixture:crew_leader'] }
      })
    );

    expect(loadContrastDefinition(source, 'c.json').vary).toEqual({
      input: 'contract.accepted_by',
      from: [],
      to: ['fixture:crew_leader']
    });
  });

  it('refuses declaring the same value on both sides', () => {
    const source = sourceWith(
      aContrastFile({ vary: { input: 'contract.risk', from: 50, to: 50 } })
    );

    expect(() => loadContrastDefinition(source, 'c.json')).toThrow(/nothing to compare/);
  });

  it('refuses the same tag set on both sides, spelled in a different order', () => {
    // `contract.tags` becomes a `SortedSet`, so two differently-ordered spellings of the
    // same set are the same input to `decide` — a contrast declaring them as `from`/`to`
    // still proves nothing.
    const source = sourceWith(
      aContrastFile({
        vary: { input: 'contract.tags', from: ['a:one', 'a:two'], to: ['a:two', 'a:one'] }
      })
    );

    expect(() => loadContrastDefinition(source, 'c.json')).toThrow(/nothing to compare/);
  });

  it('refuses an expect this build has no meaning for', () => {
    const source = sourceWith(aContrastFile({ expect: 'maybe' }));

    expect(() => loadContrastDefinition(source, 'c.json')).toThrow(
      /expected 'decline_to_accept' or 'accept_to_decline'/
    );
  });

  it('refuses a content_root that climbs out of the repository', () => {
    const source = sourceWith(aContrastFile({ content_root: '../content' }));

    expect(() => loadContrastDefinition(source, 'c.json')).toThrow(/not a valid/);
  });

  it('refuses a malformed hero content id', () => {
    const source = sourceWith(aContrastFile({ hero: 'Core:Kestrel' }));

    expect(() => loadContrastDefinition(source, 'c.json')).toThrow(/Invalid ContentId/);
  });
});
