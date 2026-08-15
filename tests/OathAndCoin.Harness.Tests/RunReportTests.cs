using System.Collections.Immutable;
using System.Text.Json;
using OathAndCoin.Content.Scenarios;
using OathAndCoin.GameProtocol;

namespace OathAndCoin.Harness.Tests;

/// <summary>
/// <c>report.json</c> is the whole point of a run: it is the document a
/// reader trusts weeks later, without the machine that produced it. These
/// tests pin what it has to say — the schema it was written under, every
/// phase that ran and how long each took, the commit it ran on, whether that
/// commit was clean enough for the run to mean anything, the visual
/// environment the frame was taken under, and every reason a failed verdict
/// gave. They also pin what it must never say: the name of the person whose
/// machine ran it.
/// </summary>
public class RunReportTests
{
    /// <summary>
    /// Spelled out here rather than read from <see cref="RunReport.PhaseIds"/>:
    /// a test that asks the code under test what to expect would agree with
    /// any reordering or omission the code later grows. The brief's version 1
    /// demanded "five phases" and then listed seven — the set is the thing
    /// being pinned, so the set is written out.
    /// </summary>
    private static readonly string[] ExpectedPhaseIds =
    {
        "resolve_engine",
        "verify_engine",
        "build_game",
        "import_assets",
        "build_expected",
        "run_game",
        "inspect_frame",
        "evaluate_verdict",
        "publish",
    };

    [Fact]
    public void Report_CarriesSchemaVersion()
    {
        using var document = Render(Sample());

        Assert.Equal(1, document.RootElement.GetProperty("schema_version").GetInt32());
    }

    [Fact]
    public void Report_ContainsExactOrderedPhaseIds()
    {
        using var document = Render(Sample());

        var ids = document.RootElement.GetProperty("phases")
            .EnumerateArray()
            .Select(phase => phase.GetProperty("id").GetString())
            .ToArray();

        Assert.Equal(ExpectedPhaseIds, ids);
    }

    [Fact]
    public void Report_RecordsVerdictAndDurationPerPhase()
    {
        var phases = Phases()
            .Select(phase => phase with { Verdict = PhaseVerdict.Passed, Duration = TimeSpan.FromMilliseconds(250) })
            .ToImmutableArray();

        using var document = Render(Sample() with { Phases = phases });

        foreach (var phase in document.RootElement.GetProperty("phases").EnumerateArray())
        {
            Assert.Equal("passed", phase.GetProperty("verdict").GetString());
            Assert.Equal(250, phase.GetProperty("duration_ms").GetInt64());
        }
    }

    [Fact]
    public void Report_NormalizesAbsolutePaths()
    {
        var (home, userName) = FabricatedHome();

        var report = Sample() with
        {
            RunDirectory = Path.Combine(home, "oath-and-coin", "artifacts", "smoke", "gate0", "run"),
            Engine = new EngineFacts(Path.Combine(home, "engines", "godot"), "4.7.1.stable.mono", "b0b1"),
            Repository = new RepositoryState(Path.Combine(home, "oath-and-coin"), "c0ffee", Dirty: false),
        };

        var json = report.ToJson(home);

        Assert.Contains("~/oath-and-coin", json, StringComparison.Ordinal);
        Assert.Contains("~/engines/godot", json, StringComparison.Ordinal);
        Assert.DoesNotContain(userName, json, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// The structured path fields are not the only way a path reaches this
    /// document. A rejected <c>--godot</c> is quoted in a failure message and
    /// nowhere else — the <c>engine</c> block is null, because verification
    /// never ran — so a report that only normalized its structured fields
    /// would publish the operator's home directory in <c>verdict.reasons</c>
    /// while every field it did normalize looked clean.
    /// </summary>
    [Fact]
    public void Report_NormalizesPathsQuotedInsideFailureMessages()
    {
        var (home, userName) = FabricatedHome();
        var enginePath = Path.Combine(home, "Godot", "Godot_v4.7.1-stable_mono_win64.exe");

        var report = Sample() with
        {
            Engine = null,
            Observation = null,
            Repository = new RepositoryState("/repo", "c0ffee", Dirty: false),
            RunDirectory = "/repo/artifacts/smoke/gate0/decisions_complete/runs/r",
            Phases = Phases()
                .Select(phase => phase.Id == "resolve_engine"
                    ? phase with
                    {
                        Verdict = PhaseVerdict.Failed,
                        Detail = $"The Godot engine at '{enginePath}', named by '--godot', does not exist.",
                    }
                    : phase)
                .ToImmutableArray(),
            Verdict = new Verdict(
                Passed: false,
                ImmutableArray.Create($"The Godot engine at '{enginePath}', named by '--godot', does not exist.")),
        };

        var json = report.ToJson(home);

        Assert.DoesNotContain(userName, json, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("~", json, StringComparison.Ordinal);

        // The message is still a readable sentence, not a path-shaped ruin:
        // only the home prefix is replaced.
        using var document = JsonDocument.Parse(json);
        var reason = document.RootElement.GetProperty("verdict").GetProperty("reasons")[0].GetString();
        Assert.StartsWith("The Godot engine at '~", reason, StringComparison.Ordinal);
        Assert.EndsWith("does not exist.", reason, StringComparison.Ordinal);
    }

    /// <summary>
    /// The plan's Definition of Done asks the report to carry the SDK version
    /// alongside the engine's: two runs from the same commit under different
    /// SDK patch levels compile different assemblies, and a report silent
    /// about the compiler cannot tell them apart.
    /// </summary>
    [Fact]
    public void Report_RecordsSdkVersion()
    {
        using var document = Render(Sample() with { SdkVersion = "8.0.424" });

        Assert.Equal("8.0.424", document.RootElement.GetProperty("sdk_version").GetString());
    }

    [Fact]
    public void Report_RecordsCommitAndDirtyFlag()
    {
        var report = Sample() with
        {
            Repository = new RepositoryState("/repo", "21db9746e9d1ab68145fc6ac0e70364774930a34", Dirty: true),
        };

        using var document = Render(report);
        var repository = document.RootElement.GetProperty("repository");

        Assert.Equal("21db9746e9d1ab68145fc6ac0e70364774930a34", repository.GetProperty("commit").GetString());
        Assert.True(repository.GetProperty("dirty").GetBoolean());
    }

    [Fact]
    public void Report_MarksDirtyRunAsNotReproducible()
    {
        using var clean = Render(Sample());
        Assert.True(clean.RootElement.GetProperty("reproducible").GetBoolean());

        var dirty = Sample() with { Repository = new RepositoryState("/repo", "c0ffee", Dirty: true) };

        using var document = Render(dirty);

        // --allow-dirty exists for debugging. A run taken under it is not
        // evidence, and the report has to say so on its own rather than leave
        // the reader to notice the dirty flag two fields away.
        Assert.False(document.RootElement.GetProperty("reproducible").GetBoolean());
    }

    [Fact]
    public void Report_RecordsVisualEnvironment()
    {
        using var document = Render(Sample());
        var visual = document.RootElement.GetProperty("visual_environment");

        Assert.Equal("1280x720", visual.GetProperty("resolution").GetString());
        Assert.Equal("gl_compatibility", visual.GetProperty("renderer").GetString());
        Assert.Equal("en", visual.GetProperty("locale").GetString());
        Assert.Equal("windowed", visual.GetProperty("window_mode").GetString());
    }

    [Fact]
    public void Report_ListsAllVerdictReasons()
    {
        var reasons = ImmutableArray.Create(
            "The game process exited with code 1, not 0.",
            "Terminal event's read_model_hash does not match the hash the tool computed independently.",
            "Frame 'frame.png' does not have a valid PNG header.");

        using var document = Render(Sample() with { Verdict = new Verdict(Passed: false, reasons) });
        var verdict = document.RootElement.GetProperty("verdict");

        Assert.False(verdict.GetProperty("passed").GetBoolean());
        Assert.Equal(
            reasons,
            verdict.GetProperty("reasons").EnumerateArray().Select(reason => reason.GetString()!).ToImmutableArray());
    }

    /// <summary>
    /// An <c>ERROR:</c> line the verdict no longer fails on still has to reach
    /// whoever reads the report (owner's ruling, 2026-08-14): narrowing the
    /// fatal set changed what fails a run, not what a run records.
    /// <c>run.log</c> keeps the output verbatim and complete; this field
    /// repeats the lines carrying one of the engine's own diagnostic markers,
    /// so the report is readable on its own.
    /// </summary>
    [Fact]
    public void Report_ListsEngineDiagnosticsTheVerdictDidNotFailOn()
    {
        var observation = SampleObservation() with
        {
            DiagnosticLines = ImmutableArray.Create(
                "Godot Engine v4.7.1.stable.mono.official",
                "ERROR: Failed to read the root certificate store.",
                "   at: get_system_ca_certificates (platform/windows/os_windows.cpp:2582)"),
        };

        using var document = Render(Sample() with { Observation = observation });

        var diagnostics = document.RootElement
            .GetProperty("actual")
            .GetProperty("engine_diagnostics")
            .EnumerateArray()
            .Select(line => line.GetString())
            .ToArray();

        // The banner line carries no marker and the location line continues
        // the one above it; the marker line is what this field states, and
        // run.log holds all three whatever this one selects.
        Assert.Equal(new[] { "ERROR: Failed to read the root certificate store." }, diagnostics);
    }

    /// <summary>
    /// A home directory and its leaf name, invented rather than read from the
    /// machine. <see cref="RunReport.ToJson"/> takes the home directory as an
    /// argument, so nothing about these tests needs the real one — and reading
    /// it made them depend on who ran them. In a container the home directory
    /// is <c>/root</c>, whose leaf name is a substring of the report's own
    /// <c>"root"</c> key, so the "no user name anywhere" assertion failed on a
    /// perfectly normalized document. The leaf here is deliberately a word no
    /// report vocabulary contains.
    /// </summary>
    private static (string Home, string UserName) FabricatedHome()
    {
        const string userName = "harness-fixture-user";
        var root = Path.GetPathRoot(Directory.GetCurrentDirectory());

        Assert.False(string.IsNullOrEmpty(root), "This test needs a rooted current directory.");

        return (Path.Combine(root, "home-fixture", userName), userName);
    }

    private static JsonDocument Render(RunReport report) =>
        JsonDocument.Parse(report.ToJson(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile)));

    private static ImmutableArray<PhaseRecord> Phases() =>
        RunReport.PhaseIds
            .Select(id => new PhaseRecord(id, PhaseVerdict.Passed, TimeSpan.FromMilliseconds(1), Detail: null))
            .ToImmutableArray();

    private static RunReport Sample() => new(
        RunId: "20260814T101530Z-0f1e2d3c",
        Repository: new RepositoryState("/repo", "21db9746e9d1ab68145fc6ac0e70364774930a34", Dirty: false),
        Scenario: "gate0",
        Checkpoint: "decisions_complete",
        Seed: 424242UL,
        Visual: new VisualEnvironment("1280x720", "gl_compatibility", "en", "windowed"),
        SdkVersion: "8.0.424",
        Engine: new EngineFacts("/engines/godot", "4.7.1.stable.mono", "b0b1"),
        Phases: Phases(),
        Observation: SampleObservation(),
        Verdict: new Verdict(Passed: true, ImmutableArray<string>.Empty),
        RunDirectory: "/repo/artifacts/smoke/gate0/decisions_complete/runs/20260814T101530Z-0f1e2d3c");

    private static RunObservation SampleObservation()
    {
        var terminalEvent = new TerminalEvent(
            SchemaVersion: 1,
            Event: "terminal",
            OutcomeKind: "success",
            Scenario: "gate0",
            Seed: 424242UL,
            Checkpoint: "decisions_complete",
            ErrorCode: null,
            ContentVersion: "aaaa",
            CanonicalHash: "bbbb",
            ReadModelHash: "cccc",
            RenderedUiHash: "dddd",
            ScreenState: "normal",
            FrameSha256: "eeee",
            FrameWidth: 1280,
            FrameHeight: 720,
            FrameDistinctColors: 42);

        return new RunObservation(
            Scenario: "gate0",
            Checkpoint: "decisions_complete",
            Seed: 424242UL,
            RequestedWidth: 1280,
            RequestedHeight: 720,
            ExpectedOutcome: ScenarioOutcomeKind.Success,
            ExpectedErrorCode: null,
            ExpectedCanonicalHash: "bbbb",
            ExpectedReadModelHash: "cccc",
            ExpectedRenderedUiHash: "dddd",
            Terminal: new TerminalParseResult(
                ImmutableArray.Create(terminalEvent),
                ImmutableArray<string>.Empty),
            ExitCode: 0,
            TimedOut: false,
            DiagnosticLines: ImmutableArray<string>.Empty,
            Frame: new FrameInspection(HasValidPngHeader: true, Width: 1280, Height: 720, ByteLength: 4096, Sha256: "eeee"),
            FramePath: "/repo/artifacts/smoke/gate0/decisions_complete/runs/20260814T101530Z-0f1e2d3c/frame.png");
    }
}
