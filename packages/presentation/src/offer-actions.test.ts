import {
  ContractStatus,
  OfferPhase,
  RejectionCodes,
  SortedSet,
  compareHeroIds,
  composeOffer,
  heroId,
  lockOffer,
  pollCrew,
  proposeContractToHero,
  DoctrineId,
  placeCrew,
  resolveContract,
  settleContract,
  type CommandResult,
  type ContentId,
  type GameState,
  type HeroState
} from '@oath-and-coin/simulation';
import { describe, expect, it } from 'vitest';

import { contractOfferScreenModel } from './contract-offer-screen-model-factory.ts';
import { enabledActions } from './contract-offer-screen-model.ts';
import { OfferAction, OFFER_ACTIONS } from './offer-actions.ts';
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
 * Which of the six commands the player may press, and why the rest are dark.
 *
 * **The table below is a restatement of the engine's own preconditions, and that is the
 * one dangerous thing about this module.** A screen cannot ask the engine "would you
 * accept this?" — every command needs a `commandId` and produces a new campaign — so the
 * only way to say why a button is dark without pressing it is to say the rules a second
 * time, in a second place, where they can drift. The last suite in this file is what makes
 * that safe: it does not check the table against a second copy of the table, it applies
 * every one of the six commands to every fixture and asserts that the ones the engine
 * actually accepts are exactly the ones this module calls enabled.
 */

function heroes(...definitions: readonly ContentId[]): readonly HeroState[] {
  return definitions.map((definition, index) =>
    aHero({
      id: heroId(index),
      definition,
      displayNameKey: `hero.core.${String(definition).split(':')[1]}.name`
    })
  );
}

function ids3(...indices: readonly number[]) {
  return SortedSet.from(compareHeroIds, indices.map(heroId));
}

const ROSTER = heroes(ids.bram, ids.doran, ids.zara);

/**
 * A campaign whose focused contract is exactly the shape a row names.
 *
 * `treasury` is generous by default so that `lockOffer`'s own money check is never what
 * decides a row that is not about money — the one row that *is* about it says so.
 */
function campaign(options: {
  readonly phase?: OfferPhase;
  readonly status?: ContractStatus;
  readonly keyHero?: number | null;
  readonly invited?: readonly number[];
  readonly respondedBy?: readonly number[];
  readonly acceptedBy?: readonly number[];
  readonly requiredCrew?: number;
  readonly treasury?: number;
  readonly advance?: number;
}): GameState {
  const {
    phase = OfferPhase.Draft,
    status = ContractStatus.Offered,
    keyHero = 0,
    invited = [],
    respondedBy = [],
    acceptedBy = [],
    requiredCrew = 2,
    treasury = 400,
    advance = 0
  } = options;

  const contract = aContract({
    id: ids.caravan,
    patronFee: 100,
    requiredCrew,
    status,
    offer: anOffer({
      phase,
      keyHero: keyHero === null ? null : heroId(keyHero),
      advance,
      invited: ids3(...invited),
      respondedBy: ids3(...respondedBy),
      acceptedBy: ids3(...acceptedBy)
    })
  });

  return withContracts(withHeroes(aState({ treasury }), ROSTER), [contract]);
}

/**
 * The campaign with its crew back, and then with the promise answered — both produced by
 * the engine rather than written by hand.
 *
 * A hand-built `ContractResolution` is what `aResolvedCampaign`'s own doc comment refuses,
 * and `phase: 'settled'` written straight onto a fixture is the same mistake one step
 * further on: `settleContract` reads a grade off the outcome and moves the treasury, so a
 * package that reached `settled` without running is not one the engine can produce.
 */
function applied(state: GameState, run: (state: GameState) => CommandResult): GameState {
  const result = run(state);

  if (!result.applied) {
    throw new Error(
      `The fixture's own command was refused as '${String(result.rejectionCode)}' — the row is ` +
        'not describing a campaign the engine can produce.'
    );
  }

  return result.state;
}

function resolved(state: GameState): GameState {
  return applied(state, (current) =>
    resolveContract(current, {
      commandId: 1,
      contractId: ids.caravan,
      expectedStateVersion: current.metadata.stateVersion,
      retreatAtRound: null
    })
  );
}

function settled(state: GameState): GameState {
  const afterOutcome = resolved(state);

  return applied(afterOutcome, (current) =>
    settleContract(current, {
      commandId: 2,
      contractId: ids.caravan,
      pay: false,
      expectedStateVersion: current.metadata.stateVersion
    })
  );
}

/** A crew whose commitments are recorded, as every accepted hero must have (§2.4). */
function crewed(count: number, treasury = 400): GameState {
  const members = [...Array(count).keys()];
  const contract = aContract({
    id: ids.caravan,
    patronFee: 100,
    requiredCrew: count,
    status: ContractStatus.Crewed,
    offer: anOffer({
      phase: OfferPhase.Locked,
      keyHero: heroId(0),
      invited: ids3(...members),
      respondedBy: ids3(...members),
      acceptedBy: ids3(...members)
    })
  });

  return withContracts(withHeroes(aState({ treasury }), ROSTER), [contract]);
}

function actionsOf(state: GameState): readonly OfferAction[] {
  return enabledActions(contractOfferScreenModel(state, [], ids.caravan));
}

/**
 * The ten states a package can be in, and what may be pressed in each.
 *
 * Two rows carry most of the weight, and the plan names both. "Polled through, crew
 * unfilled" is why `phase` and `status` together are not enough and why the loop would
 * otherwise lock: a second `pollCrew` answers "nobody left to ask", and without `compose`
 * on offer the contract could never be revised. "A draft crewed by one hero" is reachable
 * whenever `requiredCrew = 1` — the key hero's own draft acceptance fills the crew before
 * `lockOffer` runs — and a table that only looked at `crewed` would offer `resolve` over a
 * package nothing has frozen.
 */
const ROWS = [
  {
    name: 'a draft with nobody keyed',
    state: () => campaign({ keyHero: null }),
    expected: [OfferAction.Compose]
  },
  {
    name: 'a draft whose key hero has not answered',
    state: () => campaign({ invited: [0, 1] }),
    expected: [OfferAction.Compose, OfferAction.AskKeyHero]
  },
  {
    name: 'a draft whose key hero accepted',
    state: () => campaign({ invited: [0, 1], respondedBy: [0], acceptedBy: [0] }),
    expected: [OfferAction.Compose, OfferAction.Lock]
  },
  {
    name: 'a draft whose key hero accepted, over a treasury that cannot cover it',
    // `advance × requiredCrew` is `60 × 2 = 120` against a treasury of 100, so the one
    // check the row above never reaches is the only thing that differs.
    state: () =>
      campaign({
        invited: [0, 1],
        respondedBy: [0],
        acceptedBy: [0],
        advance: 60,
        treasury: 100
      }),
    expected: [OfferAction.Compose]
  },
  {
    name: 'a draft whose key hero declined',
    state: () => campaign({ invited: [0, 1], respondedBy: [0] }),
    expected: [OfferAction.Compose]
  },
  {
    name: 'a draft crewed by one hero',
    state: () =>
      campaign({
        requiredCrew: 1,
        status: ContractStatus.Crewed,
        invited: [0],
        respondedBy: [0],
        acceptedBy: [0]
      }),
    expected: [OfferAction.Compose, OfferAction.Lock]
  },
  {
    name: 'a locked package nobody has polled',
    state: () =>
      campaign({
        phase: OfferPhase.Locked,
        invited: [0, 1],
        respondedBy: [0],
        acceptedBy: [0]
      }),
    expected: [OfferAction.Compose, OfferAction.Poll]
  },
  {
    name: 'a locked package polled through, crew unfilled',
    state: () =>
      campaign({
        phase: OfferPhase.Locked,
        invited: [0, 1],
        respondedBy: [0, 1],
        acceptedBy: [0]
      }),
    expected: [OfferAction.Compose]
  },
  {
    name: 'a locked package with the crew filled and no outcome',
    state: () => crewed(2),
    expected: [OfferAction.Resolve]
  },
  {
    name: 'a resolved package',
    state: () => resolved(crewed(2)),
    expected: [OfferAction.Settle]
  },
  {
    name: 'a settled package',
    state: () => settled(crewed(2)),
    expected: []
  }
] as const;

describe('which of the six commands the screen offers', () => {
  it.each(ROWS)('$name', ({ state, expected }) => {
    expect(actionsOf(state())).toEqual(expected);
  });

  it('declares all six on every state, dark ones included', () => {
    // A button that vanishes teaches nothing; a dark one with a reason teaches what to do
    // next. The list is the same six in the same order whatever the package is doing.
    for (const row of ROWS) {
      const { availableActions } = contractOfferScreenModel(row.state(), [], ids.caravan);

      expect(availableActions.map((available) => available.action)).toEqual(OFFER_ACTIONS);
    }
  });

  it('gives every dark action a reason and every live one none', () => {
    for (const row of ROWS) {
      const { availableActions } = contractOfferScreenModel(row.state(), [], ids.caravan);

      for (const available of availableActions) {
        const live = (row.expected as readonly OfferAction[]).includes(available.action);

        expect(available.disabledReasonKey === null, `${row.name}: ${available.action}`).toBe(live);
      }
    }
  });

  it('uses every refusal in its vocabulary at least once', () => {
    // The `need_short` lesson from the resolution engine, applied here: a code that never
    // appears could be a constant, and no row would notice. Each of these is the engine's
    // own answer to one of the ways a command is refused, and the rows above are supposed
    // to reach all of them between them.
    const shown = new Set(
      ROWS.flatMap((row) =>
        contractOfferScreenModel(row.state(), [], ids.caravan)
          .availableActions.map((available) => available.disabledReasonKey)
          .filter((key): key is string => key !== null)
      )
    );

    for (const code of [
      RejectionCodes.OfferNotInDraft,
      RejectionCodes.NotTheKeyHero,
      RejectionCodes.AlreadyResponded,
      RejectionCodes.ContractAlreadyResolved,
      RejectionCodes.KeyHeroHasNotAccepted,
      RejectionCodes.TreasuryCannotCoverTheOffer,
      RejectionCodes.OfferNotLocked,
      RejectionCodes.CrewAlreadyFilled,
      RejectionCodes.NobodyLeftToPoll,
      RejectionCodes.CrewNotFilled,
      RejectionCodes.AlreadyResolved,
      RejectionCodes.AlreadySettled,
      RejectionCodes.NotResolved
    ]) {
      expect([...shown], `no row reaches '${code}'`).toContain(code);
    }
  });
});

/**
 * The check that makes the restatement safe.
 *
 * Every row, every command: the engine is asked to apply it for real, against a throwaway
 * copy of the campaign, and **the code it answers with** is compared with the one this
 * module puts on the dark control. Nothing here reads the table — a rule that drifted from
 * `engine.ts` shows up as a command the engine takes and the screen hides, as the reverse,
 * or as a dark button naming the wrong refusal.
 *
 * **Comparing the codes and not merely `applied` is the whole point.** The first version of
 * this suite compared the two sets of *enabled* actions, and external review was right that
 * it left the interesting half unmeasured: `engine.ts` says outright that the order of
 * refusals "is part of the canonical result of a command, not an implementation detail", so
 * a dark control that names a true-but-later reason is wrong in exactly the way this module
 * claims not to be — and two codes swapped between actions would have kept every enabled
 * set and every code in the vocabulary identical.
 *
 * `composeOffer` is probed with a package that is otherwise valid — the crew the contract
 * already invites when it invites one, the first `requiredCrew` heroes otherwise — because
 * "may I revise" is a question about the phase, not about the package a player has yet to
 * assemble. A probe carrying a deliberately broken package would answer `crew_size_mismatch`
 * everywhere and measure the probe rather than the screen. Every other command carries no
 * arguments of its own at all.
 */
describe('the engine agrees about every one of the seven', () => {
  function refusalOf(state: GameState, action: OfferAction): string | null {
    const contract = state.contracts.get(ids.caravan)!;
    const commandId = 999;
    const expectedStateVersion = state.metadata.stateVersion;
    const invited =
      contract.offer.invited.size > 0
        ? contract.offer.invited.values()
        : ROSTER.slice(0, contract.requiredCrew).map((hero) => hero.id);
    const keyHero = contract.offer.keyHero ?? invited[0]!;

    const result: CommandResult = (() => {
      switch (action) {
        case OfferAction.Compose:
          return composeOffer(state, {
            commandId,
            contractId: ids.caravan,
            keyHero,
            invited,
            advance: 0,
            methodTag: null,
            promisedBonus: 0,
            expectedStateVersion
          });
        case OfferAction.AskKeyHero:
          return proposeContractToHero(state, {
            commandId,
            contractId: ids.caravan,
            heroId: keyHero,
            expectedStateVersion
          });
        case OfferAction.Lock:
          return lockOffer(state, { commandId, contractId: ids.caravan, expectedStateVersion });
        case OfferAction.Poll:
          return pollCrew(state, { commandId, contractId: ids.caravan, expectedStateVersion });
        case OfferAction.Place:
          // The probe carries a legal formation — the crew down the first column, the
          // default doctrine, no threshold — for the reason `composeOffer`'s does: "may I
          // place them" is a question about the phase and the plan, not about which cells a
          // player happens to have picked. Every fixture here is a contract with no battle,
          // so the answer is `not_a_battle_contract` and the placement is never read; a
          // deliberately broken one would measure the probe.
          return placeCrew(state, {
            commandId,
            contractId: ids.caravan,
            expectedStateVersion,
            placement: invited.map((hero, index) => ({
              hero,
              cell: { row: ((index % 3) + 1) as 1 | 2 | 3, column: 1 }
            })),
            doctrine: DoctrineId.HoldTheLine,
            retreatBelowPercent: 0
          });
        case OfferAction.Resolve:
          return resolveContract(state, {
            commandId,
            contractId: ids.caravan,
            expectedStateVersion,
            retreatAtRound: null
          });
        case OfferAction.Settle:
          return settleContract(state, {
            commandId,
            contractId: ids.caravan,
            pay: false,
            expectedStateVersion
          });
      }
    })();

    return result.applied ? null : result.rejectionCode;
  }

  it.each(ROWS)('$name — the engine answers exactly what the screen shows', ({ state }) => {
    const campaignState = state();
    const { availableActions: declared } = contractOfferScreenModel(campaignState, [], ids.caravan);

    expect(declared.map((available) => [available.action, available.disabledReasonKey])).toEqual(
      OFFER_ACTIONS.map((action) => [action, refusalOf(campaignState, action)])
    );
  });

  it.each(ROWS)('$name — and takes exactly what the screen offers', ({ state }) => {
    // The set, stated separately from the codes above. It is implied by them, and it is
    // still worth its own line: this is the sentence a player experiences — the button was
    // live and the command went through — while the codes are what they read when it did
    // not, and a failure in one should not be reported as a failure in the other.
    const campaignState = state();
    const accepted = OFFER_ACTIONS.filter((action) => refusalOf(campaignState, action) === null);

    expect(actionsOf(campaignState)).toEqual(accepted);
  });
});

describe('the vocabulary itself', () => {
  it('has seven members, in the order the protocol runs', () => {
    expect(OFFER_ACTIONS).toEqual([
      OfferAction.Compose,
      OfferAction.AskKeyHero,
      OfferAction.Lock,
      OfferAction.Poll,
      OfferAction.Place,
      OfferAction.Resolve,
      OfferAction.Settle
    ]);
  });

  it('keeps composing and asking apart', () => {
    // Two actions rather than one `propose`: `composeOffer` records the terms and
    // `proposeContractToHero` asks the key hero. One button would mean either that the
    // terms are never recorded or that the hero is never asked.
    expect(new Set(OFFER_ACTIONS).size).toBe(OFFER_ACTIONS.length);
    expect(OFFER_ACTIONS).toContain(OfferAction.Compose);
    expect(OFFER_ACTIONS).toContain(OfferAction.AskKeyHero);
  });
});
