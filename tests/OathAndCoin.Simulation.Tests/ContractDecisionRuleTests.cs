using System.Collections.Immutable;
using OathAndCoin.Simulation.Decisions;
using OathAndCoin.Simulation.Ids;
using OathAndCoin.Simulation.State;

namespace OathAndCoin.Simulation.Tests;

/// <summary>
/// The gate step of <see cref="ContractDecisionRule.Decide"/> (spec §3.2):
/// a violated principle closes the decision before any arithmetic, with no
/// score and no mood draw. The scored path (payment/risk/trust/mood) is
/// still exercised end to end through <see cref="SimulationEngine"/> in
/// <see cref="ProposeContractTests"/> — this file only adds what those tests
/// cannot: a hero whose traits actually include a principle.
/// </summary>
public class ContractDecisionRuleTests
{
    private static readonly ContentId HeroDefinition = ContentId.Parse("core:bram");

    private static readonly ContentId ContractId = ContentId.Parse("core:escort_the_caravan");

    [Fact]
    public void Decide_BlocksWhenPrincipleTagMatchesContract()
    {
        var context = Context(
            principles: [("core:will_not_strike_a_temple", "target:temple")],
            contractTags: ["target:temple"],
            payment: 100,
            risk: 0);

        var decision = ContractDecisionRule.Decide(context);

        Assert.Equal(Actions.Decline, decision.Result.SelectedAction);
        Assert.Null(decision.Result.SelectedScore);
        Assert.Equal(0ul, decision.OrdinalsConsumed);
        var block = Assert.Single(decision.Result.Trace.BlockedBy);
        Assert.Equal(ReasonCodes.PrincipleForbids, block.ReasonCode);
        Assert.Equal(ContentId.Parse("core:will_not_strike_a_temple"), block.SourceEntity);
        Assert.Empty(decision.Result.Trace.PositiveFactors);
        Assert.Empty(decision.Result.Trace.NegativeFactors);
    }

    [Fact]
    public void Decide_ReportsEveryViolatedPrincipleInContentIdOrder()
    {
        var context = Context(
            principles: [("core:zz_last", "target:temple"), ("core:aa_first", "target:temple")],
            contractTags: ["target:temple"]);

        var blocks = ContractDecisionRule.Decide(context).Result.Trace.BlockedBy;

        Assert.Equal(
            new[] { ContentId.Parse("core:aa_first"), ContentId.Parse("core:zz_last") },
            blocks.Select(b => b.SourceEntity).ToArray());
    }

    [Fact]
    public void Decide_DoesNotBlockWhenPrincipleTagIsAbsent()
    {
        var context = Context(
            principles: [("core:will_not_strike_a_temple", "target:temple")],
            contractTags: ["target:bandits"]);

        Assert.Empty(ContractDecisionRule.Decide(context).Result.Trace.BlockedBy);
    }

    /// <summary>
    /// Builds a <see cref="DecisionContext"/> from the minimum a gate test
    /// needs to state: which principles the hero carries (id, tag) and which
    /// tags the contract offers. Everything else defaults to values chosen so
    /// the scored path (payment/risk/trust/mood), if it ran, would not itself
    /// decide the outcome — a gate test failing for a scoring reason would be
    /// a confusing way to fail.
    /// </summary>
    private static DecisionContext Context(
        (string PrincipleId, string Tag)[] principles,
        string[] contractTags,
        int greed = 50,
        int caution = 50,
        int pride = 50,
        int trust = 50,
        int payment = 50,
        int risk = 50,
        ulong seed = 1,
        ulong ordinal = 0,
        long traceId = 1)
    {
        var traits = principles
            .Select(p => new HeldTrait(ContentId.Parse(p.PrincipleId), ContentId.Parse(p.Tag), IsPrinciple: true, Weight: 0))
            .OrderBy(t => t.Id)
            .ToImmutableArray();

        var hero = new HeroState
        {
            Id = new HeroId(0),
            Definition = HeroDefinition,
            DisplayNameKey = "hero.core.bram.name",
            Greed = greed,
            Caution = caution,
            Pride = pride,
            TrustInGuild = trust,
            Traits = traits.Select(t => t.Id).ToImmutableArray(),
            Relationships = ImmutableSortedDictionary<ContentId, int>.Empty,
        };

        var contract = new ContractState
        {
            Id = ContractId,
            Payment = payment,
            Risk = risk,
            RequiredCrew = 1,
            Tags = ImmutableSortedSet.CreateRange(contractTags.Select(ContentId.Parse)),
            Status = ContractStatus.Offered,
            RespondedBy = ImmutableSortedSet<HeroId>.Empty,
            AcceptedBy = ImmutableSortedSet<HeroId>.Empty,
        };

        return new DecisionContext
        {
            Hero = hero,
            Contract = contract,
            Traits = traits,
            Crew = ImmutableSortedDictionary<HeroId, ContentId>.Empty,
            CampaignSeed = seed,
            DecisionOrdinal = ordinal,
            TraceId = traceId,
        };
    }
}
