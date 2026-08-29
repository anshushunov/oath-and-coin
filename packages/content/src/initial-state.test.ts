import { join, resolve } from 'node:path';

import { ContractStatus, createContractState, parseContentId } from '@oath-and-coin/simulation';
import { describe, expect, it, vi } from 'vitest';

import { loadContentSet } from './node/index.ts';
import { createInitialState } from './initial-state.ts';
import { SAVE_SCHEMA_VERSION } from './versions.ts';

// A spy that calls through to the real implementation by default, so every other
// test in this file exercises the genuine function. Only the one test below that
// asks for a one-time override sees anything different — see its own comment for
// why a spy, rather than a content fixture, is what this claim needs.
vi.mock('@oath-and-coin/simulation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@oath-and-coin/simulation')>();
  return { ...actual, createContractState: vi.fn(actual.createContractState) };
});

const repoRoot = resolve(import.meta.dirname, '..', '..', '..');
const content = loadContentSet(join(repoRoot, 'content'));

/**
 * The bridge from content to state, and the assertions are parity assertions: the frozen
 * corpus records this exact starting roster in the `final_state` of all 54 entries, so
 * the hero ids and the order they are assigned in are facts, not choices this test is
 * free to restate.
 */

describe('createInitialState', () => {
  const state = createInitialState(content, 7n, 'm1-resolution/1');

  it('assigns hero ids in content-id order, which is what the corpus recorded', () => {
    // Filesystem order is not a property of the content: it varies by platform, by
    // filesystem and by how the tree was checked out. An id derived from it would make
    // the same content produce different states on different machines, and every "same
    // seed, same result" claim on top of it would be false in a way no test on one
    // machine could see.
    expect(state.heroes.values().map((hero) => [hero.id, hero.definition])).toEqual([
      [0, 'core:bram'],
      [1, 'core:doran'],
      [2, 'core:ilsa'],
      [3, 'core:kestrel'],
      [4, 'core:mira'],
      [5, 'core:zara']
    ]);
  });

  it('carries the reproducibility tuple into metadata', () => {
    expect(state.metadata).toEqual({
      saveSchemaVersion: SAVE_SCHEMA_VERSION,
      rulesetVersion: 'm1-resolution/1',
      // `6ec81ab69e9fcec3` until Task 18 authored `core:works_in_the_open` and its
      // localization key, then `9763a54ae7dbff9c` until the same task's own crewability
      // check found `core:collect_the_debt` unreachable and fixed it with
      // `required_crew: 2 → 1`, then `46416b20360bbedd` until the resolution engine's
      // Task 2 raised every file to `schema_version: 5` and authored `capability` and
      // `needs` (`content-set.test.ts` carries the same move's full history).
      contentVersion: 'c02e365478576dd7',
      campaignSeed: 7n,
      stateVersion: 0,
      logicalTime: 0,
      nextEventId: 0,
      nextTraceId: 0,
      nextDecisionOrdinal: 0n
    });
  });

  it('applies the seed it was given rather than any default', () => {
    // The mutant that made this test necessary lives in the corpus's own history: with
    // one seed frozen, `createInitialState(seed, …)` → `createInitialState(7UL, …)` left
    // every oracle test green — a port ignoring the seed entirely matched perfectly.
    expect(createInitialState(content, 424242n, 'm1-resolution/1').metadata.campaignSeed).toBe(
      424242n
    );
  });

  it('offers every contract with no responses yet', () => {
    for (const contract of state.contracts.values()) {
      expect(contract.status).toBe(ContractStatus.Offered);
      expect(contract.offer.version).toBe(1);
      expect(contract.offer.respondedBy.size).toBe(0);
      expect(contract.offer.acceptedBy.size).toBe(0);
      expect(contract.moodOrdinals.size).toBe(0);
    }

    expect(state.contracts.get(parseContentId('core:cleanse_the_crypt'))?.tags.values()).toEqual([
      'method:public_contract',
      'target:undead'
    ]);
  });

  it('resolves every trait into the rulebook the engine reads', () => {
    // The one place a trait definition becomes a plain rule. The engine cannot reference
    // the package that defines traits, so this crossing happens exactly once.
    expect(state.traitRules.size).toBe(content.traits.size);
    expect(state.traitRules.get(parseContentId('core:hates_the_cult'))).toEqual({
      id: 'core:hates_the_cult',
      tag: 'target:cult',
      isPrinciple: false,
      weight: 14
    });
    expect(state.traitRules.get(parseContentId('core:refuses_deception'))).toEqual({
      id: 'core:refuses_deception',
      tag: 'method:deception',
      isPrinciple: true,
      weight: 0
    });
  });

  it('keeps a hero relationship keyed by the other hero content id', () => {
    // Authored as an array of pairs, held in state as a map: the decision rule looks a
    // bond up by id rather than scanning a list for it.
    const bram = state.heroes.get(0 as never);

    expect(bram?.relationships.entries()).toEqual([['core:zara', -8]]);
  });

  it('starts with an empty log and nothing applied', () => {
    expect(state.history).toEqual([]);
    expect(state.traces.size).toBe(0);
    expect(state.appliedCommandIds.size).toBe(0);
  });

  it.each([
    { name: 'an empty ruleset version', version: '' },
    { name: 'a ruleset version of spaces', version: '   ' },
    { name: 'a non-ASCII ruleset version', version: 'м1-decision/1' },
    { name: 'a ruleset version with a control character', version: 'm1' },
    { name: "a ruleset version with the `< > & ' +` set", version: 'm1+decision' }
  ])('refuses $name, because it travels in every artifact', ({ version }) => {
    // External review's blocker, from the other end: the version string reaches every
    // canonical artifact the campaign will ever produce, and `!== ''` was the whole
    // check. Non-ASCII, control characters and that punctuation set are exactly where
    // the frozen corpus records the old C# writer and RFC 8785 producing different
    // bytes — so any of them would make the artifact version a false claim.
    expect(() => createInitialState(content, 7n, version)).toThrow(/outside the character set/);
  });

  it.each([-1n, -7n, 2n ** 64n, 2n ** 70n])('refuses the seed %s', (seed) => {
    // The floor `bigint` lost when it replaced `ulong`. The RNG masks whatever it is
    // given back to 64 bits, so a negative seed silently aliases a valid unsigned one.
    expect(() => createInitialState(content, seed, 'm1-resolution/1')).toThrow(
      /outside the 64-bit unsigned range/
    );
  });

  it('accepts both ends of the seed range', () => {
    expect(createInitialState(content, 0n, 'm1-resolution/1').metadata.campaignSeed).toBe(0n);
    expect(
      createInitialState(content, 2n ** 64n - 1n, 'm1-resolution/1').metadata.campaignSeed
    ).toBe(2n ** 64n - 1n);
  });

  it('hands back a tree nothing can edit afterwards', () => {
    // Persistence used to exist only in the types: `readonly` is erased, so a caller
    // holding a reference could rewrite state behind every check that had passed.
    const built = createInitialState(content, 7n, 'm1-resolution/1');

    expect(Object.isFrozen(built)).toBe(true);
    expect(Object.isFrozen(built.metadata)).toBe(true);
    expect(Object.isFrozen(built.heroes.values()[0])).toBe(true);
    expect(() => {
      (built.metadata as { stateVersion: number }).stateVersion = 99;
    }).toThrow(TypeError);
  });

  it('builds every contract through createContractState, not a literal that skips it', () => {
    // The claim `offer-state.ts`'s own doc makes for this call site — "the door every
    // fresh-from-content contract is forced through" — has no test proving it on its
    // own: `initialOffer()` is always the trivial valid draft, so no `patronFee`,
    // `requiredCrew` or `tags` this loader accepts (all already bounded by the content
    // schema) can drive a real §2.1 violation through this call. Wrapping
    // `createContractState({...})` in `{...}` and dropping the wrapper would leave every
    // other test in this file green. A spy is what proves the wiring where the
    // behaviour cannot: replace one call with a function that throws its own message,
    // and the loader must surface exactly that message — which only happens if it
    // called the real (now spied) function rather than assembling the object by hand.
    const spy = vi.mocked(createContractState);
    const sentinel = 'createContractState was not called for the first contract built';
    spy.mockImplementationOnce(() => {
      throw new Error(sentinel);
    });

    expect(() => createInitialState(content, 7n, 'm1-resolution/1')).toThrow(sentinel);
  });
});
