import {
  RULESET_VERSION,
  createInitialState,
  loadContentSet,
  memoryFileSource
} from '@oath-and-coin/content';
import {
  Actions,
  SortedMap,
  compareHeroIds,
  composeOffer,
  parseContentId,
  proposeContractToHero,
  type GameState,
  type HeroId,
  type HeroState
} from '@oath-and-coin/simulation';
import { describe, expect, it } from 'vitest';

import { restoreDecidedSteps } from './restore-steps.ts';

/**
 * The answered steps rebuilt from a state alone — the only thing a save carries.
 *
 * A save holds a `GameState`: history, traces, heroes, contracts. It does not hold the
 * `StepOutcome` list a live run produced, and it must not — that list is a fact about a
 * process, while the state is the campaign. So the screen a reloaded session draws has to
 * come from history and traces, and this file is where the rebuilding is measured against
 * a run whose arithmetic is written out below rather than read back off the run itself.
 *
 * Every fixture is an in-memory content tree, the same door `apps/web` goes through: this
 * layer opens no file (`ADR-010` §59). The shipped tree is covered elsewhere and covered
 * harder — `tests/oracle/src/restored-read-model.test.ts` puts the rebuilt steps through
 * the screen factory on all 50 corpus entries that reached a state.
 */

const CARAVAN = parseContentId('core:escort_the_caravan');
const CRYPT = parseContentId('core:cleanse_the_crypt');

const SEED = 424242n;

const BRAM = {
  schema_version: 3,
  id: 'core:bram',
  display_name_key: 'hero.core.bram.name',
  greed: 60,
  caution: 30,
  pride: 45,
  trust_in_guild: 50,
  traits: ['core:greedy'],
  relationships: []
};

const GREEDY = {
  schema_version: 3,
  id: 'core:greedy',
  display_name_key: 'trait.core.greedy.name',
  kind: 'inclination',
  tag: 'method:escort',
  weight: 20
};

const CARAVAN_FILE = {
  schema_version: 3,
  id: 'core:escort_the_caravan',
  display_name_key: 'contract.core.escort_the_caravan.name',
  patron_fee: 70,
  risk: 30,
  required_crew: 1,
  tags: ['method:escort']
};

/** A hero who will not go near the undead, and the job that asks her to. */
const ZARA = {
  schema_version: 3,
  id: 'core:zara',
  display_name_key: 'hero.core.zara.name',
  greed: 60,
  caution: 30,
  pride: 45,
  trust_in_guild: 50,
  traits: ['core:fears_undeath'],
  relationships: []
};

const FEARS_UNDEATH = {
  schema_version: 3,
  id: 'core:fears_undeath',
  display_name_key: 'trait.core.fears_undeath.name',
  kind: 'principle',
  tag: 'target:undead'
};

const CRYPT_FILE = {
  schema_version: 3,
  id: 'core:cleanse_the_crypt',
  display_name_key: 'contract.core.cleanse_the_crypt.name',
  patron_fee: 40,
  risk: 80,
  required_crew: 1,
  tags: ['target:undead']
};

/**
 * Builds the initial state from `files` and proposes `contract` to the roster's first
 * hero — directly, not through `runScenario`/`ScenarioCommand`. That frozen scenario
 * format has no way to compose an offer (`composeOffer` arrives in `DEC-008` Tasks
 * 10-14, and the format was never extended to name it), and `proposeContractToHero`
 * (Task 11) now lets only the offer's key hero answer while the package is a draft —
 * so this keys the offer to that one hero by hand before proposing, rather than
 * routing through a command this fixture has no way to issue. The resulting state is
 * identical either way: `runScenario` was never anything but this same single call.
 */
function ran(files: Record<string, string>, contract: string): GameState {
  const base = createInitialState(loadContentSet(memoryFileSource(files)), SEED, RULESET_VERSION);
  const [heroKey] = base.heroes.keys();
  const contractId = parseContentId(contract);
  const target = base.contracts.get(contractId)!;

  const keyed: GameState = {
    ...base,
    contracts: base.contracts.set(contractId, {
      ...target,
      offer: { ...target.offer, keyHero: heroKey! }
    })
  };

  const result = proposeContractToHero(keyed, {
    commandId: 1,
    heroId: heroKey!,
    contractId,
    expectedStateVersion: keyed.metadata.stateVersion
  });

  return result.state;
}

/**
 * Bram takes the caravan job. The arithmetic, written out so the expectation below is not
 * this build agreeing with itself (`HERO_DECISION_SPEC` §2.3, `NEGOTIATION_SPEC` §4, every
 * term divided on its own): `ran()` above never composes an offer, so the offer Bram is
 * proposed is the one every contract starts on — `advance = 0`, no promised bonus — and the
 * patron fee itself no longer contributes at all. Advance 0 × greed 60 / 100 = 0
 * (no factor, not a zero one); risk 30 × caution 30 / 100 = −9; nothing offsets the risk, so
 * insult fires: (30 − 0) × pride 45 / 100 = −13; the inclination `core:greedy` matches the
 * contract's `method:escort` tag at +20; trust 50 / 10 = +5; no bonds; no grievance; mood at
 * seed 424242, ordinal 0 = +5. 0 − 9 − 13 + 20 + 5 + 0 − 0 + 5 = 8.
 */
function aStateWithOneAcceptedContract(): GameState {
  return ran(
    {
      'heroes/bram.json': JSON.stringify(BRAM),
      'contracts/caravan.json': JSON.stringify(CARAVAN_FILE),
      'traits/greedy.json': JSON.stringify(GREEDY)
    },
    'core:escort_the_caravan'
  );
}

/** Zara is asked to cleanse a crypt, and a red line closes the decision on the spot. */
function aStateWithAPrincipleRefusal(): GameState {
  return ran(
    {
      'heroes/zara.json': JSON.stringify(ZARA),
      'contracts/crypt.json': JSON.stringify(CRYPT_FILE),
      'traits/fears-undeath.json': JSON.stringify(FEARS_UNDEATH)
    },
    'core:cleanse_the_crypt'
  );
}

describe('rebuilding the answered steps from a state', () => {
  it('восстанавливает ответ героя из события и следа', () => {
    const state = aStateWithOneAcceptedContract();
    const [step] = restoreDecidedSteps(state);

    expect(step?.command.contract).toBe(CARAVAN);
    expect(step?.heroDefinition).toBe(parseContentId('core:bram'));
    expect(step?.decisions[0]?.selectedAction).toBe(Actions.Accept);
    // Счёта нет ни в событии, ни в следе — он сумма факторов.
    expect(step?.decisions[0]?.selectedScore).toBe(8);
    expect(step?.decisions[0]?.trace.traceId).toBe(0);
  });

  it('у блокированного решения счёт остаётся null, а не нулём', () => {
    // Красная линия закрывает решение до того, как счёт возникает, и
    // `createDecisionResult` отвергает счёт рядом с блокировкой. Восстановление,
    // безусловно суммирующее факторы, вернуло бы 0 — число, которое правило прочитает
    // как согласие.
    const state = aStateWithAPrincipleRefusal();
    const [step] = restoreDecidedSteps(state);

    expect(step?.command.contract).toBe(CRYPT);
    expect(step?.decisions[0]?.selectedAction).toBe(Actions.Decline);
    expect(step?.decisions[0]?.trace.blockedBy).toHaveLength(1);
    expect(step?.decisions[0]?.selectedScore).toBeNull();
  });

  it('answers nothing for a campaign nobody has been offered anything in', () => {
    const state = ran(
      {
        'heroes/bram.json': JSON.stringify(BRAM),
        'contracts/caravan.json': JSON.stringify(CARAVAN_FILE),
        'traits/greedy.json': JSON.stringify(GREEDY)
      },
      'core:escort_the_caravan'
    );

    expect(restoreDecidedSteps({ ...state, history: [] })).toEqual([]);
  });

  it("drops offer_revised from the step list — it is the player's choice, not a hero's", () => {
    const decided = aStateWithOneAcceptedContract();
    const [heroKey] = decided.heroes.keys();
    const [contractKey] = decided.contracts.keys();
    const revised = composeOffer(decided, {
      commandId: 2,
      contractId: contractKey!,
      keyHero: heroKey!,
      advance: 10,
      methodTag: null,
      promisedBonus: 0,
      expectedStateVersion: decided.metadata.stateVersion
    }).state;

    // The revision is in history alongside the earlier acceptance — two events — but
    // restoring must not throw on the one with no hero, and must not manufacture a
    // step for it either.
    expect(revised.history).toHaveLength(2);
    const steps = restoreDecidedSteps(revised);
    expect(steps).toHaveLength(1);
    expect(steps[0]?.heroDefinition).toBe(parseContentId('core:bram'));
  });

  it('names the hero the campaign no longer has rather than answering a step without one', () => {
    // A step whose hero cannot be resolved reaches the screen factory as "a decision by
    // nobody", and that factory's own diagnostic names neither the event nor the id. A
    // save whose history mentions a hero its roster does not is corrupt in a way worth
    // saying out loud once, here.
    const state = aStateWithOneAcceptedContract();
    const rosterless = { ...state, heroes: SortedMap.empty<HeroId, HeroState>(compareHeroIds) };

    expect(() => restoreDecidedSteps(rosterless)).toThrow(/hero#0/u);
  });
});
