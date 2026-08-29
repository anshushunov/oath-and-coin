import { describe, expect, it } from 'vitest';

import { SortedMap } from '../collections/sorted-map.ts';
import { SortedSet } from '../collections/sorted-set.ts';
import { RejectionCodes } from '../commands/command-result.ts';
import type { ResolveContract } from '../commands/resolve-contract.ts';
import { CommitmentState } from '../domain/commitment.ts';
import { NeedId, compareNeedIds } from '../domain/need-id.ts';
import { ConsequenceKind, CoverageVerdict, DeficitKind, OutcomeGrade } from '../domain/outcome.ts';
import { foldOutcome, resolveContract } from '../engine.ts';
import { compareContentIds } from '../ids/content-id.ts';
import { compareHeroIds, heroId, type HeroId } from '../ids/hero-id.ts';
import { GRIEVANCE_MAX } from '../negotiation/grievance.ts';
import { ContractStatus } from '../state/contract-state.ts';
import { contractOf, heroOf, type GameState } from '../state/game-state.ts';
import { OfferPhase, createContractState } from '../state/offer-state.ts';
import { aContract, aHero, anOffer, aState, ids } from '../testing/fixtures.ts';

import { draftResolution } from './contract-resolver.ts';

/**
 * `RESOLUTION_SPEC` §3 — the sixth command: what it refuses, and what one application of
 * it does to a campaign.
 *
 * The arithmetic of the outcome itself is `contract-resolver.test.ts`'s; what is under
 * test here is the protocol around it. Each fixture is named for the *outcome* it reaches,
 * because the events a resolution raises are exactly the outcome's own intents and there
 * is no way to ask about one without the other.
 */

const KEY: HeroId = heroId(0);
const SECOND: HeroId = heroId(1);

interface CrewSpec {
  readonly id: HeroId;
  readonly expertise: readonly (readonly [NeedId, number])[];
  readonly commitment?: CommitmentState;
}

interface CampaignSpec {
  readonly needs: readonly (readonly [NeedId, number])[];
  readonly crew: readonly CrewSpec[];
  readonly keyHero?: HeroId;
  readonly phase?: OfferPhase;
  readonly status?: ContractStatus;
}

/** A locked, crewed contract with a real crew — the one shape `resolveContract` accepts. */
function campaign(spec: CampaignSpec): GameState {
  const crewIds = spec.crew.map((member) => member.id);
  const accepted = SortedSet.from(compareHeroIds, crewIds);

  const contract = aContract({
    patronFee: 100,
    risk: 0,
    requiredCrew: spec.crew.length,
    needs: SortedMap.from<NeedId, number>(compareNeedIds, spec.needs),
    status: spec.status ?? ContractStatus.Crewed,
    offer: anOffer({
      keyHero: spec.keyHero ?? KEY,
      phase: spec.phase ?? OfferPhase.Locked,
      invited: SortedSet.from(compareHeroIds, crewIds),
      respondedBy: accepted,
      acceptedBy: accepted,
      commitments: SortedMap.from(
        compareHeroIds,
        spec.crew.map(
          (member) => [member.id, member.commitment ?? CommitmentState.Committed] as const
        )
      )
    })
  });

  const heroes = spec.crew.map((member) =>
    aHero({
      id: member.id,
      capability: {
        grade: 100,
        expertise: SortedMap.from<NeedId, number>(compareNeedIds, member.expertise)
      }
    })
  );

  return aState({
    heroes: SortedMap.from(
      compareHeroIds,
      heroes.map((hero) => [hero.id, hero] as const)
    ),
    // Through the constructor, so every §2.5 invariant a resolution has to be handed
    // holds by construction rather than by hope.
    contracts: SortedMap.from(compareContentIds, [[contract.id, createContractState(contract)]])
  });
}

/**
 * Both needs weak at exactly §4.3's floor, a committed crew of two: base `−80`, margin
 * `−64` against a requirement of 200 — failed. One consequence, nobody having given way,
 * so the wound lands on the man holding the worse-covered of two equally-covered needs
 * (`compareNeedIds` breaks that tie toward frontline, and `KEY` is who holds it).
 *
 * Five intents, so the fold below is a real fold rather than one event dressed as many.
 */
const failing = () =>
  campaign({
    needs: [
      [NeedId.Frontline, 100],
      [NeedId.Wilderness, 100]
    ],
    crew: [
      { id: KEY, expertise: [[NeedId.Frontline, 60]] },
      { id: SECOND, expertise: [[NeedId.Wilderness, 60]] }
    ]
  });

/** Every need closed with room to spare — a clean outcome, and the shortest run there is. */
const cleanly = () =>
  campaign({
    needs: [
      [NeedId.Frontline, 30],
      [NeedId.Wilderness, 30]
    ],
    crew: [
      {
        id: KEY,
        expertise: [
          [NeedId.Frontline, 100],
          [NeedId.Wilderness, 100]
        ]
      }
    ]
  });

/**
 * Half of one need, none of the other, and nobody reluctant: base `−150`, margin `−120`
 * against 200 — a catastrophe with no faltering, which is the one shape that reaches
 * `TrustLost`. The key hero is the man who brought nothing, so the wound and the lost
 * trust land on two different people.
 */
const catastrophically = () =>
  campaign({
    needs: [
      [NeedId.Frontline, 100],
      [NeedId.Wilderness, 100]
    ],
    crew: [
      { id: KEY, expertise: [[NeedId.Frontline, 50]] },
      { id: SECOND, expertise: [] }
    ],
    keyHero: SECOND
  });

/**
 * A catastrophe with a crew that came resentfully — so somebody *did* give way, and §5.1's
 * second record is a grudge rather than a loss of trust.
 *
 * Frontline is supplied 50 of 100 and wilderness 20 of 100, for a base of `−130`; a
 * resentful crew's `−20 %` takes the margin to `−156` against a requirement of 200. Both
 * heroes gave way, so §5.2 asks two different questions of them and both answer `SECOND`:
 * wilderness is the worse-covered need (a fifth answered against a half), and he also
 * brought least to his own. One man taking both records is a shape §5.1 permits and this
 * is the fixture that holds it.
 */
const catastrophicallyAndUnwillingly = () =>
  campaign({
    needs: [
      [NeedId.Frontline, 100],
      [NeedId.Wilderness, 100]
    ],
    crew: [
      { id: KEY, expertise: [[NeedId.Frontline, 50]], commitment: CommitmentState.Resentful },
      { id: SECOND, expertise: [[NeedId.Wilderness, 20]], commitment: CommitmentState.Resentful }
    ]
  });

/**
 * One need closed and one all but unanswered — the only fixture here whose two coverage
 * events carry *different* verdicts.
 *
 * Frontline is supplied 100 of 100 and closes; wilderness is supplied 10 of 100 and does
 * not, for a base of `−90` and a margin of `−72` against a requirement of 200 — a
 * catastrophe. Its reason for existing is §3.4's `verdict`: every other fixture has both
 * needs landing on the same verdict, so an event projection reading the verdict off the
 * wrong row — or off the reason code — answered correctly by accident.
 */
const mixedVerdicts = () =>
  campaign({
    needs: [
      [NeedId.Frontline, 100],
      [NeedId.Wilderness, 100]
    ],
    crew: [
      { id: KEY, expertise: [[NeedId.Frontline, 100]] },
      { id: SECOND, expertise: [[NeedId.Wilderness, 10]] }
    ]
  });

function aResolve(overrides: Partial<ResolveContract> = {}): ResolveContract {
  return {
    commandId: 1,
    contractId: ids.crypt,
    expectedStateVersion: 0,
    retreatAtRound: null,
    ...overrides
  };
}

const kindsOf = (state: GameState, command = aResolve()) =>
  resolveContract(state, command).events.map((event) => event.kind);

describe('what `resolveContract` refuses (§3.2)', () => {
  it('refuses a command composed against a campaign that has moved on', () => {
    expect(resolveContract(failing(), aResolve({ expectedStateVersion: 1 })).rejectionCode).toBe(
      RejectionCodes.StaleState
    );
  });

  it('refuses a command id this campaign already applied', () => {
    const once = resolveContract(failing(), aResolve()).state;

    expect(
      resolveContract(once, aResolve({ expectedStateVersion: once.metadata.stateVersion }))
        .rejectionCode
    ).toBe(RejectionCodes.DuplicateCommand);
  });

  it('refuses a contract this campaign does not have', () => {
    expect(resolveContract(failing(), aResolve({ contractId: ids.temple })).rejectionCode).toBe(
      RejectionCodes.UnknownContract
    );
  });

  it('refuses a package still being edited', () => {
    const draft = campaign({
      needs: [
        [NeedId.Frontline, 30],
        [NeedId.Wilderness, 30]
      ],
      crew: [
        {
          id: KEY,
          expertise: [
            [NeedId.Frontline, 100],
            [NeedId.Wilderness, 100]
          ]
        }
      ],
      phase: OfferPhase.Draft
    });

    expect(resolveContract(draft, aResolve()).rejectionCode).toBe(RejectionCodes.OfferNotLocked);
  });

  it('refuses a single-seat contract still in draft, though its crew is already full', () => {
    // §3.2's own note: the key hero fills a one-seat crew while the package is still a
    // draft, so `Crewed` is reachable before `lockOffer` ever runs. Without the phase
    // check, a contract would be resolvable on a package the player can still edit.
    const draft = campaign({
      needs: [
        [NeedId.Frontline, 30],
        [NeedId.Wilderness, 30]
      ],
      crew: [
        {
          id: KEY,
          expertise: [
            [NeedId.Frontline, 100],
            [NeedId.Wilderness, 100]
          ]
        }
      ],
      phase: OfferPhase.Draft
    });

    expect(contractOf(draft, ids.crypt).status).toBe(ContractStatus.Crewed);
    expect(resolveContract(draft, aResolve()).rejectionCode).toBe(RejectionCodes.OfferNotLocked);
  });

  it('refuses a locked package whose crew never filled', () => {
    const unfilled = aState({
      heroes: SortedMap.from(compareHeroIds, [[KEY, aHero({ id: KEY })]]),
      contracts: SortedMap.from(compareContentIds, [
        [
          ids.crypt,
          createContractState(
            aContract({
              requiredCrew: 2,
              status: ContractStatus.Offered,
              offer: anOffer({
                keyHero: KEY,
                phase: OfferPhase.Locked,
                invited: SortedSet.from(compareHeroIds, [KEY, SECOND]),
                respondedBy: SortedSet.from(compareHeroIds, [KEY]),
                acceptedBy: SortedSet.from(compareHeroIds, [KEY])
              })
            })
          )
        ]
      ])
    });

    expect(resolveContract(unfilled, aResolve()).rejectionCode).toBe(RejectionCodes.CrewNotFilled);
  });

  it('refuses a crewed-looking package whose status says otherwise', () => {
    // The status check on its own, with nothing else able to catch the state. Every
    // other unfilled-crew fixture also fails the invited-equals-accepted check one line
    // later, so removing the status check left the whole suite green — the two share a
    // rejection code, and which of them fired is invisible from outside. Found by a
    // mutant, closed by a state only the first check refuses: the same people invited and
    // accepted, and a status that has not caught up.
    const stale = aState({
      heroes: SortedMap.from(compareHeroIds, [[KEY, aHero({ id: KEY })]]),
      contracts: SortedMap.from(compareContentIds, [
        [
          ids.crypt,
          aContract({
            requiredCrew: 1,
            status: ContractStatus.Offered,
            offer: anOffer({
              keyHero: KEY,
              phase: OfferPhase.Locked,
              invited: SortedSet.from(compareHeroIds, [KEY]),
              respondedBy: SortedSet.from(compareHeroIds, [KEY]),
              acceptedBy: SortedSet.from(compareHeroIds, [KEY])
            })
          })
        ]
      ])
    });

    expect(resolveContract(stale, aResolve()).rejectionCode).toBe(RejectionCodes.CrewNotFilled);
  });

  it('refuses a package whose accepted crew is not the crew it invited', () => {
    // Unreachable through `createContractState` — `acceptedBy ⊆ respondedBy ⊆ invited`
    // and both sets have `requiredCrew` members, so equality follows — which is why the
    // fixture is built without it. The check is a guard against hand-assembled state and
    // against a save somebody edited, the same standing as `pollCrew`'s `hasRoom`, and it
    // can only be reached from here.
    const mismatched = aState({
      heroes: SortedMap.from(compareHeroIds, [
        [KEY, aHero({ id: KEY })],
        [SECOND, aHero({ id: SECOND })]
      ]),
      contracts: SortedMap.from(compareContentIds, [
        [
          ids.crypt,
          aContract({
            requiredCrew: 1,
            status: ContractStatus.Crewed,
            offer: anOffer({
              keyHero: KEY,
              phase: OfferPhase.Locked,
              invited: SortedSet.from(compareHeroIds, [KEY]),
              respondedBy: SortedSet.from(compareHeroIds, [SECOND]),
              acceptedBy: SortedSet.from(compareHeroIds, [SECOND]),
              commitments: SortedMap.from(compareHeroIds, [[SECOND, CommitmentState.Committed]])
            })
          })
        ]
      ])
    });

    expect(resolveContract(mismatched, aResolve()).rejectionCode).toBe(
      RejectionCodes.CrewNotFilled
    );
  });

  it('refuses a contract that already came back', () => {
    const once = resolveContract(failing(), aResolve()).state;

    expect(
      resolveContract(
        once,
        aResolve({ commandId: 2, expectedStateVersion: once.metadata.stateVersion })
      ).rejectionCode
    ).toBe(RejectionCodes.AlreadyResolved);
  });

  it('moves nothing at all when it refuses', () => {
    const state = failing();
    const refused = resolveContract(state, aResolve({ expectedStateVersion: 99 }));

    expect(Object.is(refused.state, state)).toBe(true);
    expect(refused.events).toEqual([]);
    expect(refused.decisions).toEqual([]);
  });
});

describe('what one resolution does to the campaign (§3.3)', () => {
  it('raises one event per intent, in the resolver’s own order', () => {
    expect(kindsOf(failing())).toEqual([
      'need_short',
      'need_short',
      'objective_lost',
      'hero_suffered_consequence',
      'contract_resolved'
    ]);
  });

  it('cannot produce an empty set of events: even a clean outcome raises two', () => {
    expect(kindsOf(cleanly())).toEqual([
      'need_covered',
      'need_covered',
      'objective_taken',
      'contract_resolved'
    ]);
  });

  it('gives every event its own consecutive identifier', () => {
    const state = failing();
    const applied = resolveContract(state, aResolve());
    const ids = applied.events.map((event) => event.eventId);

    // `withEvent` takes one event per call, so a command folding several through a single
    // transition — or reusing an id — is exactly what this catches. A test reading only
    // the first id would see none of it.
    expect(ids).toEqual(ids.map((_unused, index) => state.metadata.nextEventId + index));
    expect(ids).toHaveLength(5);
  });

  it('moves the history and the state version once per event', () => {
    const state = failing();
    const applied = resolveContract(state, aResolve());

    expect(applied.state.history).toHaveLength(state.history.length + applied.events.length);
    expect(applied.state.metadata.stateVersion).toBe(
      state.metadata.stateVersion + applied.events.length
    );
  });

  it('carries each event’s own fields, not a shape flattened across them', () => {
    const applied = resolveContract(failing(), aResolve());
    const [first, , , suffered, resolved] = applied.events;

    expect(first).toMatchObject({
      kind: 'need_short',
      contractId: ids.crypt,
      need: NeedId.Frontline,
      verdict: CoverageVerdict.Weak,
      gap: DeficitKind.Coverage
    });
    expect(suffered).toMatchObject({
      kind: 'hero_suffered_consequence',
      contractId: ids.crypt,
      heroId: KEY,
      consequence: ConsequenceKind.Wound,
      magnitude: 1
    });
    expect(resolved).toMatchObject({
      kind: 'contract_resolved',
      contractId: ids.crypt,
      grade: OutcomeGrade.Failed
    });
  });

  it('reads each verdict off the need it belongs to, not off the first row', () => {
    // Two needs, two different verdicts, in one run. Every other fixture in this file has
    // both landing on the same one, so a projection reading the wrong row was correct by
    // coincidence — measured with a mutant, not reasoned about.
    const applied = resolveContract(mixedVerdicts(), aResolve());
    const coverage = applied.events.filter(
      (event) => event.kind === 'need_covered' || event.kind === 'need_short'
    );

    expect(coverage.map((event) => [event.kind, event.need, event.verdict])).toEqual([
      ['need_covered', NeedId.Frontline, CoverageVerdict.Closed],
      ['need_short', NeedId.Wilderness, CoverageVerdict.Uncovered]
    ]);
  });

  it('names who gave way, and the need he was answerable for', () => {
    const applied = resolveContract(catastrophicallyAndUnwillingly(), aResolve());
    const faltered = applied.events.filter((event) => event.kind === 'hero_faltered_early');

    expect(faltered).toHaveLength(2);
    expect(faltered.map((event) => [event.heroId, event.need])).toEqual([
      [KEY, NeedId.Frontline],
      [SECOND, NeedId.Wilderness]
    ]);
  });

  it('explains none of it with a decision trace', () => {
    // `ADR-007`: a trace explains an agent's choice. A resolution is not one — the
    // explanation lives in the stored result and in the provenance.
    const applied = resolveContract(failing(), aResolve());

    for (const event of applied.events) {
      expect(event.causalTraceId).toBeNull();
    }
    expect(applied.decisions).toEqual([]);
    expect(applied.state.traces.keys()).toEqual([]);
  });

  it('spends no randomness', () => {
    const state = failing();

    expect(resolveContract(state, aResolve()).state.metadata.nextDecisionOrdinal).toBe(
      state.metadata.nextDecisionOrdinal
    );
  });

  it('records the command id exactly once', () => {
    const applied = resolveContract(failing(), aResolve({ commandId: 7 }));

    expect(applied.state.appliedCommandIds.values()).toEqual([7]);
  });
});

describe('the effect of each event, inside its own transition (§3.3)', () => {
  it('stores the resolution the last event is about', () => {
    const { resolution } = contractOf(resolveContract(failing(), aResolve()).state, ids.crypt);

    expect(resolution?.grade).toBe(OutcomeGrade.Failed);
    expect(resolution?.contributions.keys()).toEqual([KEY, SECOND]);
  });

  it('freezes the resolution, which is what puts it inside the transition rather than after', () => {
    // `withEvent` deep-freezes the state it answers with. A command that folded every
    // event first and applied the effects afterwards — or that applied `contract_resolved`'s
    // effect after its own transition — would hand back a fresh spread instead, and the
    // result would not be frozen. This is what holds `ADR-007`'s "the effect goes in before
    // its own event" at a boundary a test can actually reach.
    const applied = resolveContract(failing(), aResolve());
    const { resolution } = contractOf(applied.state, ids.crypt);

    expect(Object.isFrozen(resolution)).toBe(true);
    expect(Object.isFrozen(heroOf(applied.state, KEY))).toBe(true);
  });

  it('wounds the hero the outcome says was on the point', () => {
    const applied = resolveContract(failing(), aResolve());

    expect(heroOf(applied.state, KEY).wounds).toBe(1);
    expect(heroOf(applied.state, SECOND).wounds).toBe(0);
  });

  it('costs the key hero his trust in a catastrophe nobody gave way in', () => {
    const before = catastrophically();
    const applied = resolveContract(before, aResolve());

    expect(heroOf(applied.state, KEY).wounds).toBe(1);
    expect(heroOf(applied.state, SECOND).trustInGuild).toBe(
      heroOf(before, SECOND).trustInGuild - 1
    );
    expect(heroOf(applied.state, KEY).trustInGuild).toBe(heroOf(before, KEY).trustInGuild);
  });

  it('adds to the grievance of whoever gave way, rather than to the guild’s standing', () => {
    const before = catastrophicallyAndUnwillingly();
    const applied = resolveContract(before, aResolve());
    const grudged = applied.state.heroes
      .entries()
      .filter(([hero, state]) => state.grievance > heroOf(before, hero).grievance);

    // Exactly one man, and not by name alone: swept across the whole roster, so a rule
    // that spent the grudge on everybody — the shape edition 1.0 of §5.1 had for
    // `TrustLost` — would be caught here rather than agreeing about the one hero asked
    // about.
    expect(grudged.map(([hero]) => hero)).toEqual([SECOND]);
    expect(heroOf(applied.state, SECOND).grievance).toBe(heroOf(before, SECOND).grievance + 1);
    // A grudge and not a lost trust: somebody gave way, so §5.1's second record is his.
    // Swept the same way, because "nobody lost trust" is the half that says which of the
    // two branches ran.
    expect(
      applied.state.heroes
        .entries()
        .filter(([hero, state]) => state.trustInGuild !== heroOf(before, hero).trustInGuild)
    ).toEqual([]);
  });

  it('lets one man take both records when both rules answer with him', () => {
    // §5.1 caps the number of records, not the number of people: a catastrophe is two
    // records, and nothing says they must fall on two heroes.
    const applied = resolveContract(catastrophicallyAndUnwillingly(), aResolve());

    expect(heroOf(applied.state, SECOND).wounds).toBe(1);
    expect(heroOf(applied.state, SECOND).grievance).toBe(1);
    expect(heroOf(applied.state, KEY).wounds).toBe(0);
    expect(heroOf(applied.state, KEY).grievance).toBe(0);
  });

  it('never pushes a grievance past its ceiling', () => {
    const before = catastrophicallyAndUnwillingly();
    const brimming = {
      ...before,
      heroes: before.heroes.set(SECOND, { ...heroOf(before, SECOND), grievance: GRIEVANCE_MAX })
    };

    expect(heroOf(resolveContract(brimming, aResolve()).state, SECOND).grievance).toBe(
      GRIEVANCE_MAX
    );
  });

  it('never pushes a trust below nothing', () => {
    const before = catastrophically();
    const distrustful = {
      ...before,
      heroes: before.heroes.set(SECOND, { ...heroOf(before, SECOND), trustInGuild: 0 })
    };

    expect(heroOf(resolveContract(distrustful, aResolve()).state, SECOND).trustInGuild).toBe(0);
  });

  it('leaves the contract locked and crewed, with the money untouched', () => {
    // Resolution answers what happened; settlement answers what it pays (§5.3), and the
    // two are separate commands so a player sees the outcome before deciding about the
    // promise.
    const before = failing();
    const applied = resolveContract(before, aResolve());
    const contract = contractOf(applied.state, ids.crypt);

    expect(contract.offer.phase).toBe(OfferPhase.Locked);
    expect(contract.status).toBe(ContractStatus.Crewed);
    expect(applied.state.treasury).toBe(before.treasury);
  });
});

describe('the order the preconditions are checked in (§3.2, `NEGOTIATION_SPEC` §6.1)', () => {
  // Two broken preconditions at once must answer with the *same* one every time — the
  // order is part of a command's canonical result, not an implementation detail. Every
  // case above breaks exactly one thing, so any permutation of the checks kept the whole
  // file green; found by external review, closed by pairs.

  it('answers a stale version before a repeated command id', () => {
    const once = resolveContract(failing(), aResolve()).state;

    expect(resolveContract(once, aResolve({ expectedStateVersion: 99 })).rejectionCode).toBe(
      RejectionCodes.StaleState
    );
  });

  it('answers a repeated command id before an unknown contract', () => {
    const once = resolveContract(failing(), aResolve()).state;

    expect(
      resolveContract(
        once,
        aResolve({ contractId: ids.temple, expectedStateVersion: once.metadata.stateVersion })
      ).rejectionCode
    ).toBe(RejectionCodes.DuplicateCommand);
  });

  it('answers an unknown contract before anything about its package', () => {
    // There is no package to be wrong about, which is exactly why this comes first: every
    // check after it dereferences the contract.
    expect(resolveContract(failing(), aResolve({ contractId: ids.temple })).rejectionCode).toBe(
      RejectionCodes.UnknownContract
    );
  });

  it('answers a draft package before an unfilled crew', () => {
    const draftAndUnfilled = aState({
      heroes: SortedMap.from(compareHeroIds, [[KEY, aHero({ id: KEY })]]),
      contracts: SortedMap.from(compareContentIds, [
        [
          ids.crypt,
          createContractState(
            aContract({
              requiredCrew: 2,
              status: ContractStatus.Offered,
              offer: anOffer({
                keyHero: KEY,
                phase: OfferPhase.Draft,
                invited: SortedSet.from(compareHeroIds, [KEY, SECOND]),
                respondedBy: SortedSet.from(compareHeroIds, [KEY]),
                acceptedBy: SortedSet.from(compareHeroIds, [KEY])
              })
            })
          )
        ]
      ])
    });

    expect(resolveContract(draftAndUnfilled, aResolve()).rejectionCode).toBe(
      RejectionCodes.OfferNotLocked
    );
  });

  it('answers a crew that is not the one invited before a contract already resolved', () => {
    // Both true at once, on a state assembled by hand. The crew check comes first: a
    // resolution recorded against the wrong people is the more serious of the two things
    // there are to say about this contract.
    const resolvedOnce = resolveContract(failing(), aResolve()).state;
    const contract = contractOf(resolvedOnce, ids.crypt);
    const alsoMismatched = {
      ...resolvedOnce,
      contracts: resolvedOnce.contracts.set(ids.crypt, {
        ...contract,
        offer: { ...contract.offer, invited: SortedSet.from(compareHeroIds, [KEY]) }
      })
    };

    expect(
      resolveContract(
        alsoMismatched,
        aResolve({ commandId: 2, expectedStateVersion: alsoMismatched.metadata.stateVersion })
      ).rejectionCode
    ).toBe(RejectionCodes.CrewNotFilled);
  });

  it('refuses a crew larger than the one this package asked for', () => {
    // The direction the first edition of the set check missed entirely: it tested only
    // "every invited hero accepted", so a hero nobody invited could join the crew and go
    // out with it. Found by external review.
    const uninvited = aState({
      heroes: SortedMap.from(compareHeroIds, [
        [KEY, aHero({ id: KEY })],
        [SECOND, aHero({ id: SECOND })]
      ]),
      contracts: SortedMap.from(compareContentIds, [
        [
          ids.crypt,
          aContract({
            requiredCrew: 1,
            status: ContractStatus.Crewed,
            offer: anOffer({
              keyHero: KEY,
              phase: OfferPhase.Locked,
              invited: SortedSet.from(compareHeroIds, [KEY]),
              respondedBy: SortedSet.from(compareHeroIds, [KEY, SECOND]),
              acceptedBy: SortedSet.from(compareHeroIds, [KEY, SECOND]),
              commitments: SortedMap.from(compareHeroIds, [
                [KEY, CommitmentState.Committed],
                [SECOND, CommitmentState.Committed]
              ])
            })
          })
        ]
      ])
    });

    expect(resolveContract(uninvited, aResolve()).rejectionCode).toBe(RejectionCodes.CrewNotFilled);
  });
});

describe('the state after each event, one frame at a time (§3.3, §10.3)', () => {
  // What the freeze check cannot see. Applying every effect first and then raising every
  // event answers with the identical campaign, the identical events and an identically
  // frozen result — so the rule this fold exists to obey has no consequence in the final
  // state at all, and the freeze check was green against it. `foldOutcome` answers the
  // frames it passed through, which is the smallest seam that makes the rule checkable.
  // Found by external review.
  const framesOf = () => {
    const state = catastrophicallyAndUnwillingly();
    const contract = contractOf(state, ids.crypt);
    const draft = draftResolution({
      contract,
      crew: contract.offer.acceptedBy.values().map((hero) => ({
        hero: heroOf(state, hero),
        commitment: contract.offer.commitments.get(hero)!
      }))
    });

    return { state, draft, frames: foldOutcome(state, draft, ids.crypt) };
  };

  it('answers one frame per intent, each carrying that intent’s own event', () => {
    const { draft, frames } = framesOf();

    expect(frames).toHaveLength(draft.intents.length);
    expect(frames.map((frame) => frame.event.eventId)).toEqual(
      frames.map((_unused, index) => index)
    );
  });

  it('hands every frame back frozen, which is what puts each effect inside its transition', () => {
    // The observable the whole ordering rule reduces to. `withEvent` freezes what it
    // answers with, so a frame that came *out* of it is frozen; an effect applied after
    // its own event spreads that frozen state into a fresh, unfrozen one and the frame
    // says so. Nothing in the final campaign can tell the two apart — it is frozen again
    // on the way out either way — which is exactly why the check belongs here.
    const { frames } = framesOf();

    expect(frames.map((frame) => Object.isFrozen(frame.state))).toEqual(frames.map(() => true));
  });

  it('stores the resolution at the closing event and not one frame earlier', () => {
    // The ordering claim at the one intent whose effect is observable frame by frame:
    // every frame before the last finds the contract unresolved.
    const { frames } = framesOf();

    expect(frames.map((frame) => contractOf(frame.state, ids.crypt).resolution === null)).toEqual(
      frames.map((_unused, index) => index !== frames.length - 1)
    );
  });

  it('applies each consequence at its own event and at no earlier one', () => {
    // The same claim for §2.6's effects: a hero's wound appears in the frame of the event
    // that says he was wounded, and in none before it.
    const { state, frames } = framesOf();
    const woundedAt = frames.findIndex((frame) => frame.event.kind === 'hero_suffered_consequence');

    expect(woundedAt).toBeGreaterThan(0);

    const suffered = frames[woundedAt]!.event;
    const hero = suffered.kind === 'hero_suffered_consequence' ? suffered.heroId : KEY;

    expect(heroOf(frames[woundedAt - 1]!.state, hero).wounds).toBe(heroOf(state, hero).wounds);
    expect(heroOf(frames[woundedAt]!.state, hero).wounds).toBe(heroOf(state, hero).wounds + 1);
  });
});

describe('what a caller may do to the result (§10.3)', () => {
  it('hands back a campaign that is frozen all the way to its root', () => {
    // `withEvent` deep-freezes what it answers with, and the command then spreads that to
    // add its own id — which produces a fresh, *unfrozen* root and a fresh, unfrozen
    // `SortedSet`. Everything below was frozen and the two objects a caller touches first
    // were not. Found by external review.
    const applied = resolveContract(failing(), aResolve());

    expect(Object.isFrozen(applied.state)).toBe(true);
    expect(Object.isFrozen(applied.state.appliedCommandIds)).toBe(true);
    expect(Object.isFrozen(applied.state.metadata)).toBe(true);
  });
});
