using System.Collections.Immutable;
using OathAndCoin.Simulation;
using OathAndCoin.Simulation.Commands;
using OathAndCoin.Simulation.Decisions;
using OathAndCoin.Simulation.Events;
using OathAndCoin.Simulation.Ids;
using OathAndCoin.Simulation.State;

namespace OathAndCoin.Content.Scenarios;

/// <summary>What one scenario step did.</summary>
/// <param name="HeroDefinition">
/// The content id of the hero who answered — <c>null</c> when the step was
/// rejected before any hero was resolved. Definition rather than
/// <see cref="HeroId"/> so a report or an artifact stays readable and stable:
/// the index is a property of one campaign's roster, the definition is a
/// property of the content.
/// </param>
public sealed record StepOutcome(
    ScenarioCommand Command,
    bool Applied,
    string? RejectionCode,
    ContentId? HeroDefinition,
    DecisionResult? Decision,
    ImmutableArray<DomainEvent> Events);

/// <summary>
/// The result of a whole run: every step, and the state it ended in.
/// </summary>
/// <remarks>
/// Deliberately not given value equality over its collections. Two runs are
/// compared through <see cref="DeterminismArtifact"/>, which is an explicit,
/// stable projection — comparing outcome objects instead would make the
/// comparison depend on which fields happen to be on these records today.
/// </remarks>
public sealed record ScenarioOutcome(GameState FinalState, ImmutableArray<StepOutcome> Steps);

/// <summary>
/// Runs a scenario against content: builds the initial state from the content
/// and the seed, then applies each command in order.
/// </summary>
public static class ScenarioRunner
{
    /// <summary>
    /// The rules this build implements, recorded in every state and artifact.
    /// One half of the reproducibility tuple (TDD §7.1) — the other halves are
    /// the content version and the seed. It is a constant here rather than a
    /// parameter because a run cannot choose which rules the binary contains.
    /// </summary>
    public const string RulesetVersion = "gate0-spike/1";

    public static ScenarioOutcome Run(ContentSet content, IReadOnlyList<ScenarioCommand> commands, ulong seed)
    {
        ArgumentNullException.ThrowIfNull(content);
        ArgumentNullException.ThrowIfNull(commands);

        var engine = new SimulationEngine();
        var state = content.CreateInitialState(seed, RulesetVersion);
        var steps = ImmutableArray.CreateBuilder<StepOutcome>(commands.Count);

        foreach (var command in commands)
        {
            var heroId = new HeroId(command.HeroIndex);
            var result = engine.Apply(
                state,
                new ProposeContractToHero(
                    command.CommandId,
                    heroId,
                    command.Contract,
                    command.ExpectedStateVersion));

            steps.Add(new StepOutcome(
                command,
                result.Applied,
                result.RejectionCode,
                state.Heroes.TryGetValue(heroId, out var hero) ? hero.Definition : null,
                result.Decision,
                result.Events));

            // A rejected step returns the state it was given, so this assignment
            // is a no-op for it — the run continues rather than aborting,
            // because "what did the engine refuse and why" is part of what a
            // scenario is for.
            state = result.State;
        }

        return new ScenarioOutcome(state, steps.ToImmutable());
    }
}
