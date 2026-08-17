import { join, resolve } from 'node:path';

import { ContractStatus, parseContentId } from '@oath-and-coin/simulation';
import { describe, expect, it } from 'vitest';

import { loadContentSet } from './content-set.ts';
import { createInitialState } from './initial-state.ts';
import { SAVE_SCHEMA_VERSION } from './versions.ts';

const repoRoot = resolve(import.meta.dirname, '..', '..', '..');
const content = loadContentSet(join(repoRoot, 'content'));

/**
 * The bridge from content to state, and the assertions are parity assertions: the frozen
 * corpus records this exact starting roster in the `final_state` of all 54 entries, so
 * the hero ids and the order they are assigned in are facts, not choices this test is
 * free to restate.
 */

describe('createInitialState', () => {
  const state = createInitialState(content, 7n, 'm1-decision/1');

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
      rulesetVersion: 'm1-decision/1',
      contentVersion: '5d03734fd9c7abaa',
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
    expect(createInitialState(content, 424242n, 'm1-decision/1').metadata.campaignSeed).toBe(
      424242n
    );
  });

  it('offers every contract with no responses yet', () => {
    for (const contract of state.contracts.values()) {
      expect(contract.status).toBe(ContractStatus.Offered);
      expect(contract.respondedBy.size).toBe(0);
      expect(contract.acceptedBy.size).toBe(0);
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

  it('refuses an empty ruleset version, which travels in every artifact', () => {
    expect(() => createInitialState(content, 7n, '')).toThrow(/needs a ruleset version/);
  });
});
