using System.Collections.Immutable;
using System.Text.Json;
using System.Text.Json.Nodes;
using OathAndCoin.Content.Scenarios;

namespace OathAndCoin.Harness;

/// <summary>
/// How one phase of a run ended. <see cref="Skipped"/> means it never
/// started, because an earlier phase failed — recorded rather than omitted,
/// so every report states the same nine phases and two of them can be read
/// side by side without first working out which phases each chose to mention.
/// </summary>
public enum PhaseVerdict
{
    Passed, Failed, Skipped,
}

/// <summary>
/// One phase's outcome: its id from <see cref="RunReport.PhaseIds"/>, how it
/// ended, how long it took (zero when skipped), and why it failed.
/// </summary>
public sealed record PhaseRecord(string Id, PhaseVerdict Verdict, TimeSpan Duration, string? Detail);

/// <summary>
/// The inputs that decide what a frame actually shows, stated rather than
/// inherited from whichever machine ran the game — <c>game/project.godot</c>
/// pins the same values for the same reason, and this is read back from it.
/// </summary>
public sealed record VisualEnvironment(string Resolution, string Renderer, string Locale, string WindowMode);

/// <summary>
/// Which engine ran, proved by its own bytes: a version string is something
/// any build can print, <paramref name="Sha256"/> identifies this one.
/// </summary>
public sealed record EngineFacts(string Path, string Version, string Sha256);

/// <summary>
/// The document a run leaves behind. It is read weeks later, by someone
/// without the machine that produced it, so it states every input the run
/// depended on rather than only the ones that happened to differ: the commit,
/// the engine binary, the visual environment, both independently computed
/// hashes, what the game reported back, and every phase in between.
/// </summary>
/// <remarks>
/// Absolute paths go through <see cref="NormalizePath"/> on the way out. A
/// report is quoted into issues and pull requests, and the name of the person
/// whose machine ran it is not part of the evidence.
/// </remarks>
/// <param name="Observation">
/// What the run observed, or <c>null</c> when it failed before there was
/// anything to observe (no engine, no build, no game process).
/// </param>
public sealed record RunReport(
    string RunId, RepositoryState Repository, string Scenario, string Checkpoint, ulong Seed,
    VisualEnvironment Visual, EngineFacts? Engine, ImmutableArray<PhaseRecord> Phases,
    RunObservation? Observation, Verdict Verdict, string RunDirectory)
{
    /// <summary>
    /// The format this build writes. Mirrors
    /// <see cref="OathAndCoin.GameProtocol.TerminalEvent.SupportedSchemaVersion"/>
    /// and <see cref="ScenarioManifest.SupportedManifestSchemaVersion"/>: a
    /// reader that does not know this version should refuse the file rather
    /// than read it under the wrong one's assumptions.
    /// </summary>
    public const int SchemaVersion = 1;

    /// <summary>
    /// Every phase a run goes through, in order. Fixed and exhaustive: a run
    /// reports all nine whatever happens to it.
    /// </summary>
    public static ImmutableArray<string> PhaseIds { get; } = ImmutableArray.Create(
        "resolve_engine", "verify_engine", "build_game", "import_assets", "build_expected",
        "run_game", "inspect_frame", "evaluate_verdict", "publish");

    /// <summary>
    /// Snake_case because the report reads like the terminal event it quotes,
    /// and indented because a person reads this file — it is evidence, not a
    /// hashed artifact, so nothing here needs canonical byte-for-byte form.
    /// </summary>
    private static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        WriteIndented = true,
    };

    /// <summary>
    /// Whether this run is evidence. A dirty working tree means the code that
    /// ran is not the code the commit names, so nobody can get back to it —
    /// derived here rather than passed in, so no caller can write a report
    /// that claims otherwise (<c>--allow-dirty</c> is for debugging).
    /// </summary>
    public bool Reproducible => !Repository.Dirty;

    /// <param name="homeDirectory">The directory replaced by <c>~</c> in every path this report states.</param>
    public string ToJson(string homeDirectory)
    {
        ArgumentException.ThrowIfNullOrEmpty(homeDirectory);

        var root = new JsonObject
        {
            ["schema_version"] = SchemaVersion,
            ["run_id"] = RunId,
            ["reproducible"] = Reproducible,
            ["repository"] = new JsonObject
            {
                ["root"] = NormalizePath(Repository.Root, homeDirectory),
                ["commit"] = Repository.Commit,
                ["dirty"] = Repository.Dirty,
            },
            ["scenario"] = Scenario,
            ["checkpoint"] = Checkpoint,
            ["seed"] = JsonValue.Create(Seed),
            ["visual_environment"] = JsonSerializer.SerializeToNode(Visual, Options),
            ["engine"] = Engine is null ? null : new JsonObject
            {
                ["path"] = NormalizePath(Engine.Path, homeDirectory),
                ["version"] = Engine.Version,
                ["sha256"] = Engine.Sha256,
            },
            ["expected"] = DescribeExpected(),
            ["actual"] = DescribeActual(),
            ["phases"] = new JsonArray(Phases.Select(Describe).ToArray<JsonNode?>()),
            ["verdict"] = new JsonObject
            {
                ["passed"] = Verdict.Passed,
                ["reasons"] = new JsonArray(Verdict.Reasons.Select(reason => (JsonNode?)reason).ToArray()),
            },
            ["paths"] = new JsonObject
            {
                ["run_directory"] = NormalizePath(RunDirectory, homeDirectory),
                ["frame"] = NormalizePath(Path.Combine(RunDirectory, RunLayout.FrameFileName), homeDirectory),
                ["run_log"] = NormalizePath(Path.Combine(RunDirectory, RunLayout.RunLogFileName), homeDirectory),
                ["report"] = NormalizePath(Path.Combine(RunDirectory, RunLayout.ReportFileName), homeDirectory),
            },
        };

        return root.ToJsonString(Options);
    }

    /// <summary>
    /// Rewrites <paramref name="path"/> under <c>~</c> when it lies inside
    /// <paramref name="homeDirectory"/>, and normalizes separators to
    /// <c>/</c> so the same run reads the same on either platform.
    /// </summary>
    public static string NormalizePath(string path, string homeDirectory)
    {
        ArgumentException.ThrowIfNullOrEmpty(path);
        ArgumentException.ThrowIfNullOrEmpty(homeDirectory);

        var full = Path.GetFullPath(path).Replace('\\', '/');
        var home = Path.GetFullPath(homeDirectory).Replace('\\', '/').TrimEnd('/');

        // Case-insensitively, because Windows paths are: a run launched from
        // c:\users\... still lives under the home directory C:\Users\...
        if (string.Equals(full, home, StringComparison.OrdinalIgnoreCase))
        {
            return "~";
        }

        return full.StartsWith(home + "/", StringComparison.OrdinalIgnoreCase)
            ? "~/" + full[(home.Length + 1)..]
            : full;
    }

    private JsonNode? DescribeExpected() => Observation is null ? null : new JsonObject
    {
        ["outcome"] = OutcomeText(Observation.ExpectedOutcome),
        ["error_code"] = Observation.ExpectedErrorCode,
        ["canonical_hash"] = Observation.ExpectedCanonicalHash,

        // The two hashes stay two fields, here as in the verdict: one proves
        // the tool and the game built the same read model, the other that the
        // model reached the control tree. Reporting either as the other would
        // hide exactly the bug the second one exists to catch.
        ["read_model_hash"] = Observation.ExpectedReadModelHash,
        ["rendered_ui_hash"] = Observation.ExpectedRenderedUiHash,
    };

    private JsonNode? DescribeActual()
    {
        if (Observation is null)
        {
            return null;
        }

        // A single terminal event is a run that reported one thing about
        // itself; none or several is a failure SmokeVerdict already names,
        // and this section states the count rather than picking one to quote.
        var terminal = Observation.Terminal.Events.Length == 1 ? Observation.Terminal.Events[0] : null;

        return new JsonObject
        {
            ["exit_code"] = Observation.ExitCode,
            ["timed_out"] = Observation.TimedOut,
            ["terminal_event_count"] = Observation.Terminal.Events.Length,
            ["terminal_errors"] = new JsonArray(
                Observation.Terminal.Errors.Select(error => (JsonNode?)error).ToArray()),

            // Quoted whole, through the serializer: these two are already the
            // wire shapes a reader wants (the event as the game printed it,
            // the frame as it was found on disk), and rewriting their fields
            // by hand here would only be a second place to get them wrong.
            ["terminal_event"] = terminal is null ? null : JsonSerializer.SerializeToNode(terminal, Options),
            ["frame"] = JsonSerializer.SerializeToNode(Observation.Frame, Options),
        };
    }

    private static JsonNode Describe(PhaseRecord phase) => new JsonObject
    {
        ["id"] = phase.Id,
        ["verdict"] = VerdictText(phase.Verdict),

        // Milliseconds as an integer: TimeSpan.TotalMilliseconds is a double,
        // and this project uses no floating-point type anywhere.
        ["duration_ms"] = phase.Duration.Ticks / TimeSpan.TicksPerMillisecond,
        ["detail"] = phase.Detail,
    };

    private static string VerdictText(PhaseVerdict verdict) => verdict switch
    {
        PhaseVerdict.Passed => "passed",
        PhaseVerdict.Failed => "failed",
        PhaseVerdict.Skipped => "skipped",
        _ => throw new ArgumentOutOfRangeException(nameof(verdict), verdict, "Unknown phase verdict."),
    };

    private static string OutcomeText(ScenarioOutcomeKind outcome) => outcome switch
    {
        ScenarioOutcomeKind.Success => "success",
        ScenarioOutcomeKind.Error => "error",
        _ => throw new ArgumentOutOfRangeException(nameof(outcome), outcome, "Unknown scenario outcome kind."),
    };
}
