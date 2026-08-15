using System.Collections.Immutable;
using OathAndCoin.Simulation.Decisions;
using OathAndCoin.Simulation.Ids;
using OathAndCoin.Simulation.State;

namespace OathAndCoin.Simulation.Tests;

/// <summary>
/// The gate step of <see cref="ContractDecisionRule.Decide"/> (HERO_DECISION_SPEC §2.2):
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
    /// The sum-of-motives step (HERO_DECISION_SPEC §2.3): payment, risk, insult, personal
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

        // Magnitude alone would still pass an implementation that folded a
        // negative weight into a positive magnitude and filed it under
        // PositiveFactors anyway (e.g. via Math.Abs without routing by sign)
        // — the whole point of "the list says the sign" is which list the
        // factor is actually in.
        Assert.Contains(drawn.Result.Trace.PositiveFactors, f => f.ReasonCode == ReasonCodes.PersonalConviction);
        Assert.DoesNotContain(drawn.Result.Trace.NegativeFactors, f => f.ReasonCode == ReasonCodes.PersonalConviction);

        Assert.Contains(repelled.Result.Trace.NegativeFactors, f => f.ReasonCode == ReasonCodes.PersonalAversion);
        Assert.DoesNotContain(repelled.Result.Trace.PositiveFactors, f => f.ReasonCode == ReasonCodes.PersonalAversion);
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
        var mira = ContentId.Parse("core:mira");

        // Mira is in Crew (so the rule could resolve her ContentId if it
        // looked her up) but never listed in AcceptedBy — a helper that
        // walked context.Crew instead of contract.AcceptedBy would count her
        // relationship anyway, and the two collections would be
        // indistinguishable if this test built AcceptedBy from Crew's own
        // keys, which is exactly why they are supplied separately here.
        var decision = ContractDecisionRule.Decide(Context(
            relationships: [(zara, -8), (mira, 7)],
            crew: [(new HeroId(2), zara), (new HeroId(3), mira)],
            acceptedBy: [new HeroId(2)]));

        var factor = Single(decision, ReasonCodes.WillNotWorkWith);
        Assert.Equal(8, factor.Magnitude);
        Assert.Equal(zara, factor.SourceEntity);
        Assert.Contains(decision.Result.Trace.NegativeFactors, f => f.ReasonCode == ReasonCodes.WillNotWorkWith);
        Assert.DoesNotContain(decision.Result.Trace.PositiveFactors, f => f.ReasonCode == ReasonCodes.WillNotWorkWith);

        Assert.DoesNotContain(
            decision.Result.Trace.PositiveFactors.Concat(decision.Result.Trace.NegativeFactors),
            f => f.SourceEntity == mira);
    }

    /// <summary>
    /// The mutant this guards against: folding the whole sum into one
    /// division — <c>(payment*greed - risk*caution) / 100</c> instead of
    /// <c>payment*greed/100 - risk*caution/100</c> — passes every other test
    /// in this file, because none of them happen to pick numbers where
    /// integer division on the combined numerator rounds differently than
    /// dividing each term first. These do: 30*47/100 = 14 and 50*19/100 = 9
    /// (14 - 9 = 5), while (30*47 - 50*19)/100 = 460/100 = 4 — one whole
    /// point apart, on the boundary a real decision could straddle. Mood
    /// still applies on top of either number, so the assertion adds
    /// <see cref="ContractDecisionRule.DrawMood"/>'s own result for this
    /// context's (seed, ordinal) rather than assuming it away.
    /// </summary>
    [Fact]
    public void Decide_DividesEachTermSeparately_NotTheCombinedSum()
    {
        var context = Context(payment: 30, greed: 47, risk: 50, caution: 19, pride: 0, trust: 0);

        var decision = ContractDecisionRule.Decide(context);
        var mood = ContractDecisionRule.DrawMood(context.CampaignSeed, context.DecisionOrdinal).Value;

        Assert.Equal(5 + mood, decision.Result.SelectedScore);
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
    /// Mood (Task 7) is added to the trace like any other factor: present
    /// exactly when its value is non-zero, and living in whichever list its
    /// sign says. <see cref="ContractDecisionRule.DrawMood"/> is asked
    /// directly for the same <c>(seed, ordinal)</c> the context uses, rather
    /// than assuming a particular draw — the point is that mood follows the
    /// same "zero stays out of the trace" rule, not that this test knows
    /// what mood 42/0 happens to draw.
    /// </summary>
    [Fact]
    public void Decide_AddsMoodAsAnOrdinaryFactor()
    {
        var decision = ContractDecisionRule.Decide(Context(seed: 42, ordinal: 0));

        var mood = decision.Result.Trace.PositiveFactors
            .Concat(decision.Result.Trace.NegativeFactors)
            .SingleOrDefault(f => f.ReasonCode == ReasonCodes.UnpredictableMood);

        var expected = ContractDecisionRule.DrawMood(42, 0);
        Assert.Equal(expected.Value == 0, mood is null);
        Assert.True(decision.OrdinalsConsumed >= 1);
    }

    /// <summary>
    /// The trace is not decoration alongside the score — it is the
    /// arithmetic, so the sum of every factor's magnitude (positive minus
    /// negative) must equal <see cref="DecisionResult.SelectedScore"/>
    /// exactly, mood included.
    /// </summary>
    [Fact]
    public void Decide_SumOfFactorsEqualsSelectedScore()
    {
        var decision = ContractDecisionRule.Decide(Context(greed: 70, payment: 60, caution: 40, risk: 50, trust: 30));

        var positive = decision.Result.Trace.PositiveFactors.Sum(f => f.Magnitude);
        var negative = decision.Result.Trace.NegativeFactors.Sum(f => f.Magnitude);
        Assert.Equal(decision.Result.SelectedScore, positive - negative);
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
    /// contract offers, which comrades exist in <see cref="DecisionContext.Crew"/>,
    /// which of those have actually accepted the contract, and the six
    /// hero/contract numbers the sum-of-motives step reads. Numeric defaults
    /// (50) are chosen so the scored path, if it ran, would not itself decide
    /// a gate test's outcome — a gate test failing for a scoring reason would
    /// be a confusing way to fail.
    /// </summary>
    /// <param name="acceptedBy">
    /// <see cref="ContractState.AcceptedBy"/> explicitly, defaulting to
    /// <paramref name="crew"/>'s own <see cref="HeroId"/>s when omitted. Kept
    /// as a separate parameter rather than always derived from
    /// <paramref name="crew"/>: a test that wants to prove the rule walks
    /// <c>AcceptedBy</c> — not every hero it happens to find in
    /// <c>Crew</c> — needs to be able to put someone in <c>Crew</c> without
    /// also putting them here.
    /// </param>
    internal static DecisionContext Context(
        (string PrincipleId, string Tag)[]? principles = null,
        string[]? contractTags = null,
        (string TraitId, string Tag, int Weight)[]? inclinations = null,
        (ContentId Definition, int Weight)[]? relationships = null,
        (HeroId HeroId, ContentId Definition)[]? crew = null,
        HeroId[]? acceptedBy = null,
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
        acceptedBy ??= crew.Select(c => c.HeroId).ToArray();

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
            AcceptedBy = ImmutableSortedSet.CreateRange(acceptedBy),
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

    /// <summary>
    /// Positional overload used by <see cref="DecisionPropertyTests"/>'s
    /// grids: those tests hold the tag/relationship/crew shape and the seed
    /// fixed and sweep the numbers a score is made of, so a positional
    /// signature reads better at each of the thousands of call sites than the
    /// named-argument form above. Delegates to the named overload above rather
    /// than duplicating its construction logic — the explicit <c>seed: 1</c>
    /// argument (a name this overload does not have) is what forces overload
    /// resolution to prefer that method over recursing into this one.
    /// <para>
    /// <c>trust</c> is a parameter here, defaulted rather than hard-coded.
    /// Review finding: it used to be pinned at 50 inside this method, so the
    /// trust term contributed the identical 5 in every one of the tens of
    /// thousands of grid calls, and the only test that swept trust at all took
    /// the gate path, where the term is never computed —
    /// <see cref="DecisionPropertyTests.TrustContributesItsOwnTenthOfTheScale"/>
    /// and <see cref="DecisionPropertyTests.RaisingTrustNeverTurnsAcceptanceIntoRefusal"/>
    /// are what actually vary it now.
    /// </summary>
    internal static DecisionContext Context(
        int greed, int caution, int pride, int payment, int risk, ulong ordinal, int trust = 50) =>
        Context(
            greed: greed, caution: caution, pride: pride, payment: payment, risk: risk, ordinal: ordinal,
            trust: trust, seed: 1);

    /// <summary>
    /// A hero with exactly one principle, tagged so it always matches the
    /// contract — the gate closes the decision before <paramref name="payment"/>,
    /// <paramref name="risk"/> or <paramref name="trust"/> are ever read, which
    /// is the property <see cref="DecisionPropertyTests.PrincipleHoldsAtEveryPaymentAndRisk"/>
    /// exists to pin down.
    /// </summary>
    internal static DecisionContext ContextWithPrinciple(int payment, int risk, int trust) =>
        Context(
            principles: [("core:property_test_principle", "target:property_test")],
            contractTags: ["target:property_test"],
            payment: payment,
            risk: risk,
            trust: trust);
}
