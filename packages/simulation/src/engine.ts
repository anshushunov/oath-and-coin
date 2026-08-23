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
import type { ProposeContractToHero } from './commands/propose-contract-to-hero.ts';
import { Actions } from './decisions/actions.ts';
import { decide } from './decisions/contract-decision-rule.ts';
import type { HeldTrait } from './decisions/held-trait.ts';
import type { DomainEvent } from './events/domain-event.ts';
import { compareContentIds, type ContentId } from './ids/content-id.ts';
import { compareHeroIds, type HeroId } from './ids/hero-id.ts';
import { ContractStatus } from './state/contract-state.ts';
import { withEvent, type GameState } from './state/game-state.ts';
import { createContractState, MAX_TAGS_PER_CONTRACT, OfferPhase } from './state/offer-state.ts';

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
  const knownMoodOrdinal = contract.moodOrdinals.get(command.heroId);
  const decisionOrdinal = knownMoodOrdinal ?? state.metadata.nextDecisionOrdinal;

  const decision = decide({
    hero,
    contract,
    traits,
    crew,
    campaignSeed: state.metadata.campaignSeed,
    decisionOrdinal,
    traceId: state.metadata.nextTraceId
  });

  const accepted = decision.result.selectedAction === Actions.Accept;

  // A mood ordinal is recorded only on the draw that actually happened: the gate
  // closes before any mood is drawn (`decide`'s own `blockedBy` says so), and a hero
  // who already has a recorded ordinal keeps exactly that one — a later revision that
  // stops violating this hero's principle must still read the mood already drawn, not
  // a fresh one drawn now that nothing blocks it. Recording on the gated path would
  // make the record mean "a draw happened" for a hero it never did.
  const gateClosed = decision.result.trace.blockedBy.length > 0;
  const moodDrawnJustNow = knownMoodOrdinal === undefined && !gateClosed;
  const moodOrdinals = moodDrawnJustNow
    ? contract.moodOrdinals.set(command.heroId, decisionOrdinal)
    : contract.moodOrdinals;
  const ordinalsConsumed = knownMoodOrdinal !== undefined ? 0n : decision.ordinalsConsumed;

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
  const revisable =
    contract.offer.phase === OfferPhase.Draft ||
    (contract.offer.phase === OfferPhase.Locked && contract.status === ContractStatus.Offered);
  if (!revisable) {
    return rejected(state, RejectionCodes.OfferNotInDraft);
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
    respondedBy: SortedSet.empty<HeroId>(compareHeroIds),
    acceptedBy: SortedSet.empty<HeroId>(compareHeroIds)
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
