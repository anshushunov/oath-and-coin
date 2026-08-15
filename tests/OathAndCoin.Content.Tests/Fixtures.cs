using System.Collections.Immutable;
using OathAndCoin.Simulation.Decisions;
using OathAndCoin.Simulation.Ids;

namespace OathAndCoin.Content.Tests;

/// <summary>
/// Minimal fixtures for artifact-projection tests in this project.
/// </summary>
/// <remarks>
/// Deliberately not a reuse of <c>OathAndCoin.Simulation.Tests.Fixtures</c>:
/// that class is <c>internal</c> to <c>OathAndCoin.Simulation.Tests</c> and
/// not reachable from here, and its shape is driven by that project's own
/// equality and engine tests rather than by what an artifact-projection test
/// needs — a single, already-blocked <see cref="DecisionResult"/> with no
/// score at all.
/// </remarks>
internal static class Fixtures
{
    /// <summary>
    /// A decision blocked by a principle: <c>SelectedScore</c> is null and
    /// <c>Trace.BlockedBy</c> is non-empty, exactly the shape
    /// <see cref="Scenarios.DeterminismArtifact.RenderDecision"/> must render
    /// without ever writing a <c>selected_score</c> key.
    /// </summary>
    public static DecisionResult BlockedDecision() => new()
    {
        SelectedAction = Actions.Decline,
        ConsideredActions = ImmutableArray.Create(Actions.Accept, Actions.Decline),
        SelectedScore = null,
        Trace = new CausalTrace
        {
            TraceId = 1,
            PositiveFactors = ImmutableArray<TraceFactor>.Empty,
            NegativeFactors = ImmutableArray<TraceFactor>.Empty,
            BlockedBy = ImmutableArray.Create(
                new TraceBlock(ReasonCodes.PrincipleForbids, ContentId.Parse("core:will_not_strike_a_temple"))),
        },
    };
}
