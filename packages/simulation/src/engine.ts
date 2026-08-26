import { SortedMap } from './collections/sorted-map.ts';
import { SortedSet } from './collections/sorted-set.ts';
import {
  rejected,
  fromDecisions,
  fromEvent,
  RejectionCodes,
  type CommandResult
} from './commands/command-result.ts';
import type { ComposeOffer } from './commands/compose-offer.ts';
import type { LockOffer } from './commands/lock-offer.ts';
import type { PollCrew } from './commands/poll-crew.ts';
import type { ProposeContractToHero } from './commands/propose-contract-to-hero.ts';
import type { SettleContract } from './commands/settle-contract.ts';
import { Actions } from './decisions/actions.ts';
import type { DecisionResult } from './decisions/causal-trace.ts';
import { decide, type HeroDecision } from './decisions/contract-decision-rule.ts';
import type { DecisionContext } from './decisions/context.ts';
import type { HeldTrait } from './decisions/held-trait.ts';
import type { CommitmentState } from './domain/commitment.ts';
import type { DomainEvent } from './events/domain-event.ts';
import { compareContentIds, type ContentId } from './ids/content-id.ts';
import { compareHeroIds, type HeroId } from './ids/hero-id.ts';
import { canCover } from './negotiation/commitments.ts';
import { GRIEVANCE_MAX, grievanceForBrokenPromise } from './negotiation/grievance.ts';
import { commitmentFor } from './resolution/commitment.ts';
import type { ContractState } from './state/contract-state.ts';
import { ContractStatus } from './state/contract-state.ts';
import { heroOf, withEvent, type GameState } from './state/game-state.ts';
import type { HeroState } from './state/hero-state.ts';
import {
  createContractState,
  MAX_TAGS_PER_CONTRACT,
  OfferPhase,
  type OfferState
} from './state/offer-state.ts';

/**
 * Applies commands to a {@link GameState} and returns the state that results.
 *
 * A module of functions, where the C# original was a sealed class with no fields and a
 * reflection test asserting the absence of fields. The class existed so a later ruleset
 * variation could be a different *instance* and so that test had a subject; the port
 * keeps the property and drops both — a module-level function has nowhere to put a
 * generator, a counter or a cache, so "the engine holds nothing" stops being a test and
 * becomes a fact about the shape of the code.
 *
 * Statelessness is the whole reason replay works. Everything a decision needs — the
 * seed, the RNG ordinal, the next trace id, the version — is read from the state passed
 * in, so `apply(state, command)` is a function: the same pair produces the same result
 * on a fresh process that has just loaded a save and knows nothing about what came
 * before.
 */

/** What one hero's answer to `contract`'s current offer cost the campaign. */
interface HeroResponse {
  readonly decision: HeroDecision;
  /**
   * `contract.moodOrdinals`, updated to record this hero's draw if this was the
   * first time it happened — untouched otherwise. The caller carries this straight
   * into the next `createContractState` call; it is not a second place the pin
   * lives.
   */
  readonly moodOrdinals: SortedMap<HeroId, bigint>;
  /** What `withEvent` should be told this decision cost — `0n` for a pinned mood. */
  readonly ordinalsConsumed: bigint;
  /**
   * How willingly the hero said yes (`RESOLUTION_SPEC` §2.4), or `null` if he said no —
   * a commitment is a fact about an acceptance, and a decline records none.
   *
   * Computed here rather than by the caller because here is where the `DecisionContext`
   * this answer was given on still exists. The crew grows between one hero's answer and
   * the next; asked again later, on a fuller package, the same hero would answer
   * differently, and the record would describe a decision nobody made.
   */
  readonly commitment: CommitmentState | null;
}

/**
 * One hero's answer to `contract`'s current offer, and what it cost the campaign's
 * randomness — the context assembly, mood pinning and `decide` call that
 * `proposeContractToHero` and `pollCrew` both need. Factored out once so the two
 * commands cannot drift apart on either: a `pollCrew` that rebuilt this logic by hand
 * would be a second place `NEGOTIATION_SPEC` §2.1.1's pinning rule could be gotten
 * subtly wrong, in a command whose whole point is to run it several times in a row.
 *
 * `NEGOTIATION_SPEC` §2.1.1: a hero's mood is pinned to this contract the first time
 * it is drawn, not redrawn on every revised package — otherwise raising the advance
 * and lowering it back would be a free reroll of the one input the hero's answer
 * isn't determined by. A recorded ordinal is passed straight to `decide`, which draws
 * the identical mood from it every time (a pure function of `(campaignSeed,
 * ordinal)`) — the caller declares `0n` spent regardless of what `decide` itself
 * reports, because reading a mood already drawn is not new randomness.
 */
function decideHeroResponse(
  state: GameState,
  hero: HeroState,
  contract: ContractState
): HeroResponse {
  // The hero's traits, resolved through the campaign's own trait rulebook
  // (`GameState.traitRules` — filled once, at content-load time, on the other side of
  // the boundary this package cannot cross). Sorted by id rather than merely copied in
  // `HeroState.traits`' authored order, because the rule asserts that ordering instead
  // of re-sorting it itself.
  const traitIds = SortedSet.from(compareContentIds, hero.traits);
  const traits: HeldTrait[] = [];
  for (const traitId of traitIds.values()) {
    const trait = state.traitRules.get(traitId);
    // A bare lookup would surface a missing id as `undefined` three layers away, with
    // no clue which id, which hero, or where the rulebook is even filled. A hero naming
    // a trait id absent from `traitRules` is a content-loading bug — the id should have
    // failed the loader's own reference check before ever reaching a `HeroState` — not
    // a hero with no opinion, so it fails loudly with enough to find the cause.
    if (trait === undefined) {
      throw new Error(
        `Hero '${hero.definition}' carries trait id '${traitId}', but GameState.traitRules has ` +
          'no entry for it. traitRules is filled once, by the content loader, from every trait ' +
          'the loaded content defines — a hero referencing an id absent from that table is a ' +
          'content-loading bug, not a hero with no opinion.'
      );
    }

    traits.push(trait);
  }

  // Comrades already committed to this same offer — exactly `contract.offer.acceptedBy`,
  // resolved to the content id the rule matches relationships against. Built from what
  // already lives in state, so every hero the decision's bonds walk reaches finds an
  // entry here; an accepted hero missing from crew is exactly the context-assembly bug
  // the rule guards against.
  const crew = SortedMap.from<HeroId, ContentId>(
    compareHeroIds,
    contract.offer.acceptedBy.values().map((acceptedHeroId: HeroId) => {
      const comrade = state.heroes.get(acceptedHeroId);
      if (comrade === undefined) {
        throw new Error(
          `Contract '${contract.id}' lists hero hero#${acceptedHeroId} in acceptedBy, but the ` +
            'campaign has no such hero.'
        );
      }

      return [acceptedHeroId, comrade.definition] as const;
    })
  );

  // `NEGOTIATION_SPEC` §2.1.1: a hero's mood is pinned to this contract the first time
  // it is drawn, not redrawn on every revised package — otherwise raising the advance
  // and lowering it back would be a free reroll of the one input the hero's answer
  // isn't determined by. A recorded ordinal is passed straight to `decide`, which
  // draws the identical mood from it every time (a pure function of `(campaignSeed,
  // ordinal)`) — the engine below declares `0n` spent regardless of what `decide`
  // itself reports, because reading a mood already drawn is not new randomness.
  const knownMoodOrdinal = contract.moodOrdinals.get(hero.id);
  const decisionOrdinal = knownMoodOrdinal ?? state.metadata.nextDecisionOrdinal;

  // Named rather than inlined into the call: `commitmentFor` below needs *this* context,
  // the one the answer was actually given on, and a second object built to look like it
  // would be a second place the assembly above could drift out of step (`RESOLUTION_SPEC`
  // §2.4).
  const context: DecisionContext = {
    hero,
    contract,
    traits,
    crew,
    campaignSeed: state.metadata.campaignSeed,
    decisionOrdinal,
    traceId: state.metadata.nextTraceId
  };

  const decision = decide(context);

  // A mood ordinal is recorded only on the draw that actually happened: `decide`
  // itself reports `0n` on the gated path — its own `HeroDecision.ordinalsConsumed`
  // doc says as much — and a hero who already has a recorded ordinal keeps exactly
  // that one, so a later revision that stops violating this hero's principle must
  // still read the mood already drawn, not a fresh one drawn now that nothing blocks
  // it. Read directly off `ordinalsConsumed` rather than off `trace.blockedBy.length`:
  // the count is the fact this file needs ("did a draw happen"), stated once by the
  // one function whose job it is to state it; a second path that gated without
  // `blockedBy` growing (a red line `decide` might add outside the principle gate,
  // say) would make a `blockedBy`-shaped proxy silently record a draw that never
  // happened — exactly the failure this task exists to close.
  const moodDrawnJustNow = knownMoodOrdinal === undefined && decision.ordinalsConsumed > 0n;
  const moodOrdinals = moodDrawnJustNow
    ? contract.moodOrdinals.set(hero.id, decisionOrdinal)
    : contract.moodOrdinals;
  const ordinalsConsumed = knownMoodOrdinal !== undefined ? 0n : decision.ordinalsConsumed;

  // Only for a yes, and on the same context the yes was given on. `commitmentFor` runs
  // `decide` a second time on the same ordinal, which draws the same mood and costs the
  // campaign nothing — `ordinalsConsumed` above is already fixed and the second run's own
  // report is discarded (`RESOLUTION_SPEC` §2.4, `ADR-003`).
  const commitment =
    decision.result.selectedAction === Actions.Accept ? commitmentFor(context) : null;

  return { decision, moodOrdinals, ordinalsConsumed, commitment };
}

/**
 * Offers a contract to a hero and records what the hero decided.
 *
 * Checks run cheapest-first, and every one of them returns the state it was handed, by
 * reference. The order is not cosmetic: version and duplicate-id checks are properties
 * of the command itself, so they answer before anything is looked up in state, and the
 * decision — the only step that consumes randomness — happens once nothing can still
 * refuse it. A rejection that had already advanced the RNG ordinal would make the
 * campaign's randomness depend on failed commands.
 */
export function proposeContractToHero(
  state: GameState,
  command: ProposeContractToHero
): CommandResult {
  if (command.expectedStateVersion !== state.metadata.stateVersion) {
    return rejected(state, RejectionCodes.StaleState);
  }

  if (state.appliedCommandIds.has(command.commandId)) {
    return rejected(state, RejectionCodes.DuplicateCommand);
  }

  const hero = state.heroes.get(command.heroId);
  if (hero === undefined) {
    return rejected(state, RejectionCodes.UnknownHero);
  }

  const contract = state.contracts.get(command.contractId);
  if (contract === undefined) {
    return rejected(state, RejectionCodes.UnknownContract);
  }

  if (contract.status !== ContractStatus.Offered) {
    return rejected(state, RejectionCodes.ContractAlreadyResolved);
  }

  // §3.1, §6: only the offer's key hero may answer while the package is a draft —
  // everyone else's turn is `pollCrew`, once the package is `locked` (Task 13), not
  // before. `keyHero` is `null` until the first `composeOffer`, so this refuses every
  // hero, key or not, until a package actually names one — a hero cannot be the key
  // hero of an offer nobody has composed yet.
  if (contract.offer.phase === OfferPhase.Draft && command.heroId !== contract.offer.keyHero) {
    return rejected(state, RejectionCodes.NotTheKeyHero);
  }

  if (contract.offer.respondedBy.has(command.heroId)) {
    return rejected(state, RejectionCodes.AlreadyResponded);
  }

  const { decision, moodOrdinals, ordinalsConsumed, commitment } = decideHeroResponse(
    state,
    hero,
    contract
  );
  const accepted = decision.result.selectedAction === Actions.Accept;

  // Declining adds the hero to `offer.respondedBy` and leaves the offer open — the
  // contract's own status is about the contract, not about who said no to it. Without
  // that, the first refusal would remove the offer from everyone else and a campaign
  // could never show two heroes disagreeing about the same job.
  //
  // `crewed` means what it says: every seat filled, not merely one hero among several
  // saying yes — so the transition reads `acceptedBy.size` against `requiredCrew`, not
  // the single accepted flag from this one response.
  const acceptedBy = accepted
    ? contract.offer.acceptedBy.add(command.heroId)
    : contract.offer.acceptedBy;
  // Routed through `createContractState` — the one door a `ContractState` is built or
  // rebuilt through (`offer-state.ts`) — rather than a plain spread. §3.1's own gate
  // just above is what makes this safe: only the key hero can ever land in
  // `respondedBy` while `phase = 'draft'`, so `respondedBy ⊆ {keyHero}` cannot be
  // broken by the transition this function performs.
  const respondedContract = createContractState({
    ...contract,
    status: acceptedBy.size >= contract.requiredCrew ? ContractStatus.Crewed : contract.status,
    offer: {
      ...contract.offer,
      acceptedBy,
      commitments: withCommitmentFor(contract.offer, command.heroId, commitment),
      respondedBy: contract.offer.respondedBy.add(command.heroId)
    },
    moodOrdinals
  });

  const domainEvent: DomainEvent = {
    kind: accepted ? 'hero_accepted_contract' : 'hero_declined_contract',
    eventId: state.metadata.nextEventId,
    logicalTime: state.metadata.logicalTime,
    causalTraceId: decision.result.trace.traceId,
    heroId: command.heroId,
    contractId: command.contractId
  };

  // The spread carries the event's effects; `withEvent` carries the transition. Both, in
  // that order, never one instead of the other. Heroes answering an offer all happen
  // within the campaign's current logical time; advancing the clock is a tick's job, not
  // a proposal's, and `withEvent` allows equal times for exactly this reason.
  const nextState = withEvent(
    {
      ...state,
      contracts: state.contracts.set(respondedContract.id, respondedContract),
      appliedCommandIds: state.appliedCommandIds.add(command.commandId)
    },
    domainEvent,
    decision.result.trace,
    ordinalsConsumed
  );

  return fromDecisions(nextState, [domainEvent], [decision.result]);
}

/**
 * Revises a contract's negotiation package (`NEGOTIATION_SPEC` §3.1, §3.3, §6.1).
 *
 * Checks run in exactly the order §6.1 states — cheaper and more general first,
 * value bounds last — because the order is itself part of the canonical result: two
 * broken preconditions at once must answer with the *same* one, not whichever this
 * function happened to test first.
 *
 * **Bounds are checked before `createContractState` ever sees the revised
 * contract.** That function is the one door a `ContractState` is built or rebuilt
 * through, and it *throws* on an invariant violation — including the tag ceiling a
 * bad `methodTag` could push past. §6.1 requires an out-of-bounds package to be
 * *refused* (`rejected.offer_terms_out_of_bounds`, the same state back by
 * reference), not to surface as an exception, so every bound the command itself can
 * violate is checked here first. A content defect (a six-tag contract that also
 * declares `negotiableTags`) still throws — that is a loudly-broken authoring
 * invariant, not a value this command's own caller chose.
 */
/**
 * The commitment recorded for a hero who has just answered (`RESOLUTION_SPEC` §2.4).
 *
 * `null` records nothing, and there are two ways to get one: the hero declined, or he
 * accepted into a crew that was already full. Both mean no seat was taken, and
 * `commitments.keys() === acceptedBy` is what makes that the same thing — a commitment is
 * a fact about an acceptance that landed.
 *
 * The *value* is decided by `commitmentFor`, at the moment of the answer, on the context
 * the answer was given on; this function only writes it down.
 */
function withCommitmentFor(
  offer: OfferState,
  heroId: HeroId,
  commitment: CommitmentState | null
): SortedMap<HeroId, CommitmentState> {
  return commitment === null ? offer.commitments : offer.commitments.set(heroId, commitment);
}

export function composeOffer(state: GameState, command: ComposeOffer): CommandResult {
  if (command.expectedStateVersion !== state.metadata.stateVersion) {
    return rejected(state, RejectionCodes.StaleState);
  }

  if (state.appliedCommandIds.has(command.commandId)) {
    return rejected(state, RejectionCodes.DuplicateCommand);
  }

  const contract = state.contracts.get(command.contractId);
  if (contract === undefined) {
    return rejected(state, RejectionCodes.UnknownContract);
  }

  const keyHero = state.heroes.get(command.keyHero);
  if (keyHero === undefined) {
    return rejected(state, RejectionCodes.UnknownHero);
  }

  // §3.1's table: composeOffer is legal in `draft`, or in `locked` for as long as the
  // crew it had has not filled. Once the crew has filled, the deal is struck and a
  // revision would undo it out from under `settleContract`.
  //
  // **Ahead of the crew rules, not behind them** (`NEGOTIATION_SPEC` §6.1 step 4): phase
  // and status come before a command's own private preconditions, and the crew rules are
  // private to `composeOffer` (§3.3 step 2). A struck deal answers that it is struck —
  // reporting `crew_size_mismatch` for a package no revision could touch would name the
  // wrong one of two broken things, and the order of refusals is part of the canonical
  // result of a command, not an implementation detail.
  const revisable =
    contract.offer.phase === OfferPhase.Draft ||
    (contract.offer.phase === OfferPhase.Locked && contract.status === ContractStatus.Offered);
  if (!revisable) {
    return rejected(state, RejectionCodes.OfferNotInDraft);
  }

  // The crew, checked here rather than in `createContractState`: hero *existence* needs
  // the roster, and the constructor never receives it (`RESOLUTION_SPEC` §2.5's second
  // column). Size first, from the distinct count — a repeated hero is two names for one
  // person, so it is a crew of one however long the array was, and reporting it as a
  // size mismatch names what the caller actually did. Existence last, which is §3.3
  // step 2's own order for these three.
  const invited = SortedSet.from(compareHeroIds, command.invited);
  if (invited.size !== contract.requiredCrew) {
    return rejected(state, RejectionCodes.CrewSizeMismatch);
  }

  if (!invited.has(command.keyHero)) {
    return rejected(state, RejectionCodes.KeyHeroNotInvited);
  }

  for (const heroId of invited.values()) {
    if (!state.heroes.has(heroId)) {
      return rejected(state, RejectionCodes.UnknownHero);
    }
  }

  // `Number.isInteger` first, and separately from the range: `x < 0 || x > patronFee`
  // is false for `Number.NaN` on both sides, so a NaN advance would otherwise read as
  // "in range" and settle into state, poison the decision arithmetic downstream, and
  // only ever be caught by `z.int()` at the save boundary — an exception, not the
  // refusal §6.1 requires. §3.3's range is inclusive of integers only.
  if (
    !Number.isInteger(command.advance) ||
    command.advance < 0 ||
    command.advance > contract.patronFee
  ) {
    return rejected(state, RejectionCodes.OfferTermsOutOfBounds);
  }

  if (
    !Number.isInteger(command.promisedBonus) ||
    command.promisedBonus < 0 ||
    command.promisedBonus > contract.patronFee
  ) {
    return rejected(state, RejectionCodes.OfferTermsOutOfBounds);
  }

  if (command.methodTag !== null) {
    // `undefined` and an empty set both read as "nothing negotiable" — see
    // `ContractState.negotiableTags`'s own doc for why the field is optional.
    const negotiableTags = contract.negotiableTags ?? SortedSet.empty<ContentId>(compareContentIds);
    if (!negotiableTags.has(command.methodTag)) {
      return rejected(state, RejectionCodes.OfferTermsOutOfBounds);
    }

    // §2.4's ceiling: authored `tags` plus one chosen method tag must not exceed
    // `MAX_TAGS_PER_CONTRACT`. `negotiableTags` membership alone does not guarantee
    // this — a contract can author six tags *and* declare a disjoint, valid
    // `negotiable_tags` pair, and nothing at content-load time refuses that
    // combination (it is caught by the shipped-content check, `Task 18`, not the
    // loader). Left unchecked here, `createContractState` below would throw instead
    // of refusing — the hazard `Task 6`'s review handed this task by name.
    if (contract.tags.add(command.methodTag).size > MAX_TAGS_PER_CONTRACT) {
      return rejected(state, RejectionCodes.OfferTermsOutOfBounds);
    }
  }

  // A revision always answers `version + 1` with both answer sets empty (`NEGOTIATION_SPEC`
  // §6.1's starting-`OfferState` shape, carried forward by every later revision): an
  // acceptance given to the package this replaces is not an acceptance of this one.
  const revisedOffer = {
    version: contract.offer.version + 1,
    keyHero: command.keyHero,
    advance: command.advance,
    methodTag: command.methodTag,
    promisedBonus: command.promisedBonus,
    phase: OfferPhase.Draft,
    invited,
    respondedBy: SortedSet.empty<HeroId>(compareHeroIds),
    acceptedBy: SortedSet.empty<HeroId>(compareHeroIds),
    // Emptied with the answers, and for the same reason: a commitment is computed
    // against the package that was answered (`RESOLUTION_SPEC` §2.4), so it cannot
    // outlive that package any more than the answer itself can.
    commitments: SortedMap.empty<HeroId, CommitmentState>(compareHeroIds)
  };

  // Clearing every answer empties `acceptedBy` too, so the contract can never still
  // read `crewed` after a revision — it goes back to `offered`, `requiredCrew` being
  // at least 1 (`REQUIRED_CREW_MIN`) rules out the degenerate case of a contract
  // already crewed with zero acceptances.
  const revisedContract = createContractState({
    ...contract,
    status: ContractStatus.Offered,
    offer: revisedOffer
  });

  const domainEvent: DomainEvent = {
    kind: 'offer_revised',
    eventId: state.metadata.nextEventId,
    logicalTime: state.metadata.logicalTime,
    causalTraceId: null,
    contractId: command.contractId
  };

  // No decision, no trace, no randomness spent — composing an offer is the player's
  // own choice (`NEGOTIATION_SPEC` §3.3 point 3).
  const nextState = withEvent(
    {
      ...state,
      contracts: state.contracts.set(revisedContract.id, revisedContract),
      appliedCommandIds: state.appliedCommandIds.add(command.commandId)
    },
    domainEvent,
    null,
    0n
  );

  return fromEvent(nextState, domainEvent);
}

/**
 * Freezes a contract's current negotiation package (`NEGOTIATION_SPEC` §3.1, §3.3,
 * §6.1). Where a package stops being a draft the player can still walk away from and
 * becomes money the guild has committed.
 *
 * Checks run in exactly §6.1's order: the three general checks, then this command's
 * own phase and acceptance preconditions (§3.1's table — `lockOffer` is legal only
 * against a `draft` package whose key hero is in `acceptedBy`), and the treasury
 * check last, because it is the most expensive and the only one that reads every
 * other contract in `state.contracts` (`canCover`, `negotiation/commitments.ts`).
 * `lockOffer` takes no `advance`, `promisedBonus` or `methodTag` of its own — every
 * term it locks already lives on the package `composeOffer` built — so there is no
 * value-bounds step between the acceptance check and the treasury one; §6.1's step 5
 * has nothing to check for this command.
 *
 * **The treasury is checked against the full crew, not against who has answered.**
 * `canCover` compares `commitmentOf(contract)` — `advance × requiredCrew +
 * promisedBonus` — against the treasury net of every other `locked` contract's own
 * commitment (`reservedCommitments`). A contract still filling its crew has fewer
 * acceptances than seats, and reserving against the smaller number would let a
 * `locked` offer with empty seats free money it will owe the moment `pollCrew`
 * (Task 13) actually fills them.
 *
 * **A single-seat contract is already `crewed` by the time this runs.**
 * `proposeContractToHero` moves `status` to `Crewed` the moment `acceptedBy.size`
 * reaches `requiredCrew` — before `lockOffer` ever sees the contract, when
 * `requiredCrew` is 1 and the key hero's own draft acceptance is the whole crew.
 * This command does not recompute `status`; it only moves `phase`, so a contract
 * already `crewed` in `draft` is still `crewed` once `locked`.
 */
export function lockOffer(state: GameState, command: LockOffer): CommandResult {
  if (command.expectedStateVersion !== state.metadata.stateVersion) {
    return rejected(state, RejectionCodes.StaleState);
  }

  if (state.appliedCommandIds.has(command.commandId)) {
    return rejected(state, RejectionCodes.DuplicateCommand);
  }

  const contract = state.contracts.get(command.contractId);
  if (contract === undefined) {
    return rejected(state, RejectionCodes.UnknownContract);
  }

  // §3.1's table: `lockOffer` is legal only against a `draft` package. Checked
  // before the acceptance test below on purpose — `lockOffer` never clears
  // `acceptedBy`, so a package already `locked` would still show its key hero
  // accepted, and without this check a second lock of the same package would pass
  // straight through to the treasury check instead of being refused here.
  if (contract.offer.phase !== OfferPhase.Draft) {
    return rejected(state, RejectionCodes.OfferNotInDraft);
  }

  // §3.1, §3.3: the key hero must have accepted this exact version. `composeOffer`
  // empties `acceptedBy` on every revision, so an acceptance given to a package the
  // player has since changed can never satisfy this — there is nothing else to check
  // to tell "nobody has answered yet" apart from "the version that answered is gone".
  const { keyHero, acceptedBy } = contract.offer;
  if (keyHero === null || !acceptedBy.has(keyHero)) {
    return rejected(state, RejectionCodes.KeyHeroHasNotAccepted);
  }

  // §6.1's step 6, last and most expensive because it is the only check reading
  // every other contract in state, not just this one.
  if (!canCover(state, contract)) {
    return rejected(state, RejectionCodes.TreasuryCannotCoverTheOffer);
  }

  // Routed through `createContractState` — the one door a `ContractState` is built
  // or rebuilt through — even though nothing about moving `phase` alone from `draft`
  // to `locked` can violate an invariant this function checks: every other field is
  // carried forward untouched, and `phase = 'draft' ⇒ respondedBy ⊆ {keyHero}` stops
  // applying the moment phase is no longer `draft`.
  const lockedContract = createContractState({
    ...contract,
    offer: { ...contract.offer, phase: OfferPhase.Locked }
  });

  const domainEvent: DomainEvent = {
    kind: 'offer_locked',
    eventId: state.metadata.nextEventId,
    logicalTime: state.metadata.logicalTime,
    causalTraceId: null,
    contractId: command.contractId
  };

  // No decision, no trace, no randomness spent — locking an offer is the player's
  // own act (`NEGOTIATION_SPEC` §3.3): the acceptance it locks against already has
  // its own trace, recorded when the key hero gave it.
  const nextState = withEvent(
    {
      ...state,
      contracts: state.contracts.set(lockedContract.id, lockedContract),
      appliedCommandIds: state.appliedCommandIds.add(command.commandId)
    },
    domainEvent,
    null,
    0n
  );

  return fromEvent(nextState, domainEvent);
}

/**
 * Lets the rest of the roster answer a contract's locked package, once each, in one
 * command (`NEGOTIATION_SPEC` §3.1, §3.3, §6.1) — the reason `CommandResult.decisions`
 * is a list (Task 5) rather than a single field: `settleContract` is the only other
 * command still to come, and this is the one that produces several decisions from a
 * single player action.
 *
 * Checks run in §6.1's order: the three general checks, then this command's own
 * phase and status preconditions (§3.1's table — `pollCrew` is legal only against a
 * `locked` package whose crew has not already filled, and only against a roster
 * that still has somebody left to ask — §6's own edge-case table sends an unfilled
 * crew back to `composeOffer` for a new package, not to a second poll of the one
 * already fully answered).
 *
 * **The poll asks `offer.invited`, in `HeroId` order, skipping anyone already in
 * `offer.respondedBy`.** `m1-negotiation/1` asked `state.heroes.keys()` — the whole
 * remaining roster; the amendment of 2026-08-25 (`DEC-012`, `NEGOTIATION_SPEC` §3.3)
 * narrowed it to the package's own crew, and the order and the skip survived the change.
 * The seat-allocation paragraph below is what did not go away with it: a crew that *is*
 * the package cannot overflow, so `hasRoom` is now a guard against hand-built state
 * rather than a rule the poll can reach. That excludes the key
 * hero, who answered this exact version before `lockOffer` froze it and is not asked
 * again: `lockOffer` never raises the offer's version, so the acceptance the package
 * was locked on is an answer to the package `pollCrew` is polling, not a stale one.
 *
 * **The poll does not stop once the crew's seats are full**
 * (`NEGOTIATION_SPEC` §3.3): stopping early would make a hero's answer depend on how
 * many seats happened to remain when their turn came, not on their own character,
 * which `DEC-001` does not allow. Every hero not yet in `respondedBy` gets a full
 * decision and a trace; only the first `requiredCrew` acceptances, in the same
 * `HeroId` order, take a seat in `acceptedBy` — `hasRoom` below is recomputed on
 * every iteration precisely so a seat already taken by an earlier hero in this same
 * poll cannot be taken twice.
 *
 * **Each decision gets its own `drawsConsumed`, threaded one hero at a time.**
 * `decideHeroResponse` reports `0n` for a decision the gate closed or whose mood was
 * already pinned by an earlier answer to this contract, and the real cost of a fresh
 * draw otherwise — `pollCrew`'s total across the whole roster is the sum of those,
 * never a flat per-hero constant. Threading `currentState`/`currentContract` through
 * the loop, rather than collecting decisions first and applying them after, is what
 * lets a later hero's decision see an earlier one's acceptance already in
 * `acceptedBy` — the same connections motive `proposeContractToHero` already reads
 * this way.
 */
export function pollCrew(state: GameState, command: PollCrew): CommandResult {
  if (command.expectedStateVersion !== state.metadata.stateVersion) {
    return rejected(state, RejectionCodes.StaleState);
  }

  if (state.appliedCommandIds.has(command.commandId)) {
    return rejected(state, RejectionCodes.DuplicateCommand);
  }

  const contract = state.contracts.get(command.contractId);
  if (contract === undefined) {
    return rejected(state, RejectionCodes.UnknownContract);
  }

  // §3.1's table: `pollCrew` is legal only once a package is `locked`. Checked before
  // the crew-status check below, the same order `lockOffer` checks its own phase
  // before its own acceptance precondition: a package that is not locked at all
  // answers with this rejection regardless of what its (draft) `acceptedBy` holds.
  if (contract.offer.phase !== OfferPhase.Locked) {
    return rejected(state, RejectionCodes.OfferNotLocked);
  }

  // §3.1, §6: `requiredCrew = 1` fills the crew from the key hero's own draft
  // acceptance, before `pollCrew` ever runs — there is nobody left whose answer
  // could still change anything, so this refuses rather than iterating zero heroes
  // silently.
  if (contract.status === ContractStatus.Crewed) {
    return rejected(state, RejectionCodes.CrewAlreadyFilled);
  }

  // §6's own edge-case table sends an unfilled crew back to `composeOffer` for a
  // new package, not to a second `pollCrew` of the one already fully answered — a
  // roster every hero has already responded to has nothing left this command could
  // still decide. Refused here, before the loop below ever runs, rather than let a
  // legal, applied command append zero events: `validate-game-state.ts`'s
  // `checkCounters` relies on every applied command producing at least one
  // (`appliedCommandIds.size <= history.length`), and a `pollCrew` that could apply
  // with nobody left to ask is what would have broken that.
  //
  // **`invited`, not the whole roster** (`DEC-012` as amended 2026-08-25,
  // `RESOLUTION_SPEC` §8). The crew is part of the package now: a poll asks the people
  // this offer names and nobody else, so "nobody left" means every *invited* hero has
  // answered — not every hero in the guild.
  if (contract.offer.invited.values().every((heroId) => contract.offer.respondedBy.has(heroId))) {
    return rejected(state, RejectionCodes.NobodyLeftToPoll);
  }

  let currentState = state;
  let currentContract = contract;
  const events: DomainEvent[] = [];
  const decisions: DecisionResult[] = [];

  // `invited` rather than the roster, and read off the *original* contract: the set is
  // fixed for the life of a package, so iterating it cannot be disturbed by what an
  // earlier hero in this same poll did. Its own order is `compareHeroIds`, the same
  // order the roster gave, so who is asked first has not changed.
  for (const heroId of contract.offer.invited.values()) {
    if (currentContract.offer.respondedBy.has(heroId)) {
      continue;
    }

    const hero = heroOf(currentState, heroId);
    const { decision, moodOrdinals, ordinalsConsumed, commitment } = decideHeroResponse(
      currentState,
      hero,
      currentContract
    );

    const accepted = decision.result.selectedAction === Actions.Accept;
    // A seat is taken only while room remains — recomputed against
    // `currentContract`, which already reflects every seat an earlier hero in this
    // same poll took, so the cap applies across the whole poll, not per hero.
    const hasRoom = currentContract.offer.acceptedBy.size < currentContract.requiredCrew;
    const acceptedBy =
      accepted && hasRoom
        ? currentContract.offer.acceptedBy.add(heroId)
        : currentContract.offer.acceptedBy;

    currentContract = createContractState({
      ...currentContract,
      status:
        acceptedBy.size >= currentContract.requiredCrew
          ? ContractStatus.Crewed
          : currentContract.status,
      offer: {
        ...currentContract.offer,
        acceptedBy,
        // `hasRoom` gates the record the same way it gates the seat: a hero who agreed to
        // a crew already full took none, so there is no acceptance for a commitment to be
        // a fact about (`RESOLUTION_SPEC` §2.5's `commitments.keys() === acceptedBy`).
        commitments: withCommitmentFor(currentContract.offer, heroId, hasRoom ? commitment : null),
        respondedBy: currentContract.offer.respondedBy.add(heroId)
      },
      moodOrdinals
    });

    const domainEvent: DomainEvent = {
      kind: accepted ? 'hero_accepted_contract' : 'hero_declined_contract',
      eventId: currentState.metadata.nextEventId,
      logicalTime: currentState.metadata.logicalTime,
      causalTraceId: decision.result.trace.traceId,
      heroId,
      contractId: command.contractId
    };

    // Every hero answering within this one command shares the campaign's current
    // logical time — the same reason `proposeContractToHero` allows it: advancing
    // the clock is a tick's job, not a poll's.
    currentState = withEvent(
      {
        ...currentState,
        contracts: currentState.contracts.set(currentContract.id, currentContract)
      },
      domainEvent,
      decision.result.trace,
      ordinalsConsumed
    );

    events.push(domainEvent);
    decisions.push(decision.result);
  }

  currentState = {
    ...currentState,
    appliedCommandIds: currentState.appliedCommandIds.add(command.commandId)
  };

  return fromDecisions(currentState, events, decisions);
}

/**
 * Every accepted hero's `HeroState`, updated for a promise the guild just broke
 * (`NEGOTIATION_SPEC` §3.3): the key hero — the one the promise was made to —
 * stops believing the guild's word and carries the larger share of the grievance;
 * every other accepted hero carries a witness's smaller share. Factored out of
 * `settleContract` itself so that function's own body reads as the money movement
 * it mostly is, with the one branch that touches heroes at all named for what it
 * does.
 *
 * `contract.offer.keyHero` is read as non-null without a fallback: `promisedBonus
 * > 0 ⇒ keyHero ≠ null` is enforced by `createContractState` on every
 * `ContractState` this package can build in memory (`NEGOTIATION_SPEC` §2.1), and
 * `settleContract` only calls this when `offer.promisedBonus > 0` — so a `null`
 * here would mean that invariant had already broken upstream of this call, which
 * this function reports loudly rather than silently crediting the bonus to nobody.
 */
function applyBrokenPromise(
  state: GameState,
  contract: ContractState
): SortedMap<HeroId, HeroState> {
  const { offer } = contract;
  const keyHeroId = offer.keyHero;

  if (keyHeroId === null) {
    throw new Error(
      `Contract '${contract.id}' promises a bonus of ${String(offer.promisedBonus)} but names no ` +
        'keyHero; createContractState (NEGOTIATION_SPEC §2.1) requires promisedBonus > 0 to imply ' +
        'keyHero !== null on every ContractState this package can build, so this state should have ' +
        'been unreachable.'
    );
  }

  const { victim: victimGrievance, witness: witnessGrievance } = grievanceForBrokenPromise(
    offer.promisedBonus,
    contract.patronFee
  );

  const victim = heroOf(state, keyHeroId);
  let heroes = state.heroes.set(victim.id, {
    ...victim,
    believesGuildPromises: false,
    grievance: Math.min(victim.grievance + victimGrievance, GRIEVANCE_MAX)
  });

  // Every hero who accepted this offer, except the victim, is a witness
  // (`NEGOTIATION_SPEC` §3.3: "Свидетель определяется по acceptedBy на момент
  // расчёта: он был в отряде, когда гильдия не заплатила"). Read off the *original*
  // `state.heroes`, not the map this loop is building, so a witness read after the
  // victim's own update is unaffected by it — the two updates are independent, and
  // reading through `heroes` here would only matter if a hero could be both, which
  // `acceptedBy` being a `SortedSet` (no duplicate ids) already rules out.
  for (const heroId of offer.acceptedBy.values()) {
    if (heroId === keyHeroId) {
      continue;
    }

    const witness = heroOf(state, heroId);
    heroes = heroes.set(witness.id, {
      ...witness,
      grievance: Math.min(witness.grievance + witnessGrievance, GRIEVANCE_MAX)
    });
  }

  return heroes;
}

/**
 * Settles a contract's locked, crewed package (`NEGOTIATION_SPEC` §3.1, §3.3,
 * §6.1) — the point every negotiation this build can carry out ends at: money
 * moves exactly once, here, out of the campaign treasury, and a broken promise
 * costs what it was worth.
 *
 * Checks run in §6.1's order: the three general checks, then this command's own
 * phase and status preconditions. `AlreadySettled` is checked *before*
 * `CrewNotFilled` — a settled offer's `phase` is `settled`, which also fails the
 * `phase !== 'locked'` half of the `CrewNotFilled` test below, so without this
 * ordering a second `settleContract` against an already-settled contract would
 * answer with the wrong one of the two codes this command owns.
 *
 * **The formula (`NEGOTIATION_SPEC` §3.3, as `m1-resolution/1` implements it — the
 * patron's share becomes a function of the outcome's grade in `RESOLUTION_SPEC` §5.3):**
 *
 * ```text
 * treasury += patronFee − advance × acceptedBy.size − (pay ? promisedBonus : 0)
 * ```
 *
 * The patron pays in full here because there is no outcome to pay against yet. Under the
 * amendment of 2026-08-25 the first term becomes a share of `patronFee` set by the
 * outcome's grade (`RESOLUTION_SPEC` §5.3), and this command additionally refuses a
 * contract that has not been resolved — both land with the resolution engine.
 *
 * `acceptedBy.size`, not `requiredCrew` — the two are equal here by construction
 * (`ContractStatus.Crewed ⇔ acceptedBy.size = requiredCrew`, `NEGOTIATION_SPEC`
 * §2.1, enforced by `createContractState`), but the formula pays the heroes who
 * actually joined the crew, which is what `acceptedBy` names.
 *
 * A bonus is paid only when the offer actually promised one *and* the player
 * chose to pay it — `offer.promisedBonus === 0` settles as `contract_settled`
 * regardless of `pay` (`NEGOTIATION_SPEC` §6: "Расчёт без обещания — законен;
 * `pay` игнорируется, обид не возникает"), and no hero's `grievance` or
 * `believesGuildPromises` moves. A kept promise (`promisedBonus > 0`, `pay =
 * true`) settles as `contract_settled_promise_kept` and, likewise, touches no
 * hero — the guild kept its word, so there is nothing for §3.3's grievance
 * arithmetic to do. Only a broken promise (`promisedBonus > 0`, `pay = false`)
 * settles as `contract_settled_promise_broken` and runs
 * {@link applyBrokenPromise}.
 */
export function settleContract(state: GameState, command: SettleContract): CommandResult {
  if (command.expectedStateVersion !== state.metadata.stateVersion) {
    return rejected(state, RejectionCodes.StaleState);
  }

  if (state.appliedCommandIds.has(command.commandId)) {
    return rejected(state, RejectionCodes.DuplicateCommand);
  }

  const contract = state.contracts.get(command.contractId);
  if (contract === undefined) {
    return rejected(state, RejectionCodes.UnknownContract);
  }

  if (contract.offer.phase === OfferPhase.Settled) {
    return rejected(state, RejectionCodes.AlreadySettled);
  }

  // §3.1's table: `settleContract` is legal only against a `locked` package whose
  // contract has filled its crew. Covers both unready shapes at once — a package
  // still `draft` (never locked, or a single-seat contract the key hero already
  // filled but `lockOffer` has not yet frozen, `NEGOTIATION_SPEC` §6) and a
  // `locked` package `pollCrew` has not yet filled — because `settleContract`
  // owns no third code to tell them apart.
  if (contract.offer.phase !== OfferPhase.Locked || contract.status !== ContractStatus.Crewed) {
    return rejected(state, RejectionCodes.CrewNotFilled);
  }

  const { offer } = contract;
  const promised = offer.promisedBonus > 0;
  const paysBonus = promised && command.pay;

  const nextTreasury =
    state.treasury +
    contract.patronFee -
    offer.advance * offer.acceptedBy.size -
    (paysBonus ? offer.promisedBonus : 0);

  const heroes = promised && !command.pay ? applyBrokenPromise(state, contract) : state.heroes;

  const settledContract = createContractState({
    ...contract,
    offer: { ...offer, phase: OfferPhase.Settled }
  });

  const domainEvent: DomainEvent = {
    kind: !promised
      ? 'contract_settled'
      : command.pay
        ? 'contract_settled_promise_kept'
        : 'contract_settled_promise_broken',
    eventId: state.metadata.nextEventId,
    logicalTime: state.metadata.logicalTime,
    causalTraceId: null,
    contractId: command.contractId
  };

  // No decision, no trace, no randomness spent — settling is the player's own act
  // (`NEGOTIATION_SPEC` §3.3), the same reason `composeOffer` and `lockOffer`
  // spend none: whatever a hero decided about this offer is already recorded, on
  // the acceptance that put them in `acceptedBy`.
  const nextState = withEvent(
    {
      ...state,
      heroes,
      treasury: nextTreasury,
      contracts: state.contracts.set(settledContract.id, settledContract),
      appliedCommandIds: state.appliedCommandIds.add(command.commandId)
    },
    domainEvent,
    null,
    0n
  );

  return fromEvent(nextState, domainEvent);
}
