using System.Collections.Immutable;
using OathAndCoin.Simulation.Decisions;
using OathAndCoin.Simulation.Ids;
using OathAndCoin.Simulation.State;

namespace OathAndCoin.Simulation.Tests;

/// <summary>
/// Minimal, valid <see cref="HeroState"/>/<see cref="ContractState"/> values
/// shared across this project's equality tests. Every collection-valued
/// property starts empty, so a test that cares about one collection can
/// override just that one with <c>with</c> and leave the rest at an
/// unambiguous default.
/// </summary>
internal static class Fixtures
{
    public static readonly ContentId HeroDefinition = ContentId.Parse("core:bram");

    public static readonly ContentId ContractId = ContentId.Parse("core:escort_the_caravan");

    public static HeroState Hero() => new()
    {
        Id = new HeroId(1),
        Definition = HeroDefinition,
        DisplayNameKey = "hero.core.bram.name",
        Greed = 5,
        Caution = 5,
        Pride = 5,
        TrustInGuild = 5,
        Traits = ImmutableArray<ContentId>.Empty,
        Relationships = ImmutableSortedDictionary<ContentId, int>.Empty,
    };

    public static ContractState Contract() => new()
    {
        Id = ContractId,
        Payment = 100,
        Risk = 5,
        RequiredCrew = 1,
        Tags = ImmutableSortedSet<ContentId>.Empty,
        Status = ContractStatus.Offered,
        RespondedBy = ImmutableSortedSet<HeroId>.Empty,
        AcceptedBy = ImmutableSortedSet<HeroId>.Empty,
    };

    /// <summary>
    /// A minimal, otherwise-valid <see cref="DecisionResult"/> with
    /// <paramref name="score"/> and <paramref name="blockedBy"/> as the only
    /// two moving parts — for exercising the joint
    /// "<see cref="DecisionResult.SelectedScore"/> is null exactly when
    /// <paramref name="blockedBy"/> is non-empty" invariant without restating
    /// the rest of a decision each time.
    /// </summary>
    public static DecisionResult Result(int? score, ImmutableArray<TraceBlock> blockedBy) => new()
    {
        SelectedAction = Actions.Accept,
        ConsideredActions = ImmutableArray.Create(Actions.Accept, Actions.Decline),
        SelectedScore = score,
        Trace = new CausalTrace
        {
            TraceId = 1,
            PositiveFactors = ImmutableArray<TraceFactor>.Empty,
            NegativeFactors = ImmutableArray<TraceFactor>.Empty,
            BlockedBy = blockedBy,
        },
    };
}
