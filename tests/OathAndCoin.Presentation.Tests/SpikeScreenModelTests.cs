using System.Collections.Immutable;
using System.Globalization;
using OathAndCoin.Content;
using OathAndCoin.Content.Scenarios;
using OathAndCoin.Content.Tests;
using OathAndCoin.Simulation.Decisions;
using OathAndCoin.Simulation.Events;
using OathAndCoin.Simulation.Ids;

namespace OathAndCoin.Presentation.Tests;

/// <summary>
/// The engine-free read model built from a gate 0 run: one line per hero
/// decision, ranked reasons, and the two independent hashes that let a tool
/// process and a running game agree they built the same screen.
/// </summary>
/// <remarks>
/// <see cref="ReadModelHash_ChangesWhenAnyShownValueChanges"/> is
/// parameterized deliberately — a hash test that only ever changes one field
/// (e.g. the score) would stay green if any other field silently stopped
/// contributing to the hash, which is exactly the failure mode a "compare
/// what's on screen" tool exists to catch.
/// </remarks>
public class SpikeScreenModelTests
{
    // Same seed and same scenario as ReplayDeterminismTests
    // (tests\OathAndCoin.Content.Tests\ReplayDeterminismTests.cs) — this is
    // the run the runtime harness plan calls "gate 0", and its two decisions
    // are what the brief's expected screen describes: Zara declining, then
    // Bram accepting.
    private const ulong Seed = 424242;

    // Loaded once for the same reason ReplayDeterminismTests loads it once:
    // the mutator theory below runs the scenario repeatedly, and re-reading
    // content/scenario files each time would measure the filesystem instead
    // of the read model.
    private static readonly ContentSet Content = ContentSet.Load(RepositoryFixtures.ContentRoot);

    private static readonly IReadOnlyList<ScenarioCommand> Commands =
        ScenarioCommands.Load(RepositoryFixtures.ScenarioPath);

    [Fact]
    public void FromOutcome_ListsOneLinePerDecisionInOrder()
    {
        var model = SpikeScreenModelFactory.FromOutcome(RunGate0());

        Assert.Equal(2, model.Lines.Length);

        Assert.Equal("core:zara", model.Lines[0].HeroDefinition);
        Assert.Equal(Actions.Decline.Value, model.Lines[0].Action);
        Assert.Equal(-23, model.Lines[0].Score);

        Assert.Equal("core:bram", model.Lines[1].HeroDefinition);
        Assert.Equal(Actions.Accept.Value, model.Lines[1].Action);
        Assert.Equal(9, model.Lines[1].Score);
    }

    /// <summary>
    /// Against the gate 0 seed, Zara's own positive factors are
    /// payment_attractive (8), trusts_the_guild (4), unpredictable_mood (5) —
    /// in that computation order, because
    /// <see cref="OathAndCoin.Simulation.Decisions.ContractDecisionRule"/>
    /// appends payment, then trust, then mood. Sorted by magnitude the order
    /// is payment (8), mood (5), trust (4): different from computation
    /// order, so this only passes if the factory actually sorts rather than
    /// forwarding the trace's own order.
    /// </summary>
    [Fact]
    public void FromOutcome_RanksReasonsByMagnitudeThenCode()
    {
        var model = SpikeScreenModelFactory.FromOutcome(RunGate0());

        Assert.Equal(
            new[]
            {
                ReasonCodes.PaymentAttractive,
                ReasonCodes.UnpredictableMood,
                ReasonCodes.TrustsTheGuild,
            },
            model.Lines[0].For);
    }

    /// <summary>
    /// The gate 0 seed alone never exercises the ordinal-by-code tie-break in
    /// <c>SpikeScreenModelFactory.Rank</c> — Zara's own magnitudes (8, 5, 4)
    /// are all distinct, and so are Bram's (24, 15, 5). Without a factor pair
    /// that actually ties on magnitude, the <c>ThenBy(ReasonCode, Ordinal)</c>
    /// half of the rule could be deleted (or reversed) and every other test
    /// in this class would stay green. This test builds that pair by hand:
    /// two positive factors both magnitude 5, inserted in the order
    /// (mood, payment) — the opposite of what ordinal-by-code demands, since
    /// "hero.decision.payment_attractive" &lt; "hero.decision.unpredictable_mood"
    /// ordinally.
    /// </summary>
    [Fact]
    public void FromOutcome_BreaksEqualMagnitudeTiesByReasonCodeOrdinal()
    {
        var zara = ContentId.Parse("core:zara");
        var contract = ContentId.Parse("core:escort_the_caravan");

        var trace = new CausalTrace
        {
            TraceId = 1,
            PositiveFactors = ImmutableArray.Create(
                new TraceFactor(ReasonCodes.UnpredictableMood, zara, 5),
                new TraceFactor(ReasonCodes.PaymentAttractive, contract, 5)),
            NegativeFactors = ImmutableArray<TraceFactor>.Empty,
            BlockedBy = ImmutableArray<string>.Empty,
        };

        var decision = new DecisionResult
        {
            SelectedAction = Actions.Accept,
            ConsideredActions = ImmutableArray.Create(Actions.Accept, Actions.Decline),
            SelectedScore = 5,
            Trace = trace,
        };

        var step = new StepOutcome(
            new ScenarioCommand(1, 0, contract, ExpectedStateVersion: 0),
            Applied: true,
            RejectionCode: null,
            HeroDefinition: zara,
            Decision: decision,
            Events: ImmutableArray<DomainEvent>.Empty);

        // FinalState is never read by FromOutcome — only Steps is — so a
        // synthetic outcome does not need a real GameState to make this
        // test's point.
        var outcome = new ScenarioOutcome(FinalState: null!, Steps: ImmutableArray.Create(step));

        var model = SpikeScreenModelFactory.FromOutcome(outcome);

        Assert.Equal(
            new[] { ReasonCodes.PaymentAttractive, ReasonCodes.UnpredictableMood },
            model.Lines[0].For);
    }

    [Fact]
    public void FromError_ProducesErrorModelWithCodeAndNoLines()
    {
        var model = SpikeScreenModelFactory.FromError(
            "CONTENT_ROOT_NOT_FOUND",
            "The content directory 'C:\\build\\content' does not exist.");

        Assert.Equal("CONTENT_ROOT_NOT_FOUND", model.ErrorCode);
        Assert.Empty(model.Lines);
    }

    [Fact]
    public void ReadModelHash_IgnoresErrorDetail()
    {
        var first = SpikeScreenModelFactory.FromError(
            "CONTENT_ROOT_NOT_FOUND", "on the build agent: C:\\agents\\7\\content was not found");
        var second = SpikeScreenModelFactory.FromError(
            "CONTENT_ROOT_NOT_FOUND", "on a developer's machine: /home/dev/game/content missing");

        Assert.Equal(SpikeScreenModelFactory.ReadModelHash(first), SpikeScreenModelFactory.ReadModelHash(second));
    }

    [Fact]
    public void ReadModelHash_IsStableAcrossRuns()
    {
        var model = SpikeScreenModelFactory.FromOutcome(RunGate0());

        Assert.Equal(SpikeScreenModelFactory.ReadModelHash(model), SpikeScreenModelFactory.ReadModelHash(model));
    }

    /// <summary>
    /// Mirrors ReplayDeterminismTests.CanonicalArtifact_IsCultureInvariant:
    /// the host machine's locale is a forbidden input, and hashing is where
    /// it would leak in first if a score were ever formatted through it.
    /// </summary>
    [Fact]
    public void ReadModelHash_IsCultureInvariant()
    {
        var model = SpikeScreenModelFactory.FromOutcome(RunGate0());
        var invariant = SpikeScreenModelFactory.ReadModelHash(model);

        var hostile = (CultureInfo)CultureInfo.GetCultureInfo("de-DE").Clone();
        hostile.NumberFormat.NegativeSign = "!";
        hostile.NumberFormat.NumberDecimalSeparator = ",";

        var previousCulture = CultureInfo.CurrentCulture;
        try
        {
            CultureInfo.CurrentCulture = hostile;
            Assert.Equal(invariant, SpikeScreenModelFactory.ReadModelHash(model));
        }
        finally
        {
            CultureInfo.CurrentCulture = previousCulture;
        }
    }

    [Fact]
    public void ExpectedSnapshot_ContainsEveryShownValue()
    {
        var model = SpikeScreenModelFactory.FromOutcome(RunGate0());
        var snapshot = RenderedUiSnapshot.Expected(model);

        foreach (var line in model.Lines)
        {
            Assert.Contains(line.HeroDefinition, snapshot.Texts);
            Assert.Contains(line.Action, snapshot.Texts);
            Assert.Contains(line.Score.ToString(CultureInfo.InvariantCulture), snapshot.Texts);

            foreach (var reasonCode in line.For.Concat(line.Against))
            {
                Assert.Contains(reasonCode, snapshot.Texts);
            }
        }
    }

    [Fact]
    public void SnapshotHash_ChangesOnTextOrOrderChange()
    {
        var model = SpikeScreenModelFactory.FromOutcome(RunGate0());
        var snapshot = RenderedUiSnapshot.Expected(model);

        Assert.True(snapshot.Texts.Length >= 2, "The gate 0 snapshot is expected to carry more than one text.");

        var swapped = new RenderedUiSnapshot(
            snapshot.Texts.SetItem(0, snapshot.Texts[1]).SetItem(1, snapshot.Texts[0]));

        Assert.NotEqual(RenderedUiSnapshot.Hash(snapshot), RenderedUiSnapshot.Hash(swapped));
    }

    public static TheoryData<string, Func<SpikeScreenModel, SpikeScreenModel>> Mutators() => new()
    {
        { "score", m => WithLine(m, 0, l => l with { Score = l.Score + 1 }) },
        { "hero", m => WithLine(m, 0, l => l with { HeroDefinition = "core:other" }) },
        { "action", m => WithLine(m, 0, l => l with { Action = Actions.Accept.Value }) },
        { "for-codes", m => WithLine(m, 0, l => l with { For = l.For.RemoveAt(0) }) },
        { "against-codes", m => WithLine(m, 0, l => l with { Against = l.Against.Add("x") }) },
        { "line-order", m => m with { Lines = ImmutableArray.Create(m.Lines[1], m.Lines[0]) } },
        { "title", m => m with { Title = m.Title + "!" } },
        { "error-code", m => m with { ErrorCode = "OTHER" } },
    };

    [Theory]
    [MemberData(nameof(Mutators))]
    public void ReadModelHash_ChangesWhenAnyShownValueChanges(
        string label, Func<SpikeScreenModel, SpikeScreenModel> mutate)
    {
        var model = SpikeScreenModelFactory.FromOutcome(RunGate0());

        Assert.True(
            SpikeScreenModelFactory.ReadModelHash(model)
                != SpikeScreenModelFactory.ReadModelHash(mutate(model)),
            $"hash did not change when '{label}' changed");
    }

    private static ScenarioOutcome RunGate0() => ScenarioRunner.Run(Content, Commands, Seed);

    private static SpikeScreenModel WithLine(
        SpikeScreenModel model, int index, Func<SpikeScreenLine, SpikeScreenLine> mutate) =>
        model with { Lines = model.Lines.SetItem(index, mutate(model.Lines[index])) };
}
