import { describe, expect, it } from 'vitest';

import { SortedMap } from '../collections/sorted-map.ts';
import { SortedSet } from '../collections/sorted-set.ts';
import { RejectionCodes } from '../commands/command-result.ts';
import type { SettleContract } from '../commands/settle-contract.ts';
import { settleContract } from '../engine.ts';
import { compareContentIds, type ContentId } from '../ids/content-id.ts';
import { compareHeroIds, heroId, type HeroId } from '../ids/hero-id.ts';
import { STARTING_TREASURY } from './commitments.ts';
import { ContractStatus } from '../state/contract-state.ts';
import { heroOf, type GameState } from '../state/game-state.ts';
import type { HeroState } from '../state/hero-state.ts';
import { createContractState, OfferPhase } from '../state/offer-state.ts';
import { aContract, aHero, anOffer, aState, ids } from '../testing/fixtures.ts';

/**
 * `settleContract` (`NEGOTIATION_SPEC` §3.1, §3.3, §6.1) — the command every
 * negotiation this build can carry out ends at. Money moves exactly once, out of
 * the campaign treasury, and a broken promise costs what it was worth
 * (`negotiation/grievance.ts`'s `grievanceForBrokenPromise`, folded into a hero's
 * running `grievance` here rather than there — see that module's own doc).
 */

const KEY: HeroId = heroId(0);
const WITNESS: HeroId = heroId(1);
const OUTSIDER: HeroId = heroId(2);

interface CrewedOverrides {
  readonly treasury?: number;
  readonly patronFee?: number;
  readonly advance?: number;
  /** How many heroes accepted, starting from {@link KEY} — the contract's own
   * `requiredCrew` and `offer.acceptedBy.size` both equal this. */
  readonly crew?: number;
  readonly promisedBonus?: number;
}

/**
 * A contract locked and crewed, ready for `settleContract` — three fixed heroes
 * ({@link KEY}, {@link WITNESS}, {@link OUTSIDER}), of which only the first
 * `crew` (default 2: `KEY` and `WITNESS`) actually accepted, so `OUTSIDER` is
 * always present in the campaign and never in `acceptedBy` unless a test asks
 * for all three.
 */
function crewedCampaign(overrides: CrewedOverrides = {}): GameState {
  const crew = overrides.crew ?? 2;
  const acceptedBy = SortedSet.from(
    compareHeroIds,
    Array.from({ length: crew }, (_, index) => heroId(index))
  );

  const contract = createContractState(
    aContract({
      // 100, not `aContract`'s own default (70): several tests here promise a
      // bonus up to 100 without naming `patronFee` themselves, and `0 ≤
      // promisedBonus ≤ patronFee` (`NEGOTIATION_SPEC` §2.1) would otherwise make
      // those fixtures illegal offers `createContractState` refuses to build.
      patronFee: overrides.patronFee ?? 100,
      requiredCrew: crew,
      status: ContractStatus.Crewed,
      offer: anOffer({
        keyHero: KEY,
        advance: overrides.advance ?? 0,
        promisedBonus: overrides.promisedBonus ?? 0,
        phase: OfferPhase.Locked,
        respondedBy: acceptedBy,
        acceptedBy
      })
    })
  );

  const heroes = [KEY, WITNESS, OUTSIDER].map((id) => aHero({ id }));

  return aState({
    heroes: SortedMap.from(
      compareHeroIds,
      heroes.map((hero) => [hero.id, hero] as const)
    ),
    contracts: SortedMap.from(compareContentIds, [[contract.id, contract]]),
    treasury: overrides.treasury ?? STARTING_TREASURY
  });
}

/** A locked package whose crew never filled — `settleContract`'s `CrewNotFilled`. */
function lockedButUncrewed(): GameState {
  const acceptedBy = SortedSet.from(compareHeroIds, [KEY]);

  const contract = createContractState(
    aContract({
      requiredCrew: 2,
      status: ContractStatus.Offered,
      offer: anOffer({
        keyHero: KEY,
        phase: OfferPhase.Locked,
        respondedBy: acceptedBy,
        acceptedBy
      })
    })
  );

  const heroes = [KEY, WITNESS, OUTSIDER].map((id) => aHero({ id }));

  return aState({
    heroes: SortedMap.from(
      compareHeroIds,
      heroes.map((hero) => [hero.id, hero] as const)
    ),
    contracts: SortedMap.from(compareContentIds, [[contract.id, contract]])
  });
}

function aSettle(overrides: Partial<SettleContract> = {}): SettleContract {
  return {
    commandId: 1,
    contractId: ids.crypt,
    pay: true,
    expectedStateVersion: 0,
    ...overrides
  };
}

describe('settleContract', () => {
  it('pays the patron fee in and the advances out', () => {
    const settled = settleContract(
      crewedCampaign({ treasury: 400, patronFee: 60, advance: 10, crew: 3 }),
      aSettle({ pay: true })
    ).state;
    expect(settled.treasury).toBe(400 + 60 - 30);
  });

  it('keeps the bonus in the treasury when the guild breaks its word', () => {
    const settled = settleContract(
      crewedCampaign({ treasury: 400, patronFee: 60, advance: 10, crew: 3, promisedBonus: 20 }),
      aSettle({ pay: false })
    ).state;
    expect(settled.treasury).toBe(400 + 60 - 30);
  });

  it('costs the victim their faith and the witnesses only their patience', () => {
    const settled = settleContract(
      crewedCampaign({ promisedBonus: 100, patronFee: 100 }),
      aSettle({ pay: false })
    ).state;
    expect(heroOf(settled, KEY).believesGuildPromises).toBe(false);
    expect(heroOf(settled, KEY).grievance).toBe(30);
    expect(heroOf(settled, WITNESS).believesGuildPromises).toBe(true);
    expect(heroOf(settled, WITNESS).grievance).toBe(12);
  });

  it('leaves a hero who was not in the crew untouched', () => {
    const settled = settleContract(
      crewedCampaign({ promisedBonus: 100 }),
      aSettle({ pay: false })
    ).state;
    expect(heroOf(settled, OUTSIDER).grievance).toBe(0);
  });

  it('leaves everyone whole when the word was kept', () => {
    const settled = settleContract(
      crewedCampaign({ promisedBonus: 100 }),
      aSettle({ pay: true })
    ).state;
    expect(heroOf(settled, KEY).believesGuildPromises).toBe(true);
    expect(heroOf(settled, KEY).grievance).toBe(0);
  });

  it('costs more to break a large promise than a small one', () => {
    const small = settleContract(
      crewedCampaign({ promisedBonus: 10, patronFee: 100 }),
      aSettle({ pay: false })
    ).state;
    const large = settleContract(
      crewedCampaign({ promisedBonus: 100, patronFee: 100 }),
      aSettle({ pay: false })
    ).state;
    expect(heroOf(large, KEY).grievance).toBeGreaterThan(heroOf(small, KEY).grievance);
  });

  it('settles a contract with no promise at all, whatever pay says', () => {
    const settled = settleContract(crewedCampaign({ promisedBonus: 0 }), aSettle({ pay: false }));
    expect(settled.events[0]!.kind).toBe('contract_settled');
    expect(heroOf(settled.state, KEY).grievance).toBe(0);
  });

  it('refuses a settlement before the crew is filled', () => {
    expect(settleContract(lockedButUncrewed(), aSettle()).rejectionCode).toBe(
      RejectionCodes.CrewNotFilled
    );
  });

  it('refuses a second settlement', () => {
    const once = settleContract(crewedCampaign(), aSettle()).state;
    const twice = settleContract(
      once,
      aSettle({ commandId: 9, expectedStateVersion: once.metadata.stateVersion })
    );
    expect(twice.rejectionCode).toBe(RejectionCodes.AlreadySettled);
  });
});

/**
 * `NEGOTIATION_SPEC` §10.1's treasury properties: universal claims over every
 * order a campaign's contracts can be locked and settled in, not statements about
 * one hand-picked example.
 */

interface SettleSpec {
  readonly id: ContentId;
  readonly patronFee: number;
  readonly requiredCrew: number;
  readonly advance: number;
  readonly promisedBonus: number;
}

function crewOfSize(size: number): SortedSet<HeroId> {
  return SortedSet.from(
    compareHeroIds,
    Array.from({ length: size }, (_, index) => heroId(index))
  );
}

function heroesOfSize(size: number): readonly HeroState[] {
  return Array.from({ length: size }, (_, index) => aHero({ id: heroId(index) }));
}

function permutationsOf<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) {
    return [items.slice()];
  }

  const result: T[][] = [];
  for (let index = 0; index < items.length; index += 1) {
    const rest = [...items.slice(0, index), ...items.slice(index + 1)];
    for (const tail of permutationsOf(rest)) {
      result.push([items[index]!, ...tail]);
    }
  }
  return result;
}

function payFlagCombinations(count: number): boolean[][] {
  if (count === 0) {
    return [[]];
  }

  const tails = payFlagCombinations(count - 1);
  const result: boolean[][] = [];
  for (const tail of tails) {
    result.push([true, ...tail]);
    result.push([false, ...tail]);
  }
  return result;
}

/**
 * Three contracts, distinct ids, each already locked and crewed, with the
 * campaign's treasury set to *exactly* the sum of what every one of them
 * committed (`negotiation/commitments.ts`'s `commitmentOf`, summed) — the
 * tightest a real `lockOffer` chain could have left it (`NEGOTIATION_SPEC` §2.3).
 * `ids.temple` and `ids.cult` are reused here as two more, otherwise-unrelated
 * contract ids, the same convention `commitments.test.ts` already uses.
 */
const LOCK_AND_SETTLE_SPECS: readonly SettleSpec[] = [
  { id: ids.crypt, patronFee: 50, requiredCrew: 3, advance: 50, promisedBonus: 0 },
  { id: ids.temple, patronFee: 80, requiredCrew: 2, advance: 30, promisedBonus: 20 },
  { id: ids.cult, patronFee: 40, requiredCrew: 1, advance: 10, promisedBonus: 40 }
];

function lockedCampaignWith(specs: readonly SettleSpec[]): GameState {
  const contracts = specs.map((spec) => {
    const acceptedBy = crewOfSize(spec.requiredCrew);

    return createContractState(
      aContract({
        id: spec.id,
        patronFee: spec.patronFee,
        requiredCrew: spec.requiredCrew,
        status: ContractStatus.Crewed,
        offer: anOffer({
          keyHero: KEY,
          advance: spec.advance,
          promisedBonus: spec.promisedBonus,
          phase: OfferPhase.Locked,
          respondedBy: acceptedBy,
          acceptedBy
        })
      })
    );
  });

  const totalCommitted = specs.reduce(
    (sum, spec) => sum + spec.advance * spec.requiredCrew + spec.promisedBonus,
    0
  );

  const heroes = heroesOfSize(3);

  return aState({
    heroes: SortedMap.from(
      compareHeroIds,
      heroes.map((hero) => [hero.id, hero] as const)
    ),
    contracts: SortedMap.from(
      compareContentIds,
      contracts.map((c) => [c.id, c] as const)
    ),
    treasury: totalCommitted
  });
}

/**
 * Every order the three {@link LOCK_AND_SETTLE_SPECS} contracts can be settled
 * in (3! = 6), crossed with every combination of `pay` across them (2³ = 8) —
 * 48 sequences, `fn` called after each of the three settlements in every one, so
 * a violation at any intermediate point is caught, not only at the end.
 */
function forEachGeneratedLockAndSettleSequence(fn: (state: GameState) => void): void {
  for (const order of permutationsOf(LOCK_AND_SETTLE_SPECS)) {
    for (const pays of payFlagCombinations(order.length)) {
      let state = lockedCampaignWith(LOCK_AND_SETTLE_SPECS);
      let commandId = 1;

      for (const [index, spec] of order.entries()) {
        const result = settleContract(
          state,
          aSettle({
            commandId,
            contractId: spec.id,
            pay: pays[index]!,
            expectedStateVersion: state.metadata.stateVersion
          })
        );

        expect(result.rejectionCode).toBeNull();
        state = result.state;
        fn(state);
        commandId += 1;
      }
    }
  }
}

const SETTLEMENT_SPECS: readonly SettleSpec[] = [
  { id: ids.crypt, patronFee: 100, requiredCrew: 1, advance: 30, promisedBonus: 0 },
  { id: ids.crypt, patronFee: 100, requiredCrew: 4, advance: 20, promisedBonus: 15 },
  { id: ids.crypt, patronFee: 60, requiredCrew: 2, advance: 25, promisedBonus: 10 },
  { id: ids.crypt, patronFee: 40, requiredCrew: 3, advance: 0, promisedBonus: 40 }
];

/**
 * Every {@link SETTLEMENT_SPECS} spec settled once with `pay: true` and once with
 * `pay: false` — 8 settlements. `committed` is `commitmentOf` restated
 * (`advance × requiredCrew + promisedBonus`); `paid` is read off the *actual*
 * treasury change `settleContract` produced, not recomputed by the same formula
 * a second time, so a mutant that pays more than the formula says would still be
 * caught here.
 */
function forEachGeneratedSettlement(fn: (args: { committed: number; paid: number }) => void): void {
  for (const spec of SETTLEMENT_SPECS) {
    for (const pay of [true, false]) {
      const acceptedBy = crewOfSize(spec.requiredCrew);
      const contract = createContractState(
        aContract({
          id: spec.id,
          patronFee: spec.patronFee,
          requiredCrew: spec.requiredCrew,
          status: ContractStatus.Crewed,
          offer: anOffer({
            keyHero: KEY,
            advance: spec.advance,
            promisedBonus: spec.promisedBonus,
            phase: OfferPhase.Locked,
            respondedBy: acceptedBy,
            acceptedBy
          })
        })
      );

      const heroes = heroesOfSize(spec.requiredCrew);
      const state = aState({
        heroes: SortedMap.from(
          compareHeroIds,
          heroes.map((hero) => [hero.id, hero] as const)
        ),
        contracts: SortedMap.from(compareContentIds, [[contract.id, contract]]),
        treasury: 1_000_000
      });

      const result = settleContract(state, aSettle({ contractId: spec.id, pay }));
      expect(result.rejectionCode).toBeNull();

      const committed = spec.advance * spec.requiredCrew + spec.promisedBonus;
      const paid = state.treasury + spec.patronFee - result.state.treasury;

      fn({ committed, paid });
    }
  }
}

const PROMISE_SPECS: readonly SettleSpec[] = [
  { id: ids.crypt, patronFee: 100, requiredCrew: 1, advance: 0, promisedBonus: 1 },
  { id: ids.crypt, patronFee: 100, requiredCrew: 3, advance: 20, promisedBonus: 100 },
  { id: ids.crypt, patronFee: 50, requiredCrew: 2, advance: 10, promisedBonus: 25 },
  { id: ids.crypt, patronFee: 30, requiredCrew: 1, advance: 5, promisedBonus: 30 }
];

/**
 * For every {@link PROMISE_SPECS} spec, the key hero's own `HeroState` after
 * breaking the promise it names, paired with the same hero's `HeroState` after
 * settling an otherwise-identical contract that never promised anything at all
 * (`promisedBonus: 0`) — both freshly built, both starting from `grievance: 0`.
 */
function forEachGeneratedPromise(fn: (args: { broken: HeroState; none: HeroState }) => void): void {
  for (const spec of PROMISE_SPECS) {
    const acceptedBy = crewOfSize(spec.requiredCrew);
    const heroes = heroesOfSize(spec.requiredCrew);

    function campaignWith(promisedBonus: number): GameState {
      const contract = createContractState(
        aContract({
          id: spec.id,
          patronFee: spec.patronFee,
          requiredCrew: spec.requiredCrew,
          status: ContractStatus.Crewed,
          offer: anOffer({
            keyHero: KEY,
            advance: spec.advance,
            promisedBonus,
            phase: OfferPhase.Locked,
            respondedBy: acceptedBy,
            acceptedBy
          })
        })
      );

      return aState({
        heroes: SortedMap.from(
          compareHeroIds,
          heroes.map((hero) => [hero.id, hero] as const)
        ),
        contracts: SortedMap.from(compareContentIds, [[contract.id, contract]]),
        treasury: 1_000_000
      });
    }

    const broken = settleContract(
      campaignWith(spec.promisedBonus),
      aSettle({ contractId: spec.id, pay: false })
    ).state;
    const none = settleContract(
      campaignWith(0),
      aSettle({ contractId: spec.id, pay: false })
    ).state;

    fn({ broken: heroOf(broken, KEY), none: heroOf(none, KEY) });
  }
}

describe('settleContract — treasury properties (NEGOTIATION_SPEC §10.1)', () => {
  it('never leaves the treasury negative, in any order contracts are settled', () => {
    forEachGeneratedLockAndSettleSequence((state) => {
      expect(state.treasury).toBeGreaterThanOrEqual(0);
    });
  });

  it('never pays out more than the lock committed', () => {
    forEachGeneratedSettlement(({ committed, paid }) => {
      expect(paid).toBeLessThanOrEqual(committed);
    });
  });

  it('makes breaking a promise cost strictly more than never promising', () => {
    forEachGeneratedPromise(({ broken, none }) => {
      expect(broken.grievance).toBeGreaterThan(none.grievance);
    });
  });
});
