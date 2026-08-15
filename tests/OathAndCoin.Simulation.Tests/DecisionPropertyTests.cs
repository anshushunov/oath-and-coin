using OathAndCoin.Simulation.Decisions;
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

    [Fact]
    public void SelectedActionIsAlwaysAmongConsideredActions()
    {
        foreach (var greed in Grid)
        foreach (var caution in Grid)
        foreach (var pride in Grid)
        foreach (var payment in Grid)
        foreach (var risk in Grid)
        {
            var result = ContractDecisionRule.Decide(
                Context(greed, caution, pride, payment, risk, ordinal: 0)).Result;

            Assert.Contains(result.SelectedAction, result.ConsideredActions);
        }
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
