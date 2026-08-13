using System.Globalization;
using System.Text.Json;
using OathAndCoin.Content.Scenarios;
using OathAndCoin.Simulation.Decisions;
using OathAndCoin.Simulation.Ids;

namespace OathAndCoin.Content.Tests;

/// <summary>
/// The spike's actual claim: the same seed reproduces the same run, and that
/// run contains two heroes deciding for themselves — one refusal and one
/// acceptance, each with its own explanation.
/// </summary>
/// <remarks>
/// The canonical artifact is what "the same run" is measured against. A
/// human-readable report is produced alongside it (see <see cref="SpikeReport"/>)
/// and is deliberately not what determinism is checked on: a report is written
/// for people, so it will be reworded, and comparing runs on it would make
/// every rewording look like a determinism failure (spec §8.6).
/// </remarks>
public class ReplayDeterminismTests
{
    private const ulong Seed = 424242;

    private static readonly ContentId Bram = ContentId.Parse("core:bram");
    private static readonly ContentId Zara = ContentId.Parse("core:zara");

    [Fact]
    public void SameSeed_ProducesIdenticalCanonicalArtifact()
    {
        Assert.Equal(
            DeterminismArtifact.Serialize(RunScenario(Seed)),
            DeterminismArtifact.Serialize(RunScenario(Seed)));
    }

    [Fact]
    public void SameSeed_ProducesIdenticalHash()
    {
        Assert.Equal(
            DeterminismArtifact.Hash(RunScenario(Seed)),
            DeterminismArtifact.Hash(RunScenario(Seed)));
    }

    /// <summary>
    /// Guards the failure mode the plan calls "an indicator passed off as a
    /// verdict": every assertion above stays green even if the seed never
    /// reaches a decision. The scores must differ, not merely the JSON — the
    /// artifact echoes the seed back, so comparing artifacts alone would
    /// "prove" the seed matters even if nothing ever read it.
    /// </summary>
    [Fact]
    public void DifferentSeed_ProducesDifferentArtifact()
    {
        var (first, second) = SeedsWithDifferentFirstMood();

        var firstRun = RunScenario(first);
        var secondRun = RunScenario(second);

        Assert.NotEqual(
            firstRun.Steps[0].Decision!.SelectedScore,
            secondRun.Steps[0].Decision!.SelectedScore);
        Assert.NotEqual(DeterminismArtifact.Serialize(firstRun), DeterminismArtifact.Serialize(secondRun));
        Assert.NotEqual(DeterminismArtifact.Hash(firstRun), DeterminismArtifact.Hash(secondRun));
    }

    /// <summary>
    /// The whole point of the spike. Both steps must be decisions the heroes
    /// made — a step the engine refused (unknown contract, already resolved,
    /// stale version) is not a hero deciding anything, and a scenario built
    /// out of those would demonstrate one autonomous decision while claiming
    /// two.
    /// </summary>
    [Fact]
    public void Scenario_ShowsTwoAutonomousDecisions()
    {
        var outcome = RunScenario(Seed);

        Assert.Equal(2, outcome.Steps.Length);
        Assert.All(outcome.Steps, step => Assert.True(
            step.Applied,
            $"Step {step.Command.CommandId} was rejected with '{step.RejectionCode}' instead of deciding."));

        Assert.Equal(Zara, outcome.Steps[0].HeroDefinition);
        Assert.Equal(Actions.Decline, outcome.Steps[0].Decision!.SelectedAction);

        Assert.Equal(Bram, outcome.Steps[1].HeroDefinition);
        Assert.Equal(Actions.Accept, outcome.Steps[1].Decision!.SelectedAction);
    }

    /// <summary>
    /// Two stored explanations, and they explain different things.
    /// </summary>
    /// <remarks>
    /// The plan phrased this as "the sets of reason codes differ". Against this
    /// scoring rule that assertion cannot hold on purpose: both heroes are
    /// offered the same contract, so payment, risk, trust and mood all
    /// contribute to both decisions and the bare code sets are identical for
    /// every seed where nobody's mood lands on exactly zero. A test written
    /// that way would pass only by accident of the seed, and fail the moment
    /// the mood draw changed — an assertion about the RNG dressed up as one
    /// about explanations.
    ///
    /// What actually distinguishes the two explanations is what a player would
    /// read off them: which way each factor pulled, how hard, and which factor
    /// decided the answer. Zara refuses because the risk (40) outweighs
    /// everything she was offered; Bram accepts because the payment (24) leads.
    /// </remarks>
    [Fact]
    public void Scenario_ProducesTwoDistinctTraces()
    {
        var outcome = RunScenario(Seed);

        Assert.Equal(2, outcome.FinalState.Traces.Count);

        var refusal = outcome.Steps[0].Decision!.Trace;
        var acceptance = outcome.Steps[1].Decision!.Trace;

        Assert.False(
            SignedFactorsOf(refusal).SetEquals(SignedFactorsOf(acceptance)),
            "Both heroes were explained by the same factors with the same magnitudes — "
            + "the explanations do not distinguish the decisions.");

        Assert.Equal(("against", ReasonCodes.RiskTooHigh), DecisiveFactorOf(refusal));
        Assert.Equal(("for", ReasonCodes.PaymentAttractive), DecisiveFactorOf(acceptance));
    }

    [Fact]
    public void CanonicalArtifact_ContainsFinalStateAndTraces()
    {
        var outcome = RunScenario(Seed);

        var artifact = DeterminismArtifact.Serialize(outcome);

        Assert.Contains("\"state_version\"", artifact, StringComparison.Ordinal);
        Assert.Contains("\"hero_declined_contract\"", artifact, StringComparison.Ordinal);
        Assert.Contains("\"hero_accepted_contract\"", artifact, StringComparison.Ordinal);

        foreach (var traceId in outcome.FinalState.Traces.Keys)
        {
            Assert.Contains(
                $"\"trace_id\":{traceId.ToString(CultureInfo.InvariantCulture)}",
                artifact,
                StringComparison.Ordinal);
        }

        Assert.Contains(ReasonCodes.RiskTooHigh, artifact, StringComparison.Ordinal);
        Assert.Contains(ReasonCodes.PaymentAttractive, artifact, StringComparison.Ordinal);
    }

    /// <summary>
    /// The host machine's locale is a forbidden input (TDD §7.3), and
    /// serialization is where it would leak in first: one number formatted
    /// through the current culture is enough to make an artifact produced on a
    /// German-locale machine differ from the same run on an English one.
    /// </summary>
    [Fact]
    public void CanonicalArtifact_IsCultureInvariant()
    {
        var invariant = DeterminismArtifact.Serialize(RunScenario(Seed));

        // A culture whose number formatting cannot be mistaken for the
        // invariant one. Picking a real locale (de-DE and its decimal comma)
        // would leave the test blind to the numbers this artifact actually
        // carries — they are all integers, and "-28" is spelled the same in
        // German. Overriding the negative sign makes any hand-formatted number
        // visible, and the scores here do go negative.
        var hostile = (CultureInfo)CultureInfo.GetCultureInfo("de-DE").Clone();
        hostile.NumberFormat.NegativeSign = "!";
        hostile.NumberFormat.NumberDecimalSeparator = ",";

        var previousCulture = CultureInfo.CurrentCulture;
        try
        {
            CultureInfo.CurrentCulture = hostile;
            Assert.Equal(invariant, DeterminismArtifact.Serialize(RunScenario(Seed)));
        }
        finally
        {
            CultureInfo.CurrentCulture = previousCulture;
        }
    }

    /// <summary>
    /// Canonical ordering asserted directly, rather than inferred from two runs
    /// agreeing with each other. Two runs of the same build agree about key
    /// order no matter what that order is — so without this, removing the sort
    /// would leave every determinism test above green while the artifact
    /// stopped being canonical, and the first cross-build comparison would be
    /// the one to find out.
    /// </summary>
    [Fact]
    public void CanonicalArtifact_WritesObjectKeysInOrdinalOrder()
    {
        using var document = JsonDocument.Parse(DeterminismArtifact.Serialize(RunScenario(Seed)));

        AssertKeysAreOrdered(document.RootElement, "$");
    }

    private static void AssertKeysAreOrdered(JsonElement element, string path)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.Object:
                var keys = element.EnumerateObject().Select(property => property.Name).ToList();
                Assert.Equal(keys.OrderBy(key => key, StringComparer.Ordinal).ToList(), keys);

                foreach (var property in element.EnumerateObject())
                {
                    AssertKeysAreOrdered(property.Value, $"{path}.{property.Name}");
                }

                break;

            case JsonValueKind.Array:
                var index = 0;
                foreach (var item in element.EnumerateArray())
                {
                    AssertKeysAreOrdered(item, $"{path}[{index}]");
                    index++;
                }

                break;
        }
    }

    // Loaded once: the seed search below runs the scenario repeatedly, and
    // re-reading the same files each time would measure the filesystem rather
    // than the simulation. Reusing one ContentSet across runs is also a small
    // assertion in itself — a runner that mutated the content it was given
    // would show up as one run affecting the next.
    private static readonly ContentSet Content = ContentSet.Load(RepositoryFixtures.ContentRoot);

    private static readonly IReadOnlyList<ScenarioCommand> Commands =
        ScenarioCommands.Load(RepositoryFixtures.ScenarioPath);

    private static ScenarioOutcome RunScenario(ulong seed) => ScenarioRunner.Run(Content, Commands, seed);

    /// <summary>Every factor as (direction, code, magnitude).</summary>
    private static HashSet<(string Direction, string ReasonCode, int Magnitude)> SignedFactorsOf(CausalTrace trace) =>
        trace.PositiveFactors.Select(factor => ("for", factor.ReasonCode, factor.Magnitude))
            .Concat(trace.NegativeFactors.Select(factor => ("against", factor.ReasonCode, factor.Magnitude)))
            .ToHashSet();

    /// <summary>The factor that weighed most, and which way it pulled.</summary>
    private static (string Direction, string ReasonCode) DecisiveFactorOf(CausalTrace trace)
    {
        var strongest = SignedFactorsOf(trace).OrderByDescending(factor => factor.Magnitude).First();
        return (strongest.Direction, strongest.ReasonCode);
    }

    /// <summary>
    /// Two seeds whose first decision scores differently, found through the
    /// public API on every machine rather than written down as a pair of magic
    /// numbers that would quietly stop being different if the mood range
    /// changed.
    /// </summary>
    private static (ulong First, ulong Second) SeedsWithDifferentFirstMood()
    {
        var baseline = RunScenario(1).Steps[0].Decision!.SelectedScore;

        for (ulong seed = 2; seed < 1000; seed++)
        {
            if (RunScenario(seed).Steps[0].Decision!.SelectedScore != baseline)
            {
                return (1, seed);
            }
        }

        throw new InvalidOperationException(
            "No seed below 1000 changed the first decision's score — "
            + "the seed is not reaching the decision at all.");
    }
}
