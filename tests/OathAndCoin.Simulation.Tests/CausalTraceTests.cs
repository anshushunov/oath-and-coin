using System.Collections.Immutable;
using OathAndCoin.Simulation.Decisions;
using OathAndCoin.Simulation.Ids;

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

    // Fix round 5 / C-7: SourceEntity used to be free text, so an
    // explanation named the thing that caused it in a form nothing could
    // resolve. Typed as a ContentId it is programmatically linked back to the
    // entity — this test walks that link, which is the whole point of the
    // change and is what a UI would do to let a player follow a reason back
    // to its cause. The hero's *definition* is used, not its runtime HeroId,
    // because the definition is stable across saves.
    [Fact]
    public void TraceFactor_SourceEntityResolvesBackToTheEntityThatProducedIt()
    {
        var bram = ContentId.Parse("core:bram");
        var heroes = ImmutableSortedDictionary<ContentId, string>.Empty.Add(bram, "hero.display_name.bram");
        var factor = new TraceFactor(ReasonCodes.TrustsTheGuild, bram, 2);

        Assert.Equal(bram, factor.SourceEntity);
        Assert.True(heroes.ContainsKey(factor.SourceEntity));
        Assert.Equal("core", factor.SourceEntity.Namespace);
    }

    // The other side of the same boundary, stated as an executable fact:
    // reason codes are an engine dictionary that becomes localization keys.
    // They are never authored in content and never addressed from content, so
    // they are deliberately not ContentIds — and they are not even shaped like
    // one, which keeps the two vocabularies impossible to confuse.
    [Fact]
    public void ReasonCodes_AreEngineStringsNotContentIds()
    {
        foreach (var code in new[]
                 {
                     ReasonCodes.PaymentInsulting,
                     ReasonCodes.PersonalConviction,
                     ReasonCodes.PersonalAversion,
                     ReasonCodes.StandsWithComrade,
                     ReasonCodes.WillNotWorkWith,
                     ReasonCodes.PrincipleForbids,
                 })
        {
            Assert.StartsWith("hero.decision.", code, StringComparison.Ordinal);
            Assert.False(ContentId.TryParse(code, out _));
        }
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
        BlockedBy = defaultOut == "BlockedBy" ? default : ImmutableArray<TraceBlock>.Empty,
    };

    [Fact]
    public void BlockedBy_NamesTheEntityThatBlocked()
    {
        var trace = new CausalTrace
        {
            TraceId = 1,
            PositiveFactors = ImmutableArray<TraceFactor>.Empty,
            NegativeFactors = ImmutableArray<TraceFactor>.Empty,
            BlockedBy = ImmutableArray.Create(
                new TraceBlock(ReasonCodes.PrincipleForbids, ContentId.Parse("core:will_not_strike_a_temple"))),
        };

        var block = Assert.Single(trace.BlockedBy);
        Assert.Equal(ContentId.Parse("core:will_not_strike_a_temple"), block.SourceEntity);
    }

    [Fact]
    public void SelectedScore_IsNullExactlyWhenBlocked()
    {
        var blocked = Fixtures.Result(score: null, blockedBy: ImmutableArray.Create(
            new TraceBlock(ReasonCodes.PrincipleForbids, ContentId.Parse("core:principle"))));
        var scored = Fixtures.Result(score: 7, blockedBy: ImmutableArray<TraceBlock>.Empty);

        Assert.Null(blocked.SelectedScore);
        Assert.Equal(7, scored.SelectedScore);
    }

    [Fact]
    public void DecisionResult_RejectsScoreTogetherWithBlock()
    {
        Assert.Throws<ArgumentException>(() => Fixtures.Result(
            score: 7,
            blockedBy: ImmutableArray.Create(new TraceBlock(ReasonCodes.PrincipleForbids, ContentId.Parse("core:p")))));
    }

    [Fact]
    public void DecisionResult_RejectsMissingScoreWithoutBlock()
    {
        Assert.Throws<ArgumentException>(() => Fixtures.Result(
            score: null,
            blockedBy: ImmutableArray<TraceBlock>.Empty));
    }

    [Fact]
    public void DecisionResult_ValidatesScoreAgainstBlockRegardlessOfInitializerOrder()
    {
        // Trace is written before SelectedScore here. Everywhere else in the
        // repository — ContractDecisionRule.Decide, Fixtures.Result, and
        // every test above — the order is the opposite: SelectedScore first,
        // Trace second. Without this test, a validation call dropped from
        // whichever accessor never runs first in practice could disappear
        // and nothing here would notice, the same risk
        // DecisionResult_ValidatesRegardlessOfInitializerOrder rules out for
        // SelectedAction/ConsideredActions.
        var exception = Assert.Throws<ArgumentException>(() => new DecisionResult
        {
            SelectedAction = Actions.Accept,
            ConsideredActions = ImmutableArray.Create(Actions.Accept, Actions.Decline),
            Trace = new CausalTrace
            {
                TraceId = 1,
                PositiveFactors = ImmutableArray<TraceFactor>.Empty,
                NegativeFactors = ImmutableArray<TraceFactor>.Empty,
                BlockedBy = ImmutableArray.Create(
                    new TraceBlock(ReasonCodes.PrincipleForbids, ContentId.Parse("core:principle"))),
            },
            SelectedScore = 7,
        });

        Assert.Contains(nameof(DecisionResult.SelectedScore), exception.Message, StringComparison.Ordinal);
    }
}
