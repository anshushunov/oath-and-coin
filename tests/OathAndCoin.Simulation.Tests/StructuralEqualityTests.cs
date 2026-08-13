using System.Collections.Immutable;
using OathAndCoin.Simulation.Decisions;
using OathAndCoin.Simulation.Events;
using OathAndCoin.Simulation.Ids;
using OathAndCoin.Simulation.State;

namespace OathAndCoin.Simulation.Tests;

/// <summary>
/// Pins that campaign state and stored explanations compare by content, not
/// by the identity of the arrays and dictionaries they happen to hold.
/// </summary>
/// <remarks>
/// Before this fix the behaviour was not merely "reference equality", it was
/// inconsistent: two identical <see cref="GameState"/>s built independently
/// were unequal, two <see cref="CausalTrace"/>s with the same factors were
/// unequal, but two traces whose collections were <em>all</em> the shared
/// <c>Empty</c> singleton were equal. A save/load round-trip test on a
/// trivial fixture would therefore go green and only start failing on the
/// first explanation that carried a real factor — i.e. on the two-hero,
/// two-explanation scenario this contract package exists to support. Every
/// test here uses non-empty collections for exactly that reason.
/// </remarks>
public class StructuralEqualityTests
{
    private static readonly ContentId BramDefinition = ContentId.Parse("core:bram");
    private static readonly ContentId ZaraDefinition = ContentId.Parse("core:zara");
    private static readonly ContentId ContractId = ContentId.Parse("core:escort_the_caravan");

    [Fact]
    public void IdenticalStatesBuiltIndependently_AreEqual()
    {
        var left = BuildPopulatedState();
        var right = BuildPopulatedState();

        Assert.NotSame(left, right);
        Assert.Equal(left, right);
        Assert.True(left == right);
        Assert.Equal(left.GetHashCode(), right.GetHashCode());
    }

    // The regression that matters for the next plan: the difference is one
    // factor inside one stored explanation, several levels down from the
    // state object itself.
    [Fact]
    public void StatesDifferingByOneFactorInAnExplanation_AreNotEqual()
    {
        var left = BuildPopulatedState();
        var right = BuildPopulatedState(paymentMagnitude: 4);

        Assert.NotEqual(left, right);
        Assert.False(left == right);
    }

    [Fact]
    public void StatesDifferingByOneRespondingHero_AreNotEqual()
    {
        var left = BuildPopulatedState();
        var right = BuildPopulatedState(respondedBy: new HeroId(2));

        Assert.NotEqual(left, right);
    }

    [Fact]
    public void StatesDifferingByHistory_AreNotEqual()
    {
        var left = BuildPopulatedState();
        var right = BuildPopulatedState(acceptingHero: new HeroId(2));

        Assert.NotEqual(left, right);
    }

    [Fact]
    public void TracesWithIdenticalNonEmptyFactors_AreEqual()
    {
        var left = BuildTrace(traceId: 7);
        var right = BuildTrace(traceId: 7);

        Assert.NotSame(left, right);
        Assert.Equal(left, right);
        Assert.Equal(left.GetHashCode(), right.GetHashCode());
    }

    [Theory]
    [InlineData(4, null, null)]
    [InlineData(3, "hero.decision.risk_too_high", null)]
    [InlineData(3, null, "hero.decision.unpredictable_mood")]
    public void TracesDifferingInAnyPart_AreNotEqual(int magnitude, string? blocker, string? tieBreak)
    {
        var left = BuildTrace(traceId: 7);
        var right = BuildTrace(traceId: 7, paymentMagnitude: magnitude, extraBlocker: blocker, tieBreak: tieBreak);

        Assert.NotEqual(left, right);
    }

    [Fact]
    public void DecisionResultsWithIdenticalContent_AreEqual()
    {
        var left = BuildDecision();
        var right = BuildDecision();

        Assert.NotSame(left, right);
        Assert.Equal(left, right);
        Assert.Equal(left.GetHashCode(), right.GetHashCode());
    }

    [Fact]
    public void DecisionResultsDifferingInConsideredActionsOrTrace_AreNotEqual()
    {
        var baseline = BuildDecision();

        Assert.NotEqual(baseline, BuildDecision(consideredOrder: new[] { Actions.Decline, Actions.Accept }));
        Assert.NotEqual(baseline, BuildDecision(paymentMagnitude: 4));
    }

    [Fact]
    public void ContractsWithIdenticalResponders_AreEqual()
    {
        var left = BuildContract(respondedBy: new HeroId(1));
        var right = BuildContract(respondedBy: new HeroId(1));

        Assert.Equal(left, right);
        Assert.Equal(left.GetHashCode(), right.GetHashCode());
        Assert.NotEqual(left, BuildContract(respondedBy: new HeroId(2)));
    }

    // The Equals/GetHashCode contract, stated directly: equal values must
    // hash equally. Asserted over a set of values that includes both equal
    // pairs and near-miss pairs, so it is not satisfied by a constant hash
    // plus a permissive Equals.
    [Fact]
    public void GetHashCode_IsConsistentWithEquals()
    {
        var values = new object[]
        {
            BuildPopulatedState(),
            BuildPopulatedState(),
            BuildPopulatedState(paymentMagnitude: 4),
            BuildPopulatedState(respondedBy: new HeroId(2)),
            BuildTrace(traceId: 7),
            BuildTrace(traceId: 7),
            BuildTrace(traceId: 8),
            BuildDecision(),
            BuildDecision(),
            BuildDecision(paymentMagnitude: 4),
            BuildContract(respondedBy: new HeroId(1)),
            BuildContract(respondedBy: new HeroId(1)),
        };

        var equalPairs = 0;
        foreach (var left in values)
        {
            foreach (var right in values)
            {
                if (!left.Equals(right))
                {
                    continue;
                }

                equalPairs++;
                Assert.Equal(left.GetHashCode(), right.GetHashCode());
            }
        }

        // Sanity check on the check itself: if Equals had regressed to
        // reference equality, the loop above would only ever compare each
        // value with itself and assert nothing.
        Assert.True(
            equalPairs > values.Length,
            $"Only {equalPairs} equal pairs among {values.Length} values — no two distinct instances "
            + "compared equal, so this test proved nothing about hashing.");
    }

    private static GameState BuildPopulatedState(
        int paymentMagnitude = 3,
        HeroId? respondedBy = null,
        HeroId? acceptingHero = null)
    {
        var responder = respondedBy ?? new HeroId(1);
        var accepting = acceptingHero ?? new HeroId(1);
        var trace = BuildTrace(traceId: 0, paymentMagnitude: paymentMagnitude);

        var state = new GameState
        {
            Metadata = new GameMetadata
            {
                SaveSchemaVersion = 1,
                RulesetVersion = "ruleset-1",
                ContentVersion = "content-1",
                CampaignSeed = 424242UL,
                StateVersion = 0,
                LogicalTime = 0,
                NextEventId = 0,
                NextTraceId = 0,
                NextDecisionOrdinal = 0,
            },
            Heroes = ImmutableSortedDictionary<HeroId, HeroState>.Empty
                .Add(new HeroId(1), BuildHero(new HeroId(1), BramDefinition))
                .Add(new HeroId(2), BuildHero(new HeroId(2), ZaraDefinition)),
            Contracts = ImmutableSortedDictionary<ContentId, ContractState>.Empty
                .Add(ContractId, BuildContract(responder)),
            Traces = ImmutableSortedDictionary<long, CausalTrace>.Empty,
            History = ImmutableArray<DomainEvent>.Empty,
        };

        return state.WithEvent(
            new HeroAcceptedContract(0, 0, trace.TraceId, accepting, ContractId),
            trace,
            drawsConsumed: 1);
    }

    private static HeroState BuildHero(HeroId id, ContentId definition) => new()
    {
        Id = id,
        Definition = definition,
        DisplayNameKey = "hero.display_name." + definition.Name,
        Greed = 5,
        Caution = 5,
        TrustInGuild = 5,
    };

    private static ContractState BuildContract(HeroId respondedBy) => new()
    {
        Id = ContractId,
        Payment = 100,
        Risk = 5,
        Status = ContractStatus.Offered,
        RespondedBy = ImmutableSortedSet<HeroId>.Empty.Add(respondedBy),
    };

    private static CausalTrace BuildTrace(
        long traceId,
        int paymentMagnitude = 3,
        string? extraBlocker = null,
        string? tieBreak = null) => new()
    {
        TraceId = traceId,
        PositiveFactors = ImmutableArray.Create(
            new TraceFactor(ReasonCodes.PaymentAttractive, "core:bram", paymentMagnitude),
            new TraceFactor(ReasonCodes.TrustsTheGuild, "core:bram", 2)),
        NegativeFactors = ImmutableArray.Create(
            new TraceFactor(ReasonCodes.RiskTooHigh, "core:escort_the_caravan", -1)),
        BlockedBy = extraBlocker is null
            ? ImmutableArray<string>.Empty
            : ImmutableArray.Create(extraBlocker),
        TieBreak = tieBreak,
    };

    private static DecisionResult BuildDecision(
        ContentId[]? consideredOrder = null,
        int paymentMagnitude = 3) => new()
    {
        SelectedAction = Actions.Accept,
        ConsideredActions = ImmutableArray.Create(consideredOrder ?? new[] { Actions.Accept, Actions.Decline }),
        SelectedScore = 10,
        Trace = BuildTrace(traceId: 0, paymentMagnitude: paymentMagnitude),
    };
}
