using System.Collections.Immutable;
using System.Reflection;
using OathAndCoin.Simulation.Decisions;
using OathAndCoin.Simulation.Events;
using OathAndCoin.Simulation.Ids;
using OathAndCoin.Simulation.Random;
using OathAndCoin.Simulation.State;

namespace OathAndCoin.Simulation.Tests;

/// <summary>
/// Verifies <see cref="GameState"/> (ADR-007, planned — TDD §21): campaign
/// state is a value whose collections are physically immutable, whose event log only grows
/// through <see cref="GameState.WithEvent"/> with strictly ordered event
/// ids, and whose stored <see cref="CausalTrace"/>s stay addressable from
/// the events that reference them — in both directions, so neither an event
/// nor a trace can end up orphaned.
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

        var next = state.WithEvent(evt, null, drawsConsumed: 0);

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
        var trace = CreateEmptyTrace(traceId: state.Metadata.NextTraceId);
        var evt = new HeroAcceptedContract(
            state.Metadata.NextEventId, state.Metadata.LogicalTime, trace.TraceId, new HeroId(1), ContractId);

        var next = state.WithEvent(evt, trace, drawsConsumed: 0);

        Assert.Same(trace, next.Traces[evt.CausalTraceId!.Value]);
        Assert.Equal(state.Metadata.NextTraceId + 1, next.Metadata.NextTraceId);
    }

    // Fix round 1 / C-1: WithEvent advanced NextEventId/StateVersion but not
    // NextTraceId, so the most natural client pattern — read NextTraceId,
    // build the trace under that id, build the event referencing it, call
    // WithEvent — reads the same (never-advanced) id on the very next
    // decision and silently overwrites the first explanation at that key.
    [Fact]
    public void WithEvent_AdvancesNextTraceIdAndKeepsBothExplanationsAddressable()
    {
        var state = CreateState();

        var firstTraceId = state.Metadata.NextTraceId;
        var firstTrace = CreateEmptyTrace(firstTraceId);
        var firstEvent = new HeroAcceptedContract(
            state.Metadata.NextEventId, state.Metadata.LogicalTime, firstTraceId, new HeroId(1), ContractId);
        var afterFirst = state.WithEvent(firstEvent, firstTrace, drawsConsumed: 1);

        Assert.Equal(firstTraceId + 1, afterFirst.Metadata.NextTraceId);

        var secondTraceId = afterFirst.Metadata.NextTraceId;
        var secondTrace = CreateEmptyTrace(secondTraceId);
        var secondEvent = new HeroDeclinedContract(
            afterFirst.Metadata.NextEventId, afterFirst.Metadata.LogicalTime, secondTraceId, new HeroId(2), ContractId);
        var afterSecond = afterFirst.WithEvent(secondEvent, secondTrace, drawsConsumed: 1);

        Assert.NotEqual(firstTraceId, secondTraceId);
        Assert.Equal(secondTraceId + 1, afterSecond.Metadata.NextTraceId);
        Assert.Equal(2, afterSecond.Traces.Count);
        Assert.Same(firstTrace, afterSecond.Traces[firstTraceId]);
        Assert.Same(secondTrace, afterSecond.Traces[secondTraceId]);
    }

    // Fix round 5 / C-3: NextDecisionOrdinal was declared, documented as
    // "what makes the engine stateless", and never advanced by anything —
    // while WithEvent's remarks forbid using a bare `with` as a transition.
    // There was therefore no sanctioned way to move it at all, and because
    // a draw is a pure function of (seed, stream, ordinal), two decisions in
    // a row would have drawn the identical value. The last assert shows that
    // consequence directly rather than trusting the counter.
    //
    // Note also what compiles here: NextDecisionOrdinal is handed to
    // DeterministicRng.Draw with no cast. That only builds because both are
    // ulong now — the signed/unsigned mismatch is pinned by the compiler,
    // not by an assertion that could rot.
    [Fact]
    public void WithEvent_AdvancesDecisionOrdinalSoTwoDecisionsDrawDifferently()
    {
        var state = CreateState();

        var firstOrdinal = state.Metadata.NextDecisionOrdinal;
        var firstEvent = new HeroAcceptedContract(
            state.Metadata.NextEventId, state.Metadata.LogicalTime, null, new HeroId(1), ContractId);
        var afterFirst = state.WithEvent(firstEvent, null, drawsConsumed: 1);

        var secondOrdinal = afterFirst.Metadata.NextDecisionOrdinal;
        var secondEvent = new HeroDeclinedContract(
            afterFirst.Metadata.NextEventId, afterFirst.Metadata.LogicalTime, null, new HeroId(2), ContractId);
        var afterSecond = afterFirst.WithEvent(secondEvent, null, drawsConsumed: 1);

        Assert.NotEqual(firstOrdinal, secondOrdinal);
        Assert.Equal(firstOrdinal + 1, secondOrdinal);
        Assert.Equal(secondOrdinal + 1, afterSecond.Metadata.NextDecisionOrdinal);

        Assert.NotEqual(
            DeterministicRng.Draw(state.Metadata.CampaignSeed, RngStream.HeroDecision, firstOrdinal),
            DeterministicRng.Draw(state.Metadata.CampaignSeed, RngStream.HeroDecision, secondOrdinal));
    }

    [Fact]
    public void WithEvent_AdvancesDecisionOrdinalByTheDrawsActuallyConsumed()
    {
        var state = CreateState();
        var evt = new HeroAcceptedContract(
            state.Metadata.NextEventId, state.Metadata.LogicalTime, null, new HeroId(1), ContractId);

        var next = state.WithEvent(evt, null, drawsConsumed: 3);

        Assert.Equal(state.Metadata.NextDecisionOrdinal + 3, next.Metadata.NextDecisionOrdinal);
    }

    // The other half of the contract: a transition that drew nothing must not
    // burn an ordinal, or a replay would desynchronize from the run it is
    // replaying.
    [Fact]
    public void WithEvent_LeavesDecisionOrdinalUntouchedWhenNothingWasDrawn()
    {
        var state = CreateState();
        var evt = new HeroAcceptedContract(
            state.Metadata.NextEventId, state.Metadata.LogicalTime, null, new HeroId(1), ContractId);

        var next = state.WithEvent(evt, null, drawsConsumed: 0);

        Assert.Equal(state.Metadata.NextDecisionOrdinal, next.Metadata.NextDecisionOrdinal);
    }

    // Fix round 5 / C-5: LogicalTime was never validated and never advanced.
    // An event stamped -999 appended cheerfully after one stamped 0, so
    // History was not monotone in time and the campaign clock in Metadata
    // sat at its initial value forever — "when did this happen" had no
    // answer the log could corroborate.
    [Fact]
    public void WithEvent_RejectsEventBeforeTheCampaignsLogicalTime()
    {
        var state = CreateState();
        var atTen = new HeroAcceptedContract(
            state.Metadata.NextEventId, 10, null, new HeroId(1), ContractId);
        var afterTen = state.WithEvent(atTen, null, drawsConsumed: 0);

        var backwards = new HeroDeclinedContract(
            afterTen.Metadata.NextEventId, -999, null, new HeroId(2), ContractId);

        var exception = Assert.Throws<ArgumentException>(
            () => afterTen.WithEvent(backwards, null, drawsConsumed: 0));

        Assert.Contains("-999", exception.Message, StringComparison.Ordinal);
        Assert.Contains("10", exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void WithEvent_AdvancesLogicalTimeToTheEventsOwn()
    {
        var state = CreateState();
        var evt = new HeroAcceptedContract(
            state.Metadata.NextEventId, 7, null, new HeroId(1), ContractId);

        var next = state.WithEvent(evt, null, drawsConsumed: 0);

        Assert.Equal(7, next.Metadata.LogicalTime);
        Assert.Equal(0, state.Metadata.LogicalTime);
    }

    // Simultaneity is legitimate: two heroes answering the same offer in the
    // same tick share a logical time. Only going *backwards* is rejected.
    [Fact]
    public void WithEvent_AllowsTwoEventsAtTheSameLogicalTime()
    {
        var state = CreateState();
        var first = new HeroAcceptedContract(
            state.Metadata.NextEventId, 3, null, new HeroId(1), ContractId);
        var afterFirst = state.WithEvent(first, null, drawsConsumed: 1);

        var second = new HeroDeclinedContract(
            afterFirst.Metadata.NextEventId, 3, null, new HeroId(2), ContractId);
        var afterSecond = afterFirst.WithEvent(second, null, drawsConsumed: 1);

        Assert.Equal(3, afterSecond.Metadata.LogicalTime);
        Assert.Equal(2, afterSecond.History.Length);
    }

    // Fix round 1 / C-1: a second decision must never silently erase what
    // an earlier one already explained, even if a caller misuses the API by
    // reusing an occupied trace id with different content.
    [Fact]
    public void WithEvent_RejectsOverwritingStoredTraceWithDifferentContent()
    {
        var state = CreateState();
        var traceId = state.Metadata.NextTraceId;
        var original = CreateEmptyTrace(traceId);
        var firstEvent = new HeroAcceptedContract(
            state.Metadata.NextEventId, state.Metadata.LogicalTime, traceId, new HeroId(1), ContractId);
        var afterFirst = state.WithEvent(firstEvent, original, drawsConsumed: 0);

        var different = new CausalTrace
        {
            TraceId = traceId,
            PositiveFactors = ImmutableArray.Create(new TraceFactor(ReasonCodes.PaymentAttractive, HeroDefinition, 3)),
            NegativeFactors = ImmutableArray<TraceFactor>.Empty,
            BlockedBy = ImmutableArray<string>.Empty,
        };
        var secondEvent = new HeroDeclinedContract(
            afterFirst.Metadata.NextEventId, afterFirst.Metadata.LogicalTime, traceId, new HeroId(2), ContractId);

        Assert.Throws<ArgumentException>(() => afterFirst.WithEvent(secondEvent, different, drawsConsumed: 0));
    }

    // Fix round 6 / R-2: storing a new trace only checked that its id was
    // absent from Traces, while NextTraceId advanced by exactly one whatever
    // id got stored. Store id 7 with the counter at 0 and the counter reads
    // 1; store ids 1..6 after that and it reads 7 again — an id that is
    // already occupied. "Next free" stopped being true, and the next decision
    // would be handed an id it could not store.
    [Fact]
    public void WithEvent_RejectsNewTraceAheadOfTheCounter()
    {
        var state = CreateState();
        var aheadOfCounter = state.Metadata.NextTraceId + 7;
        var trace = CreateEmptyTrace(aheadOfCounter);
        var evt = new HeroAcceptedContract(
            state.Metadata.NextEventId, state.Metadata.LogicalTime, aheadOfCounter, new HeroId(1), ContractId);

        var exception = Assert.Throws<ArgumentException>(() => state.WithEvent(evt, trace, drawsConsumed: 0));

        // The diagnostic has to name both numbers, or the caller cannot tell
        // which id it should have used.
        Assert.Contains(aheadOfCounter.ToString(), exception.Message, StringComparison.Ordinal);
        Assert.Contains(state.Metadata.NextTraceId.ToString(), exception.Message, StringComparison.Ordinal);
        Assert.Contains(nameof(GameMetadata.NextTraceId), exception.Message, StringComparison.Ordinal);
    }

    // The same rule once the campaign is under way: the counter is not merely
    // a starting point that any later id satisfies.
    [Fact]
    public void WithEvent_RejectsNewTraceThatSkipsTheCounter()
    {
        var state = CreateState();
        var firstTraceId = state.Metadata.NextTraceId;
        var firstEvent = new HeroAcceptedContract(
            state.Metadata.NextEventId, state.Metadata.LogicalTime, firstTraceId, new HeroId(1), ContractId);
        var afterFirst = state.WithEvent(firstEvent, CreateEmptyTrace(firstTraceId), drawsConsumed: 1);

        var skipped = afterFirst.Metadata.NextTraceId + 4;
        var secondEvent = new HeroDeclinedContract(
            afterFirst.Metadata.NextEventId, afterFirst.Metadata.LogicalTime, skipped, new HeroId(2), ContractId);

        var exception = Assert.Throws<ArgumentException>(
            () => afterFirst.WithEvent(secondEvent, CreateEmptyTrace(skipped), drawsConsumed: 1));

        Assert.Contains(skipped.ToString(), exception.Message, StringComparison.Ordinal);
        Assert.Contains(afterFirst.Metadata.NextTraceId.ToString(), exception.Message, StringComparison.Ordinal);

        // The rejected call left nothing behind.
        Assert.Single(afterFirst.Traces);
        Assert.Equal(firstTraceId + 1, afterFirst.Metadata.NextTraceId);
    }

    [Fact]
    public void WithEvent_RejectsOutOfOrderEventId()
    {
        var state = CreateState();
        var wrongEventId = state.Metadata.NextEventId + 5;
        var evt = new HeroAcceptedContract(wrongEventId, state.Metadata.LogicalTime, null, new HeroId(1), ContractId);

        var exception = Assert.Throws<ArgumentException>(() => state.WithEvent(evt, null, drawsConsumed: 0));

        Assert.Contains(wrongEventId.ToString(), exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void WithEvent_RejectsTraceIdMismatch()
    {
        var state = CreateState();
        var trace = CreateEmptyTrace(traceId: 1);
        // Event claims a different trace than the one actually handed in.
        var evt = new HeroAcceptedContract(state.Metadata.NextEventId, state.Metadata.LogicalTime, 2, new HeroId(1), ContractId);

        Assert.Throws<ArgumentException>(() => state.WithEvent(evt, trace, drawsConsumed: 0));
    }

    // Fix round 1 / I-1: the previous check only caught "trace given, ids
    // mismatch." An event that declares a CausalTraceId, with no trace
    // given and nothing stored under that id yet, passed silently — exactly
    // the dangling reference the whole feature exists to prevent.
    [Fact]
    public void WithEvent_RejectsDanglingCausalTraceReference()
    {
        var state = CreateState();
        var evt = new HeroAcceptedContract(
            state.Metadata.NextEventId, state.Metadata.LogicalTime, 99, new HeroId(1), ContractId);

        Assert.Throws<ArgumentException>(() => state.WithEvent(evt, null, drawsConsumed: 0));
    }

    // Fix round 1 / I-1: the mirror case also passed silently — a trace
    // handed in for an event that references no CausalTraceId at all would
    // land in Traces unreachable from any event.
    [Fact]
    public void WithEvent_RejectsTraceWithoutEventReference()
    {
        var state = CreateState();
        var trace = CreateEmptyTrace(state.Metadata.NextTraceId);
        var evt = new HeroAcceptedContract(
            state.Metadata.NextEventId, state.Metadata.LogicalTime, null, new HeroId(1), ContractId);

        Assert.Throws<ArgumentException>(() => state.WithEvent(evt, trace, drawsConsumed: 0));
    }

    // Fix round 1 / I-1: the legitimate case the strict check must still
    // allow — a second event referencing an explanation stored by an
    // earlier one, without re-supplying the trace.
    [Fact]
    public void WithEvent_AllowsEventToReferenceAlreadyStoredTrace()
    {
        var state = CreateState();
        var traceId = state.Metadata.NextTraceId;
        var trace = CreateEmptyTrace(traceId);
        var firstEvent = new HeroAcceptedContract(
            state.Metadata.NextEventId, state.Metadata.LogicalTime, traceId, new HeroId(1), ContractId);
        var afterFirst = state.WithEvent(firstEvent, trace, drawsConsumed: 0);

        var secondEvent = new HeroDeclinedContract(
            afterFirst.Metadata.NextEventId, afterFirst.Metadata.LogicalTime, traceId, new HeroId(2), ContractId);
        var afterSecond = afterFirst.WithEvent(secondEvent, null, drawsConsumed: 0);

        Assert.Equal(afterFirst.Metadata.NextTraceId, afterSecond.Metadata.NextTraceId);
        Assert.Single(afterSecond.Traces);
        Assert.Same(trace, afterSecond.Traces[traceId]);
    }

    // Fix round 1 / I-2: GameState is a public record with public init
    // properties (needed for structural construction/inspection elsewhere),
    // so a bare `with` expression always compiles and always yields a new
    // GameState value. It must never be mistaken for a real campaign
    // transition: WithEvent is the only place StateVersion may advance
    // (see the remarks on GameState). This pins that a bare `with` leaves
    // StateVersion untouched, so it can never be silently substituted for
    // WithEvent without becoming visible here.
    [Fact]
    public void PlainWithExpression_DoesNotAdvanceStateVersion()
    {
        var state = CreateState();

        var mutated = state with { Contracts = state.Contracts.SetItem(ContractId, CreateContract(ContractId)) };

        Assert.Equal(state.Metadata.StateVersion, mutated.Metadata.StateVersion);
        Assert.NotSame(state, mutated);
    }

    // Fix round 1 / I-3: the original version of this test always called
    // source.ToImmutableSortedDictionary() at its own call site before
    // assigning Heroes, so the defensive copy happened in *test* code — it
    // passed identically whether GameState.Heroes was the concrete
    // ImmutableSortedDictionary<,> or loosened to an interface like
    // IReadOnlyDictionary<,> that a plain Dictionary already satisfies
    // without copying, because it never actually tried to hand Heroes an
    // unconverted Dictionary (and a version that did wouldn't compile
    // against the correct, strict implementation). Reflection's
    // PropertyInfo.SetValue sidesteps that: it bypasses the C# compiler's
    // `init` restriction (compile-time only, not enforced by the CLR) and
    // lets the test attempt exactly that assignment. Against the correct,
    // physically immutable type this is rejected outright; if it were ever
    // accepted, mutating the original Dictionary afterwards would leak into
    // the already-built state — this test proves that consequence directly
    // rather than assuming it.
    [Fact]
    public void MutatingSourceCollection_DoesNotAffectState()
    {
        var heroId = new HeroId(1);
        var source = new Dictionary<HeroId, HeroState>
        {
            [heroId] = CreateHero(heroId, greed: 5),
        };
        var state = CreateState();
        var heroesProperty = typeof(GameState).GetProperty(nameof(GameState.Heroes))!;

        var exception = Record.Exception(() => heroesProperty.SetValue(state, source));

        if (exception is not null)
        {
            Assert.IsType<ArgumentException>(exception);
            return;
        }

        source[heroId] = CreateHero(heroId, greed: 999);
        Assert.Fail(
            $"Heroes accepted a raw, unconverted Dictionary via reflection; mutating it afterwards "
            + $"changed the already-built state's Greed to {state.Hero(heroId).Greed}.");
    }

    [Fact]
    public void Collections_AreDeeplyImmutable()
    {
        var properties = typeof(GameState).GetProperties(BindingFlags.Public | BindingFlags.Instance);

        AssertDeclaredType(properties, nameof(GameState.Heroes), typeof(ImmutableSortedDictionary<HeroId, HeroState>));
        AssertDeclaredType(properties, nameof(GameState.Contracts), typeof(ImmutableSortedDictionary<ContentId, ContractState>));
        AssertDeclaredType(properties, nameof(GameState.Traces), typeof(ImmutableSortedDictionary<long, CausalTrace>));
        AssertDeclaredType(properties, nameof(GameState.History), typeof(ImmutableArray<DomainEvent>));

        var respondedByProperty = typeof(ContractState).GetProperty(nameof(ContractState.RespondedBy));
        Assert.NotNull(respondedByProperty);
        Assert.Equal(typeof(ImmutableSortedSet<HeroId>), respondedByProperty!.PropertyType);
    }

    private static void AssertDeclaredType(PropertyInfo[] properties, string propertyName, Type expectedType)
    {
        var property = Assert.Single(properties, p => p.Name == propertyName);
        Assert.Equal(expectedType, property.PropertyType);
    }

    // Fix round 1 / I-4: default(ImmutableArray<T>) is an uninitialized
    // struct, not an empty array — `required` only guards against "never
    // assigned," not "assigned this specific default struct value."
    [Fact]
    public void History_RejectsDefaultImmutableArray()
    {
        var exception = Assert.Throws<ArgumentException>(() => new GameState
        {
            Metadata = CreateMetadata(),
            Heroes = ImmutableSortedDictionary<HeroId, HeroState>.Empty,
            Contracts = ImmutableSortedDictionary<ContentId, ContractState>.Empty,
            Traces = ImmutableSortedDictionary<long, CausalTrace>.Empty,
            History = default,
        });

        Assert.Contains("History", exception.Message, StringComparison.Ordinal);
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
        NextDecisionOrdinal = 0UL,
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

    private static ContractState CreateContract(ContentId id) => new()
    {
        Id = id,
        Payment = 100,
        Risk = 5,
        Status = ContractStatus.Offered,
        RespondedBy = ImmutableSortedSet<HeroId>.Empty,
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
