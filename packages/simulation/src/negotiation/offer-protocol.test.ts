import { describe, expect, it } from 'vitest';

import { SortedMap } from '../collections/sorted-map.ts';
import { SortedSet } from '../collections/sorted-set.ts';
import { RejectionCodes, type CommandResult } from '../commands/command-result.ts';
import type { ComposeOffer } from '../commands/compose-offer.ts';
import type { LockOffer } from '../commands/lock-offer.ts';
import type { ProposeContractToHero } from '../commands/propose-contract-to-hero.ts';
import { Actions } from '../decisions/actions.ts';
import type { DecisionResult } from '../decisions/causal-trace.ts';
import { ReasonCodes } from '../decisions/reason-codes.ts';
import {
  composeOffer,
  composeOffer as engineComposeOffer,
  lockOffer,
  proposeContractToHero
} from '../engine.ts';
import { compareContentIds } from '../ids/content-id.ts';
import { compareHeroIds, heroId, type HeroId } from '../ids/hero-id.ts';
import { ContractStatus, type ContractState } from '../state/contract-state.ts';
import { contractOf, type GameState } from '../state/game-state.ts';
import { OfferPhase, type OfferState } from '../state/offer-state.ts';
import {
  aContract,
  aHero,
  anOffer,
  aState,
  aTrait,
  compareNumbers,
  ids,
  sixTags
} from '../testing/fixtures.ts';

/**
 * `composeOffer` (`NEGOTIATION_SPEC` §3.1, §3.3, §6.1) — the first command of the
 * negotiation protocol, and the only one this file's fixtures need to reach: every
 * campaign starts with nobody keyed and nothing offered (`initialOffer`), so this is
 * the one command that ever moves a contract off that start.
 */

const KEY_HERO: HeroId = heroId(0);
/** A second hero, distinct from {@link KEY_HERO} — for tests proving a revision names
 * the *command's* key hero, not whichever one the package already had. */
const OTHER_HERO: HeroId = heroId(1);

function aCampaign(
  stateOverrides: Partial<GameState> = {},
  contractOverrides: Partial<ContractState> = {}
): GameState {
  return aState({
    heroes: SortedMap.from(compareHeroIds, [
      [KEY_HERO, aHero({ id: KEY_HERO })],
      [OTHER_HERO, aHero({ id: OTHER_HERO })]
    ]),
    contracts: SortedMap.from(compareContentIds, [[ids.crypt, aContract(contractOverrides)]]),
    ...stateOverrides
  });
}

/** `state`'s one contract, with its key hero already accepted the current (draft) package. */
function accepted(state: GameState): GameState {
  const contract = contractOf(state, ids.crypt);
  const acceptedBy = SortedSet.from(compareHeroIds, [KEY_HERO]);

  return {
    ...state,
    contracts: state.contracts.set(contract.id, {
      ...contract,
      status:
        acceptedBy.size >= contract.requiredCrew ? ContractStatus.Crewed : ContractStatus.Offered,
      offer: {
        ...contract.offer,
        keyHero: KEY_HERO,
        respondedBy: acceptedBy,
        acceptedBy
      }
    })
  };
}

/**
 * A single-seat contract the key hero has already filled — in `draft`, not `locked`:
 * `NEGOTIATION_SPEC` §3.1's single-seat case fills the crew from the key hero's own
 * draft acceptance, before `lockOffer` (Task 12) ever runs. `composeOffer` is legal
 * in `draft` regardless of status, which is exactly what this fixture exercises.
 */
function crewedSingleSeatCampaign(): GameState {
  const acceptedBy = SortedSet.from(compareHeroIds, [KEY_HERO]);

  return aCampaign(
    {},
    {
      requiredCrew: 1,
      status: ContractStatus.Crewed,
      offer: anOffer({
        keyHero: KEY_HERO,
        phase: OfferPhase.Draft,
        respondedBy: acceptedBy,
        acceptedBy
      })
    }
  );
}

/** A locked package whose crew never filled — composeOffer's one path back to `draft`. */
function lockedButUncrewed(): GameState {
  const acceptedBy = SortedSet.from(compareHeroIds, [KEY_HERO]);

  return aCampaign(
    {},
    {
      requiredCrew: 2,
      status: ContractStatus.Offered,
      offer: anOffer({
        keyHero: KEY_HERO,
        phase: OfferPhase.Locked,
        respondedBy: acceptedBy,
        acceptedBy
      })
    }
  );
}

/** A locked package whose crew is full — the deal is struck, and revising it is refused. */
function lockedAndCrewed(): GameState {
  const acceptedBy = SortedSet.from(compareHeroIds, [KEY_HERO]);

  return aCampaign(
    {},
    {
      requiredCrew: 1,
      status: ContractStatus.Crewed,
      offer: anOffer({
        keyHero: KEY_HERO,
        phase: OfferPhase.Locked,
        respondedBy: acceptedBy,
        acceptedBy
      })
    }
  );
}

function aCompose(overrides: Partial<ComposeOffer> = {}): ComposeOffer {
  return {
    commandId: 1,
    contractId: ids.crypt,
    keyHero: KEY_HERO,
    advance: 0,
    methodTag: null,
    promisedBonus: 0,
    expectedStateVersion: 0,
    ...overrides
  };
}

function offerOf(state: GameState): OfferState {
  return contractOf(state, ids.crypt).offer;
}

describe('composeOffer', () => {
  it('raises the version, leaves no answer behind, and carries the new terms', () => {
    const revised = composeOffer(
      accepted(aCampaign()),
      aCompose({ advance: 50, keyHero: OTHER_HERO, promisedBonus: 5 })
    ).state;
    const offer = offerOf(revised);
    expect(offer.version).toBe(2);
    expect(offer.respondedBy.values()).toEqual([]);
    expect(offer.acceptedBy.values()).toEqual([]);
    // Kills an implementation that writes `advance: 0`, keeps the package's previous
    // `keyHero` instead of the command's, or drops `promisedBonus` — `accepted()`'s
    // package is keyed to `KEY_HERO`, so reusing the old value instead of the command's
    // `OTHER_HERO` would be visible here, unlike a test that never changes the key hero.
    expect(offer.advance).toBe(50);
    expect(offer.keyHero).toBe(OTHER_HERO);
    expect(offer.promisedBonus).toBe(5);
    expect(offer.methodTag).toBeNull();
  });

  it('accepts a method tag the contract does offer, and carries it into the revised offer', () => {
    const withNegotiableTag = aCampaign(
      {},
      { negotiableTags: SortedSet.from(compareContentIds, [ids.deception, ids.temple]) }
    );
    // Kills an implementation whose bounds check refuses every non-null methodTag
    // regardless of `negotiableTags` — the sibling "refuses a method tag the contract
    // does not offer" test alone cannot tell that shape apart from a correct one,
    // because its contract's `negotiableTags` is empty either way.
    const result = composeOffer(withNegotiableTag, aCompose({ methodTag: ids.deception }));
    expect(result.rejectionCode).toBeNull();
    expect(offerOf(result.state).methodTag).toBe(ids.deception);
  });

  it('refuses a method tag that would push the contract past the tag ceiling', () => {
    const atCeiling = aCampaign(
      {},
      {
        tags: sixTags(),
        negotiableTags: SortedSet.from(compareContentIds, [ids.deception, ids.temple])
      }
    );
    // Kills an implementation that checks only `negotiableTags` membership and lets a
    // legal-but-capacity-breaking tag reach `createContractState`, which throws instead
    // of refusing (the hazard Task 6's review handed this task by name).
    const result = composeOffer(atCeiling, aCompose({ methodTag: ids.deception }));
    expect(result.rejectionCode).toBe(RejectionCodes.OfferTermsOutOfBounds);
    // §6.1: a refusal changes nothing at all, and that is a property of the *object*,
    // not merely of its fields — the reference test the brief itself warns is easy to
    // get vacuously right (`expect(result.state).toBe(lockedAndCrewed())` would be red
    // forever). Named by review as missing here specifically.
    expect(result.state).toBe(atCeiling);
  });

  it('refuses a non-integer advance', () => {
    // Kills `command.advance < 0 || command.advance > patronFee`, which both read
    // `Number.NaN` as "in range" — the bound must check `Number.isInteger` too.
    expect(composeOffer(aCampaign(), aCompose({ advance: Number.NaN })).rejectionCode).toBe(
      RejectionCodes.OfferTermsOutOfBounds
    );
  });

  it('refuses a non-integer promisedBonus', () => {
    // The `advance` test above only ever tries `Number.NaN`, and `promisedBonus` has no
    // `Number.isInteger` test at all — delete that guard and the whole file stays
    // green. A genuine fraction (not NaN) also proves the guard is really
    // `Number.isInteger`, not merely a NaN special-case.
    expect(composeOffer(aCampaign(), aCompose({ promisedBonus: 2.5 })).rejectionCode).toBe(
      RejectionCodes.OfferTermsOutOfBounds
    );
  });

  it('checks the phase before value bounds', () => {
    const state = lockedAndCrewed();
    // Kills an implementation that swaps §6.1's step 4 (phase/status) and step 5
    // (value bounds): both this contract's phase and this command's advance are
    // broken at once, and only `OfferNotInDraft` is the cheaper, earlier check.
    expect(composeOffer(state, aCompose({ advance: 999 })).rejectionCode).toBe(
      RejectionCodes.OfferNotInDraft
    );
  });

  it('carries moodOrdinals forward untouched', () => {
    const withMood = aCampaign(
      {},
      { moodOrdinals: SortedMap.from(compareHeroIds, [[KEY_HERO, 3n]]) }
    );
    // Kills an implementation that rebuilds the revised contract's `moodOrdinals` as a
    // fresh empty map instead of carrying the existing one forward — nothing in the
    // other six tests reads this field at all.
    const revised = composeOffer(withMood, aCompose()).state;
    expect(contractOf(revised, ids.crypt).moodOrdinals.get(KEY_HERO)).toBe(3n);
  });

  it('returns the contract to offered when the crew it had is cleared', () => {
    expect(
      contractOf(composeOffer(crewedSingleSeatCampaign(), aCompose()).state, ids.crypt).status
    ).toBe('offered');
  });

  it('allows a revision while locked as long as the crew never filled', () => {
    const locked = lockedButUncrewed();
    expect(offerOf(composeOffer(locked, aCompose()).state).phase).toBe(OfferPhase.Draft);
  });

  it('refuses a revision once the crew is filled', () => {
    const state = lockedAndCrewed();
    const result = composeOffer(state, aCompose());
    expect(result.rejectionCode).toBe(RejectionCodes.OfferNotInDraft);
    expect(result.state).toBe(state);
  });

  it('refuses a method tag the contract does not offer', () => {
    expect(composeOffer(aCampaign(), aCompose({ methodTag: ids.temple })).rejectionCode).toBe(
      RejectionCodes.OfferTermsOutOfBounds
    );
  });

  it('refuses an advance above the patron fee', () => {
    expect(composeOffer(aCampaign(), aCompose({ advance: 101 })).rejectionCode).toBe(
      RejectionCodes.OfferTermsOutOfBounds
    );
  });

  it('answers with the cheaper rejection when several preconditions are broken at once', () => {
    const state = lockedAndCrewed();
    expect(
      composeOffer(state, aCompose({ expectedStateVersion: 99, advance: 999, keyHero: heroId(99) }))
        .rejectionCode
    ).toBe(RejectionCodes.StaleState);
    expect(composeOffer(state, aCompose({ advance: 999, keyHero: heroId(99) })).rejectionCode).toBe(
      RejectionCodes.UnknownHero
    );
  });
});

describe('proposeContractToHero — the key hero, and the mood pinned to the contract', () => {
  /**
   * `NEGOTIATION_SPEC` §2.1.1 (mood pinned to the contract, not the offer version) and
   * §6 (only the key hero answers a draft). Every helper below runs the *real*
   * `proposeContractToHero` and `composeOffer` — the mood-pinning bookkeeping this task
   * adds lives in `engine.ts`, not in `decide()`, which was already a pure function of
   * `(campaignSeed, ordinal)` before this task touched it.
   *
   * `answered()` resets only the protocol plumbing its own internal call consumes
   * (`stateVersion`, `appliedCommandIds`) back to the fixed baseline a fresh campaign
   * starts on, so every helper below can keep composing further commands against the
   * default `expectedStateVersion`/`commandId` a fresh campaign would also accept —
   * exactly as a player revising a package one command at a time would. What it does
   * *not* reset is `contracts` (so `moodOrdinals`, `respondedBy`, `acceptedBy` are
   * exactly what the engine wrote) or `metadata.nextDecisionOrdinal` (so a real draw's
   * cost survives) — the two things every test below actually reads. Named for what it
   * does, not for what it produces: the key hero answers, and the answer is whatever
   * `decide` says — `declinedByPrinciple` below calls this same helper on a package its
   * hero declines, and `answered` reads the same either way.
   */

  const KEY_HERO: HeroId = heroId(0);
  /** Exists only to be refused — never a legal respondent while the package is a draft. */
  const OTHER_HERO: HeroId = heroId(3);

  const proposeTraitRules = SortedMap.from(compareContentIds, [
    [
      ids.refusesDeception,
      aTrait({ id: ids.refusesDeception, tag: ids.deception, isPrinciple: true, weight: 0 })
    ]
  ]);

  function aCampaign(): GameState {
    return aState({
      heroes: SortedMap.from(compareHeroIds, [
        // Every scale but `trustInGuild` zeroed, and `trustInGuild` picked so the
        // non-mood score is exactly `1`: at seed `7n`, `drawMood` is `-2` on ordinal 0
        // and `4` on ordinal 2 (computed, not guessed) — `1 - 2 = -1` declines, `1 + 4
        // = 5` accepts. A mutant that redraws mood instead of reusing the pinned
        // ordinal genuinely flips the answer here; a hero whose other motives already
        // decided the case regardless of mood would not — and did not, until this was
        // tuned (an earlier draft used `aHero()`'s untouched defaults, and the "cycled
        // away and back" test passed against the ignore-`moodOrdinals` mutant purely
        // because greed/caution/pride left the score too lopsided for any mood to move
        // it).
        [
          KEY_HERO,
          aHero({
            id: KEY_HERO,
            greed: 0,
            caution: 0,
            pride: 0,
            trustInGuild: 10,
            traits: [ids.refusesDeception]
          })
        ],
        [OTHER_HERO, aHero({ id: OTHER_HERO })]
      ]),
      contracts: SortedMap.from(compareContentIds, [
        [
          ids.crypt,
          aContract({
            // Two seats: one acceptance never crews the offer, so `ContractAlreadyResolved`
            // cannot pre-empt the checks these tests are actually about.
            requiredCrew: 2,
            negotiableTags: SortedSet.from(compareContentIds, [ids.deception, ids.open]),
            offer: anOffer({ keyHero: KEY_HERO })
          })
        ]
      ]),
      traitRules: proposeTraitRules
    });
  }

  function aProposal(overrides: Partial<ProposeContractToHero> = {}): ProposeContractToHero {
    return {
      commandId: 1,
      heroId: KEY_HERO,
      contractId: ids.crypt,
      expectedStateVersion: 0,
      ...overrides
    };
  }

  function aCompose(overrides: Partial<ComposeOffer> = {}): ComposeOffer {
    return {
      commandId: 2,
      contractId: ids.crypt,
      keyHero: KEY_HERO,
      advance: 0,
      methodTag: null,
      promisedBonus: 0,
      expectedStateVersion: 0,
      ...overrides
    };
  }

  /** Every decision `answered()` produced, keyed by the state it returned — not a
   * field on `GameState` itself, which this whole suite otherwise treats as plain
   * data. `moodFactorOf` reads through this rather than through `answered()`'s return
   * value directly, because the return value is a `GameState`, and the one thing a
   * `GameState` alone cannot answer is "what did the last decision's own trace say" —
   * only `CommandResult.decisions` carries that. */
  const lastDecisionByState = new WeakMap<GameState, DecisionResult>();

  /**
   * The key hero answers the current draft, for real, through `proposeContractToHero`
   * — the function this task changes. Only the protocol bookkeeping a chain of these
   * calls would otherwise exhaust (`stateVersion`, `appliedCommandIds`) is reset on the
   * way out, back to what a fresh campaign starts on; `contracts` and
   * `nextDecisionOrdinal` are carried forward exactly as the engine produced them, and
   * the decision itself is kept in `lastDecisionByState` for `moodFactorOf`.
   */
  function answered(state: GameState): GameState {
    const result = proposeContractToHero(
      state,
      aProposal({ expectedStateVersion: state.metadata.stateVersion })
    );

    const next: GameState = {
      ...state,
      contracts: result.state.contracts,
      appliedCommandIds: SortedSet.empty<number>(compareNumbers),
      metadata: {
        ...state.metadata,
        stateVersion: 0,
        nextDecisionOrdinal: result.state.metadata.nextDecisionOrdinal
      }
    };

    const decision = result.decisions[0];
    if (decision !== undefined) {
      lastDecisionByState.set(next, decision);
    }

    return next;
  }

  /**
   * The key hero's own answer to this contract's current package — read off the
   * contract's own bookkeeping rather than re-decided, so asking twice never risks a
   * stale second answer.
   */
  function actionOf(state: GameState): string {
    return contractOf(state, ids.crypt).offer.acceptedBy.has(KEY_HERO)
      ? Actions.Accept
      : Actions.Decline;
  }

  /**
   * The mood that actually reached the last decision's score — read off that
   * decision's own trace (`ReasonCodes.UnpredictableMood`'s factor, wherever it
   * landed), not recomputed by calling `drawMood` a second time against whichever
   * ordinal `moodOrdinals` happens to record. Recomputing from the recorded ordinal
   * only proves the record is consistent with itself; it cannot catch a build that
   * writes the *correct* ordinal to `moodOrdinals` while quietly feeding `decide` a
   * *different* one for the score — the two would still agree on what got recorded,
   * and disagree only in the trace nobody looked at. Zero when neither factor list
   * carries the code, matching `decide`'s own rule: the factor is present only away
   * from zero.
   */
  function moodFactorOf(state: GameState): number {
    const decision = lastDecisionByState.get(state);
    if (decision === undefined) {
      throw new Error(
        'moodFactorOf: no decision recorded for this state — pass what answered() returned.'
      );
    }

    const positive = decision.trace.positiveFactors.find(
      (factor) => factor.reasonCode === ReasonCodes.UnpredictableMood
    );
    if (positive !== undefined) {
      return positive.magnitude;
    }

    const negative = decision.trace.negativeFactors.find(
      (factor) => factor.reasonCode === ReasonCodes.UnpredictableMood
    );
    return negative === undefined ? 0 : -negative.magnitude;
  }

  /**
   * A package the key hero's own principle forbids (`method:deception`), answered —
   * the gate closes before any score exists and no mood is drawn.
   */
  function declinedByPrinciple(state: GameState): GameState {
    const composed = composeOffer(state, aCompose({ methodTag: ids.deception })).state;
    return answered(composed);
  }

  it('refuses anyone but the key hero while the package is a draft', () => {
    expect(proposeContractToHero(aCampaign(), aProposal({ heroId: heroId(3) })).rejectionCode).toBe(
      RejectionCodes.NotTheKeyHero
    );
  });

  it('refuses a second answer to the same version', () => {
    expect(
      proposeContractToHero(answered(aCampaign()), aProposal({ commandId: 2 })).rejectionCode
    ).toBe(RejectionCodes.AlreadyResponded);
  });

  it('gives the same hero the same mood after the package was revised', () => {
    const first = answered(aCampaign());
    const again = answered(composeOffer(first, aCompose({ advance: 50 })).state);
    expect(moodFactorOf(again)).toEqual(moodFactorOf(first));
  });

  it('gives the same answer after a package is cycled away and back', () => {
    const a = answered(aCampaign());
    const back = composeOffer(
      answered(composeOffer(a, aCompose({ advance: 50 })).state),
      aCompose({ advance: 40 })
    ).state;
    expect(actionOf(answered(back))).toBe(actionOf(a));
  });

  it('spends no new ordinal on a hero who already drew a mood for this contract', () => {
    const first = answered(aCampaign());
    const again = answered(composeOffer(first, aCompose({ advance: 50 })).state);
    expect(again.metadata.nextDecisionOrdinal).toBe(first.metadata.nextDecisionOrdinal);
  });

  it('records no mood ordinal for a decision the gate closed', () => {
    const gated = declinedByPrinciple(aCampaign());
    expect(contractOf(gated, ids.crypt).moodOrdinals.has(heroId(0))).toBe(false);
    expect(gated.metadata.nextDecisionOrdinal).toBe(0n);
  });

  it('lets a hero who was gated draw a fresh mood once the package stops violating the principle', () => {
    const gated = declinedByPrinciple(aCampaign());
    const scored = answered(composeOffer(gated, aCompose({ methodTag: ids.open })).state);
    expect(contractOf(scored, ids.crypt).moodOrdinals.has(heroId(0))).toBe(true);
  });
});

/**
 * `lockOffer` (`NEGOTIATION_SPEC` §3.1, §3.3, §6.1) — the point a package stops
 * being a draft the player can still walk away from and becomes money the guild
 * has committed. `KEY_HERO`/`OTHER_HERO` are this file's own top-level ones
 * (`heroId(0)`/`heroId(1)`); the outer, module-level `accepted()` is reused as-is,
 * since it only edits `ids.crypt`'s own offer and is agnostic to which `aCampaign`
 * built the state around it.
 */
describe('lockOffer', () => {
  /**
   * A campaign shaped like the outer `aCampaign`, except its own second parameter
   * also accepts the two offer terms these tests need to flex (`advance`,
   * `promisedBonus`) alongside ordinary `ContractState` fields such as
   * `requiredCrew`. `lockOffer` itself takes no such terms — they already live on
   * the package a prior `composeOffer` set — so there is nowhere else for a test
   * needing a specific `advance`/`requiredCrew` pair to put it but into the
   * contract this campaign starts on.
   */
  function aCampaign(
    stateOverrides: Partial<GameState> = {},
    overrides: Partial<ContractState> & {
      readonly advance?: number;
      readonly promisedBonus?: number;
    } = {}
  ): GameState {
    const { advance, promisedBonus, ...contractOverrides } = overrides;
    const offerOverrides: Partial<OfferState> = {
      ...(advance !== undefined ? { advance } : {}),
      ...(promisedBonus !== undefined ? { promisedBonus } : {})
    };

    return aState({
      heroes: SortedMap.from(compareHeroIds, [
        [KEY_HERO, aHero({ id: KEY_HERO })],
        [OTHER_HERO, aHero({ id: OTHER_HERO })]
      ]),
      contracts: SortedMap.from(compareContentIds, [
        [ids.crypt, aContract({ ...contractOverrides, offer: anOffer(offerOverrides) })]
      ]),
      ...stateOverrides
    });
  }

  /**
   * `composeOffer`, but resetting `stateVersion`/`appliedCommandIds` back to what a
   * fresh campaign starts on before returning — the same convention, and for the
   * same reason, `proposeContractToHero`'s own describe block's `answered()`
   * (above) resets them: so a test composing a real revision by hand can still
   * follow it with another command at the default `expectedStateVersion`/
   * `commandId` every fixture in this file already assumes, rather than every test
   * threading the exact counter its own particular chain of calls would produce.
   * Shadows the imported `composeOffer` for every `it` below, the same way this
   * file's `proposeContractToHero` block already shadows `aCampaign`/`aCompose`.
   */
  function composeOffer(state: GameState, command: ComposeOffer): CommandResult {
    const result = engineComposeOffer(state, command);

    if (!result.applied) {
      return result;
    }

    return {
      ...result,
      state: {
        ...result.state,
        metadata: { ...result.state.metadata, stateVersion: 0 },
        appliedCommandIds: SortedSet.empty<number>(compareNumbers)
      }
    };
  }

  function aLock(overrides: Partial<LockOffer> & { readonly advance?: number } = {}): LockOffer {
    // `advance` is not a `LockOffer` field — locking carries no terms of its own,
    // every term it freezes already lives on the package `composeOffer` set — but
    // it is accepted and discarded here so a call site can name, right next to the
    // command, which of `withOneLockedContract`'s own overrides is the number that
    // makes this particular lock fail; see that fixture's own doc.
    const { advance: _advance, ...lockOverrides } = overrides;

    return {
      commandId: 1,
      contractId: ids.crypt,
      expectedStateVersion: 0,
      ...lockOverrides
    };
  }

  /**
   * `aCampaign`, plus one *other* contract already `locked` with a small
   * commitment of its own — for the one test proving `lockOffer`'s treasury check
   * counts every locked contract's reservation, not only the one about to be
   * locked. `ids.temple` is otherwise only ever used as a tag id in this file;
   * reused here as a second, unrelated contract's id, since nothing in this
   * isolated campaign reads it as anything else.
   */
  function withOneLockedContract(
    overrides: Partial<ContractState> & {
      readonly advance?: number;
      readonly promisedBonus?: number;
    } = {},
    stateOverrides: Partial<GameState> = {}
  ): GameState {
    const campaign = aCampaign(stateOverrides, overrides);
    const otherLockedContract = aContract({
      id: ids.temple,
      requiredCrew: 1,
      status: ContractStatus.Offered,
      offer: anOffer({ keyHero: OTHER_HERO, advance: 1, phase: OfferPhase.Locked })
    });

    return {
      ...campaign,
      contracts: campaign.contracts.set(otherLockedContract.id, otherLockedContract)
    };
  }

  it('refuses to lock a package the key hero has not accepted', () => {
    expect(lockOffer(aCampaign(), aLock()).rejectionCode).toBe(
      RejectionCodes.KeyHeroHasNotAccepted
    );
  });

  it('refuses to lock against an acceptance of an older version', () => {
    const revised = composeOffer(accepted(aCampaign()), aCompose({ advance: 50 })).state;
    expect(lockOffer(revised, aLock()).rejectionCode).toBe(RejectionCodes.KeyHeroHasNotAccepted);
  });

  it('reserves the advance for every seat, not for the heroes who happened to answer', () => {
    const campaign = accepted(aCampaign({ treasury: 100 }, { advance: 40, requiredCrew: 3 }));
    expect(lockOffer(campaign, aLock()).rejectionCode).toBe(
      RejectionCodes.TreasuryCannotCoverTheOffer
    );
  });

  it('counts what other locked contracts already committed', () => {
    const campaign = accepted(
      withOneLockedContract({ advance: 100, requiredCrew: 6 }, { treasury: 600 })
    );
    expect(lockOffer(campaign, aLock({ advance: 100 })).rejectionCode).toBe(
      RejectionCodes.TreasuryCannotCoverTheOffer
    );
  });

  it('fills a single-seat contract the moment the key hero accepts', () => {
    const locked = lockOffer(accepted(aCampaign({}, { requiredCrew: 1 })), aLock()).state;
    expect(contractOf(locked, ids.crypt).status).toBe('crewed');
    expect(offerOf(locked).phase).toBe(OfferPhase.Locked);
  });

  // Beyond the five tests above: `NEGOTIATION_SPEC` §3.1's table restricts
  // `lockOffer` to a `draft` package, the same way `composeOffer`'s own
  // `OfferNotInDraft` restricts revision. Proven directly, because `lockOffer`
  // never clears `acceptedBy`: without this check, a second lock of an
  // already-`locked` package would still find the key hero accepted and fall
  // through to the treasury check, instead of being refused here.
  it('refuses to lock a package that is already locked', () => {
    const state = lockedButUncrewed();
    const result = lockOffer(state, aLock());
    expect(result.rejectionCode).toBe(RejectionCodes.OfferNotInDraft);
    // §6.1: a refusal changes nothing at all, and that is a property of the
    // *object*, not merely of its fields.
    expect(result.state).toBe(state);
  });
});
