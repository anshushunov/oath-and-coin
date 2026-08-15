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

    private static readonly SimulationEngine Engine = new();

    // Per-instance, not per-call: xUnit builds a fresh ProposeContractTests
    // for every [Fact], so these start at the same value for every test —
    // and, within one test, they track exactly the (CommandId,
    // ExpectedStateVersion) a caller composing commands one at a time would
    // use: the campaign's StateVersion advances by exactly one on every
    // *applied* proposal (Task 8: WithEvent bumps it unconditionally,
    // whether the hero accepted, declined, or was blocked by a principle),
    // so a plain per-test counter tracks it without ever having to ask the
    // state what its own version is.
    private long _nextCommandId = 1;

    private long _nextExpectedStateVersion;

    [Fact]
    public void Propose_AddsAcceptingHeroToCrewAndKeepsOfferOpen()
    {
        var state = Fixtures.StateWithTwoHeroes(requiredCrew: 2);

        var afterFirst = Engine.Apply(state, Propose(heroIndex: 0)).State;

        var contract = afterFirst.Contracts.Values.Single();
        Assert.Equal(ContractStatus.Offered, contract.Status);
        Assert.Single(contract.AcceptedBy);
        Assert.Single(contract.RespondedBy);
    }

    [Fact]
    public void Propose_MarksContractCrewedWhenRequiredCrewIsReached()
    {
        var state = Fixtures.StateWithTwoHeroes(requiredCrew: 2);

        var after = Engine.Apply(
            Engine.Apply(state, Propose(heroIndex: 0)).State,
            Propose(heroIndex: 1)).State;

        Assert.Equal(ContractStatus.Crewed, after.Contracts.Values.Single().Status);
    }

    [Fact]
    public void Propose_KeepsOrdinalUnchangedWhenAPrincipleBlocked()
    {
        var state = Fixtures.StateWithPrincipledHero();
        var before = state.Metadata.NextDecisionOrdinal;

        var after = Engine.Apply(state, Propose(heroIndex: 0)).State;

        Assert.Equal(before, after.Metadata.NextDecisionOrdinal);
    }

    [Fact]
    public void Propose_NextScoredDecisionReusesTheOrdinalTheGateDidNotRead()
    {
        var state = Fixtures.StateWithPrincipledHeroThenOrdinaryHero();
        var expectedOrdinal = state.Metadata.NextDecisionOrdinal;

        var afterGate = Engine.Apply(state, Propose(heroIndex: 0)).State;
        var afterScored = Engine.Apply(afterGate, Propose(heroIndex: 1)).State;

        var expectedMood = ContractDecisionRule.DrawMood(state.Metadata.CampaignSeed, expectedOrdinal);
        Assert.Equal(expectedOrdinal + expectedMood.OrdinalsConsumed, afterScored.Metadata.NextDecisionOrdinal);
    }

    [Fact]
    public void Propose_RejectsHeroWhoAlreadyResponded()
    {
        var state = Fixtures.StateWithTwoHeroes(requiredCrew: 2);
        var after = Engine.Apply(state, Propose(heroIndex: 0)).State;

        var result = Engine.Apply(after, Propose(heroIndex: 0));

        Assert.Equal(RejectionCodes.AlreadyResponded, result.RejectionCode);
    }

    [Fact]
    public void Propose_KeepsAcceptedByASubsetOfRespondedBy()
    {
        var state = Fixtures.StateWithSixHeroes(requiredCrew: 4);

        foreach (var index in new[] { 0, 1, 2, 3, 4, 5 })
        {
            var result = Engine.Apply(state, Propose(heroIndex: index));
            state = result.State;

            foreach (var contract in state.Contracts.Values)
            {
                Assert.True(
                    contract.AcceptedBy.IsSubsetOf(contract.RespondedBy),
                    $"after hero {index}: AcceptedBy left RespondedBy behind");
            }
        }
    }

    /// <summary>
    /// Builds the next command in this test's own sequence — see the remarks
    /// on <see cref="_nextCommandId"/>/<see cref="_nextExpectedStateVersion"/>
    /// for why a plain counter is enough. Every fixture this helper is used
    /// with (<see cref="Fixtures.StateWithTwoHeroes"/>,
    /// <see cref="Fixtures.StateWithSixHeroes"/>,
    /// <see cref="Fixtures.StateWithPrincipledHero"/>,
    /// <see cref="Fixtures.StateWithPrincipledHeroThenOrdinaryHero"/>) offers
    /// exactly one contract, at <see cref="Fixtures.ContractId"/>.
    /// </summary>
    private ProposeContractToHero Propose(int heroIndex)
    {
        var command = new ProposeContractToHero(
            _nextCommandId,
            new HeroId(heroIndex),
            Fixtures.ContractId,
            _nextExpectedStateVersion);

        _nextCommandId++;
        _nextExpectedStateVersion++;

        return command;
    }

    /// <summary>
    /// Zara's numbers put her decision at -33 before mood (payment pull 8,
    /// risk aversion 40, insult 5, trust 4), which the mood range (-5..+5)
    /// cannot reach — so this asserts a decision, not a seed.
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

    /// <summary>
    /// Bram sits at +9 before mood (payment pull 24, risk aversion 15, insult
    /// 5, trust 5) — the same argument, mirrored.
    /// </summary>
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
            scores.Add(result.Decision!.SelectedScore!.Value);
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
