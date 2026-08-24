import {
  RULESET_VERSION,
  createInitialState,
  loadContentSet,
  memoryFileSource
} from '@oath-and-coin/content';
import {
  composeOffer,
  lockOffer,
  pollCrew,
  proposeContractToHero
} from '@oath-and-coin/simulation';
import { describe, expect, it } from 'vitest';

import { buildSave, readSave } from './envelope.ts';

/**
 * `pollCrew` (`DEC-008` Task 13) is the first command whose one `commandId` can leave
 * more than one event in `history` — up to every hero the roster still owed an answer
 * to, in a single call. Every command before it appended exactly one event per applied
 * command id, and `validate-game-state.ts`'s `checkCounters` was written against that
 * shape: `appliedCommandIds.size === history.length`. This suite is the one that
 * exercises the shape `pollCrew` actually produces — three heroes, one `pollCrew` call,
 * two of its events — through the *real* save path (`buildSave`/`readSave`), not just
 * the codec's own schema.
 *
 * A fresh, self-contained content set and campaign, deliberately not reusing
 * `envelope.test.ts`'s shared `content`/`state`: that fixture is pinned by tamper-table
 * tests that count exact event/trace ids for a single-hero campaign, and widening its
 * roster to exercise `pollCrew` would move every one of those numbers for a reason
 * unrelated to what they test.
 */

const KEY_HERO_FILE = {
  schema_version: 3,
  id: 'core:bram',
  display_name_key: 'hero.core.bram.name',
  greed: 60,
  caution: 0,
  pride: 0,
  trust_in_guild: 50,
  traits: [],
  relationships: []
};

const OTHER_HERO_FILE = {
  schema_version: 3,
  id: 'core:doran',
  display_name_key: 'hero.core.doran.name',
  greed: 60,
  caution: 0,
  pride: 0,
  trust_in_guild: 50,
  traits: [],
  relationships: []
};

const THIRD_HERO_FILE = {
  schema_version: 3,
  id: 'core:zara',
  display_name_key: 'hero.core.zara.name',
  greed: 60,
  caution: 0,
  pride: 0,
  trust_in_guild: 50,
  traits: [],
  relationships: []
};

const CONTRACT_FILE = {
  schema_version: 3,
  id: 'core:cleanse_the_crypt',
  display_name_key: 'contract.core.cleanse_the_crypt.name',
  patron_fee: 70,
  risk: 0,
  required_crew: 2,
  tags: []
};

/** Unused by any hero here — `loadContentSet` still requires a `traits/` directory. */
const UNUSED_TRAIT_FILE = {
  schema_version: 3,
  id: 'core:greedy',
  display_name_key: 'trait.core.greedy.name',
  kind: 'inclination',
  tag: 'method:escort',
  weight: 20
};

const content = loadContentSet(
  memoryFileSource({
    'heroes/bram.json': JSON.stringify(KEY_HERO_FILE),
    'heroes/doran.json': JSON.stringify(OTHER_HERO_FILE),
    'heroes/zara.json': JSON.stringify(THIRD_HERO_FILE),
    'contracts/crypt.json': JSON.stringify(CONTRACT_FILE),
    'traits/greedy.json': JSON.stringify(UNUSED_TRAIT_FILE)
  })
);

/**
 * `composeOffer` → the key hero accepts → `lockOffer` → `pollCrew` answers the other
 * two heroes in one command — the real command chain a player would issue, ending on
 * the shape this suite exists to save: one `commandId` (`pollCrew`'s own) behind two
 * of `history`'s events.
 */
function pollCrewCampaign(): { readonly state: ReturnType<typeof createInitialState> } {
  const base = createInitialState(content, 7n, RULESET_VERSION);
  const [keyHero] = base.heroes.keys();
  const [contractId] = base.contracts.keys();

  const composed = composeOffer(base, {
    commandId: 1,
    contractId: contractId!,
    keyHero: keyHero!,
    advance: 10,
    methodTag: null,
    promisedBonus: 0,
    expectedStateVersion: base.metadata.stateVersion
  }).state;

  const answered = proposeContractToHero(composed, {
    commandId: 2,
    heroId: keyHero!,
    contractId: contractId!,
    expectedStateVersion: composed.metadata.stateVersion
  }).state;

  const locked = lockOffer(answered, {
    commandId: 3,
    contractId: contractId!,
    expectedStateVersion: answered.metadata.stateVersion
  }).state;

  const polled = pollCrew(locked, {
    commandId: 4,
    contractId: contractId!,
    expectedStateVersion: locked.metadata.stateVersion
  });

  // Two events from the one `pollCrew` command — the shape this whole file exists to
  // save, not merely construct in memory.
  expect(polled.events).toHaveLength(2);
  expect(polled.state.appliedCommandIds.size).toBe(4);
  expect(polled.state.history.length).toBe(5);

  return { state: polled.state };
}

describe('a pollCrew history survives the real save path', () => {
  it('round-trips through buildSave/readSave with more events than applied commands', () => {
    const { state } = pollCrewCampaign();
    const [contractId] = state.contracts.keys();

    const bytes = buildSave({
      state,
      focusedContract: contractId!,
      createdAt: '2026-08-22T00:00:00.000Z'
    });

    const { state: restored } = readSave(bytes, {
      rulesetVersion: state.metadata.rulesetVersion,
      contentVersion: state.metadata.contentVersion
    });

    expect(restored.history).toEqual(state.history);
    expect(restored.contracts.get(contractId!)?.offer.acceptedBy.values()).toEqual(
      state.contracts.get(contractId!)?.offer.acceptedBy.values()
    );
    expect(restored.metadata).toEqual(state.metadata);
  });
});
