using System.Collections.Immutable;
using System.Diagnostics;
using System.Globalization;
using OathAndCoin.Content;
using OathAndCoin.Content.Scenarios;
using OathAndCoin.GameProtocol;
using OathAndCoin.Presentation;

namespace OathAndCoin.Harness;

/// <summary>
/// One <c>run-smoke</c> invocation, from the working tree it is taken from to
/// the report it leaves behind. Every piece it uses was built and tested on
/// its own — the command line, the process runner, the frame inspector, the
/// verdict, the layout and the report — and this is the only place that knows
/// what order they go in.
/// </summary>
/// <remarks>
/// <para>
/// The nine phases are <see cref="RunReport.PhaseIds"/>, and a run states all
/// nine whatever happens to it. The first five have no "carried on anyway"
/// outcome: without an engine, a build, imported assets or an expectation to
/// compare against, the run can prove nothing, so each aborts the run (exit
/// code 3) and the phases after it are reported as skipped. Everything the
/// game itself does — a non-zero exit, a timeout, a missing frame — is data
/// for <see cref="SmokeVerdict"/>, not a failure of this tool, and is carried
/// all the way to a published report.
/// </para>
/// <para>
/// The report is published in every case that gets far enough to have a run
/// directory. The two refusals that come earlier — a dirty working tree, and
/// inputs that cannot be read at all — say so on stderr and create nothing:
/// there is no run to file.
/// </para>
/// </remarks>
public static class SmokeRun
{
    /// <summary>The verdict passed: this run proves what it set out to prove.</summary>
    public const int ExitPassed = 0;

    /// <summary>The verdict failed. Every reason is printed to stderr.</summary>
    public const int ExitVerdictFailed = 1;

    /// <summary>
    /// The run could not be carried out: no engine, a failed build or import,
    /// an expectation the tool could not build, or a working tree it refuses
    /// to run on.
    /// </summary>
    public const int ExitEnvironment = 3;

    /// <summary>
    /// The locale every run states. Carried in argv rather than inherited
    /// from the machine (see <c>GameArguments.Locale</c>), because it decides
    /// what the frame says.
    /// </summary>
    private const string Locale = "en";

    public static int Execute(ParsedArguments arguments, IProcessRunner runner, TextWriter output, TextWriter error)
    {
        ArgumentNullException.ThrowIfNull(arguments);
        ArgumentNullException.ThrowIfNull(runner);
        ArgumentNullException.ThrowIfNull(output);
        ArgumentNullException.ThrowIfNull(error);

        try
        {
            return Run(arguments, runner, output, error);
        }
        catch (Exception exception)
        {
            // Anything thrown out here happened before there was a run
            // directory to publish a report into (reading git, reading the
            // scenario, opening the layout), so this message is the whole
            // report. Caught broadly on purpose: a tool's top level turning
            // an unexpected failure into one line on stderr and a usable exit
            // code beats a stack trace and whatever code the runtime picks.
            error.WriteLine(exception.Message);
            return ExitEnvironment;
        }
    }

    private static int Run(ParsedArguments arguments, IProcessRunner runner, TextWriter output, TextWriter error)
    {
        var repository = RepositoryState.Read(runner, AppContext.BaseDirectory);

        if (repository.Dirty && !arguments.AllowDirty)
        {
            error.WriteLine(
                "The working tree has uncommitted changes, so this run could not be reproduced from the commit "
                + "it would name. Commit them first. '--allow-dirty' runs anyway, for debugging — a run taken "
                + "under it is marked 'reproducible: false' and is not evidence.");
            return ExitEnvironment;
        }

        var inputs = ScenarioInputs.Load(repository.Root, arguments);
        var visual = GodotEngine.ReadVisualEnvironment(
            Path.Combine(repository.Root, "game", "project.godot"),
            GameArguments.DefaultWidth, GameArguments.DefaultHeight, Locale);

        var layout = RunLayout.Begin(
            arguments.OutputRoot ?? Path.Combine(repository.Root, "artifacts", "smoke"),
            arguments.Scenario, inputs.Checkpoint.Name, CreateRunId(arguments, inputs.Checkpoint));

        RedirectTemporaryDirectory(repository.Root);

        var phases = new PhaseLog();
        EngineFacts? engine = null;
        RunObservation? observation = null;
        Verdict? verdict = null;
        string? aborted = null;

        try
        {
            var enginePath = phases.Run("resolve_engine", () => GodotEngine.Resolve(arguments.GodotPath));
            engine = phases.Run("verify_engine", () => GodotEngine.Verify(runner, enginePath));
            phases.Run("build_game", () => GodotEngine.Build(runner, repository.Root));
            phases.Run("import_assets", () => GodotEngine.Import(runner, enginePath, repository.Root));

            var expected = phases.Run(
                "build_expected", () => Expectation.Build(repository.Root, layout.RunId, inputs, arguments.Seed));

            var outcome = phases.Run(
                "run_game", () => RunGame(runner, enginePath, repository.Root, arguments, inputs, expected, layout));

            var frame = phases.Time(
                "inspect_frame",
                () => Inspect(layout.Staged(RunLayout.FrameFileName)),
                inspection => inspection.HasValidPngHeader);

            var observed = Observe(inputs, arguments, expected, outcome, frame, layout);
            observation = observed;
            verdict = phases.Time("evaluate_verdict", () => SmokeVerdict.Evaluate(observed), result => result.Passed);
        }
        catch (Exception exception)
        {
            aborted = exception.Message;
        }

        verdict ??= new Verdict(
            Passed: false, ImmutableArray.Create(aborted ?? "The run ended before it reached a verdict."));

        Publish(
            layout,
            phases,
            new RunReport(
                layout.RunId, repository, arguments.Scenario, inputs.Checkpoint.Name, arguments.Seed, visual,
                engine, ImmutableArray<PhaseRecord>.Empty, observation, verdict, layout.RunDirectory));

        output.WriteLine($"run: {layout.RunDirectory}");

        foreach (var reason in verdict.Reasons)
        {
            error.WriteLine(reason);
        }

        if (aborted is not null)
        {
            return ExitEnvironment;
        }

        return verdict.Passed ? ExitPassed : ExitVerdictFailed;
    }

    /// <summary>
    /// Renders the report and hands the whole run to <see cref="RunLayout.Publish"/>.
    /// </summary>
    /// <remarks>
    /// This is the one phase with no duration to state, and it says so rather
    /// than reporting a number it made up: everything <c>publish</c> does —
    /// rendering the document, writing it, renaming the directory, moving the
    /// two pointers — happens after the document that would have to carry the
    /// measurement is finished.
    /// </remarks>
    private static void Publish(RunLayout layout, PhaseLog phases, RunReport report)
    {
        phases.Add(
            "publish",
            PhaseVerdict.Passed,
            TimeSpan.Zero,
            "Not timed: a report cannot state how long writing itself took.");

        var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        layout.Publish((report with { Phases = phases.Complete() }).ToJson(home), report.Verdict.Passed);
    }

    /// <summary>Launches the game and keeps everything it said, whatever it said.</summary>
    private static ProcessOutcome RunGame(
        IProcessRunner runner,
        string enginePath,
        string repositoryRoot,
        ParsedArguments arguments,
        ScenarioInputs inputs,
        Expectation expected,
        RunLayout layout)
    {
        var game = new GameArguments(
            Smoke: true,
            Scenario: arguments.Scenario,
            Checkpoint: inputs.Checkpoint.Name,
            Seed: arguments.Seed,

            // The faulted root for a scenario that expects an error, the real
            // one otherwise — the same root the expectation was built
            // against, so both sides of the comparison saw the same content.
            ContentRoot: expected.ContentRoot,
            SchemaRoot: Path.Combine(repositoryRoot, "schemas"),
            ScenarioRoot: Path.Combine(repositoryRoot, "scenarios"),
            ScreenshotPath: layout.Staged(RunLayout.FrameFileName),
            Width: GameArguments.DefaultWidth,
            Height: GameArguments.DefaultHeight,
            Locale: Locale);

        var argv = GameInvocation.BuildArgv(Path.Combine(repositoryRoot, "game"), game);
        var outcome = runner.Run(enginePath, argv, TimeSpan.FromSeconds(arguments.TimeoutSeconds));

        File.WriteAllLines(
            layout.Staged(RunLayout.RunLogFileName),
            outcome.Lines.Select(line => $"{line.Stream}\t{line.SequenceInStream}\t{line.Text}"));

        return outcome;
    }

    /// <summary>
    /// A frame that was never written is a failed verdict, not a failed tool:
    /// this stands in for it so the run still reaches a published report.
    /// </summary>
    private static FrameInspection Inspect(string path) => File.Exists(path)
        ? FrameFile.Inspect(path)
        : new FrameInspection(HasValidPngHeader: false, Width: 0, Height: 0, ByteLength: 0, Sha256: string.Empty);

    private static RunObservation Observe(
        ScenarioInputs inputs,
        ParsedArguments arguments,
        Expectation expected,
        ProcessOutcome outcome,
        FrameInspection frame,
        RunLayout layout)
    {
        var lines = outcome.Lines.Select(line => line.Text).ToImmutableArray();

        return new RunObservation(
            arguments.Scenario, inputs.Checkpoint.Name, arguments.Seed,
            inputs.Manifest.ExpectedOutcome, inputs.Manifest.ExpectedErrorCode,
            expected.CanonicalHash, expected.ReadModelHash, expected.RenderedUiHash,
            TerminalEvent.Parse(lines), outcome.ExitCode, outcome.TimedOut, lines, frame,

            // The published path, not the staging one: the report and every
            // verdict reason point a reader at where the frame finally lives.
            layout.Published(RunLayout.FrameFileName));
    }

    /// <summary>
    /// Points <c>TEMP</c> and <c>TMP</c> at a short path inside
    /// <c>artifacts/</c> for every child process this run launches.
    /// </summary>
    /// <remarks>
    /// On Windows the engine's shader cache lands under the temporary
    /// directory, and a profile-local one is long enough that the cache
    /// directory is created and then cannot be opened past the ~260 character
    /// path limit. A path inside the repository is short by construction.
    /// Set on this process: a child launched afterwards inherits the
    /// environment block as amended here.
    /// </remarks>
    private static void RedirectTemporaryDirectory(string repositoryRoot)
    {
        var temporary = Path.Combine(repositoryRoot, "artifacts", "tmp");
        Directory.CreateDirectory(temporary);
        Environment.SetEnvironmentVariable("TEMP", temporary);
        Environment.SetEnvironmentVariable("TMP", temporary);
    }

    /// <summary>
    /// A run id is hashed from the run's own resolved inputs, not from the
    /// argv the operator typed: two invocations that differ only in spelling
    /// out a default are the same run and are named alike.
    /// </summary>
    private static string CreateRunId(ParsedArguments arguments, Checkpoint checkpoint) => RunLayout.CreateRunId(
        DateTimeOffset.UtcNow,
        ImmutableArray.Create(
            arguments.Scenario, checkpoint.Name, arguments.Seed.ToString(CultureInfo.InvariantCulture),
            arguments.GodotPath ?? string.Empty, arguments.AllowDirty ? "allow-dirty" : "clean"));

    /// <summary>The scenario's own files, read once and passed around.</summary>
    private sealed record ScenarioInputs(
        ScenarioManifest Manifest, IReadOnlyList<ScenarioCommand> Commands, Checkpoint Checkpoint)
    {
        public static ScenarioInputs Load(string repositoryRoot, ParsedArguments arguments)
        {
            var scenarioRoot = Path.Combine(repositoryRoot, "scenarios");
            var manifest = ScenarioManifest.Load(Path.Combine(scenarioRoot, $"{arguments.Scenario}.manifest.json"));

            // A scenario that fails before any command runs has no command
            // file at all — see scenarios/content_error.manifest.json, whose
            // only checkpoint sits after command id 0. Resolve still refuses a
            // checkpoint that names a command id, so a command file that has
            // genuinely gone missing is caught there rather than assumed away.
            var commandsPath = Path.Combine(scenarioRoot, $"{arguments.Scenario}.commands.json");
            var commands = File.Exists(commandsPath)
                ? ScenarioCommands.Load(commandsPath)
                : Array.Empty<ScenarioCommand>();

            return new ScenarioInputs(
                manifest, commands, CheckpointResolver.Resolve(manifest, commands, arguments.Checkpoint));
        }
    }

    /// <summary>
    /// What the tool worked out on its own, before the game ran: the content
    /// root the game must be pointed at, and the three hashes the game's own
    /// terminal event is compared against.
    /// </summary>
    /// <param name="ContentRoot">
    /// The repository's content tree, or the faulted stand-in for a scenario
    /// that expects an error.
    /// </param>
    private sealed record Expectation(
        string ContentRoot, string? CanonicalHash, string ReadModelHash, string RenderedUiHash)
    {
        /// <summary>
        /// Builds the expectation by doing what the game will do, in this
        /// process: apply the manifest's fault, then either load content and
        /// run the scenario, or build the error screen the fault produces.
        /// </summary>
        /// <remarks>
        /// The fault is applied from its own description, never from the
        /// scenario's name: a tool that recognised <c>content_error</c> by
        /// name would agree with a manifest it had not actually reproduced,
        /// which is the one thing this comparison exists to rule out. The
        /// reproduced error code is checked against the manifest's for the
        /// same reason.
        /// </remarks>
        public static Expectation Build(string repositoryRoot, string runId, ScenarioInputs inputs, ulong seed)
        {
            var contentRoot = ApplyFault(
                inputs.Manifest.Fault,
                Path.Combine(repositoryRoot, "content"),
                Path.Combine(repositoryRoot, "artifacts", "faults", runId));

            SpikeScreenModel model;
            string? canonicalHash = null;

            if (!Directory.Exists(contentRoot))
            {
                // The game's own first loading stage, reproduced (see
                // Main.LoadModel). The detail differs and does not have to
                // match: neither hash includes it.
                model = SpikeScreenModelFactory.FromError(
                    "CONTENT_ROOT_NOT_FOUND", $"Content root '{contentRoot}' does not exist.");
            }
            else
            {
                var outcome = ScenarioRunner.Run(
                    ContentSet.Load(contentRoot),
                    CheckpointResolver.CommandsUpTo(inputs.Commands, inputs.Checkpoint),
                    seed);

                model = SpikeScreenModelFactory.FromOutcome(outcome);
                canonicalHash = DeterminismArtifact.Hash(outcome);
            }

            if (!string.Equals(model.ErrorCode, inputs.Manifest.ExpectedErrorCode, StringComparison.Ordinal))
            {
                throw new InvalidOperationException(
                    $"Reproducing scenario '{inputs.Manifest.Scenario}' here produced error code "
                    + $"'{model.ErrorCode ?? "(none)"}', but its manifest expects "
                    + $"'{inputs.Manifest.ExpectedErrorCode ?? "(none)"}'. The tool did not reproduce the fault "
                    + "the scenario describes, so it has nothing honest to compare the game against.");
            }

            return new Expectation(
                contentRoot,
                canonicalHash,
                SpikeScreenModelFactory.ReadModelHash(model),
                RenderedUiSnapshot.Hash(RenderedUiSnapshot.Expected(model)));
        }

        /// <summary>
        /// Turns a manifest's <see cref="FaultInjection"/> into the content
        /// root a faulted run reads from. Faults are reproduced inside
        /// <paramref name="faultRoot"/>, a throwaway directory: breaking the
        /// repository's own content would break every run after this one.
        /// </summary>
        private static string ApplyFault(FaultInjection? fault, string contentRoot, string faultRoot) => fault switch
        {
            null => contentRoot,

            // Nothing is created: the fault is the absence itself.
            { Kind: "missing_content_root" } => Path.Combine(faultRoot, fault.Path),
            _ => throw new InvalidOperationException(
                $"Scenario fault kind '{fault.Kind}' has no reproduction here. Add one — a tool that skips the "
                + "fault it was told to reproduce compares the game against the wrong screen."),
        };
    }

    /// <summary>
    /// Records how each phase went, in the order they ran, and fills in the
    /// ones a failure meant never happened.
    /// </summary>
    private sealed class PhaseLog
    {
        private readonly List<PhaseRecord> _records = new();

        /// <summary>Runs a phase that either works or aborts the run.</summary>
        public T Run<T>(string id, Func<T> body) => Time(id, body, _ => true);

        /// <summary>The same, for a phase that produces nothing.</summary>
        public void Run(string id, Action body) => Run(id, () => { body(); return true; });

        /// <summary>
        /// Runs a phase whose own result decides its verdict — for the phases
        /// that did their job correctly and whose answer is what failed.
        /// </summary>
        public T Time<T>(string id, Func<T> body, Func<T, bool> passed)
        {
            var stopwatch = Stopwatch.StartNew();

            try
            {
                var value = body();
                Add(id, passed(value) ? PhaseVerdict.Passed : PhaseVerdict.Failed, stopwatch.Elapsed, null);
                return value;
            }
            catch (Exception exception)
            {
                Add(id, PhaseVerdict.Failed, stopwatch.Elapsed, exception.Message);
                throw;
            }
        }

        public void Add(string id, PhaseVerdict verdict, TimeSpan duration, string? detail) =>
            _records.Add(new PhaseRecord(id, verdict, duration, detail));

        /// <summary>
        /// Every phase in <see cref="RunReport.PhaseIds"/> order, with the
        /// ones that never ran marked <see cref="PhaseVerdict.Skipped"/>.
        /// </summary>
        public ImmutableArray<PhaseRecord> Complete()
        {
            var recorded = _records.Select(record => record.Id).ToHashSet(StringComparer.Ordinal);

            return _records
                .Concat(RunReport.PhaseIds
                    .Where(id => !recorded.Contains(id))
                    .Select(id => new PhaseRecord(id, PhaseVerdict.Skipped, TimeSpan.Zero, null)))
                .OrderBy(record => RunReport.PhaseIds.IndexOf(record.Id))
                .ToImmutableArray();
        }
    }
}
