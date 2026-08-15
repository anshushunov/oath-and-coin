using System.Collections.Immutable;
using OathAndCoin.Content.Scenarios;
using OathAndCoin.Simulation.Commands;
using OathAndCoin.Simulation.Decisions;
using OathAndCoin.Simulation.Ids;
using OathAndCoin.Simulation.State;

namespace OathAndCoin.Content.Tests;

/// <summary>
/// Task 13's own claim: at least twenty scenarios, each replaying byte for
/// byte to a canonical artifact checked in beside its manifest and commands
/// (spec §8.1, this task's brief).
/// </summary>
/// <remarks>
/// <para>
/// <see cref="EveryScenarioReplaysToItsCanonicalArtifact"/> and
/// <see cref="AtLeastTwentyScenariosAreShipped"/> are the brief's own test
/// bodies, taken verbatim. Everything else in this file exists because those
/// two, on their own, prove only that a scenario is <em>reproducible</em> —
/// never that it demonstrates the rule its own file name promises. A
/// scenario named <c>refusal_by_principle</c> whose tags never actually
/// matched a principle would still replay to its own canonical artifact
/// forever, green, guarding the wrong thing. Every scenario below therefore
/// gets its own test that inspects the <em>trace</em> — not just the action —
/// and, wherever the arithmetic allows it, proves the named factor was
/// <em>decisive</em>: that subtracting its signed contribution from the
/// actual score would have flipped the sign. That is a fact about this run's
/// own numbers, not an inference from what the scenario happened to produce.
/// </para>
/// <para>
/// Two categories cannot be proven decisive this way with today's six heroes
/// and four contracts, and say so in their own test's remarks rather than
/// overclaiming: <see cref="AttractionByInclination_TraitIsWhatTipsItToAccept"/>'s
/// sibling for repulsion and the plain "accept/decline by comrade" pair use a
/// small custom fixture (<c>scenarios/fixtures/decision_core/</c>) for
/// exactly the cases production content cannot reach cleanly — every other
/// scenario below runs on the shipped six heroes and four contracts.
/// </para>
/// </remarks>
public class ScenarioCoverageTests
{
    private static readonly ContentId Bram = ContentId.Parse("core:bram");
    private static readonly ContentId Doran = ContentId.Parse("core:doran");

    [Fact]
    public void EveryScenarioReplaysToItsCanonicalArtifact()
    {
        foreach (var manifest in RepositoryFixtures.ScenarioManifests())
        {
            var outcome = RepositoryFixtures.RunScenario(manifest.Scenario, seed: 7);
            var canonical = File.ReadAllText(RepositoryFixtures.CanonicalArtifact(manifest.Scenario));

            Assert.Equal(canonical, DeterminismArtifact.ToCanonicalJson(outcome));
        }
    }

    [Fact]
    public void AtLeastTwentyScenariosAreShipped() =>
        Assert.True(RepositoryFixtures.ScenarioManifests().Count >= 20);

    // ---- money: accept and decline ----------------------------------

    /// <summary>
    /// Kestrel takes <c>cleanse_the_crypt</c> for the money: payment is the
    /// single largest factor in either direction, ahead of her own
    /// inclination, trust, the risk she is discounting and the mood of the
    /// day.
    /// </summary>
    [Fact]
    public void AcceptByPayment_PaymentIsTheLargestFactorEitherWay()
    {
        var outcome = RepositoryFixtures.RunScenario("accept_by_payment", seed: 7);
        var decision = SoleDecision(outcome);

        Assert.Equal(Actions.Accept, decision.SelectedAction);
        var strongest = StrongestFactor(decision.Trace);
        Assert.Equal(ReasonCodes.PaymentAttractive, strongest.ReasonCode);
    }

    /// <summary>Zara refuses <c>silence_the_cult</c>: risk dwarfs every other factor.</summary>
    [Fact]
    public void DeclineByRisk_RiskIsTheLargestFactorEitherWay()
    {
        var outcome = RepositoryFixtures.RunScenario("decline_by_risk", seed: 7);
        var decision = SoleDecision(outcome);

        Assert.Equal(Actions.Decline, decision.SelectedAction);
        var strongest = StrongestFactor(decision.Trace);
        Assert.Equal(ReasonCodes.RiskTooHigh, strongest.ReasonCode);
    }

    /// <summary>
    /// Bram, on the one contract none of his principles forbid, accepts for
    /// the money — the sole hero <c>collect_the_debt</c> can ever reach a
    /// decision from (every other hero is blocked; see
    /// <see cref="RefusalByPrinciple_NamesTheViolatedPrinciple"/> and its two
    /// siblings).
    /// </summary>
    [Fact]
    public void AcceptByPaymentAlt_TheOneHeroNoPrincipleForbidsAccepts()
    {
        var outcome = RepositoryFixtures.RunScenario("accept_by_payment_alt", seed: 7);
        var decision = SoleDecision(outcome);

        Assert.Equal(Actions.Accept, decision.SelectedAction);
        Assert.Empty(decision.Trace.BlockedBy);
        var strongest = StrongestFactor(decision.Trace);
        Assert.Equal(ReasonCodes.PaymentAttractive, strongest.ReasonCode);
    }

    /// <summary>
    /// Ilsa refuses <c>escort_the_caravan</c> at a moment (the third decision
    /// of the campaign, mood +4) when everything <em>except</em> the insult
    /// would have had her accept: <c>score + insultMagnitude &gt;= 0</c>. The
    /// insult — payment below risk, scaled by pride — is what actually tips
    /// this one, not merely present alongside the decisive risk factor.
    /// </summary>
    [Fact]
    public void DeclineByInsult_InsultIsWhatTipsItToDecline()
    {
        var outcome = RepositoryFixtures.RunScenario("decline_by_insult", seed: 7);
        var decision = LastDecision(outcome);

        Assert.Equal(Actions.Decline, decision.SelectedAction);
        var insult = SingleFactor(decision.Trace.NegativeFactors, ReasonCodes.PaymentInsulting);

        Assert.True(decision.SelectedScore < 0);
        Assert.True(decision.SelectedScore + insult.Magnitude >= 0,
            "Removing the insult should have flipped this decision to accept.");
    }

    // ---- principle blocks ---------------------------------------------

    /// <summary>Doran refuses to touch a contract that serves slavers — a red line, not a score.</summary>
    [Fact]
    public void RefusalByPrinciple_NamesTheViolatedPrinciple()
    {
        var outcome = RepositoryFixtures.RunScenario("refusal_by_principle", seed: 7);
        var decision = SoleDecision(outcome);

        Assert.Equal(Actions.Decline, decision.SelectedAction);
        Assert.Null(decision.SelectedScore);
        var block = Assert.Single(decision.Trace.BlockedBy);
        Assert.Equal(ReasonCodes.PrincipleForbids, block.ReasonCode);
        Assert.Equal(ContentId.Parse("core:will_not_serve_slavers"), block.SourceEntity);
    }

    /// <summary>Zara refuses a contract asking for deception — a different principle, same red line.</summary>
    [Fact]
    public void RefusalByPrincipleDeception_NamesTheViolatedPrinciple()
    {
        var outcome = RepositoryFixtures.RunScenario("refusal_by_principle_deception", seed: 7);
        var decision = SoleDecision(outcome);

        Assert.Equal(Actions.Decline, decision.SelectedAction);
        var block = Assert.Single(decision.Trace.BlockedBy);
        Assert.Equal(ContentId.Parse("core:refuses_deception"), block.SourceEntity);
    }

    /// <summary>
    /// Ilsa carries two principles (<see cref="TwoPrinciplesBlocked_NamesBothViolatedPrinciplesInOrder"/>
    /// blocks both of them at once on a fixture contract), but
    /// <c>collect_the_debt</c>'s tags match only one of them — this scenario
    /// is the contrast: a single block, not two, because only one tag
    /// actually matched.
    /// </summary>
    [Fact]
    public void RefusalByPrincipleAbandonWounded_BlocksOnExactlyOnePrincipleEvenThoughTheHeroCarriesTwo()
    {
        var outcome = RepositoryFixtures.RunScenario("refusal_by_principle_abandon_wounded", seed: 7);
        var decision = SoleDecision(outcome);

        Assert.Equal(Actions.Decline, decision.SelectedAction);
        var block = Assert.Single(decision.Trace.BlockedBy);
        Assert.Equal(ReasonCodes.PrincipleForbids, block.ReasonCode);
        Assert.Equal(ContentId.Parse("core:will_not_abandon_the_wounded"), block.SourceEntity);
    }

    /// <summary>
    /// A fixture hero carrying two principles, both matched by one fixture
    /// contract's tags at once — production content has no contract that
    /// matches two of one hero's principles simultaneously (every principle
    /// tag pairing that exists is spread across different contracts), so this
    /// is the one scenario that needs its own small content root.
    /// </summary>
    [Fact]
    public void TwoPrinciplesBlocked_NamesBothViolatedPrinciplesInOrder()
    {
        var outcome = RepositoryFixtures.RunScenario("two_principles_blocked", seed: 7);
        var decision = SoleDecision(outcome);

        Assert.Equal(Actions.Decline, decision.SelectedAction);
        Assert.Null(decision.SelectedScore);
        Assert.Equal(2, decision.Trace.BlockedBy.Length);
        Assert.All(decision.Trace.BlockedBy, block => Assert.Equal(ReasonCodes.PrincipleForbids, block.ReasonCode));
        Assert.Equal(ContentId.Parse("fixture:principle_alpha"), decision.Trace.BlockedBy[0].SourceEntity);
        Assert.Equal(ContentId.Parse("fixture:principle_beta"), decision.Trace.BlockedBy[1].SourceEntity);
    }

    // ---- inclinations ---------------------------------------------------

    /// <summary>
    /// Doran's own liking for striking at the cult (<c>hates_the_cult</c>) is
    /// what turns <c>silence_the_cult</c> into an accept: without it,
    /// <c>score - 14 &lt; 0</c>.
    /// </summary>
    [Fact]
    public void AttractionByInclination_TraitIsWhatTipsItToAccept()
    {
        var outcome = RepositoryFixtures.RunScenario("attraction_by_inclination", seed: 7);
        var decision = SoleDecision(outcome);

        Assert.Equal(Actions.Accept, decision.SelectedAction);
        var conviction = SingleFactor(decision.Trace.PositiveFactors, ReasonCodes.PersonalConviction);
        Assert.Equal(ContentId.Parse("core:hates_the_cult"), conviction.SourceEntity);

        Assert.True(decision.SelectedScore >= 0);
        Assert.True(decision.SelectedScore - conviction.Magnitude < 0,
            "Removing the inclination should have flipped this decision to decline.");
    }

    /// <summary>
    /// A fixture hero whose only inclination is a repulsion strong enough to
    /// flip the sign on its own (<c>score + 14 &gt;= 0</c> without it).
    /// Production content has no hero/contract pair where a repulsion
    /// inclination is decisive this way — <c>fears_undeath</c>'s two carriers
    /// (Mira, Zara) are also the two most cautious heroes, so risk alone
    /// always decides before the inclination could matter; see
    /// <c>DecliningByInsult</c>'s neighbouring case for the same shape of
    /// argument on <c>payment_insulting</c>, where it does work out.
    /// </summary>
    [Fact]
    public void RepulsionByInclination_TraitIsWhatTipsItToDecline()
    {
        var outcome = RepositoryFixtures.RunScenario("repulsion_by_inclination", seed: 7);
        var decision = SoleDecision(outcome);

        Assert.Equal(Actions.Decline, decision.SelectedAction);
        var aversion = SingleFactor(decision.Trace.NegativeFactors, ReasonCodes.PersonalAversion);
        Assert.Equal(ContentId.Parse("fixture:test_aversion"), aversion.SourceEntity);

        Assert.True(decision.SelectedScore < 0);
        Assert.True(decision.SelectedScore + aversion.Magnitude >= 0,
            "Removing the aversion should have flipped this decision to accept.");
    }

    /// <summary>
    /// Bram carries <c>hates_the_cult</c> (a personal conviction about
    /// <c>target:cult</c>), but <c>cleanse_the_crypt</c> tags
    /// <c>target:undead</c>/<c>method:public_contract</c> — no match, so the
    /// trait contributes nothing at all, and the trace carries neither a
    /// <c>personal_conviction</c> nor a <c>personal_aversion</c> factor.
    /// </summary>
    [Fact]
    public void InclinationWithoutTagMatch_UnmatchedTraitContributesNothing()
    {
        var outcome = RepositoryFixtures.RunScenario("inclination_without_tag_match", seed: 7);
        var decision = SoleDecision(outcome);

        Assert.Equal(Actions.Accept, decision.SelectedAction);
        Assert.DoesNotContain(decision.Trace.PositiveFactors, factor => factor.ReasonCode == ReasonCodes.PersonalConviction);
        Assert.DoesNotContain(decision.Trace.NegativeFactors, factor => factor.ReasonCode == ReasonCodes.PersonalAversion);
    }

    // ---- comrades ---------------------------------------------------------

    /// <summary>
    /// A fixture hero who would accept alone (<c>score without the bond &gt;= 0</c>)
    /// declines once a disliked comrade has already taken the same job:
    /// <c>score + 20 &gt;= 0</c> without the bond, but the actual score is
    /// negative. Production content has no negative relationship whose
    /// disliked party ever accepts the contract the liking hero would also
    /// accept (see this task's report for the full case analysis), so this
    /// needs the fixture too.
    /// </summary>
    [Fact]
    public void DeclineByComrade_BondIsWhatTipsItToDecline()
    {
        var outcome = RepositoryFixtures.RunScenario("decline_by_comrade", seed: 7);
        var decision = LastDecision(outcome);

        Assert.Equal(Actions.Decline, decision.SelectedAction);
        var refusal = SingleFactor(decision.Trace.NegativeFactors, ReasonCodes.WillNotWorkWith);
        Assert.Equal(ContentId.Parse("fixture:crew_leader"), refusal.SourceEntity);

        Assert.True(decision.SelectedScore < 0);
        Assert.True(decision.SelectedScore + refusal.Magnitude >= 0,
            "Removing the comrade's bond should have flipped this decision to accept.");
    }

    /// <summary>
    /// The bond-driven twin of <see cref="DeclineByComrade_BondIsWhatTipsItToDecline"/>:
    /// a liked comrade having already accepted is what turns a decline into
    /// an accept, and — because this contract needs exactly two — the same
    /// two commands also fill its crew.
    /// </summary>
    [Fact]
    public void AcceptByComrade_BondIsWhatTipsItToAcceptAndCrewsTheJob()
    {
        var outcome = RepositoryFixtures.RunScenario("accept_by_comrade", seed: 7);
        var decision = LastDecision(outcome);

        Assert.Equal(Actions.Accept, decision.SelectedAction);
        var bond = SingleFactor(decision.Trace.PositiveFactors, ReasonCodes.StandsWithComrade);
        Assert.Equal(ContentId.Parse("fixture:crew_leader"), bond.SourceEntity);

        Assert.True(decision.SelectedScore >= 0);
        Assert.True(decision.SelectedScore - bond.Magnitude < 0,
            "Removing the comrade's bond should have flipped this decision to decline.");

        var jobBeta = outcome.FinalState.Contracts[ContentId.Parse("fixture:job_beta")];
        Assert.Equal(ContractStatus.Crewed, jobBeta.Status);
    }

    /// <summary>
    /// Two simple, unconditional accepters, on a contract that needs exactly
    /// two — kept separate from <see cref="AcceptByComrade_BondIsWhatTipsItToAcceptAndCrewsTheJob"/>
    /// so "the crew filled" is proven by heroes who would have accepted
    /// regardless of each other, not incidentally alongside a bond story.
    /// </summary>
    [Fact]
    public void CrewFilled_StatusBecomesCrewedOnceEverySeatIsTaken()
    {
        var outcome = RepositoryFixtures.RunScenario("crew_filled", seed: 7);

        Assert.All(outcome.Steps, step => Assert.Equal(Actions.Accept, step.Decision!.SelectedAction));

        var crewJob = outcome.FinalState.Contracts[ContentId.Parse("fixture:crew_job")];
        Assert.Equal(ContractStatus.Crewed, crewJob.Status);
        Assert.Equal(crewJob.RequiredCrew, crewJob.AcceptedBy.Count);
    }

    // ---- mood and the grey zone ------------------------------------------

    /// <summary>
    /// Doran's sum of motives on <c>cleanse_the_crypt</c> is +1 — inside the
    /// band mood can overturn (<c>|sum| &lt;= 5</c>) — and, as the campaign's
    /// very first decision, the day's mood happens to be -2: enough to tip a
    /// would-be accept into a decline.
    /// </summary>
    [Fact]
    public void GreyZoneFlip_MoodIsWhatTipsItToDecline()
    {
        var outcome = RepositoryFixtures.RunScenario("grey_zone_flip", seed: 7);
        var decision = SoleDecision(outcome);

        Assert.Equal(Actions.Decline, decision.SelectedAction);
        var mood = SingleFactor(decision.Trace.NegativeFactors, ReasonCodes.UnpredictableMood);
        var withoutMood = decision.SelectedScore!.Value + mood.Magnitude;

        Assert.True(decision.SelectedScore < 0);
        Assert.True(withoutMood >= 0, "Removing the mood draw should have flipped this decision to accept.");
        Assert.InRange(withoutMood, ContractDecisionRule.MoodMin, -ContractDecisionRule.MoodMin);
    }

    /// <summary>
    /// The same hero and contract as <see cref="GreyZoneFlip_MoodIsWhatTipsItToDecline"/>,
    /// but reached after six other decisions have already spent the
    /// campaign's randomness: at that ordinal, seed 7 draws a mood of exactly
    /// zero, so the trace carries no <c>unpredictable_mood</c> factor at all
    /// and the grey-zone sum decides the action by itself, unmoved.
    /// </summary>
    [Fact]
    public void GreyZoneStable_MoodContributesNothingAndTheActionMatchesTheBareSum()
    {
        var outcome = RepositoryFixtures.RunScenario("grey_zone_stable", seed: 7);
        var decision = LastDecision(outcome);

        Assert.Equal(Actions.Accept, decision.SelectedAction);
        Assert.DoesNotContain(decision.Trace.PositiveFactors, factor => factor.ReasonCode == ReasonCodes.UnpredictableMood);
        Assert.DoesNotContain(decision.Trace.NegativeFactors, factor => factor.ReasonCode == ReasonCodes.UnpredictableMood);
        Assert.InRange(decision.SelectedScore!.Value, ContractDecisionRule.MoodMin, -ContractDecisionRule.MoodMin);
    }

    // ---- order and repeated answers ---------------------------------------

    /// <summary>
    /// Bram then Doran, versus Doran then Bram, on the same contract: Doran's
    /// own sum of motives is grey-zone-small (+1), so whichever mood ordinal
    /// he lands on — and whether Bram (his one positive relationship) has
    /// already accepted — decides his answer. Going second, he inherits
    /// Bram's bond and a favourable-enough mood and accepts; going first, he
    /// has neither and declines. Same two heroes, same contract, opposite
    /// outcome purely from the order they were offered in.
    /// </summary>
    [Fact]
    public void OrderChangesOutcome_SameHeroSameContractDisagreesByOrder()
    {
        var allyFirst = RepositoryFixtures.RunScenario("order_ally_first", seed: 7);
        var allySecond = RepositoryFixtures.RunScenario("order_ally_second", seed: 7);

        var doranWhenSecond = DecisionOf(allyFirst, Doran);
        var doranWhenFirst = DecisionOf(allySecond, Doran);

        Assert.Equal(Actions.Accept, doranWhenSecond.SelectedAction);
        Assert.Equal(Actions.Decline, doranWhenFirst.SelectedAction);

        // Bram's own decision is decisive either way (his sum of motives is
        // far outside the grey band) — it is specifically Doran's answer
        // that the order moves, not both of them.
        Assert.Equal(Actions.Accept, DecisionOf(allyFirst, Bram).SelectedAction);
        Assert.Equal(Actions.Accept, DecisionOf(allySecond, Bram).SelectedAction);
    }

    /// <summary>
    /// The same hero answering the same offer twice: the second command is
    /// rejected outright — no second decision, no second trace, and the
    /// state it returns is untouched (spec: nobody is asked twice).
    /// </summary>
    [Fact]
    public void DuplicateResponseAttempt_TheSecondAnswerIsRejectedNotReconsidered()
    {
        var outcome = RepositoryFixtures.RunScenario("duplicate_response_attempt", seed: 7);

        Assert.Equal(2, outcome.Steps.Length);
        Assert.True(outcome.Steps[0].Applied);
        Assert.NotNull(outcome.Steps[0].Decision);

        Assert.False(outcome.Steps[1].Applied);
        Assert.Null(outcome.Steps[1].Decision);
        Assert.Equal(RejectionCodes.AlreadyResponded, outcome.Steps[1].RejectionCode);
    }

    // ---- the gate and the dice together -----------------------------------

    /// <summary>
    /// The one scenario built to prove the artifact reproduces the
    /// no-randomness path and the randomness-consuming path <em>together</em>,
    /// not merely each in isolation elsewhere in this file (spec §8.1): a
    /// principle block first (zero RNG ordinals spent), then two ordinary
    /// decisions (one ordinal each). <c>NextDecisionOrdinal</c> ending at
    /// exactly 2 — not 3 — is the direct proof that the gate really drew
    /// nothing.
    /// </summary>
    [Fact]
    public void MixedGateThenDecisions_TheBlockedStepSpendsNoRandomnessAndTheOtherTwoSpendExactlyOneEach()
    {
        var outcome = RepositoryFixtures.RunScenario("mixed_gate_then_decisions", seed: 7);

        Assert.Equal(3, outcome.Steps.Length);

        var gate = outcome.Steps[0].Decision!;
        Assert.NotEmpty(gate.Trace.BlockedBy);
        Assert.Null(gate.SelectedScore);

        Assert.All(outcome.Steps.Skip(1), step =>
        {
            Assert.Empty(step.Decision!.Trace.BlockedBy);
            Assert.NotNull(step.Decision!.SelectedScore);
        });

        Assert.Equal(2UL, outcome.FinalState.Metadata.NextDecisionOrdinal);
    }

    // ---- helpers ------------------------------------------------------

    private static DecisionResult SoleDecision(ScenarioOutcome outcome)
    {
        var step = Assert.Single(outcome.Steps);
        Assert.True(step.Applied, $"Step {step.Command.CommandId} was rejected with '{step.RejectionCode}'.");
        return step.Decision!;
    }

    private static DecisionResult LastDecision(ScenarioOutcome outcome)
    {
        var step = outcome.Steps[^1];
        Assert.True(step.Applied, $"Step {step.Command.CommandId} was rejected with '{step.RejectionCode}'.");
        return step.Decision!;
    }

    private static DecisionResult DecisionOf(ScenarioOutcome outcome, ContentId heroDefinition)
    {
        var step = outcome.Steps.Single(step => step.HeroDefinition == heroDefinition);
        Assert.True(step.Applied, $"Step {step.Command.CommandId} was rejected with '{step.RejectionCode}'.");
        return step.Decision!;
    }

    private static TraceFactor SingleFactor(ImmutableArray<TraceFactor> factors, string reasonCode)
    {
        var matches = factors.Where(factor => factor.ReasonCode == reasonCode).ToList();
        Assert.True(matches.Count == 1, $"Expected exactly one '{reasonCode}' factor, found {matches.Count}.");
        return matches[0];
    }

    private readonly record struct DirectedFactor(string Direction, string ReasonCode, ContentId SourceEntity, int Magnitude);

    private static DirectedFactor StrongestFactor(CausalTrace trace)
    {
        var all = trace.PositiveFactors
            .Select(factor => new DirectedFactor("for", factor.ReasonCode, factor.SourceEntity, factor.Magnitude))
            .Concat(trace.NegativeFactors
                .Select(factor => new DirectedFactor("against", factor.ReasonCode, factor.SourceEntity, factor.Magnitude)));

        return all.OrderByDescending(factor => factor.Magnitude).First();
    }
}
