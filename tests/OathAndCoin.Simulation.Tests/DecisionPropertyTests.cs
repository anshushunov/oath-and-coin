using OathAndCoin.Simulation.Decisions;
using OathAndCoin.Simulation.Ids;
using static OathAndCoin.Simulation.Tests.ContractDecisionRuleTests;

namespace OathAndCoin.Simulation.Tests;

/// <summary>
/// The predictability property Milestone 1's whole hypothesis rests on
/// (Task 7): a hero's autonomy has to read as character, not chance, and
/// that only holds if raising payment never turns an accepted contract down
/// and raising risk never turns a declined one up. A single-fact test at
/// one set of numbers cannot show that — these sweep a grid deliberately
/// wide enough to hit the boundaries integer division rounds differently
/// at (0, 1, 25, 50, 75, 99, 100), rather than only the comfortable middle.
/// </summary>
public class DecisionPropertyTests
{
    private static readonly int[] Grid = [0, 1, 25, 50, 75, 99, 100];

    [Fact]
    public void RaisingPaymentNeverTurnsAcceptanceIntoRefusal()
    {
        foreach (var greed in Grid)
            foreach (var caution in Grid)
                foreach (var pride in Grid)
                    foreach (var risk in Grid)
                        foreach (var ordinal in new ulong[] { 0, 1, 2, 3 })
                        {
                            var accepted = false;
                            foreach (var payment in Grid)
                            {
                                var decision = ContractDecisionRule.Decide(
                                    Context(greed, caution, pride, payment, risk, ordinal));
                                var accepts = decision.Result.SelectedAction == Actions.Accept;

                                Assert.False(
                                    accepted && !accepts,
                                    $"greed={greed} caution={caution} pride={pride} risk={risk} "
                                    + $"ordinal={ordinal}: raising payment to {payment} turned acceptance into refusal");
                                accepted |= accepts;
                            }
                        }
    }

    [Fact]
    public void RaisingRiskNeverTurnsRefusalIntoAcceptance()
    {
        foreach (var greed in Grid)
            foreach (var caution in Grid)
                foreach (var pride in Grid)
                    foreach (var payment in Grid)
                        foreach (var ordinal in new ulong[] { 0, 1, 2, 3 })
                        {
                            var refused = false;
                            foreach (var risk in Grid)
                            {
                                var decision = ContractDecisionRule.Decide(
                                    Context(greed, caution, pride, payment, risk, ordinal));
                                var refuses = decision.Result.SelectedAction == Actions.Decline;

                                Assert.False(
                                    refused && !refuses,
                                    $"greed={greed} caution={caution} pride={pride} payment={payment} "
                                    + $"ordinal={ordinal}: raising risk to {risk} turned refusal into acceptance");
                                refused |= refuses;
                            }
                        }
    }

    [Fact]
    public void PrincipleHoldsAtEveryPaymentAndRisk()
    {
        foreach (var payment in Grid)
            foreach (var risk in Grid)
                foreach (var trust in Grid)
                {
                    var decision = ContractDecisionRule.Decide(ContextWithPrinciple(payment, risk, trust));

                    Assert.Equal(Actions.Decline, decision.Result.SelectedAction);
                    Assert.Null(decision.Result.SelectedScore);
                    Assert.Equal(0ul, decision.OrdinalsConsumed);
                }
    }

    /// <summary>
    /// Not "the selection is among what was considered" — <see cref="DecisionResult"/>'s
    /// own constructor already refuses to exist otherwise
    /// (<c>CausalTraceTests</c> pins that down three ways, including
    /// initializer order), so a test repeating it here cannot fail: it is
    /// 16,807 calls into the rule to re-check a guarantee the type gives for
    /// free. What is not guaranteed by any type is that the hero actually
    /// weighed <em>both</em> answers before choosing one — a rule that quietly
    /// stopped offering Decline (say, always returning
    /// <c>ConsideredActions = [Actions.Accept]</c> once some condition held)
    /// would still build a perfectly valid <see cref="DecisionResult"/> and
    /// pass every constructor check, while silently making refusal
    /// unreachable. That is what this sweeps for instead.
    /// </summary>
    [Fact]
    public void ConsideredActionsAlwaysWeighBothAcceptAndDecline()
    {
        foreach (var greed in Grid)
            foreach (var caution in Grid)
                foreach (var pride in Grid)
                    foreach (var payment in Grid)
                        foreach (var risk in Grid)
                        {
                            var result = ContractDecisionRule.Decide(
                                Context(greed, caution, pride, payment, risk, ordinal: 0)).Result;

                            Assert.Contains(Actions.Accept, result.ConsideredActions);
                            Assert.Contains(Actions.Decline, result.ConsideredActions);
                        }
    }

    /// <summary>
    /// The other half of predictability (spec/doc-comment on
    /// <see cref="ContractDecisionRule.MoodMin"/>): outside the grey zone
    /// (<c>|sum of motives| &gt; -MoodMin</c>), mood cannot flip the answer no
    /// matter which of the 11 ordinals it draws from — that is arithmetic
    /// (mood is bounded to <c>[MoodMin, MoodMax]</c> = <c>[-5, 5]</c>), not a
    /// property of these particular numbers, so the same action must come back
    /// for every ordinal in the sweep. Both signs are exercised: a contract
    /// so generous greed/payment alone decide it (sum well above +5), and one
    /// so risky caution/risk alone decide it (sum well below -5).
    /// </summary>
    [Fact]
    public void DecisiveSumOfMotivesKeepsTheSameActionAcrossEveryMood()
    {
        // paymentPull(0) - riskAversion(100) - insult(0) + guildTrust(5) = -95;
        // even the most favourable mood (+5) leaves -90, still refused.
        const int decisiveGreed = 0;
        const int decisiveCaution = 100;
        const int decisivePride = 0;
        const int decisivePayment = 0;
        const int decisiveRisk = 100;

        for (ulong ordinal = 0; ordinal <= 10; ordinal++)
        {
            var decision = ContractDecisionRule.Decide(
                Context(decisiveGreed, decisiveCaution, decisivePride, decisivePayment, decisiveRisk, ordinal));

            Assert.Equal(Actions.Decline, decision.Result.SelectedAction);
        }

        // paymentPull(100) - riskAversion(0) - insult(0) + guildTrust(5) = 105;
        // even the harshest mood (-5) leaves 100, still accepted.
        const int generousGreed = 100;
        const int generousCaution = 0;
        const int generousPride = 0;
        const int generousPayment = 100;
        const int generousRisk = 0;

        for (ulong ordinal = 0; ordinal <= 10; ordinal++)
        {
            var decision = ContractDecisionRule.Decide(
                Context(generousGreed, generousCaution, generousPride, generousPayment, generousRisk, ordinal));

            Assert.Equal(Actions.Accept, decision.Result.SelectedAction);
        }
    }

    /// <summary>
    /// Inside the grey zone, mood is not inert — it is the one thing
    /// <see cref="ContractDecisionRule.MoodMin"/>'s doc-comment says is
    /// allowed to decide. A sum of motives sitting exactly at the edge of the
    /// band (here <c>-5</c>, still inside <c>[MoodMin, -MoodMin]</c>) has to
    /// actually flip somewhere across the sweep, or the "mood can decide"
    /// half of the property would be exactly as untested as the "mood
    /// cannot decide" half was before this task.
    /// </summary>
    [Fact]
    public void BoundarySumOfMotivesLetsMoodFlipTheAction()
    {
        // paymentPull(0) - riskAversion(10) - insult(0) + guildTrust(5) = -5,
        // the edge of [MoodMin, -MoodMin]: mood +5 makes the total 0 (Accept),
        // mood -5 makes it -10 (Decline) — both reachable within [-5, 5].
        const int greed = 0;
        const int caution = 10;
        const int pride = 0;
        const int payment = 0;
        const int risk = 100;

        var seenActions = new HashSet<ContentId>();
        for (ulong ordinal = 0; ordinal <= 10; ordinal++)
        {
            var decision = ContractDecisionRule.Decide(Context(greed, caution, pride, payment, risk, ordinal));
            seenActions.Add(decision.Result.SelectedAction);
        }

        Assert.Contains(Actions.Accept, seenActions);
        Assert.Contains(Actions.Decline, seenActions);
    }

    [Fact]
    public void IrrelevantFieldsDoNotChangeTheDecision()
    {
        var baseline = ContractDecisionRule.Decide(Context());
        var renamed = ContractDecisionRule.Decide(Context() with
        {
            Hero = Context().Hero with { DisplayNameKey = "hero.core.other.name" },
        });

        Assert.Equal(baseline.Result.SelectedAction, renamed.Result.SelectedAction);
        Assert.Equal(baseline.Result.SelectedScore, renamed.Result.SelectedScore);
    }

    [Fact]
    public void SameInputsProduceTheSameDecision()
    {
        var first = ContractDecisionRule.Decide(Context());
        var second = ContractDecisionRule.Decide(Context());

        Assert.Equal(first.Result, second.Result);
        Assert.Equal(first.OrdinalsConsumed, second.OrdinalsConsumed);
    }
}
