using System.Collections.Immutable;
using OathAndCoin.Simulation.Commands;
using OathAndCoin.Simulation.Decisions;
using OathAndCoin.Simulation.Events;
using OathAndCoin.Simulation.Ids;
using OathAndCoin.Simulation.State;

namespace OathAndCoin.Simulation;

/// <summary>
/// Applies commands to a <see cref="GameState"/> and returns the state that
/// results. Holds nothing: no generator, no counter, no cache, not even a
/// reference to the campaign it is operating on.
/// </summary>
/// <remarks>
/// <para>
/// Statelessness is the whole reason replay works. Everything a decision needs
/// — the seed, the RNG ordinal, the next trace id, the version — is read from
/// the state passed in, so <c>Apply(state, command)</c> is a function: the same
/// pair produces the same result on a fresh engine, on a reused one, and on a
/// process that has just loaded a save and knows nothing about what came
/// before. The moment anything lives in a field here, "same seed, same result"
/// would additionally depend on how many times this instance had been called,
/// which is not something a save file can record.
/// <c>ProposeContractTests.EngineHasNoMutableState</c> asserts the absence of
/// fields by reflection, because the property is invisible in a diff that adds
/// one.
/// </para>
/// <para>
/// A type with no state could have been a static class. It is an instance type
/// so that a later ruleset variation (difficulty rules, a modded ruleset) can
/// be a different <em>instance</em> rather than a static switch — and so the
/// no-fields test has something to be about.
/// </para>
/// </remarks>
public sealed class SimulationEngine
{
    /// <summary>
    /// Offers a contract to a hero and records what the hero decided.
    /// </summary>
    /// <remarks>
    /// Checks run cheapest-first, and every one of them returns the state it
    /// was handed, by reference. The order is not cosmetic: version and
    /// duplicate-id checks are properties of the command itself, so they
    /// answer before anything is looked up in state, and the decision — the
    /// only step that consumes randomness — happens once nothing can still
    /// refuse it. A rejection that had already advanced the RNG ordinal would
    /// make the campaign's randomness depend on failed commands.
    /// </remarks>
    public CommandResult Apply(GameState state, ProposeContractToHero command)
    {
        ArgumentNullException.ThrowIfNull(state);
        ArgumentNullException.ThrowIfNull(command);

        if (command.ExpectedStateVersion != state.Metadata.StateVersion)
        {
            return CommandResult.Rejected(state, RejectionCodes.StaleState);
        }

        if (state.AppliedCommandIds.Contains(command.CommandId))
        {
            return CommandResult.Rejected(state, RejectionCodes.DuplicateCommand);
        }

        if (!state.Heroes.TryGetValue(command.HeroId, out var hero))
        {
            return CommandResult.Rejected(state, RejectionCodes.UnknownHero);
        }

        if (!state.Contracts.TryGetValue(command.ContractId, out var contract))
        {
            return CommandResult.Rejected(state, RejectionCodes.UnknownContract);
        }

        if (contract.Status != ContractStatus.Offered)
        {
            return CommandResult.Rejected(state, RejectionCodes.ContractAlreadyResolved);
        }

        if (contract.RespondedBy.Contains(command.HeroId))
        {
            return CommandResult.Rejected(state, RejectionCodes.AlreadyResponded);
        }

        // The hero's traits, resolved through the campaign's own trait
        // rulebook (GameState.TraitRules — filled once, at content-load
        // time, on the other side of the boundary this engine cannot cross;
        // see the remarks there). Sorted by id, not merely copied in
        // HeroState.Traits' authored order, because the rule asserts that
        // ordering rather than re-sorting it itself.
        var traitIds = ImmutableSortedSet.CreateRange(hero.Traits);
        var traitsBuilder = ImmutableArray.CreateBuilder<HeldTrait>(traitIds.Count);
        foreach (var traitId in traitIds)
        {
            traitsBuilder.Add(state.TraitRules[traitId]);
        }

        // Comrades already committed to this same offer — exactly
        // contract.AcceptedBy, resolved to the content id the rule matches
        // relationships against. Built from what already lives in GameState,
        // no content lookup required, so every hero this decision's own
        // bonds walk (ContractDecisionRule.Decide, via AcceptedBy) finds an
        // entry here — an accepted hero missing from Crew is exactly the
        // context-assembly bug that rule guards against.
        var crewBuilder = ImmutableSortedDictionary.CreateBuilder<HeroId, ContentId>();
        foreach (var acceptedHeroId in contract.AcceptedBy)
        {
            crewBuilder.Add(acceptedHeroId, state.Heroes[acceptedHeroId].Definition);
        }

        var context = new DecisionContext
        {
            Hero = hero,
            Contract = contract,
            Traits = traitsBuilder.ToImmutable(),
            Crew = crewBuilder.ToImmutable(),
            CampaignSeed = state.Metadata.CampaignSeed,
            DecisionOrdinal = state.Metadata.NextDecisionOrdinal,
            TraceId = state.Metadata.NextTraceId,
        };

        var decision = ContractDecisionRule.Decide(context);

        var accepted = decision.Result.SelectedAction == Actions.Accept;

        // Declining adds the hero to RespondedBy and leaves the offer open —
        // the contract's own status is about the contract, not about who said
        // no to it (see ContractStatus). Without that, the first refusal would
        // remove the offer from everyone else and a campaign could never show
        // two heroes disagreeing about the same job.
        //
        // Crewed means what its own doc comment says: every seat filled, not
        // merely one hero among several saying yes — so the transition reads
        // AcceptedBy.Count against RequiredCrew, not the single accepted
        // flag from this one response.
        var acceptedBy = accepted ? contract.AcceptedBy.Add(command.HeroId) : contract.AcceptedBy;
        var respondedContract = contract with
        {
            Status = acceptedBy.Count >= contract.RequiredCrew ? ContractStatus.Crewed : contract.Status,
            AcceptedBy = acceptedBy,
            RespondedBy = contract.RespondedBy.Add(command.HeroId),
        };

        DomainEvent domainEvent = accepted
            ? new HeroAcceptedContract(
                state.Metadata.NextEventId,
                state.Metadata.LogicalTime,
                decision.Result.Trace.TraceId,
                command.HeroId,
                command.ContractId)
            : new HeroDeclinedContract(
                state.Metadata.NextEventId,
                state.Metadata.LogicalTime,
                decision.Result.Trace.TraceId,
                command.HeroId,
                command.ContractId);

        // The `with` carries the event's effects; WithEvent carries the
        // transition. Both, in that order, never one instead of the other —
        // see the remarks on GameState. Heroes answering an offer all happen
        // within the campaign's current logical time; advancing the clock is a
        // tick's job, not a proposal's, and WithEvent allows equal times for
        // exactly this reason.
        var nextState = (state with
        {
            Contracts = state.Contracts.SetItem(respondedContract.Id, respondedContract),
            AppliedCommandIds = state.AppliedCommandIds.Add(command.CommandId),
        }).WithEvent(domainEvent, decision.Result.Trace, decision.OrdinalsConsumed);

        return CommandResult.FromDecision(nextState, domainEvent, decision.Result);
    }
}
