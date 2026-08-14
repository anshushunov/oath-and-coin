using System.Collections.Immutable;
using System.Reflection;
using System.Text.Json;
using OathAndCoin.Harness;

namespace OathAndCoin.Harness.Tests;

/// <summary>
/// End-to-end cover for the orchestration itself: the phase list a run
/// publishes when it aborts, the refusal that comes before any of it, and the
/// exit codes both produce.
/// </summary>
/// <remarks>
/// <para>
/// Every piece <see cref="SmokeRun"/> assembles is tested on its own, and
/// that was not enough: <c>GodotCaptureSurface.RunOnMainThread&lt;T&gt;</c>
/// shipped through a whole task recursing into itself because no automated
/// caller ever reached it. The skipped-phase filling in <c>PhaseLog.Complete</c>
/// and the abort path are the same shape of code — reachable only by a run
/// that goes wrong — so they get a caller here rather than a promise that
/// somebody will notice by hand.
/// </para>
/// <para>
/// The seams are the ones <see cref="SmokeRun.Execute"/> already takes: a
/// fake <see cref="IProcessRunner"/> answers the three <c>git</c> calls and
/// refuses everything else, and <c>--output</c> puts the run directory in a
/// temporary directory instead of the repository's <c>artifacts/</c>. No
/// engine, no build and no game process is involved — the run under test is
/// one that never gets that far.
/// </para>
/// </remarks>
public class SmokeRunTests : IDisposable
{
    private const string Commit = "21db9746e9d1ab68145fc6ac0e70364774930a34";

    private readonly string _outputRoot = Path.Combine(
        Path.GetTempPath(), "oath-and-coin-tests", Guid.NewGuid().ToString("n"));

    private readonly string? _temporaryDirectory = Environment.GetEnvironmentVariable("TEMP");
    private readonly string? _temporaryDirectoryAlias = Environment.GetEnvironmentVariable("TMP");

    [Fact]
    public void Run_PublishesEveryPhaseAndExitsThreeWhenTheEngineCannotBeResolved()
    {
        var error = new StringWriter();
        var output = new StringWriter();

        // A path that cannot exist, so resolve_engine fails on its own terms
        // rather than on whatever GODOT happens to be set to on this machine.
        var missingEngine = Path.Combine(_outputRoot, "no-such-engine", "godot.exe");

        var exitCode = SmokeRun.Execute(
            Arguments(godotPath: missingEngine), new FakeGitRunner(dirty: false), output, error);

        Assert.Equal(3, exitCode);

        using var report = JsonDocument.Parse(File.ReadAllText(PublishedReportPath()));
        var phases = report.RootElement.GetProperty("phases");

        Assert.Equal(
            new[]
            {
                "resolve_engine", "verify_engine", "build_game", "import_assets", "build_expected",
                "run_game", "inspect_frame", "evaluate_verdict", "publish",
            },
            phases.EnumerateArray().Select(phase => phase.GetProperty("id").GetString()).ToArray());

        Assert.Equal(
            new[]
            {
                "failed", "skipped", "skipped", "skipped", "skipped",
                "skipped", "skipped", "skipped", "passed",
            },
            phases.EnumerateArray().Select(phase => phase.GetProperty("verdict").GetString()).ToArray());

        // The run failed before there was anything to observe, and the report
        // says so rather than inventing an expectation or an outcome.
        Assert.Equal(JsonValueKind.Null, report.RootElement.GetProperty("engine").ValueKind);
        Assert.Equal(JsonValueKind.Null, report.RootElement.GetProperty("expected").ValueKind);
        Assert.Equal(JsonValueKind.Null, report.RootElement.GetProperty("actual").ValueKind);
        Assert.Equal(JsonValueKind.Null, report.RootElement.GetProperty("sdk_version").ValueKind);

        Assert.False(report.RootElement.GetProperty("verdict").GetProperty("passed").GetBoolean());
        Assert.True(report.RootElement.GetProperty("reproducible").GetBoolean());
        Assert.Contains("does not exist", error.ToString(), StringComparison.Ordinal);
    }

    [Fact]
    public void Run_RefusesADirtyWorkingTreeBeforeCreatingAnything()
    {
        var error = new StringWriter();
        var output = new StringWriter();

        var exitCode = SmokeRun.Execute(
            Arguments(godotPath: null), new FakeGitRunner(dirty: true), output, error);

        Assert.Equal(3, exitCode);

        // Nothing is filed: there is no run to file. A refusal that left an
        // empty run directory behind would be indistinguishable from a run
        // that died on its first phase.
        Assert.False(Directory.Exists(_outputRoot));
        Assert.Equal(string.Empty, output.ToString());
        Assert.Contains("--allow-dirty", error.ToString(), StringComparison.Ordinal);
    }

    [Fact]
    public void Run_MarksADirtyRunNotReproducibleWhenItIsAllowed()
    {
        var error = new StringWriter();
        var output = new StringWriter();
        var missingEngine = Path.Combine(_outputRoot, "no-such-engine", "godot.exe");

        var exitCode = SmokeRun.Execute(
            Arguments(godotPath: missingEngine, allowDirty: true), new FakeGitRunner(dirty: true), output, error);

        Assert.Equal(3, exitCode);

        using var report = JsonDocument.Parse(File.ReadAllText(PublishedReportPath()));

        Assert.False(report.RootElement.GetProperty("reproducible").GetBoolean());
        Assert.True(report.RootElement.GetProperty("repository").GetProperty("dirty").GetBoolean());
    }

    public void Dispose()
    {
        GC.SuppressFinalize(this);

        // SmokeRun points TEMP and TMP at the repository for the child
        // processes it launches, which in this process means for every test
        // that runs after it. Put them back.
        Environment.SetEnvironmentVariable("TEMP", _temporaryDirectory);
        Environment.SetEnvironmentVariable("TMP", _temporaryDirectoryAlias);

        try
        {
            if (Directory.Exists(_outputRoot))
            {
                Directory.Delete(_outputRoot, recursive: true);
            }
        }
        catch (IOException)
        {
            // A leaked temp directory is not worth failing a green test over.
        }
    }

    private ParsedArguments Arguments(string? godotPath, bool allowDirty = false) => new(
        Scenario: "gate0",
        Checkpoint: null,
        GodotPath: godotPath,
        Seed: CommandLine.DefaultSeed,
        OutputRoot: _outputRoot,
        TimeoutSeconds: CommandLine.DefaultTimeoutSeconds,
        AllowDirty: allowDirty);

    /// <summary>
    /// The single run directory under the scenario's checkpoint — the layout
    /// is asserted by name rather than by globbing for whatever appeared, so
    /// a run filed in the wrong place fails here instead of passing quietly.
    /// </summary>
    private string PublishedReportPath()
    {
        var runs = Path.Combine(_outputRoot, "gate0", "decisions_complete", "runs");
        var directory = Assert.Single(Directory.GetDirectories(runs));

        return Path.Combine(directory, RunLayout.ReportFileName);
    }

    /// <summary>
    /// Answers the three <c>git</c> calls <see cref="RepositoryState.Read"/>
    /// makes and refuses everything else, so a run that reaches the engine,
    /// the build or the game fails this test loudly instead of launching a
    /// real process from a unit test.
    /// </summary>
    private sealed class FakeGitRunner(bool dirty) : IProcessRunner
    {
        private static readonly string RepositoryRoot = Path.GetFullPath(
            typeof(FakeGitRunner).Assembly
                .GetCustomAttributes<AssemblyMetadataAttribute>()
                .Single(attribute => attribute.Key == "RepositoryRoot")
                .Value!);

        public ProcessOutcome Run(string fileName, IReadOnlyList<string> arguments, TimeSpan timeout)
        {
            if (!string.Equals(fileName, "git", StringComparison.Ordinal))
            {
                throw new InvalidOperationException(
                    $"This run was not supposed to launch '{fileName}'. It aborts before any engine, build or "
                    + "game process — if it got here, the phase order is wrong.");
            }

            var joined = string.Join(' ', arguments);

            return joined switch
            {
                var text when text.EndsWith("rev-parse --show-toplevel", StringComparison.Ordinal) =>
                    Output(RepositoryRoot),
                var text when text.EndsWith("rev-parse HEAD", StringComparison.Ordinal) => Output(Commit),
                var text when text.EndsWith("status --porcelain", StringComparison.Ordinal) =>
                    dirty ? Output(" M game/app/Main.cs") : Output(),
                _ => throw new InvalidOperationException($"Unexpected git invocation: git {joined}"),
            };
        }

        private static ProcessOutcome Output(params string[] lines) => new(
            lines
                .Select((text, index) => new ProcessLine(ProcessStream.StandardOutput, index, text))
                .ToImmutableArray(),
            ExitCode: 0,
            TimedOut: false,
            Duration: TimeSpan.Zero);
    }
}
