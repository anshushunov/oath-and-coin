using System.Collections.Immutable;
using OathAndCoin.Simulation.Decisions;
using OathAndCoin.Simulation.Ids;

namespace OathAndCoin.Simulation.Tests;

/// <summary>
/// Verifies <see cref="DecisionResult"/> and <see cref="ReasonCodes"/>
/// (TDD §8): a decision's selection must always be among what was actually
/// considered, and reason codes are pinned, namespaced constants rather
/// than strings assembled ad hoc.
/// </summary>
public class CausalTraceTests
{
    private static readonly ContentId Considered1 = ContentId.Parse("core:escort_the_caravan");
    private static readonly ContentId Considered2 = ContentId.Parse("core:clear_the_ruins");
    private static readonly ContentId NotConsidered = ContentId.Parse("core:guard_the_gate");

    [Fact]
    public void DecisionResult_SelectedActionMustBeAmongConsidered()
    {
        var exception = Assert.Throws<ArgumentException>(() => new DecisionResult
        {
            SelectedAction = NotConsidered,
            ConsideredActions = ImmutableArray.Create(Considered1, Considered2),
            SelectedScore = 10,
            Trace = CreateEmptyTrace(),
        });

        Assert.Contains(NotConsidered.Value, exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void DecisionResult_AcceptsSelectionAmongConsidered()
    {
        var result = new DecisionResult
        {
            SelectedAction = Considered1,
            ConsideredActions = ImmutableArray.Create(Considered1, Considered2),
            SelectedScore = 10,
            Trace = CreateEmptyTrace(),
        };

        Assert.Equal(Considered1, result.SelectedAction);
        Assert.Equal(2, result.ConsideredActions.Length);
    }

    [Fact]
    public void DecisionResult_ValidatesRegardlessOfInitializerOrder()
    {
        // ConsideredActions is written before SelectedAction here, the
        // opposite order from the tests above — the invariant must not
        // depend on which init accessor object-initializer syntax happens
        // to run first.
        var exception = Assert.Throws<ArgumentException>(() => new DecisionResult
        {
            ConsideredActions = ImmutableArray.Create(Considered1, Considered2),
            SelectedAction = NotConsidered,
            SelectedScore = 10,
            Trace = CreateEmptyTrace(),
        });

        Assert.Contains(NotConsidered.Value, exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void ReasonCodes_AreStableAndNamespaced()
    {
        Assert.Equal("hero.decision.payment_attractive", ReasonCodes.PaymentAttractive);
        Assert.Equal("hero.decision.risk_too_high", ReasonCodes.RiskTooHigh);
        Assert.Equal("hero.decision.trusts_the_guild", ReasonCodes.TrustsTheGuild);
        Assert.Equal("hero.decision.unpredictable_mood", ReasonCodes.UnpredictableMood);

        var codes = new[]
        {
            ReasonCodes.PaymentAttractive,
            ReasonCodes.RiskTooHigh,
            ReasonCodes.TrustsTheGuild,
            ReasonCodes.UnpredictableMood,
        };

        Assert.All(codes, code => Assert.StartsWith("hero.decision.", code, StringComparison.Ordinal));
        Assert.Equal(codes.Length, codes.Distinct().Count());
    }

    private static CausalTrace CreateEmptyTrace() => new()
    {
        TraceId = 1,
        PositiveFactors = ImmutableArray<TraceFactor>.Empty,
        NegativeFactors = ImmutableArray<TraceFactor>.Empty,
        BlockedBy = ImmutableArray<string>.Empty,
    };
}
