using System.Collections.Immutable;
using System.Reflection;
using OathAndCoin.Simulation.Decisions;
using OathAndCoin.Simulation.Events;
using OathAndCoin.Simulation.Ids;
using OathAndCoin.Simulation.State;

namespace OathAndCoin.Simulation.Tests;

/// <summary>
/// One mutation per member, for every hand-written <c>Equals</c> in the core.
/// </summary>
/// <remarks>
/// <para>
/// Review finding (branch-level): <see cref="StructuralEqualityTests"/> varies
/// collections only, because collections are what the hand-written
/// <c>Equals</c> overrides were written for. Every scalar member rode along
/// untested — deleting the greed comparison from <see cref="HeroState"/>, the
/// payment or status comparison from <see cref="ContractState"/>, or the
/// trait rulebook from <see cref="GameState"/> left the whole suite green.
/// </para>
/// <para>
/// The mutation tables below are the mutations; the reflective check is what
/// keeps them complete. A property added to one of these records without a
/// mutation here fails <em>this</em> test by name, rather than quietly
/// joining the set of members nothing compares — which is the exact failure
/// this file exists to close, restated one level up.
/// </para>
/// <para>
/// Only <c>Equals</c> is asserted, never hash inequality: two unequal values
/// are allowed to hash alike, and a test demanding otherwise would be
/// asserting something the contract does not promise. Equal-implies-equal-hash
/// is <see cref="StructuralEqualityTests.GetHashCode_IsConsistentWithEquals"/>'s
/// business.
/// </para>
/// </remarks>
public class EqualityMutationTests
{
    [Fact]
    public void HeroState_EqualsSeparatesEveryMember() => AssertEveryMemberSeparated(
        Fixtures.Hero(),
        new Dictionary<string, Func<HeroState, HeroState>>(StringComparer.Ordinal)
        {
            [nameof(HeroState.Id)] = hero => hero with { Id = new HeroId(hero.Id.Value + 1) },
            [nameof(HeroState.Definition)] = hero => hero with { Definition = ContentId.Parse("core:other") },
            [nameof(HeroState.DisplayNameKey)] = hero => hero with { DisplayNameKey = "hero.core.other.name" },
            [nameof(HeroState.Greed)] = hero => hero with { Greed = hero.Greed + 1 },
            [nameof(HeroState.Caution)] = hero => hero with { Caution = hero.Caution + 1 },
            [nameof(HeroState.Pride)] = hero => hero with { Pride = hero.Pride + 1 },
            [nameof(HeroState.TrustInGuild)] = hero => hero with { TrustInGuild = hero.TrustInGuild + 1 },
            [nameof(HeroState.Traits)] = hero => hero with
            {
                Traits = ImmutableArray.Create(ContentId.Parse("core:hates_the_cult")),
            },
            [nameof(HeroState.Relationships)] = hero => hero with
            {
                Relationships = ImmutableSortedDictionary<ContentId, int>.Empty
                    .Add(ContentId.Parse("core:zara"), -8),
            },
        });

    [Fact]
    public void ContractState_EqualsSeparatesEveryMember() => AssertEveryMemberSeparated(
        Fixtures.Contract(),
        new Dictionary<string, Func<ContractState, ContractState>>(StringComparer.Ordinal)
        {
            [nameof(ContractState.Id)] = contract => contract with { Id = ContentId.Parse("core:other_job") },
            [nameof(ContractState.Payment)] = contract => contract with { Payment = contract.Payment - 1 },
            [nameof(ContractState.Risk)] = contract => contract with { Risk = contract.Risk + 1 },
            [nameof(ContractState.RequiredCrew)] = contract => contract with
            {
                RequiredCrew = contract.RequiredCrew + 1,
            },
            [nameof(ContractState.Tags)] = contract => contract with
            {
                Tags = ImmutableSortedSet.Create(ContentId.Parse("target:cult")),
            },
            [nameof(ContractState.Status)] = contract => contract with { Status = ContractStatus.Crewed },
            [nameof(ContractState.RespondedBy)] = contract => contract with
            {
                RespondedBy = ImmutableSortedSet.Create(new HeroId(1)),
            },
            [nameof(ContractState.AcceptedBy)] = contract => contract with
            {
                AcceptedBy = ImmutableSortedSet.Create(new HeroId(1)),
            },
        });

    [Fact]
    public void GameState_EqualsSeparatesEveryMember() => AssertEveryMemberSeparated(
        Baseline(),
        new Dictionary<string, Func<GameState, GameState>>(StringComparer.Ordinal)
        {
            [nameof(GameState.Metadata)] = state => state with
            {
                Metadata = state.Metadata with { StateVersion = state.Metadata.StateVersion + 1 },
            },
            [nameof(GameState.Heroes)] = state => state with
            {
                Heroes = state.Heroes.SetItem(new HeroId(1), Fixtures.Hero() with { Greed = 99 }),
            },
            [nameof(GameState.Contracts)] = state => state with
            {
                Contracts = state.Contracts.SetItem(Fixtures.ContractId, Fixtures.Contract() with { Payment = 1 }),
            },
            [nameof(GameState.AppliedCommandIds)] = state => state with
            {
                AppliedCommandIds = state.AppliedCommandIds.Add(42),
            },
            [nameof(GameState.TraitRules)] = state => state with
            {
                TraitRules = state.TraitRules.SetItem(
                    ContentId.Parse("core:hates_the_cult"),
                    new HeldTrait(
                        ContentId.Parse("core:hates_the_cult"),
                        ContentId.Parse("target:cult"),
                        IsPrinciple: false,
                        Weight: 7)),
            },
            [nameof(GameState.Traces)] = state => state with
            {
                Traces = state.Traces.SetItem(1, Trace(traceId: 1, magnitude: 9)),
            },
            [nameof(GameState.History)] = state => state with
            {
                History = ImmutableArray<DomainEvent>.Empty,
            },
        });

    /// <summary>
    /// <see cref="GameMetadata"/> is a plain record with no hand-written
    /// <c>Equals</c>, so the compiler's memberwise comparison already covers
    /// it — but <see cref="GameState.Equals(GameState?)"/> compares it with a
    /// single <c>Metadata == other.Metadata</c>, and every scalar identifying
    /// a run's position in the campaign lives inside it. Held here so that
    /// stays true rather than being assumed from the language.
    /// </summary>
    [Fact]
    public void GameMetadata_EqualsSeparatesEveryMember() => AssertEveryMemberSeparated(
        Metadata(),
        new Dictionary<string, Func<GameMetadata, GameMetadata>>(StringComparer.Ordinal)
        {
            [nameof(GameMetadata.SaveSchemaVersion)] = m => m with { SaveSchemaVersion = m.SaveSchemaVersion + 1 },
            [nameof(GameMetadata.RulesetVersion)] = m => m with { RulesetVersion = "other" },
            [nameof(GameMetadata.ContentVersion)] = m => m with { ContentVersion = "other" },
            [nameof(GameMetadata.CampaignSeed)] = m => m with { CampaignSeed = m.CampaignSeed + 1 },
            [nameof(GameMetadata.StateVersion)] = m => m with { StateVersion = m.StateVersion + 1 },
            [nameof(GameMetadata.LogicalTime)] = m => m with { LogicalTime = m.LogicalTime + 1 },
            [nameof(GameMetadata.NextEventId)] = m => m with { NextEventId = m.NextEventId + 1 },
            [nameof(GameMetadata.NextTraceId)] = m => m with { NextTraceId = m.NextTraceId + 1 },
            [nameof(GameMetadata.NextDecisionOrdinal)] = m => m with
            {
                NextDecisionOrdinal = m.NextDecisionOrdinal + 1,
            },
        });

    /// <summary>
    /// Review finding (branch-level, I10): the decision-result mutators varied
    /// neither the chosen action nor the score — the two members a reader of
    /// a decision actually cares about — so removing either comparison from
    /// <see cref="DecisionResult"/>'s own equality left every test green.
    /// </summary>
    [Fact]
    public void DecisionResult_EqualsSeparatesEveryMember() => AssertEveryMemberSeparated(
        Decision(),
        new Dictionary<string, Func<DecisionResult, DecisionResult>>(StringComparer.Ordinal)
        {
            [nameof(DecisionResult.SelectedAction)] = d => d with { SelectedAction = Actions.Decline },
            [nameof(DecisionResult.ConsideredActions)] = d => d with
            {
                ConsideredActions = ImmutableArray.Create(Actions.Decline, Actions.Accept),
            },
            [nameof(DecisionResult.SelectedScore)] = d => d with { SelectedScore = d.SelectedScore + 1 },
            [nameof(DecisionResult.Trace)] = d => d with { Trace = Trace(traceId: 7, magnitude: 4) },
        });

    /// <summary>
    /// Review finding (branch-level, I10): the trace mutators never varied a
    /// negative factor, so deleting <c>NegativeFactors</c> from the
    /// comparison was green — on the one type whose whole purpose is to carry
    /// both sides of an argument.
    /// </summary>
    [Fact]
    public void CausalTrace_EqualsSeparatesEveryMember() => AssertEveryMemberSeparated(
        Trace(traceId: 7, magnitude: 3),
        new Dictionary<string, Func<CausalTrace, CausalTrace>>(StringComparer.Ordinal)
        {
            [nameof(CausalTrace.TraceId)] = trace => trace with { TraceId = trace.TraceId + 1 },
            [nameof(CausalTrace.PositiveFactors)] = trace => trace with
            {
                PositiveFactors = ImmutableArray.Create(
                    new TraceFactor(ReasonCodes.PaymentAttractive, Fixtures.ContractId, 99)),
            },
            [nameof(CausalTrace.NegativeFactors)] = trace => trace with
            {
                NegativeFactors = ImmutableArray.Create(
                    new TraceFactor(ReasonCodes.RiskTooHigh, Fixtures.ContractId, 99)),
            },
            [nameof(CausalTrace.BlockedBy)] = trace => trace with
            {
                // Added, not emptied: the baseline's BlockedBy is already
                // empty, so "mutating" it to empty is a no-op that asserts
                // nothing. CausalTrace on its own permits factors and blocks
                // together — the rule that they are exclusive lives on
                // DecisionResult, which is not what is under test here.
                BlockedBy = ImmutableArray.Create(
                    new TraceBlock(ReasonCodes.PrincipleForbids, ContentId.Parse("core:refuses_deception"))),
            },
            [nameof(CausalTrace.TieBreak)] = trace => trace with { TieBreak = "hero.decision.unpredictable_mood" },
        });

    private static void AssertEveryMemberSeparated<T>(T baseline, IReadOnlyDictionary<string, Func<T, T>> mutations)
        where T : notnull
    {
        var properties = typeof(T)
            .GetProperties(BindingFlags.Public | BindingFlags.Instance)
            .Where(property => property.GetIndexParameters().Length == 0)

            // The compiler synthesizes EqualityContract on every record; it is
            // not a member anyone declared and has nothing to mutate.
            .Where(property => property.Name != "EqualityContract")
            .Select(property => property.Name)
            .ToHashSet(StringComparer.Ordinal);

        Assert.True(
            properties.SetEquals(mutations.Keys),
            $"{typeof(T).Name}: every public property needs a mutation here, and every mutation needs a "
            + $"property. Missing mutations: [{string.Join(", ", properties.Except(mutations.Keys))}]. "
            + $"Mutations for properties that no longer exist: "
            + $"[{string.Join(", ", mutations.Keys.Except(properties))}].");

        foreach (var (name, mutate) in mutations)
        {
            var mutated = mutate(baseline);

            Assert.False(
                baseline.Equals(mutated),
                $"{typeof(T).Name}.Equals treats two values differing only in '{name}' as equal — that member "
                + "is not compared.");
        }
    }

    private static GameMetadata Metadata() => new()
    {
        SaveSchemaVersion = 1,
        RulesetVersion = "milestone-1",
        ContentVersion = "abc123",
        CampaignSeed = 424242,
        StateVersion = 3,
        LogicalTime = 2,
        NextEventId = 5,
        NextTraceId = 4,
        NextDecisionOrdinal = 2,
    };

    /// <summary>
    /// Every collection non-empty on purpose, the same rule
    /// <see cref="StructuralEqualityTests"/>'s remarks give: an all-empty
    /// fixture compares equal under plain reference equality too, because
    /// every collection is the same shared <c>Empty</c> singleton.
    /// </summary>
    private static GameState Baseline() => new()
    {
        Metadata = Metadata(),
        Heroes = ImmutableSortedDictionary<HeroId, HeroState>.Empty.Add(new HeroId(1), Fixtures.Hero()),
        Contracts = ImmutableSortedDictionary<ContentId, ContractState>.Empty
            .Add(Fixtures.ContractId, Fixtures.Contract()),
        AppliedCommandIds = ImmutableSortedSet.Create(1L),
        TraitRules = ImmutableSortedDictionary<ContentId, HeldTrait>.Empty.Add(
            ContentId.Parse("core:hates_the_cult"),
            new HeldTrait(
                ContentId.Parse("core:hates_the_cult"),
                ContentId.Parse("target:cult"),
                IsPrinciple: false,
                Weight: 6)),
        Traces = ImmutableSortedDictionary<long, CausalTrace>.Empty.Add(1, Trace(traceId: 1, magnitude: 3)),
        History = ImmutableArray.Create<DomainEvent>(
            new HeroAcceptedContract(
                EventId: 1,
                LogicalTime: 1,
                CausalTraceId: 1,
                HeroId: new HeroId(1),
                ContractId: Fixtures.ContractId)),
    };

    private static CausalTrace Trace(long traceId, int magnitude) => new()
    {
        TraceId = traceId,
        PositiveFactors = ImmutableArray.Create(
            new TraceFactor(ReasonCodes.PaymentAttractive, Fixtures.ContractId, magnitude)),
        NegativeFactors = ImmutableArray.Create(
            new TraceFactor(ReasonCodes.RiskTooHigh, Fixtures.ContractId, magnitude)),
        BlockedBy = ImmutableArray<TraceBlock>.Empty,
    };

    private static DecisionResult Decision() => new()
    {
        SelectedAction = Actions.Accept,
        ConsideredActions = ImmutableArray.Create(Actions.Accept, Actions.Decline),
        SelectedScore = 3,
        Trace = Trace(traceId: 7, magnitude: 3),
    };
}
