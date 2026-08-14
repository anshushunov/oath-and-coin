using System.Collections.Immutable;
using System.Text.Json;
using System.Text.Json.Serialization;
using OathAndCoin.Content.Scenarios;
using OathAndCoin.GameProtocol;

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
/// the SDK and the engine binary, the visual environment, both independently
/// computed hashes, what the game reported back, and every phase in between.
/// </summary>
/// <remarks>
/// Nothing leaves this type without going through <see cref="NormalizePath"/>
/// or <see cref="NormalizeText"/> first — structured path fields through the
/// former, free text through the latter, because an absolute path quoted
/// inside a failure message is exactly as much of a leak as one in a field of
/// its own. A report is quoted into issues and pull requests, and the name of
/// the person whose machine ran it is not part of the evidence.
/// </remarks>
/// <param name="SdkVersion">
/// What <c>dotnet --version</c> reported during <c>build_game</c>, or
/// <c>null</c> when the run never got that far. Two runs that differ only by
/// SDK patch level are otherwise indistinguishable in this document.
/// </param>
/// <param name="Observation">
/// What the run observed, or <c>null</c> when it failed before there was
/// anything to observe (no engine, no build, no game process).
/// </param>
public sealed record RunReport(
    string RunId, RepositoryState Repository, string Scenario, string Checkpoint, ulong Seed,
    VisualEnvironment Visual, string? SdkVersion, EngineFacts? Engine, ImmutableArray<PhaseRecord> Phases,
    RunObservation? Observation, Verdict Verdict, string RunDirectory)
{
    /// <summary>
    /// The format this build writes. Mirrors
    /// <see cref="TerminalEvent.SupportedSchemaVersion"/> and
    /// <see cref="ScenarioManifest.SupportedManifestSchemaVersion"/>: a
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
    /// enum members included — the converter spells them the same way, so
    /// nothing here keeps a second switch over an enum whose wire text is
    /// already decided. Indented because a person reads this file: it is
    /// evidence, not a hashed artifact, so nothing needs canonical form.
    /// </summary>
    private static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        WriteIndented = true,
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.SnakeCaseLower) },
    };

    /// <summary>
    /// Whether this run is evidence. A dirty working tree means the code that
    /// ran is not the code the commit names, so nobody can get back to it —
    /// derived here rather than passed in, so no caller can write a report
    /// that claims otherwise (<c>--allow-dirty</c> is for debugging).
    /// </summary>
    public bool Reproducible => !Repository.Dirty;

    /// <param name="homeDirectory">The directory replaced by <c>~</c> everywhere in this report.</param>
    public string ToJson(string homeDirectory)
    {
        ArgumentException.ThrowIfNullOrEmpty(homeDirectory);

        var document = new ReportDocument(
            SchemaVersion,
            RunId,
            Reproducible,
            Repository with { Root = NormalizePath(Repository.Root, homeDirectory) },
            Scenario,
            Checkpoint,
            Seed,
            Visual,
            SdkVersion,
            Engine is null ? null : Engine with { Path = NormalizePath(Engine.Path, homeDirectory) },
            Observation is null ? null : new ExpectedDocument(
                Observation.ExpectedOutcome, Observation.ExpectedErrorCode, Observation.ExpectedCanonicalHash,

                // Two fields, here as in the verdict: one proves the tool and
                // the game built the same read model, the other that the
                // model reached the control tree. Reporting either as the
                // other would hide the bug the second one exists to catch.
                Observation.ExpectedReadModelHash, Observation.ExpectedRenderedUiHash),
            Observation is null ? null : DescribeActual(Observation, homeDirectory),
            Phases.Select(phase => new PhaseDocument(
                phase.Id,
                phase.Verdict,

                // Milliseconds as an integer: TimeSpan.TotalMilliseconds is a
                // double, and this project uses no floating-point type.
                phase.Duration.Ticks / TimeSpan.TicksPerMillisecond,
                NormalizeText(phase.Detail, homeDirectory))).ToImmutableArray(),
            new VerdictDocument(
                Verdict.Passed,
                Verdict.Reasons.Select(reason => NormalizeText(reason, homeDirectory)!).ToImmutableArray()),
            new PathsDocument(
                NormalizePath(RunDirectory, homeDirectory),
                NormalizePath(Path.Combine(RunDirectory, RunLayout.FrameFileName), homeDirectory),
                NormalizePath(Path.Combine(RunDirectory, RunLayout.RunLogFileName), homeDirectory),
                NormalizePath(Path.Combine(RunDirectory, RunLayout.ReportFileName), homeDirectory)));

        return JsonSerializer.Serialize(document, Options);
    }

    /// <summary>
    /// Rewrites <paramref name="path"/> under <c>~</c> when it lies inside
    /// <paramref name="homeDirectory"/>, and normalizes separators to
    /// <c>/</c> so the same run reads the same on either platform. For a
    /// value that is a path in its entirety; see <see cref="NormalizeText"/>
    /// for one with a path somewhere inside it.
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

    /// <summary>
    /// Replaces the home directory with <c>~</c> wherever it appears inside
    /// free text — a failure message, a phase's detail, a verdict's reason.
    /// </summary>
    /// <remarks>
    /// These messages quote paths the way whoever produced them had them:
    /// the OS's own spelling (backslashes on Windows) from an exception, this
    /// tool's normalized spelling (forward slashes) from anything that went
    /// through <see cref="NormalizePath"/> first. Both are replaced, so a
    /// path that never reached a structured field — a rejected
    /// <c>--godot</c>, quoted in the only place a failed run records it — is
    /// no longer where a user name reaches the report. Separators are left
    /// alone otherwise: this is arbitrary prose, not a path, and rewriting
    /// every backslash in it would corrupt text that is not one.
    /// </remarks>
    public static string? NormalizeText(string? text, string homeDirectory)
    {
        ArgumentException.ThrowIfNullOrEmpty(homeDirectory);

        if (string.IsNullOrEmpty(text))
        {
            return text;
        }

        var home = Path.GetFullPath(homeDirectory).TrimEnd('/', '\\');

        return text
            .Replace(home, "~", StringComparison.OrdinalIgnoreCase)
            .Replace(home.Replace('\\', '/'), "~", StringComparison.OrdinalIgnoreCase);
    }

    private static ActualDocument DescribeActual(RunObservation observation, string homeDirectory) => new(
        observation.ExitCode,
        observation.TimedOut,

        // A single terminal event is a run that reported one thing about
        // itself; none or several is a failure SmokeVerdict already names,
        // and this section states the count rather than picking one to quote.
        observation.Terminal.Events.Length,
        observation.Terminal.Errors.Select(error => NormalizeText(error, homeDirectory)!).ToImmutableArray(),
        observation.Terminal.Events.Length == 1 ? observation.Terminal.Events[0] : null,

        // Every engine diagnostic, including the ones the verdict tolerated.
        // Only two markers fail a run (see SmokeVerdict's fatal prefixes);
        // that decides what a run means, not what it records, so an ERROR:
        // line about the machine still reaches whoever reads this document.
        // run.log holds the output complete and verbatim either way.
        observation.DiagnosticLines
            .Where(SmokeVerdict.IsDiagnostic)
            .Select(line => NormalizeText(line, homeDirectory)!)
            .ToImmutableArray(),
        observation.Frame);

    /// <summary>
    /// The report's wire shape, as records rather than hand-built JSON
    /// objects: the serializer already knows how to spell a record's members
    /// in snake_case, and every type it reaches here — the repository state,
    /// the engine facts, the terminal event, the frame inspection — is
    /// already the shape a reader wants. Writing those fields out again by
    /// hand would only be a second place to get one of them wrong.
    /// </summary>
    private sealed record ReportDocument(
        int SchemaVersion, string RunId, bool Reproducible, RepositoryState Repository, string Scenario,
        string Checkpoint, ulong Seed, VisualEnvironment VisualEnvironment, string? SdkVersion,
        EngineFacts? Engine, ExpectedDocument? Expected, ActualDocument? Actual,
        ImmutableArray<PhaseDocument> Phases, VerdictDocument Verdict, PathsDocument Paths);

    private sealed record ExpectedDocument(
        ScenarioOutcomeKind Outcome, string? ErrorCode, string? CanonicalHash,
        string ReadModelHash, string RenderedUiHash);

    private sealed record ActualDocument(
        int ExitCode, bool TimedOut, int TerminalEventCount, ImmutableArray<string> TerminalErrors,
        TerminalEvent? TerminalEvent, ImmutableArray<string> EngineDiagnostics, FrameInspection Frame);

    private sealed record PhaseDocument(string Id, PhaseVerdict Verdict, long DurationMs, string? Detail);

    private sealed record VerdictDocument(bool Passed, ImmutableArray<string> Reasons);

    private sealed record PathsDocument(string RunDirectory, string Frame, string RunLog, string Report);
}
