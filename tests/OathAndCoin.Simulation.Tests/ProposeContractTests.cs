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

    [Fact]
    public void Propose_AddsAcceptingHeroToCrewAndKeepsOfferOpen()
    {
        var state = Fixtures.StateWithTwoHeroes(requiredCrew: 2);

        var afterFirst = Engine.Apply(state, Propose(commandId: 1, new HeroId(0), state)).State;

        var contract = afterFirst.Contracts.Values.Single();
        Assert.Equal(ContractStatus.Offered, contract.Status);
        Assert.Single(contract.AcceptedBy);
        Assert.Single(contract.RespondedBy);
    }

    [Fact]
    public void Propose_MarksContractCrewedWhenRequiredCrewIsReached()
    {
        var state = Fixtures.StateWithTwoHeroes(requiredCrew: 2);

        var first = Engine.Apply(state, Propose(commandId: 1, new HeroId(0), state));
        // Review finding (Important 1): on the pre-fix engine, the first
        // acceptance alone set Crewed, and this test's single assertion on
        // the final Status could not tell that apart from the correct
        // "reached RequiredCrew" behaviour — both paths land on Crewed here.
        // Applied/count on *each* step is what actually distinguishes them.
        Assert.True(first.Applied);

        var second = Engine.Apply(first.State, Propose(commandId: 2, new HeroId(1), first.State));
        Assert.True(second.Applied);

        var contract = second.State.Contracts.Values.Single();
        Assert.Equal(ContractStatus.Crewed, contract.Status);
        Assert.Equal(2, contract.AcceptedBy.Count);
    }

    [Fact]
    public void Propose_KeepsOrdinalUnchangedWhenAPrincipleBlocked()
    {
        var state = Fixtures.StateWithPrincipledHero();
        var before = state.Metadata.NextDecisionOrdinal;

        var after = Engine.Apply(state, Propose(commandId: 1, new HeroId(0), state)).State;

        Assert.Equal(before, after.Metadata.NextDecisionOrdinal);
    }

    [Fact]
    public void Propose_NextScoredDecisionReusesTheOrdinalTheGateDidNotRead()
    {
        var state = Fixtures.StateWithPrincipledHeroThenOrdinaryHero();
        var expectedOrdinal = state.Metadata.NextDecisionOrdinal;

        var afterGate = Engine.Apply(state, Propose(commandId: 1, new HeroId(0), state)).State;
        var afterScored = Engine.Apply(afterGate, Propose(commandId: 2, new HeroId(1), afterGate)).State;

        var expectedMood = ContractDecisionRule.DrawMood(state.Metadata.CampaignSeed, expectedOrdinal);
        Assert.Equal(expectedOrdinal + expectedMood.OrdinalsConsumed, afterScored.Metadata.NextDecisionOrdinal);
    }

    /// <summary>
    /// Review finding (Important 1): a version of this test that only
    /// checked <see cref="CommandResult.RejectionCode"/> was a verbatim
    /// duplicate of <see cref="SecondResponseFromSameHero_IsRejected"/> —
    /// same shape, same assertion, nothing new. This one uses a fixture
    /// where hero 0 actually
    /// <em>accepts</em> (unlike Zara, who declines in the fixture the older
    /// test uses), so it additionally proves the rejected retry did not
    /// double-count — or otherwise disturb — the crew membership the first,
    /// accepted response already recorded.
    /// </summary>
    [Fact]
    public void Propose_RejectsHeroWhoAlreadyResponded()
    {
        var state = Fixtures.StateWithTwoHeroes(requiredCrew: 2);
        var after = Engine.Apply(state, Propose(commandId: 1, new HeroId(0), state)).State;

        var result = Engine.Apply(after, Propose(commandId: 2, new HeroId(0), after));

        Assert.False(result.Applied);
        Assert.Equal(RejectionCodes.AlreadyResponded, result.RejectionCode);
        Assert.Same(after, result.State);
        Assert.Single(result.State.Contracts.Values.Single().AcceptedBy);
    }

    /// <summary>
    /// Review finding (Important 1): the previous version of this test only
    /// asserted the subset relationship, which the pre-fix engine (AcceptedBy
    /// permanently empty) satisfied trivially. Tracking how many proposals
    /// actually resulted in an accepted decision, independently of the
    /// engine's own bookkeeping, and asserting <c>AcceptedBy.Count</c> equals
    /// that number on every step is what a fixed-but-wrong AcceptedBy cannot
    /// pass by accident.
    /// </summary>
    [Fact]
    public void Propose_KeepsAcceptedByASubsetOfRespondedBy()
    {
        var state = Fixtures.StateWithSixHeroes(requiredCrew: 4);
        var acceptedCount = 0;

        for (var index = 0; index < 6; index++)
        {
            var result = Engine.Apply(state, Propose(commandId: index + 1, new HeroId(index), state));
            state = result.State;

            if (result.Applied && result.Decision!.SelectedAction == Actions.Accept)
            {
                acceptedCount++;
            }

            var contract = state.Contracts.Values.Single();
            Assert.True(
                contract.AcceptedBy.IsSubsetOf(contract.RespondedBy),
                $"after hero {index}: AcceptedBy left RespondedBy behind");
            Assert.Equal(acceptedCount, contract.AcceptedBy.Count);
        }
    }

    /// <summary>
    /// Review finding (Important 4): <see cref="RejectionCodes.ContractAlreadyResolved"/>
    /// had no dedicated test anywhere in the repository. A hero who has
    /// <em>not</em> responded yet, offered a contract that is already
    /// <see cref="ContractStatus.Crewed"/>, is the one case that reaches this
    /// code specifically — not <see cref="RejectionCodes.AlreadyResponded"/>,
    /// which would fire first for a hero who already answered.
    /// </summary>
    [Fact]
    public void Propose_RejectsProposalOnAnAlreadyCrewedContract()
    {
        var state = Fixtures.StateWithTwoHeroes(requiredCrew: 1);
        var afterFirst = Engine.Apply(state, Propose(commandId: 1, new HeroId(0), state)).State;
        Assert.Equal(ContractStatus.Crewed, afterFirst.Contracts.Values.Single().Status);

        var result = Engine.Apply(afterFirst, Propose(commandId: 2, new HeroId(1), afterFirst));

        Assert.False(result.Applied);
        Assert.Equal(RejectionCodes.ContractAlreadyResolved, result.RejectionCode);
        Assert.Same(afterFirst, result.State);
    }

    /// <summary>
    /// Review finding (Important 2): <see cref="DecisionContext.Crew"/>'s
    /// mapped <em>value</em> (which content id an accepted hero resolves to)
    /// was covered structurally — every accepted hero has an entry — but
    /// nothing checked that the entry names the right hero. A context that
    /// mapped every entry to the deciding hero's own definition instead of
    /// each comrade's would still pass every other test in this file (all of
    /// them use heroes with empty <see cref="HeroState.Relationships"/>).
    /// This fixture gives hero 1 a relationship keyed by hero 0's own
    /// definition — the bond factor's <see cref="TraceFactor.SourceEntity"/>
    /// must be hero 0's definition, or the wiring named the wrong comrade.
    /// </summary>
    [Fact]
    public void Propose_RecordsBondFactorNamingTheAcceptedComradesDefinition()
    {
        var state = Fixtures.StateWithBondedHeroes(relationshipWeight: 7);

        var afterFirst = Engine.Apply(state, Propose(commandId: 1, new HeroId(0), state));
        Assert.True(afterFirst.Applied);

        var second = Engine.Apply(afterFirst.State, Propose(commandId: 2, new HeroId(1), afterFirst.State));

        var bondFactor = Assert.Single(
            second.Decision!.Trace.PositiveFactors.Concat(second.Decision.Trace.NegativeFactors),
            factor => factor.ReasonCode is ReasonCodes.StandsWithComrade or ReasonCodes.WillNotWorkWith);
        Assert.Equal(Fixtures.BondedComradeDefinition, bondFactor.SourceEntity);
    }

    /// <summary>
    /// Review finding (Important 3): no fixture ever gave a hero more than
    /// one trait, and the real Gate 0 content gives both Bram and Zara
    /// exactly one each — so nothing exercised the sort
    /// <c>Apply</c> performs before handing <c>Traits</c> to
    /// <see cref="ContractDecisionRule.Decide"/>, which asserts the ordering
    /// rather than restoring it. This fixture authors two inclinations in
    /// <see cref="HeroState.Traits"/> in the <em>reverse</em> of their id
    /// order — if the engine ever stopped sorting, this would either throw
    /// (the rule's own ordering assertion) or silently drop the sort's
    /// effect, and either way this test would no longer see both factors,
    /// correctly attributed, at their authored weights.
    /// </summary>
    [Fact]
    public void Propose_ResolvesTraitsRegardlessOfTheirAuthoredOrder()
    {
        var state = Fixtures.StateWithTraitsAuthoredOutOfOrder();

        var result = Engine.Apply(state, Propose(commandId: 1, new HeroId(0), state));

        Assert.True(result.Applied);
        Assert.Contains(
            result.Decision!.Trace.PositiveFactors,
            factor => factor.ReasonCode == ReasonCodes.PersonalConviction
                && factor.SourceEntity == Fixtures.LowerTraitId
                && factor.Magnitude == 3);
        Assert.Contains(
            result.Decision.Trace.PositiveFactors,
            factor => factor.ReasonCode == ReasonCodes.PersonalConviction
                && factor.SourceEntity == Fixtures.HigherTraitId
                && factor.Magnitude == 5);
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
    /// verdict (AGENTS.md §8).
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
