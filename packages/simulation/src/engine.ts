import { SortedMap } from './collections/sorted-map.ts';
import { SortedSet } from './collections/sorted-set.ts';
import {
  rejected,
  fromDecisions,
  RejectionCodes,
  type CommandResult
} from './commands/command-result.ts';
import type { ProposeContractToHero } from './commands/propose-contract-to-hero.ts';
import { Actions } from './decisions/actions.ts';
import { decide } from './decisions/contract-decision-rule.ts';
import type { HeldTrait } from './decisions/held-trait.ts';
import type { DomainEvent } from './events/domain-event.ts';
import { compareContentIds, type ContentId } from './ids/content-id.ts';
import { compareHeroIds, type HeroId } from './ids/hero-id.ts';
import { ContractStatus } from './state/contract-state.ts';
import { withEvent, type GameState } from './state/game-state.ts';

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

  const decision = decide({
    hero,
    contract,
    traits,
    crew,
    campaignSeed: state.metadata.campaignSeed,
    decisionOrdinal: state.metadata.nextDecisionOrdinal,
    traceId: state.metadata.nextTraceId
  });

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
  const respondedContract = {
    ...contract,
    status: acceptedBy.size >= contract.requiredCrew ? ContractStatus.Crewed : contract.status,
    offer: {
      ...contract.offer,
      acceptedBy,
      respondedBy: contract.offer.respondedBy.add(command.heroId)
    }
  };

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
    decision.ordinalsConsumed
  );

  return fromDecisions(nextState, [domainEvent], [decision.result]);
}
