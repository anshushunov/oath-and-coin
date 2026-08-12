using System.Collections.Immutable;
using OathAndCoin.Simulation.Decisions;
using OathAndCoin.Simulation.Events;
using OathAndCoin.Simulation.Ids;
using OathAndCoin.Simulation.State;

namespace OathAndCoin.Simulation.Tests;

/// <summary>
/// Verifies <see cref="GameState"/> (ADR-007): campaign state is a value
/// whose collections are physically immutable, whose event log only grows
/// through <see cref="GameState.WithEvent"/> with strictly ordered event
/// ids, and whose stored <see cref="CausalTrace"/>s stay addressable from
/// the events that reference them.
/// </summary>
public class GameStateTests
{
    private static readonly ContentId HeroDefinition = ContentId.Parse("core:bram");
    private static readonly ContentId ContractId = ContentId.Parse("core:escort_the_caravan");

    [Fact]
    public void WithEvent_AppendsEventAndAdvancesCounters()
    {
        var state = CreateState();
        var evt = new HeroAcceptedContract(
            state.Metadata.NextEventId, state.Metadata.LogicalTime, null, new HeroId(1), ContractId);

        var next = state.WithEvent(evt, null);

        Assert.Equal(state.Metadata.NextEventId + 1, next.Metadata.NextEventId);
        Assert.Equal(state.Metadata.StateVersion + 1, next.Metadata.StateVersion);
        Assert.Single(next.History);
        Assert.Equal(evt, next.History[0]);

        // The original state must not have been mutated in place.
        Assert.Empty(state.History);
        Assert.Equal(0, state.Metadata.NextEventId);
        Assert.Equal(0, state.Metadata.StateVersion);
    }

    [Fact]
    public void WithEvent_StoresTraceAddressableByEventReference()
    {
        var state = CreateState();
        var trace = CreateEmptyTrace(traceId: 7);
        var evt = new HeroAcceptedContract(
            state.Metadata.NextEventId, state.Metadata.LogicalTime, trace.TraceId, new HeroId(1), ContractId);

        var next = state.WithEvent(evt, trace);

        Assert.Same(trace, next.Traces[evt.CausalTraceId!.Value]);
    }

    [Fact]
    public void WithEvent_RejectsOutOfOrderEventId()
    {
        var state = CreateState();
        var wrongEventId = state.Metadata.NextEventId + 5;
        var evt = new HeroAcceptedContract(wrongEventId, state.Metadata.LogicalTime, null, new HeroId(1), ContractId);

        var exception = Assert.Throws<ArgumentException>(() => state.WithEvent(evt, null));

        Assert.Contains(wrongEventId.ToString(), exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void WithEvent_RejectsTraceIdMismatch()
    {
        var state = CreateState();
        var trace = CreateEmptyTrace(traceId: 1);
        // Event claims a different trace than the one actually handed in.
        var evt = new HeroAcceptedContract(state.Metadata.NextEventId, state.Metadata.LogicalTime, 2, new HeroId(1), ContractId);

        Assert.Throws<ArgumentException>(() => state.WithEvent(evt, trace));
    }

    [Fact]
    public void MutatingSourceCollection_DoesNotAffectState()
    {
        // Behavior, not type: a type assertion (e.g. Assert.IsAssignableFrom
        // <ImmutableSortedDictionary<...>>) would prove the declared
        // property type but not that the *owner of the original Dictionary*
        // lost the ability to change already-built state. Build state from
        // a plain, mutable Dictionary, then mutate that same Dictionary
        // afterwards, and confirm the state that was already built does not
        // see the change.
        var heroId = new HeroId(1);
        var source = new Dictionary<HeroId, HeroState>
        {
            [heroId] = CreateHero(heroId, greed: 5),
        };

        var state = CreateState(heroes: source.ToImmutableSortedDictionary());

        source[heroId] = CreateHero(heroId, greed: 999);
        source[new HeroId(2)] = CreateHero(new HeroId(2), greed: 1);

        Assert.Equal(5, state.Hero(heroId).Greed);
        Assert.False(state.Heroes.ContainsKey(new HeroId(2)));
        Assert.Single(state.Heroes);
    }

    // Fix round 1: MutatingSourceCollection_DoesNotAffectState always calls
    // ToImmutableSortedDictionary() at its own call site before assigning
    // Heroes, so the defensive copy already happened in test code — that
    // test passes unchanged even if GameState.Heroes is loosened from the
    // concrete ImmutableSortedDictionary<,> to IReadOnlyDictionary<,> (a
    // type any Dictionary already satisfies without copying). A property
    // typed as an interface no longer *forces* every future caller through
    // a copying conversion; it just happens that this particular test still
    // performs one. This test targets that gap directly: it asserts the
    // exact declared type of every collection property, so relaxing any of
    // them to a interface — even one only "coincidentally" caught in
    // practice — is a visible failure here.
    [Fact]
    public void Collections_AreDeeplyImmutable()
    {
        var properties = typeof(GameState).GetProperties(
            System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Instance);

        AssertDeclaredType(properties, nameof(GameState.Heroes), typeof(ImmutableSortedDictionary<HeroId, HeroState>));
        AssertDeclaredType(properties, nameof(GameState.Contracts), typeof(ImmutableSortedDictionary<ContentId, ContractState>));
        AssertDeclaredType(properties, nameof(GameState.Traces), typeof(ImmutableSortedDictionary<long, CausalTrace>));
        AssertDeclaredType(properties, nameof(GameState.History), typeof(ImmutableArray<DomainEvent>));

        var respondedByProperty = typeof(ContractState).GetProperty(nameof(ContractState.RespondedBy));
        Assert.NotNull(respondedByProperty);
        Assert.Equal(typeof(ImmutableSortedSet<HeroId>), respondedByProperty!.PropertyType);
    }

    private static void AssertDeclaredType(
        System.Reflection.PropertyInfo[] properties, string propertyName, Type expectedType)
    {
        var property = Assert.Single(properties, p => p.Name == propertyName);
        Assert.Equal(expectedType, property.PropertyType);
    }

    [Fact]
    public void Hero_ThrowsDiagnosticErrorForUnknownId()
    {
        var state = CreateState();

        var exception = Assert.Throws<KeyNotFoundException>(() => state.Hero(new HeroId(42)));

        Assert.Contains("hero#42", exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Metadata_CarriesReproducibilityContract()
    {
        var metadata = CreateMetadata();

        Assert.Equal(1, metadata.SaveSchemaVersion);
        Assert.Equal("ruleset-1", metadata.RulesetVersion);
        Assert.Equal(424242UL, metadata.CampaignSeed);
        Assert.Equal(0, metadata.StateVersion);
    }

    private static GameMetadata CreateMetadata() => new()
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
    };

    private static HeroState CreateHero(HeroId id, int greed) => new()
    {
        Id = id,
        Definition = HeroDefinition,
        DisplayNameKey = "hero.display_name.bram",
        Greed = greed,
        Caution = 5,
        TrustInGuild = 5,
    };

    private static CausalTrace CreateEmptyTrace(long traceId) => new()
    {
        TraceId = traceId,
        PositiveFactors = ImmutableArray<TraceFactor>.Empty,
        NegativeFactors = ImmutableArray<TraceFactor>.Empty,
        BlockedBy = ImmutableArray<string>.Empty,
    };

    private static GameState CreateState(ImmutableSortedDictionary<HeroId, HeroState>? heroes = null) => new()
    {
        Metadata = CreateMetadata(),
        Heroes = heroes ?? ImmutableSortedDictionary<HeroId, HeroState>.Empty,
        Contracts = ImmutableSortedDictionary<ContentId, ContractState>.Empty,
        Traces = ImmutableSortedDictionary<long, CausalTrace>.Empty,
        History = ImmutableArray<DomainEvent>.Empty,
    };
}
