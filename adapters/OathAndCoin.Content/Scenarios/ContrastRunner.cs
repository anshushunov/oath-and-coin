using System.Collections.Immutable;
using System.Text.Json.Nodes;
using OathAndCoin.Simulation;
using OathAndCoin.Simulation.Commands;
using OathAndCoin.Simulation.Decisions;
using OathAndCoin.Simulation.Ids;
using OathAndCoin.Simulation.State;

namespace OathAndCoin.Content.Scenarios;

/// <summary>
/// What running a <see cref="ContrastDefinition"/> found: the action each
/// branch reached, whether that pair matches the direction the definition
/// declared, and the RNG ordinal each branch actually spent its one decision
/// on.
/// </summary>
/// <param name="Flipped">
/// <c>true</c> only when the two actions match <see cref="ContrastDefinition.Expect"/>'s
/// own direction exactly — not merely "the two answers differ". A contrast
/// declaring <c>decline_to_accept</c> whose branches actually went
/// <c>accept</c>/<c>decline</c> (the opposite way) is not flipped as
/// declared, even though its two answers disagree; treating any disagreement
/// as success would let a contrast pass while asserting the wrong story
/// about its own content.
/// </param>
/// <param name="ActionFrom">What the hero decided in the <c>from</c> branch.</param>
/// <param name="ActionTo">What the hero decided in the <c>to</c> branch.</param>
/// <param name="OrdinalUsedFrom">
/// <see cref="GameMetadata.NextDecisionOrdinal"/> the <c>from</c> branch's one
/// decision was asked at.
/// </param>
/// <param name="OrdinalUsedTo">The same, for the <c>to</c> branch.</param>
/// <remarks>
/// <see cref="OrdinalUsedFrom"/> and <see cref="OrdinalUsedTo"/> are always
/// equal for every contrast <see cref="ContrastRunner"/> can produce — both
/// branches are freshly built from the same content and the same seed, and
/// each branch issues exactly one command, so each reaches its decision at
/// ordinal 0. They are still reported, rather than assumed, because "the
/// same ordinal on both sides" is this format's whole reason to exist
/// (spec §8.3): the equality is a fact about how <see cref="Run"/> is built,
/// not a promise a caller has to take on faith.
/// </remarks>
public sealed record ContrastResult(
    bool Flipped, ContentId ActionFrom, ContentId ActionTo, ulong OrdinalUsedFrom, ulong OrdinalUsedTo);

/// <summary>
/// Runs a <see cref="ContrastDefinition"/>'s two branches and reports what
/// each one decided.
/// </summary>
/// <remarks>
/// Both branches are built from the same <see cref="ContentSet"/> instance,
/// the same seed, and the same freshly-created <see cref="GameState"/> — the
/// only difference between them is the single field
/// <see cref="ContrastDefinition.Input"/> names, changed from
/// <see cref="ContrastDefinition.From"/> to <see cref="ContrastDefinition.To"/>.
/// Each branch then issues exactly one <see cref="ProposeContractToHero"/>
/// command, to the same hero, for the same contract, at command id 1 — no
/// other command runs in either branch. That is what makes "same seed, same
/// ordinal, same pre-state" a fact about how this method is built rather
/// than an author's promise: there is no code path here that could apply a
/// second command, use a different seed per branch, or reuse state mutated
/// by anything other than the one named field.
/// </remarks>
public static class ContrastRunner
{
    public static ContrastResult Run(ContrastDefinition definition)
    {
        ArgumentNullException.ThrowIfNull(definition);

        var content = ContentSet.Load(definition.ContentRoot);

        var from = RunBranch(content, definition, definition.From);
        var to = RunBranch(content, definition, definition.To);

        var flipped = definition.Expect switch
        {
            "decline_to_accept" => from.Action == Actions.Decline && to.Action == Actions.Accept,
            "accept_to_decline" => from.Action == Actions.Accept && to.Action == Actions.Decline,
            _ => throw new InvalidOperationException(
                $"Contrast '{definition.Name}' declares expect '{definition.Expect}', which "
                + "ContrastDefinition.Build should already have rejected."),
        };

        return new ContrastResult(flipped, from.Action, to.Action, from.Ordinal, to.Ordinal);
    }

    /// <summary>
    /// Builds one branch's initial state, applies <paramref name="value"/> to
    /// the field <see cref="ContrastDefinition.Input"/> names, and asks the
    /// definition's hero the definition's one question.
    /// </summary>
    private static (ContentId Action, ulong Ordinal) RunBranch(
        ContentSet content, ContrastDefinition definition, JsonNode value)
    {
        var state = content.CreateInitialState(definition.Seed, ScenarioRunner.RulesetVersion);
        state = ApplyVary(state, definition.Input, definition.Contract, value);

        var heroId = ResolveHeroId(state, definition.Hero, definition.Name);
        var ordinal = state.Metadata.NextDecisionOrdinal;

        var engine = new SimulationEngine();
        var result = engine.Apply(
            state,
            new ProposeContractToHero(
                CommandId: 1,
                heroId,
                definition.Contract,
                ExpectedStateVersion: state.Metadata.StateVersion));

        if (!result.Applied || result.Decision is null)
        {
            throw new InvalidOperationException(
                $"Contrast '{definition.Name}' could not ask hero '{definition.Hero}' about contract "
                + $"'{definition.Contract}': the one command this branch issues was rejected "
                + $"('{result.RejectionCode}'). A contrast's single command must always be answerable, or "
                + "the two branches are not actually asking the same question.");
        }

        return (result.Decision.SelectedAction, ordinal);
    }

    /// <summary>
    /// Applies <paramref name="value"/> to exactly the field
    /// <paramref name="input"/> names on <paramref name="contractId"/>'s
    /// state, leaving every other field — including every other contract and
    /// every hero — untouched. This is the one place a vary actually changes
    /// anything; everything else about the two branches comes from the same
    /// <see cref="ContentSet.CreateInitialState"/> call.
    /// </summary>
    private static GameState ApplyVary(GameState state, string input, ContentId contractId, JsonNode value)
    {
        if (!state.Contracts.TryGetValue(contractId, out var contract))
        {
            throw new InvalidDataException(
                $"Content root has no contract definition '{contractId}' for this contrast to vary.");
        }

        var varied = input switch
        {
            "contract.payment" => contract with { Payment = ContrastDefinition.AsInt(value) },
            "contract.risk" => contract with { Risk = ContrastDefinition.AsInt(value) },
            "contract.tags" => contract with
            {
                Tags = ImmutableSortedSet.CreateRange(ContrastDefinition.AsContentIds(value)),
            },
            "contract.accepted_by" => WithAcceptedBy(state, contract, ContrastDefinition.AsContentIds(value)),
            _ => throw new InvalidOperationException(
                $"Unknown vary input '{input}', which ContrastDefinition.Build should already have rejected."),
        };

        return state with { Contracts = state.Contracts.SetItem(contractId, varied) };
    }

    /// <summary>
    /// The one input that varies a precondition rather than a content value
    /// (see the remarks on <see cref="ContrastDefinition"/>): who has already
    /// accepted this contract before the named hero is asked. Set directly on
    /// the freshly-built state rather than through a real
    /// <see cref="ProposeContractToHero"/> command for each accepting
    /// comrade — issuing one would be a second command in this branch, which
    /// is exactly the thing that would put the "no other command" guarantee
    /// in the hands of whoever writes the next contrast instead of in this
    /// method's own structure.
    /// </summary>
    private static ContractState WithAcceptedBy(
        GameState state, ContractState contract, ImmutableArray<ContentId> acceptedByDefinitions)
    {
        var heroIds = ImmutableSortedSet.CreateRange(
            acceptedByDefinitions.Select(definitionId => ResolveHeroId(state, definitionId, contract.Id.Value)));

        return contract with
        {
            AcceptedBy = heroIds,
            RespondedBy = contract.RespondedBy.Union(heroIds),
        };
    }

    /// <summary>
    /// Finds the runtime <see cref="HeroId"/> <see cref="ContentSet.CreateInitialState"/>
    /// assigned to <paramref name="heroDefinition"/>, rather than recomputing
    /// its content-id-sorted index independently — a second statement of that
    /// ordering rule here would drift from the loader's the day either one
    /// changes without the other.
    /// </summary>
    private static HeroId ResolveHeroId(GameState state, ContentId heroDefinition, string context)
    {
        foreach (var (id, hero) in state.Heroes)
        {
            if (hero.Definition == heroDefinition)
            {
                return id;
            }
        }

        throw new InvalidDataException(
            $"Content root has no hero definition '{heroDefinition}' for '{context}' to resolve.");
    }
}
