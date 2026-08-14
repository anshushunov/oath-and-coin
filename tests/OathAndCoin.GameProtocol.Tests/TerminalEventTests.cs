using System.Text.Json.Nodes;
using OathAndCoin.GameProtocol;

namespace OathAndCoin.GameProtocol.Tests;

/// <summary>
/// <see cref="TerminalEvent.Parse"/> reads the game's stdout looking for the
/// one line that reports what happened. stdout is not a clean channel — the
/// engine prints its own banner, warnings, shader compiler chatter — so the
/// contract is: never throw, and only ever call something an "error" if it
/// looked like an attempted event in the first place.
/// </summary>
public class TerminalEventTests
{
    private static string BuildLine(
        int schemaVersion = TerminalEvent.SupportedSchemaVersion,
        string outcomeKind = "success",
        string? errorCode = null,
        string? contentVersion = "content-abc123",
        string? canonicalHash = "canonical-abc123",
        string checkpoint = "decisions_complete")
    {
        var json = new JsonObject
        {
            ["schema_version"] = schemaVersion,
            ["event"] = "terminal",
            ["outcome_kind"] = outcomeKind,
            ["scenario"] = "gate0",
            ["seed"] = 424242,
            ["checkpoint"] = checkpoint,
            ["error_code"] = errorCode,
            ["content_version"] = contentVersion,
            ["canonical_hash"] = canonicalHash,
            ["read_model_hash"] = "read-model-hash",
            ["rendered_ui_hash"] = "rendered-ui-hash",
            ["frame_sha256"] = "frame-sha256",
            ["frame_width"] = 1280,
            ["frame_height"] = 720,
            ["frame_distinct_colors"] = 12,
        };

        return json.ToJsonString();
    }

    private static TerminalEvent ExpectedEvent(
        string outcomeKind = "success",
        string? errorCode = null,
        string? contentVersion = "content-abc123",
        string? canonicalHash = "canonical-abc123",
        string checkpoint = "decisions_complete") => new(
        SchemaVersion: TerminalEvent.SupportedSchemaVersion,
        Event: "terminal",
        OutcomeKind: outcomeKind,
        Scenario: "gate0",
        Seed: 424242UL,
        Checkpoint: checkpoint,
        ErrorCode: errorCode,
        ContentVersion: contentVersion,
        CanonicalHash: canonicalHash,
        ReadModelHash: "read-model-hash",
        RenderedUiHash: "rendered-ui-hash",
        FrameSha256: "frame-sha256",
        FrameWidth: 1280,
        FrameHeight: 720,
        FrameDistinctColors: 12);

    [Fact]
    public void Parse_ParsesAValidEventAmongEngineNoise()
    {
        var lines = new[]
        {
            "Godot Engine v4.2.1.stable.official",
            BuildLine(),
            "OpenGL ES 3.0 Renderer: llvmpipe",
        };

        var result = TerminalEvent.Parse(lines);

        Assert.Equal(new[] { ExpectedEvent() }, result.Events);
        Assert.Empty(result.Errors);
    }

    [Fact]
    public void Parse_CollectsMultipleEventsInOrder()
    {
        var lines = new[]
        {
            BuildLine(checkpoint: "first"),
            BuildLine(checkpoint: "second"),
        };

        var result = TerminalEvent.Parse(lines);

        Assert.Equal(
            new[] { ExpectedEvent(checkpoint: "first"), ExpectedEvent(checkpoint: "second") },
            result.Events);
        Assert.Empty(result.Errors);
    }

    [Fact]
    public void Parse_AddsMalformedJsonToErrorsInsteadOfThrowing()
    {
        var lines = new[] { "{\"schema_version\": 1, \"event\": \"terminal\", " };

        var result = TerminalEvent.Parse(lines);

        Assert.Empty(result.Events);
        Assert.Single(result.Errors);
    }

    [Fact]
    public void Parse_AddsUnknownSchemaVersionToErrors()
    {
        var lines = new[] { BuildLine(schemaVersion: 99) };

        var result = TerminalEvent.Parse(lines);

        Assert.Empty(result.Events);
        var error = Assert.Single(result.Errors);
        Assert.Contains("99", error, StringComparison.Ordinal);
    }

    [Fact]
    public void Parse_AddsMissingRequiredFieldToErrors()
    {
        var json = JsonNode.Parse(BuildLine())!.AsObject();
        json.Remove("checkpoint");

        var result = TerminalEvent.Parse(new[] { json.ToJsonString() });

        Assert.Empty(result.Events);
        Assert.Single(result.Errors);
    }

    [Fact]
    public void Parse_IgnoresNonJsonLineSilently()
    {
        var result = TerminalEvent.Parse(new[] { "Godot Engine v4.2.1.stable.official" });

        Assert.Empty(result.Events);
        Assert.Empty(result.Errors);
    }

    [Fact]
    public void ToLine_RoundTripsThroughParse()
    {
        // The writer and the reader are the two halves of one wire format,
        // and the game — which has no test project of its own — is the only
        // caller of the writer. This is the test that makes adding a field on
        // one side without the other fail here instead of on someone's
        // machine the next time they launch the engine by hand.
        var original = ExpectedEvent();

        var result = TerminalEvent.Parse(new[] { original.ToLine() });

        Assert.Equal(new[] { original }, result.Events);
        Assert.Empty(result.Errors);
    }

    [Fact]
    public void ToLine_RoundTripsErrorEventWithoutContentVersionOrCanonicalHash()
    {
        var original = ExpectedEvent(
            outcomeKind: "error",
            errorCode: "CONTENT_ROOT_NOT_FOUND",
            contentVersion: null,
            canonicalHash: null);

        var result = TerminalEvent.Parse(new[] { original.ToLine() });

        Assert.Equal(new[] { original }, result.Events);
        Assert.Empty(result.Errors);
    }

    [Fact]
    public void Parse_ParsesErrorOutcomeWithoutContentVersion()
    {
        var line = BuildLine(
            outcomeKind: "error",
            errorCode: "CONTENT_ROOT_NOT_FOUND",
            contentVersion: null,
            canonicalHash: null);

        var result = TerminalEvent.Parse(new[] { line });

        Assert.Equal(
            new[]
            {
                ExpectedEvent(
                    outcomeKind: "error",
                    errorCode: "CONTENT_ROOT_NOT_FOUND",
                    contentVersion: null,
                    canonicalHash: null),
            },
            result.Events);
        Assert.Empty(result.Errors);
    }
}
