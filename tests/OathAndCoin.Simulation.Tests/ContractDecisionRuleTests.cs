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
    /// The sum-of-motives step (spec §3.3): payment, risk, insult, personal
    /// inclinations, guild trust and bonds to already-committed comrades —
    /// each its own signed, individually-divided term, each surfacing as its
    /// own trace factor with a stable reason code and a source entity a
    /// player could go inspect. Mood (Task 7) already runs underneath these
    /// via <see cref="SimulationEngine"/>-level tests in
    /// <see cref="ProposeContractTests"/>; nothing here depends on its value.
    /// </summary>
    [Fact]
    public void Decide_PaymentPullIsWeightedByGreed()
    {
        var decision = ContractDecisionRule.Decide(Context(greed: 60, payment: 40, caution: 0, pride: 0, trust: 0));

        var factor = Single(decision, ReasonCodes.PaymentAttractive);
        Assert.Equal(24, factor.Magnitude);
    }

    [Fact]
    public void Decide_InsultAppliesOnlyWhenPaymentIsBelowRisk()
    {
        var insulted = ContractDecisionRule.Decide(Context(pride: 50, payment: 20, risk: 60, greed: 0, caution: 0, trust: 0));
        var paidFairly = ContractDecisionRule.Decide(Context(pride: 50, payment: 60, risk: 60, greed: 0, caution: 0, trust: 0));

        Assert.Equal(20, Single(insulted, ReasonCodes.PaymentInsulting).Magnitude);
        Assert.DoesNotContain(
            paidFairly.Result.Trace.NegativeFactors,
            f => f.ReasonCode == ReasonCodes.PaymentInsulting);
    }

    [Fact]
    public void Decide_InclinationContributesWithItsOwnSign()
    {
        var drawn = ContractDecisionRule.Decide(Context(
            inclinations: [("core:hates_the_cult", "target:cult", 12)],
            contractTags: ["target:cult"]));
        var repelled = ContractDecisionRule.Decide(Context(
            inclinations: [("core:fears_undeath", "target:undead", -9)],
            contractTags: ["target:undead"]));

        Assert.Equal(12, Single(drawn, ReasonCodes.PersonalConviction).Magnitude);
        Assert.Equal(9, Single(repelled, ReasonCodes.PersonalAversion).Magnitude);
    }

    [Fact]
    public void Decide_IgnoresInclinationWhoseTagTheContractLacks()
    {
        var decision = ContractDecisionRule.Decide(Context(
            inclinations: [("core:hates_the_cult", "target:cult", 12)],
            contractTags: ["target:bandits"]));

        Assert.DoesNotContain(
            decision.Result.Trace.PositiveFactors,
            f => f.ReasonCode == ReasonCodes.PersonalConviction);
    }

    [Fact]
    public void Decide_BondsCountOnlyHeroesWhoAlreadyAccepted()
    {
        var zara = ContentId.Parse("core:zara");
        var decision = ContractDecisionRule.Decide(Context(
            relationships: [(zara, -8)],
            crew: [(new HeroId(2), zara)]));

        var factor = Single(decision, ReasonCodes.WillNotWorkWith);
        Assert.Equal(8, factor.Magnitude);
        Assert.Equal(zara, factor.SourceEntity);
    }

    [Fact]
    public void Decide_OmitsZeroMagnitudeFactors()
    {
        var decision = ContractDecisionRule.Decide(Context(greed: 0, caution: 0, pride: 0, trust: 0, payment: 0, risk: 0));

        Assert.DoesNotContain(
            decision.Result.Trace.PositiveFactors.Concat(decision.Result.Trace.NegativeFactors),
            f => f.Magnitude == 0);
    }

    /// <summary>
    /// Finds the one factor with <paramref name="reasonCode"/> across both
    /// <see cref="CausalTrace.PositiveFactors"/> and
    /// <see cref="CausalTrace.NegativeFactors"/> — which list it actually
    /// landed in is exactly what the caller is trying to pin down, so this
    /// looks at both rather than assuming one. Fails if the code is absent or
    /// (a modelling error that would otherwise pass silently) present in both.
    /// </summary>
    private static TraceFactor Single(HeroDecision decision, string reasonCode) =>
        Assert.Single(
            decision.Result.Trace.PositiveFactors
                .Concat(decision.Result.Trace.NegativeFactors)
                .Where(f => f.ReasonCode == reasonCode));

    /// <summary>
    /// Builds a <see cref="DecisionContext"/> from the minimum a test needs to
    /// state: which principles/inclinations the hero carries, which tags the
    /// contract offers, which comrades it should treat as already-accepted
    /// crew, and the six hero/contract numbers the sum-of-motives step reads.
    /// Numeric defaults (50) are chosen so the scored path, if it ran, would
    /// not itself decide a gate test's outcome — a gate test failing for a
    /// scoring reason would be a confusing way to fail.
    /// </summary>
    private static DecisionContext Context(
        (string PrincipleId, string Tag)[]? principles = null,
        string[]? contractTags = null,
        (string TraitId, string Tag, int Weight)[]? inclinations = null,
        (ContentId Definition, int Weight)[]? relationships = null,
        (HeroId HeroId, ContentId Definition)[]? crew = null,
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
        principles ??= [];
        contractTags ??= [];
        inclinations ??= [];
        relationships ??= [];
        crew ??= [];

        var traits = principles
            .Select(p => new HeldTrait(ContentId.Parse(p.PrincipleId), ContentId.Parse(p.Tag), IsPrinciple: true, Weight: 0))
            .Concat(inclinations.Select(i =>
                new HeldTrait(ContentId.Parse(i.TraitId), ContentId.Parse(i.Tag), IsPrinciple: false, Weight: i.Weight)))
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
            Relationships = relationships.ToImmutableSortedDictionary(r => r.Definition, r => r.Weight),
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
            AcceptedBy = ImmutableSortedSet.CreateRange(crew.Select(c => c.HeroId)),
        };

        return new DecisionContext
        {
            Hero = hero,
            Contract = contract,
            Traits = traits,
            Crew = crew.ToImmutableSortedDictionary(c => c.HeroId, c => c.Definition),
            CampaignSeed = seed,
            DecisionOrdinal = ordinal,
            TraceId = traceId,
        };
    }
}
