using System.Collections.Immutable;
using System.Reflection;
using OathAndCoin.Simulation.Commands;
using OathAndCoin.Simulation.Decisions;
using OathAndCoin.Simulation.Events;
using OathAndCoin.Simulation.Ids;
using OathAndCoin.Simulation.Random;
using OathAndCoin.Simulation.State;

namespace OathAndCoin.Simulation.Tests;

/// <summary>
/// The command layer: what a proposal does when it is accepted, and — at
/// least as important — what it refuses to do. Every rejection here returns
/// the state it was given, unchanged and by reference, so a rejected command
/// cannot advance the campaign by accident.
/// </summary>
public class ProposeContractTests
{
    private const ulong Seed = 424242;

    private static readonly HeroId Bram = new(0);
    private static readonly HeroId Zara = new(1);
    private static readonly ContentId BramDefinition = ContentId.Parse("core:bram");
    private static readonly ContentId ZaraDefinition = ContentId.Parse("core:zara");
    private static readonly ContentId ContractId = ContentId.Parse("core:escort_the_caravan");

    /// <summary>
    /// Zara's numbers put her decision at -28 before mood, which the mood
    /// range (-5..+5) cannot reach — so this asserts a decision, not a seed.
    /// </summary>
    [Fact]
    public void CautiousHero_DeclinesAndTraceNamesRisk()
    {
        var state = CreateState();

        var result = new SimulationEngine().Apply(state, Propose(commandId: 1, Zara, state));

        Assert.True(result.Applied);
        Assert.Equal(Actions.Decline, result.Decision!.SelectedAction);
        Assert.Contains(result.Decision.Trace.NegativeFactors, factor => factor.ReasonCode == ReasonCodes.RiskTooHigh);
        Assert.Contains(
            result.Decision.Trace.NegativeFactors,
            factor => factor.ReasonCode == ReasonCodes.RiskTooHigh && factor.SourceEntity == ContractId);
        Assert.IsType<HeroDeclinedContract>(Assert.Single(result.Events));
    }

    /// <summary>Bram sits at +14 before mood — the same argument, mirrored.</summary>
    [Fact]
    public void GreedyHero_AcceptsAndTraceNamesPayment()
    {
        var state = CreateState();

        var result = new SimulationEngine().Apply(state, Propose(commandId: 1, Bram, state));

        Assert.True(result.Applied);
        Assert.Equal(Actions.Accept, result.Decision!.SelectedAction);
        Assert.Contains(
            result.Decision.Trace.PositiveFactors,
            factor => factor.ReasonCode == ReasonCodes.PaymentAttractive);
        Assert.Equal(ContractStatus.Crewed, result.State.Contract(ContractId).Status);
        Assert.IsType<HeroAcceptedContract>(Assert.Single(result.Events));
    }

    [Fact]
    public void Decline_DoesNotCloseContractForOtherHeroes()
    {
        var engine = new SimulationEngine();
        var state = CreateState();

        var declined = engine.Apply(state, Propose(commandId: 1, Zara, state));

        Assert.True(declined.Applied);
        Assert.Equal(ContractStatus.Offered, declined.State.Contract(ContractId).Status);

        var accepted = engine.Apply(declined.State, Propose(commandId: 2, Bram, declined.State));

        Assert.True(accepted.Applied);
        Assert.Equal(Actions.Accept, accepted.Decision!.SelectedAction);
    }

    [Fact]
    public void SecondResponseFromSameHero_IsRejected()
    {
        var engine = new SimulationEngine();
        var state = CreateState();
        var first = engine.Apply(state, Propose(commandId: 1, Zara, state));

        var second = engine.Apply(first.State, Propose(commandId: 2, Zara, first.State));

        Assert.False(second.Applied);
        Assert.Equal(RejectionCodes.AlreadyResponded, second.RejectionCode);
        Assert.Same(first.State, second.State);
    }

    [Fact]
    public void StaleExpectedStateVersion_IsRejected()
    {
        var engine = new SimulationEngine();
        var state = CreateState();
        var first = engine.Apply(state, Propose(commandId: 1, Zara, state));

        // Built against the pre-command version — exactly what an in-flight
        // decision from a UI that has not seen the first result looks like.
        var stale = new ProposeContractToHero(
            CommandId: 2,
            HeroId: Bram,
            ContractId: ContractId,
            ExpectedStateVersion: state.Metadata.StateVersion);

        var result = engine.Apply(first.State, stale);

        Assert.False(result.Applied);
        Assert.Equal(RejectionCodes.StaleState, result.RejectionCode);
        Assert.Same(first.State, result.State);
    }

    [Fact]
    public void DuplicateCommandId_IsRejected()
    {
        var engine = new SimulationEngine();
        var state = CreateState();
        var first = engine.Apply(state, Propose(commandId: 7, Zara, state));

        var replayed = engine.Apply(first.State, Propose(commandId: 7, Bram, first.State));

        Assert.False(replayed.Applied);
        Assert.Equal(RejectionCodes.DuplicateCommand, replayed.RejectionCode);
        Assert.Same(first.State, replayed.State);
    }

    [Fact]
    public void UnknownContract_IsRejectedWithoutMutatingState()
    {
        var state = CreateState();
        var command = new ProposeContractToHero(
            CommandId: 1,
            HeroId: Bram,
            ContractId: ContentId.Parse("core:no_such_contract"),
            ExpectedStateVersion: state.Metadata.StateVersion);

        var result = new SimulationEngine().Apply(state, command);

        Assert.False(result.Applied);
        Assert.Equal(RejectionCodes.UnknownContract, result.RejectionCode);
        Assert.Same(state, result.State);
        Assert.Null(result.Decision);
        Assert.Empty(result.Events);
    }

    [Fact]
    public void SameStateAndCommand_ProduceIdenticalResult()
    {
        var state = CreateState();
        var command = Propose(commandId: 1, Zara, state);

        var first = new SimulationEngine().Apply(state, command);
        var second = new SimulationEngine().Apply(state, command);

        Assert.Equal(first.Decision, second.Decision);
        Assert.Equal(first.State, second.State);
    }

    /// <summary>
    /// Direct defence against the engine growing a memory again: the moment a
    /// generator, a counter or a cache lives in a field, replay stops being a
    /// property of (state, command) and starts depending on how many times the
    /// engine instance has been used.
    /// </summary>
    [Fact]
    public void EngineHasNoMutableState()
    {
        var fields = typeof(SimulationEngine)
            .GetFields(BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);

        Assert.Empty(fields);
    }

    [Fact]
    public void EveryDecision_ProducesStoredTrace()
    {
        var state = CreateState();

        var result = new SimulationEngine().Apply(state, Propose(commandId: 1, Zara, state));

        var domainEvent = Assert.Single(result.Events);
        var traceId = Assert.NotNull(domainEvent.CausalTraceId);
        Assert.Equal(result.Decision!.Trace, result.State.Traces[traceId]);
    }

    /// <summary>
    /// Without this, "the run is reproducible" stays green even if the seed
    /// never reaches the decision at all — an indicator passed off as a
    /// verdict (spec §8.3).
    /// </summary>
    [Fact]
    public void DifferentSeeds_ChangeTheMoodFactor()
    {
        var scores = new HashSet<int>();

        for (ulong seed = 1; seed <= 8; seed++)
        {
            var state = CreateState(seed);
            var result = new SimulationEngine().Apply(state, Propose(commandId: 1, Zara, state));
            scores.Add(result.Decision!.SelectedScore);
        }

        Assert.True(scores.Count > 1, "Eight different campaign seeds produced one single score.");
    }

    /// <summary>
    /// The test the plan's own mutant table demanded: a decision that reads a
    /// constant ordinal instead of the campaign's own
    /// <see cref="GameMetadata.NextDecisionOrdinal"/> survives every other test
    /// in this file, because each of them looks at one decision at a time.
    /// Two decisions in one run are what expose it — the second must draw its
    /// mood at a different ordinal than the first, and therefore is free to
    /// differ from it.
    /// </summary>
    [Fact]
    public void ConsecutiveDecisions_DrawMoodAtDifferentOrdinals()
    {
        // Not a magic constant: the first seed whose first two mood draws
        // actually differ, found the same way on every machine.
        var seed = FirstSeedWhereConsecutiveMoodsDiffer(out var expectedFirstMood, out var expectedSecondMood);

        var engine = new SimulationEngine();
        var state = CreateState(seed);

        var first = engine.Apply(state, Propose(commandId: 1, Zara, state));
        var second = engine.Apply(first.State, Propose(commandId: 2, Bram, first.State));

        Assert.Equal(expectedFirstMood, MoodOf(first.Decision!));
        Assert.Equal(expectedSecondMood, MoodOf(second.Decision!));
        Assert.NotEqual(0UL, second.State.Metadata.NextDecisionOrdinal - first.State.Metadata.NextDecisionOrdinal);
    }

    private static ulong FirstSeedWhereConsecutiveMoodsDiffer(out int firstMood, out int secondMood)
    {
        for (ulong seed = 1; seed < 1000; seed++)
        {
            var first = ContractDecisionRule.DrawMood(seed, ordinal: 0).Value;
            var second = ContractDecisionRule.DrawMood(seed, ordinal: 1).Value;

            if (first != second && first != 0 && second != 0)
            {
                firstMood = first;
                secondMood = second;
                return seed;
            }
        }

        throw new InvalidOperationException(
            "No seed below 1000 produced two different non-zero consecutive mood draws — "
            + "the RNG or the mood range changed shape.");
    }

    private static int MoodOf(DecisionResult decision)
    {
        var positive = decision.Trace.PositiveFactors
            .FirstOrDefault(factor => factor.ReasonCode == ReasonCodes.UnpredictableMood);
        if (positive is not null)
        {
            return positive.Magnitude;
        }

        var negative = decision.Trace.NegativeFactors
            .FirstOrDefault(factor => factor.ReasonCode == ReasonCodes.UnpredictableMood);

        return negative is null ? 0 : -negative.Magnitude;
    }

    private static ProposeContractToHero Propose(long commandId, HeroId hero, GameState state) =>
        new(commandId, hero, ContractId, state.Metadata.StateVersion);

    private static GameState CreateState(ulong campaignSeed = Seed) => new()
    {
        Metadata = new GameMetadata
        {
            SaveSchemaVersion = 1,
            RulesetVersion = "test-ruleset",
            ContentVersion = "test-content",
            CampaignSeed = campaignSeed,
            StateVersion = 0,
            LogicalTime = 0,
            NextEventId = 0,
            NextTraceId = 0,
            NextDecisionOrdinal = 0,
        },
        Heroes = ImmutableSortedDictionary.CreateRange(new[]
        {
            KeyValuePair.Create(Bram, new HeroState
            {
                Id = Bram,
                Definition = BramDefinition,
                DisplayNameKey = "hero.core.bram.name",
                Greed = 60,
                Caution = 30,
                Pride = 50,
                TrustInGuild = 50,
                Traits = ImmutableArray<ContentId>.Empty,
                Relationships = ImmutableSortedDictionary<ContentId, int>.Empty,
            }),
            KeyValuePair.Create(Zara, new HeroState
            {
                Id = Zara,
                Definition = ZaraDefinition,
                DisplayNameKey = "hero.core.zara.name",
                Greed = 20,
                Caution = 80,
                Pride = 55,
                TrustInGuild = 40,
                Traits = ImmutableArray<ContentId>.Empty,
                Relationships = ImmutableSortedDictionary<ContentId, int>.Empty,
            }),
        }),
        Contracts = ImmutableSortedDictionary.CreateRange(new[]
        {
            KeyValuePair.Create(ContractId, new ContractState
            {
                Id = ContractId,
                Payment = 40,
                Risk = 50,
                RequiredCrew = 1,
                Tags = ImmutableSortedSet<ContentId>.Empty,
                Status = ContractStatus.Offered,
                RespondedBy = ImmutableSortedSet<HeroId>.Empty,
                AcceptedBy = ImmutableSortedSet<HeroId>.Empty,
            }),
        }),
        Traces = ImmutableSortedDictionary<long, CausalTrace>.Empty,
        History = ImmutableArray<DomainEvent>.Empty,
    };
}
