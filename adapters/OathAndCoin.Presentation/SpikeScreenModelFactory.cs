using System.Collections.Immutable;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using OathAndCoin.Content;
using OathAndCoin.Content.Scenarios;
using OathAndCoin.Simulation.Decisions;

namespace OathAndCoin.Presentation;

/// <summary>
/// Builds a <see cref="SpikeScreenModel"/> from a scenario run, and computes
/// the hash that lets two independently built models — the tool's expected
/// one and the game's actual one — prove they agree without either side
/// shipping the other its object graph.
/// </summary>
/// <remarks>
/// See the remarks on <see cref="SpikeScreenModel"/> and the plan brief this
/// task implements: this is one of two hashes. <see cref="ReadModelHash"/>
/// proves the model itself matches; it says nothing about whether that model
/// actually reached the screen — that is what
/// <see cref="RenderedUiSnapshot"/> is for.
/// </remarks>
public static class SpikeScreenModelFactory
{
    /// <summary>
    /// Fixed for now: this is the only screen the runtime harness plan has
    /// built a read model for. Matches
    /// <see cref="OathAndCoin.Content.Scenarios.SpikeReport"/>'s own header
    /// so the machine-readable and human-readable halves of the spike name
    /// the same thing.
    /// </summary>
    private const string Title = "Oath & Coin — Gate 0 spike";

    private static readonly JsonWriterOptions WriterOptions = new()
    {
        Indented = false,
        SkipValidation = false,
    };

    /// <summary>
    /// One line per step that reached a decision. A rejected step (unknown
    /// contract, stale version — see <see cref="StepOutcome.Applied"/>) is
    /// not a hero deciding anything and produces no line, mirroring
    /// <see cref="OathAndCoin.Content.Scenarios.SpikeReport"/>'s own
    /// treatment of the same case.
    /// </summary>
    public static SpikeScreenModel FromOutcome(ScenarioOutcome outcome)
    {
        ArgumentNullException.ThrowIfNull(outcome);

        var lines = outcome.Steps
            .Where(step => step.Decision is not null)
            .Select(ToLine)
            .ToImmutableArray();

        return new SpikeScreenModel(Title, lines, ErrorCode: null, ErrorDetail: null);
    }

    /// <summary>
    /// A screen for a run that never produced any decisions to show.
    /// <paramref name="errorCode"/> is what the two hashes compare;
    /// <paramref name="detail"/> is for the person reading the screen and
    /// never enters either hash — see the remarks on
    /// <see cref="SpikeScreenModel.ErrorDetail"/>.
    /// </summary>
    public static SpikeScreenModel FromError(string errorCode, string detail)
    {
        ArgumentException.ThrowIfNullOrEmpty(errorCode);
        ArgumentException.ThrowIfNullOrEmpty(detail);

        return new SpikeScreenModel(Title, ImmutableArray<SpikeScreenLine>.Empty, errorCode, detail);
    }

    /// <summary>
    /// SHA-256 of the model's canonical JSON — every field a player can see
    /// except <see cref="SpikeScreenModel.ErrorDetail"/> (see its remarks),
    /// canonicalized by the same <see cref="CanonicalJson.Write"/>
    /// <see cref="DeterminismArtifact"/> uses, so object keys are sorted
    /// ordinally and numbers are written by <see cref="Utf8JsonWriter"/>,
    /// never through the current culture.
    /// </summary>
    public static string ReadModelHash(SpikeScreenModel model)
    {
        ArgumentNullException.ThrowIfNull(model);

        var root = new JsonObject
        {
            ["title"] = model.Title,
            ["error_code"] = model.ErrorCode,
            ["lines"] = new JsonArray(model.Lines.Select(Describe).ToArray<JsonNode?>()),
        };

        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream, WriterOptions))
        {
            CanonicalJson.Write(root, writer);
        }

        return Convert.ToHexString(SHA256.HashData(stream.ToArray())).ToLowerInvariant();
    }

    private static SpikeScreenLine ToLine(StepOutcome step)
    {
        var decision = step.Decision!;
        var hero = step.HeroDefinition
            ?? throw new InvalidOperationException(
                $"Step {step.Command.CommandId} produced a decision without a resolved hero — "
                + "ScenarioRunner should never return that combination.");

        // Gate 0 has no red line yet — ContractDecisionRule.Decide never
        // leaves Trace.BlockedBy non-empty, so SelectedScore is never null
        // here. Showing a blocked decision on this screen is a later task's
        // problem, along with SpikeScreenLine's own shape for it.
        var score = decision.SelectedScore
            ?? throw new InvalidOperationException(
                $"Step {step.Command.CommandId} decision has no score — SpikeScreenLine cannot "
                + "represent a blocked decision yet.");

        return new SpikeScreenLine(
            hero.Value,
            decision.SelectedAction.Value,
            score,
            Rank(decision.Trace.PositiveFactors),
            Rank(decision.Trace.NegativeFactors));
    }

    /// <summary>
    /// Reason codes in the order a player reads them: strongest factor
    /// first, ties broken ordinally by code. Without the tie-break, two
    /// factors of equal magnitude would print in whichever order
    /// <see cref="OathAndCoin.Simulation.Decisions.ContractDecisionRule"/>
    /// happened to compute them — an order this type must never depend on
    /// (TDD §7.3: nothing observable depends on iteration/evaluation order).
    /// </summary>
    private static ImmutableArray<string> Rank(ImmutableArray<TraceFactor> factors) =>
        factors
            .OrderByDescending(factor => factor.Magnitude)
            .ThenBy(factor => factor.ReasonCode, StringComparer.Ordinal)
            .Select(factor => factor.ReasonCode)
            .ToImmutableArray();

    private static JsonNode Describe(SpikeScreenLine line) => new JsonObject
    {
        ["hero_definition"] = line.HeroDefinition,
        ["action"] = line.Action,
        ["score"] = line.Score,
        ["for"] = new JsonArray(line.For.Select(code => (JsonNode?)code).ToArray()),
        ["against"] = new JsonArray(line.Against.Select(code => (JsonNode?)code).ToArray()),
    };
}
