using System.Collections.Immutable;
using OathAndCoin.Simulation.Decisions;

namespace OathAndCoin.Simulation.Tests;

/// <summary>
/// Verifies <see cref="DecisionResult"/>, <see cref="CausalTrace"/> and
/// <see cref="ReasonCodes"/> (TDD §8): a decision's selection must always be
/// among what was actually considered, reason codes are pinned, namespaced
/// constants rather than strings assembled ad hoc, and none of the
/// <see cref="ImmutableArray{T}"/>-typed properties silently accept an
/// uninitialized <c>default</c> struct in place of an empty array.
/// </summary>
public class CausalTraceTests
{
    [Fact]
    public void DecisionResult_SelectedActionMustBeAmongConsidered()
    {
        var exception = Assert.Throws<ArgumentException>(() => new DecisionResult
        {
            SelectedAction = Actions.Accept,
            ConsideredActions = ImmutableArray.Create(Actions.Decline),
            SelectedScore = 10,
            Trace = CreateEmptyTrace(),
        });

        Assert.Contains(Actions.Accept.Value, exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void DecisionResult_AcceptsSelectionAmongConsidered()
    {
        var result = new DecisionResult
        {
            SelectedAction = Actions.Accept,
            ConsideredActions = ImmutableArray.Create(Actions.Accept, Actions.Decline),
            SelectedScore = 10,
            Trace = CreateEmptyTrace(),
        };

        Assert.Equal(Actions.Accept, result.SelectedAction);
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
            ConsideredActions = ImmutableArray.Create(Actions.Decline),
            SelectedAction = Actions.Accept,
            SelectedScore = 10,
            Trace = CreateEmptyTrace(),
        });

        Assert.Contains(Actions.Accept.Value, exception.Message, StringComparison.Ordinal);
    }

    // Fix round 1 / I-4: default(ImmutableArray<ContentId>) is an
    // uninitialized struct, not an empty array. Before this fix,
    // ConsideredActions = default would reach Contains() inside the
    // invariant check and throw NullReferenceException instead of the
    // documented ArgumentException.
    [Fact]
    public void ConsideredActions_RejectsDefaultImmutableArray()
    {
        var exception = Assert.Throws<ArgumentException>(() => new DecisionResult
        {
            SelectedAction = Actions.Accept,
            ConsideredActions = default,
            SelectedScore = 10,
            Trace = CreateEmptyTrace(),
        });

        Assert.Contains("ConsideredActions", exception.Message, StringComparison.Ordinal);
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

    [Fact]
    public void Actions_AreStableAndNamespaced()
    {
        Assert.Equal("action:accept", Actions.Accept.Value);
        Assert.Equal("action:decline", Actions.Decline.Value);
        Assert.NotEqual(Actions.Accept, Actions.Decline);
    }

    [Theory]
    [InlineData("PositiveFactors")]
    [InlineData("NegativeFactors")]
    [InlineData("BlockedBy")]
    public void CausalTrace_RejectsDefaultImmutableArrayFactorCollections(string propertyName)
    {
        var exception = Assert.Throws<ArgumentException>(() => CreateEmptyTrace(defaultOut: propertyName));

        Assert.Contains(propertyName, exception.Message, StringComparison.Ordinal);
    }

    private static CausalTrace CreateEmptyTrace(string? defaultOut = null) => new()
    {
        TraceId = 1,
        PositiveFactors = defaultOut == "PositiveFactors" ? default : ImmutableArray<TraceFactor>.Empty,
        NegativeFactors = defaultOut == "NegativeFactors" ? default : ImmutableArray<TraceFactor>.Empty,
        BlockedBy = defaultOut == "BlockedBy" ? default : ImmutableArray<string>.Empty,
    };
}
