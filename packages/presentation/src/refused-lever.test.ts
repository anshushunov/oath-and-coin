import {
  CombatRole,
  ContractStatus,
  DoctrineId,
  NeedId,
  OfferPhase,
  RejectionCodes,
  SortedMap,
  SortedSet,
  compareHeroIds,
  compareNeedIds,
  composeOffer,
  heroId,
  lockOffer,
  placeCrew,
  type BattleObjective,
  type CommandResult,
  type ContentId,
  type ContractBattlePlan,
  type GameState,
  type HeroState,
  type PlaceCrew
} from '@oath-and-coin/simulation';
import { describe, expect, it } from 'vitest';

import { OfferAction } from './offer-actions.ts';
import { OFFER_LEVER_IDS, OfferLeverId, leverOfRefusal } from './refused-lever.ts';
import {
  aContract,
  aHero,
  anOffer,
  aState,
  ids,
  withContracts,
  withHeroes
} from './testing/fixtures.ts';

/**
 * Which lever a refusal stands beside.
 *
 * **Every row here is a refusal the engine actually produced, never a code typed into the
 * test.** The mapping in `refused-lever.ts` restates a fact each `RejectionCodes` member's
 * own doc states — which check of which command answers with it — and a table checked
 * against a second copy of that table would be green over any misreading of the doc. So
 * each case runs the command, takes the code the engine answered with, and only then asks
 * which lever that code concerns.
 *
 * Found by the owner playing, 2026-08-31: an advance of 100 against a ceiling of 65 was
 * refused, and the sentence printed under seven rows of buttons, outside the window. The
 * player stalled there. The lever is where the mistake is, so the lever is where the
 * refusal has to stand.
 */

const ROSTER: readonly HeroState[] = [ids.bram, ids.doran, ids.zara].map((definition, index) =>
  aHero({ id: heroId(index), definition })
);

function crew(...indices: readonly number[]): SortedSet<ReturnType<typeof heroId>> {
  return SortedSet.from(compareHeroIds, indices.map(heroId));
}

/** The smallest legal enemy pattern, so `placeCrew` has a board to refuse a formation on. */
function aPlan(): ContractBattlePlan {
  return {
    objectives: SortedMap.from<NeedId, BattleObjective>(compareNeedIds, [
      [NeedId.Frontline, { kind: 'subdue', targets: ['foe:a'] }],
      [NeedId.Wilderness, { kind: 'hold', rounds: 2 }]
    ]),
    foes: [
      {
        id: 'foe:a',
        role: CombatRole.Vanguard,
        cell: { row: 1, column: 1 },
        combat: { might: 30, guard: 20, aim: 20, focus: 20, care: 0 }
      }
    ],
    wards: []
  };
}

/** A two-seat draft over a fee of 100, with the key hero's own acceptance where a row needs it. */
function draft(options: {
  readonly treasury?: number;
  readonly advance?: number;
  readonly accepted?: boolean;
}): GameState {
  const { treasury = 400, advance = 0, accepted = false } = options;
  const contract = aContract({
    id: ids.caravan,
    patronFee: 100,
    requiredCrew: 2,
    offer: anOffer({
      phase: OfferPhase.Draft,
      keyHero: heroId(0),
      advance,
      invited: crew(0, 1),
      respondedBy: accepted ? crew(0) : crew(),
      acceptedBy: accepted ? crew(0) : crew()
    })
  });

  return withContracts(withHeroes(aState({ treasury }), ROSTER), [contract]);
}

/** A locked, crewed battle contract — the one shape `placeCrew` reads a formation on. */
function crewedBattle(): GameState {
  const contract = aContract({
    id: ids.caravan,
    patronFee: 100,
    requiredCrew: 2,
    status: ContractStatus.Crewed,
    battle: aPlan(),
    offer: anOffer({
      phase: OfferPhase.Locked,
      keyHero: heroId(0),
      invited: crew(0, 1),
      respondedBy: crew(0, 1),
      acceptedBy: crew(0, 1)
    })
  });

  return withContracts(withHeroes(aState({ treasury: 400 }), ROSTER), [contract]);
}

function compose(
  state: GameState,
  terms: {
    readonly advance?: number;
    readonly promisedBonus?: number;
    readonly methodTag?: ContentId | null;
    readonly keyHero?: number;
    readonly invited?: readonly number[];
  }
): CommandResult {
  const { advance = 0, promisedBonus = 0, methodTag = null, keyHero = 0, invited = [0, 1] } = terms;

  return composeOffer(state, {
    commandId: 1,
    contractId: ids.caravan,
    expectedStateVersion: state.metadata.stateVersion,
    keyHero: heroId(keyHero),
    invited: invited.map(heroId),
    advance,
    promisedBonus,
    methodTag
  });
}

function place(state: GameState, overrides: Partial<PlaceCrew>): CommandResult {
  return placeCrew(state, {
    commandId: 1,
    contractId: ids.caravan,
    expectedStateVersion: state.metadata.stateVersion,
    placement: [
      { hero: heroId(0), cell: { row: 1, column: 1 } },
      { hero: heroId(1), cell: { row: 2, column: 1 } }
    ],
    doctrine: DoctrineId.HoldTheLine,
    retreatBelowPercent: 0,
    ...overrides
  });
}

/** The code the engine refused with — and a loud failure if it did not refuse at all. */
function refusalOf(result: CommandResult): string {
  if (result.applied || result.rejectionCode === null) {
    throw new Error('The fixture was meant to be refused, and the engine took it.');
  }

  return result.rejectionCode;
}

describe('the lever a refusal stands beside', () => {
  it.each([
    {
      name: 'an advance over the patron fee',
      run: () => compose(draft({}), { advance: 101 }),
      code: RejectionCodes.OfferTermsOutOfBounds,
      lever: OfferLeverId.Terms
    },
    {
      name: 'a promise over the patron fee',
      run: () => compose(draft({}), { promisedBonus: 101 }),
      code: RejectionCodes.OfferTermsOutOfBounds,
      lever: OfferLeverId.Terms
    },
    {
      name: 'a method the contract never offered',
      run: () => compose(draft({}), { methodTag: ids.methodDeception }),
      code: RejectionCodes.OfferTermsOutOfBounds,
      lever: OfferLeverId.Terms
    },
    {
      name: 'a crew of the wrong size',
      run: () => compose(draft({}), { invited: [0] }),
      code: RejectionCodes.CrewSizeMismatch,
      lever: OfferLeverId.Crew
    },
    {
      name: 'a key hero the package does not invite',
      run: () => compose(draft({}), { keyHero: 2 }),
      code: RejectionCodes.KeyHeroNotInvited,
      lever: OfferLeverId.KeyHero
    }
  ])('$name is refused by composeOffer beside the lever it names', ({ run, code, lever }) => {
    const refusal = refusalOf(run());

    expect(refusal).toBe(code);
    expect(leverOfRefusal(OfferAction.Compose, refusal)).toBe(lever);
  });

  it('a package the treasury cannot cover is refused at the lock beside the money levers', () => {
    // `advance × requiredCrew` is `60 × 2 = 120` against a treasury of 100 — the same row
    // `offer-actions.test.ts` uses for the one refusal that is about money.
    const state = draft({ treasury: 100, advance: 60, accepted: true });
    const refusal = refusalOf(
      lockOffer(state, {
        commandId: 1,
        contractId: ids.caravan,
        expectedStateVersion: state.metadata.stateVersion
      })
    );

    expect(refusal).toBe(RejectionCodes.TreasuryCannotCoverTheOffer);
    expect(leverOfRefusal(OfferAction.Lock, refusal)).toBe(OfferLeverId.Terms);
  });

  it.each([
    {
      name: 'a retreat threshold past one hundred per cent',
      run: () => place(crewedBattle(), { retreatBelowPercent: 101 }),
      code: RejectionCodes.OfferTermsOutOfBounds
    },
    {
      name: 'two men on one cell',
      run: () =>
        place(crewedBattle(), {
          placement: [
            { hero: heroId(0), cell: { row: 1, column: 1 } },
            { hero: heroId(1), cell: { row: 1, column: 1 } }
          ]
        }),
      code: RejectionCodes.CellTaken
    },
    {
      name: 'a man left standing nowhere',
      run: () =>
        place(crewedBattle(), { placement: [{ hero: heroId(0), cell: { row: 1, column: 1 } }] }),
      code: RejectionCodes.UnplacedHero
    }
  ])('$name is refused by placeCrew beside the formation', ({ run, code }) => {
    const refusal = refusalOf(run());

    expect(refusal).toBe(code);
    expect(leverOfRefusal(OfferAction.Place, refusal)).toBe(OfferLeverId.Formation);
  });

  it('reads one code as two levers, because two commands answer with it', () => {
    // `offer_terms_out_of_bounds` is `composeOffer`'s answer for the money and the method,
    // and `placeCrew`'s for the retreat threshold. The code alone cannot say which; the
    // command pressed can. A mapping keyed on the code alone would put a retreat refusal
    // beside the advance.
    const fromCompose = refusalOf(compose(draft({}), { advance: 101 }));
    const fromPlace = refusalOf(place(crewedBattle(), { retreatBelowPercent: 101 }));

    expect(fromCompose).toBe(fromPlace);
    expect(leverOfRefusal(OfferAction.Compose, fromCompose)).toBe(OfferLeverId.Terms);
    expect(leverOfRefusal(OfferAction.Place, fromPlace)).toBe(OfferLeverId.Formation);
  });

  it('names no lever for a refusal about the package as a whole', () => {
    // A struck deal cannot be revised (`NEGOTIATION_SPEC` §3.1): the refusal is about the
    // package's phase, and no lever on the screen is the one to move. It stands beside the
    // button that was pressed instead.
    const struck = withContracts(withHeroes(aState({ treasury: 400 }), ROSTER), [
      aContract({
        id: ids.caravan,
        patronFee: 100,
        requiredCrew: 2,
        status: ContractStatus.Crewed,
        offer: anOffer({
          phase: OfferPhase.Locked,
          keyHero: heroId(0),
          invited: crew(0, 1),
          respondedBy: crew(0, 1),
          acceptedBy: crew(0, 1)
        })
      })
    ]);
    const refusal = refusalOf(compose(struck, {}));

    expect(refusal).toBe(RejectionCodes.OfferNotInDraft);
    expect(leverOfRefusal(OfferAction.Compose, refusal)).toBeNull();
    expect(leverOfRefusal(OfferAction.Lock, RejectionCodes.KeyHeroHasNotAccepted)).toBeNull();
    expect(leverOfRefusal(OfferAction.Poll, RejectionCodes.NobodyLeftToPoll)).toBeNull();
  });

  it('answers only with a lever the screen draws, whatever it is asked', () => {
    for (const action of Object.values(OfferAction)) {
      for (const code of Object.values(RejectionCodes)) {
        const lever = leverOfRefusal(action, code);

        expect(lever === null || OFFER_LEVER_IDS.includes(lever)).toBe(true);
      }
    }
  });
});
