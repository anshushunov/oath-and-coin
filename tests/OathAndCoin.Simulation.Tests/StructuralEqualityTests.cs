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
    private static readonly ContentId SecondContractId = ContentId.Parse("core:clear_the_mine");

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

    // Fix round 6 / R-3: EntriesEqual compares by key lookup and MembersEqual
    // by SetEquals, so neither depends on enumeration order or on which
    // comparer built the collection. EntriesHash and MembersHash, however,
    // folded elements in *enumeration* order — and for a sorted collection
    // that order is precisely what the comparer decides. Two states with
    // identical content, one built with the natural comparer and one with its
    // reverse, therefore compared equal and hashed differently: the
    // Equals/GetHashCode contract broken outright.
    [Fact]
    public void StatesBuiltWithReversedComparers_AreEqualAndHashEqually()
    {
        var natural = BuildComparerSensitiveState(descending: false);
        var reversed = BuildComparerSensitiveState(descending: true);

        // Guard on the fixture itself: if the two states happened to
        // enumerate identically, everything below would pass for free.
        AssertEnumeratesDifferently(natural.Heroes.Keys, reversed.Heroes.Keys, nameof(GameState.Heroes));
        AssertEnumeratesDifferently(natural.Contracts.Keys, reversed.Contracts.Keys, nameof(GameState.Contracts));
        AssertEnumeratesDifferently(natural.Traces.Keys, reversed.Traces.Keys, nameof(GameState.Traces));
        AssertEnumeratesDifferently(
            natural.Contract(ContractId).RespondedBy,
            reversed.Contract(ContractId).RespondedBy,
            nameof(ContractState.RespondedBy));

        Assert.Equal(natural, reversed);
        Assert.Equal(natural.GetHashCode(), reversed.GetHashCode());
    }

    // The consequence the contract exists to prevent, shown directly rather
    // than inferred from the hash codes above.
    [Fact]
    public void StateBuiltWithReversedComparers_IsFoundInSetAndDictionary()
    {
        var natural = BuildComparerSensitiveState(descending: false);
        var reversed = BuildComparerSensitiveState(descending: true);

        var set = new HashSet<GameState> { natural };

        Assert.Contains(reversed, set);
        Assert.False(
            set.Add(reversed),
            "the reversed-comparer state landed in a different bucket and was stored as a second, "
            + "distinct member of a set that already contained an equal value");

        var byState = new Dictionary<GameState, string> { [natural] = "campaign" };

        Assert.True(byState.TryGetValue(reversed, out var found));
        Assert.Equal("campaign", found);
    }

    // The same asymmetry one level down, on the sorted *set*: MembersEqual
    // uses SetEquals, so the responder set's comparer must not reach the hash
    // either.
    [Fact]
    public void ContractsWithReversedResponderComparer_AreEqualAndHashEqually()
    {
        var natural = BuildContract(BuildResponders(descending: false));
        var reversed = BuildContract(BuildResponders(descending: true));

        AssertEnumeratesDifferently(
            natural.RespondedBy,
            reversed.RespondedBy,
            nameof(ContractState.RespondedBy));
        Assert.Equal(natural, reversed);
        Assert.Equal(natural.GetHashCode(), reversed.GetHashCode());
        Assert.Contains(reversed, new HashSet<ContractState> { natural });
    }

    private static void AssertEnumeratesDifferently<T>(
        IEnumerable<T> natural,
        IEnumerable<T> reversed,
        string what)
    {
        Assert.False(
            natural.SequenceEqual(reversed),
            $"{what} enumerated identically under both comparers, so this fixture cannot "
            + "distinguish an order-independent hash from an order-dependent one");
    }

    /// <summary>
    /// Descending order over the natural one, so a sorted collection built
    /// with it enumerates backwards while holding exactly the same content.
    /// </summary>
    private sealed class Descending<T> : IComparer<T>
    {
        public static readonly Descending<T> Instance = new();

        public int Compare(T? x, T? y) => Comparer<T>.Default.Compare(y, x);
    }

    private static ImmutableSortedSet<HeroId> BuildResponders(bool descending)
    {
        var responders = descending
            ? ImmutableSortedSet<HeroId>.Empty.WithComparer(Descending<HeroId>.Instance)
            : ImmutableSortedSet<HeroId>.Empty;

        return responders.Add(new HeroId(1)).Add(new HeroId(2));
    }

    // Every collection here holds at least two elements, because a
    // one-element collection enumerates the same way under either comparer
    // and would make the test vacuous.
    private static GameState BuildComparerSensitiveState(bool descending)
    {
        var heroes = descending
            ? ImmutableSortedDictionary<HeroId, HeroState>.Empty.WithComparers(Descending<HeroId>.Instance)
            : ImmutableSortedDictionary<HeroId, HeroState>.Empty;
        var contracts = descending
            ? ImmutableSortedDictionary<ContentId, ContractState>.Empty.WithComparers(Descending<ContentId>.Instance)
            : ImmutableSortedDictionary<ContentId, ContractState>.Empty;
        var traces = descending
            ? ImmutableSortedDictionary<long, CausalTrace>.Empty.WithComparers(Descending<long>.Instance)
            : ImmutableSortedDictionary<long, CausalTrace>.Empty;

        var responders = BuildResponders(descending);

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
            Heroes = heroes
                .Add(new HeroId(1), BuildHero(new HeroId(1), BramDefinition))
                .Add(new HeroId(2), BuildHero(new HeroId(2), ZaraDefinition)),
            Contracts = contracts
                .Add(ContractId, BuildContract(responders))
                .Add(SecondContractId, BuildContract(responders, SecondContractId)),
            Traces = traces,
            History = ImmutableArray<DomainEvent>.Empty,
        };

        var firstTrace = BuildTrace(traceId: 0);
        state = state.WithEvent(
            new HeroAcceptedContract(0, 0, firstTrace.TraceId, new HeroId(1), ContractId),
            firstTrace,
            drawsConsumed: 1);

        var secondTrace = BuildTrace(traceId: 1, paymentMagnitude: 4);
        return state.WithEvent(
            new HeroDeclinedContract(1, 0, secondTrace.TraceId, new HeroId(2), SecondContractId),
            secondTrace,
            drawsConsumed: 1);
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

    private static ContractState BuildContract(HeroId respondedBy) =>
        BuildContract(ImmutableSortedSet<HeroId>.Empty.Add(respondedBy));

    private static ContractState BuildContract(ImmutableSortedSet<HeroId> respondedBy, ContentId? id = null) => new()
    {
        Id = id ?? ContractId,
        Payment = 100,
        Risk = 5,
        Status = ContractStatus.Offered,
        RespondedBy = respondedBy,
    };

    private static CausalTrace BuildTrace(
        long traceId,
        int paymentMagnitude = 3,
        string? extraBlocker = null,
        string? tieBreak = null) => new()
    {
        TraceId = traceId,
        PositiveFactors = ImmutableArray.Create(
            new TraceFactor(ReasonCodes.PaymentAttractive, BramDefinition, paymentMagnitude),
            new TraceFactor(ReasonCodes.TrustsTheGuild, BramDefinition, 2)),
        NegativeFactors = ImmutableArray.Create(
            new TraceFactor(ReasonCodes.RiskTooHigh, ContractId, -1)),
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
