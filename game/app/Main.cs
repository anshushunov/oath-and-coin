using System.Collections.Immutable;
using System.Threading.Tasks;
using Godot;
using OathAndCoin.Content;
using OathAndCoin.Content.Scenarios;
using OathAndCoin.Game.Harness;
using OathAndCoin.Game.Ui;
using OathAndCoin.GameProtocol;
using OathAndCoin.Presentation;

namespace OathAndCoin.Game.App;

/// <summary>
/// The whole game, for now: parses the protocol's own argv
/// (<see cref="GameArguments"/>), loads content and runs one scenario up to a
/// checkpoint, shows the result on <see cref="ContractOfferScreen"/>, and —
/// in <c>--smoke</c> mode only — drives an automated capture of that
/// checkpoint through <see cref="CaptureProtocol"/>. There is exactly one
/// scene (<c>Main.tscn</c>) and exactly one script; later runtime-harness
/// tasks are expected to grow the game, not this file.
/// </summary>
public partial class Main : Control
{
    /// <summary>
    /// Mirrors <c>OathAndCoin.SimulationRunner.Program.ExitArgumentError</c>:
    /// an invocation this build could not even parse is the launcher's
    /// mistake, not a fact about the content or the scenario, and gets a
    /// different exit code so a caller can tell the two apart.
    /// </summary>
    private const int ExitArgumentError = 2;

    /// <summary>
    /// The model <see cref="ContractOfferScreenModelFactory"/> deliberately
    /// never builds (see the remarks on <see cref="ScreenState.Loading"/>):
    /// there is no <see cref="ScenarioOutcome"/> yet to build one from. This
    /// is the one screen this file constructs by hand, shown exactly when a
    /// scenario's manifest declares <see cref="ScenarioOutcomeKind.Loading"/>
    /// — a checkpoint stood in for "before a <see cref="ScenarioOutcome"/>
    /// exists", never reached by actually running anything.
    /// </summary>
    private static readonly ContractOfferScreenModel LoadingModel = new()
    {
        State = ScreenState.Loading,
        TitleKey = ContractOfferScreenModelFactory.TitleKey,
        Contract = null,
        Roster = ImmutableArray<HeroCard>.Empty,
        Responses = ImmutableArray<ResponseLine>.Empty,
        ErrorCode = null,
        ErrorDetail = null,
    };

    public override void _Ready()
    {
        GameArguments arguments;
        try
        {
            arguments = GameArguments.Parse(OS.GetCmdlineUserArgs());
        }
        catch (ArgumentException exception)
        {
            Console.Error.WriteLine(exception.Message);
            GetTree().Quit(ExitArgumentError);
            return;
        }

        // The locale project.godot pins is only a baseline (see its own
        // comments). The value that actually governs this run travels in
        // argv like every other input a visual run has to state rather than
        // inherit from the machine it happens to execute on.
        TranslationServer.SetLocale(arguments.Locale);

        var loaded = LoadModel(arguments);

        // The locale catalogue is loaded from the repository's own
        // content/locale tree, never from arguments.ContentRoot: a scenario
        // simulating a broken or substituted content root (content_error,
        // screen_empty) still has to show a title, and that tree is not
        // where either scenario points --content at (see ResolveLocaleFile).
        var catalogue = LocaleCatalogue.Load(ResolveLocaleFile(arguments));
        var textSource = new TextSource(catalogue);

        var screen = new ContractOfferScreen();
        screen.Render(loaded.Model, textSource);
        AddChild(screen);

        if (!arguments.Smoke)
        {
            // Manual mode: the screen is the whole point. It stays up for a
            // person to look at; nothing here drives a checkpoint capture or
            // exits the process — that is what --smoke is for. The two
            // hashes below exist only to go into the terminal line a capture
            // emits, so there is nothing to compute yet.
            return;
        }

        var readModelHash = ContractOfferScreenModelFactory.ReadModelHash(loaded.Model);
        var renderedUiHash = RenderedUiSnapshot.Hash(screen.Snapshot());
        var outcomeKind = OutcomeKindFor(loaded.Model);
        var surface = new GodotCaptureSurface(GetViewport(), GetTree(), arguments.ScreenshotPath);

        // See the remarks on GodotCaptureSurface for why this runs on a
        // worker thread: CaptureProtocol.Run blocks on real engine signals,
        // and this — the engine's own thread — is the one thread that must
        // never block waiting for one. The try/catch matters as much as the
        // thread does: an unobserved exception on a Task.Run continuation is
        // swallowed by the runtime rather than crashing the process, and
        // without this the failure mode would be a silent hang until the
        // harness's own external timeout gives up — instead of the loud,
        // immediate "SCRIPT ERROR:" line SmokeVerdict already knows how to
        // read as a failure.
        Task.Run(() =>
        {
            try
            {
                CaptureProtocol.Run(
                    surface,
                    result => BuildTerminalLine(arguments, outcomeKind, loaded, readModelHash, renderedUiHash, result));
            }
            catch (Exception exception)
            {
                Console.Error.WriteLine($"SCRIPT ERROR: autopilot capture failed: {exception}");
                surface.Quit(1);
            }
        });
    }

    /// <summary>
    /// The terminal event's <c>outcome_kind</c> for <paramref name="model"/>:
    /// <c>"loading"</c> for the one state the factory never builds,
    /// otherwise the same success/error split as before.
    /// </summary>
    private static string OutcomeKindFor(ContractOfferScreenModel model) =>
        model.State == ScreenState.Loading ? "loading" : model.ErrorCode is null ? "success" : "error";

    /// <summary>What loading content and running the scenario up to its checkpoint produced.</summary>
    /// <param name="Model">The screen to show — an error model when loading failed before any decision ran.</param>
    /// <param name="ContentVersion">
    /// <see cref="ContentSet.ContentVersion"/> of the loaded content, or
    /// <c>null</c> when content never finished loading (including the
    /// <see cref="ScreenState.Loading"/> screen, which never starts loading
    /// at all).
    /// </param>
    /// <param name="CanonicalHash">
    /// <see cref="DeterminismArtifact.Hash"/> of the run, or <c>null</c> for the same reason.
    /// </param>
    private readonly record struct LoadResult(ContractOfferScreenModel Model, string? ContentVersion, string? CanonicalHash);

    /// <summary>
    /// Loads the requested scenario's manifest and commands, resolves the
    /// requested checkpoint against them, and then — unless the manifest
    /// declares <see cref="ScreenState.Loading"/>, in which case there is
    /// nothing further to do — loads content and runs the scenario up to
    /// that checkpoint.
    /// </summary>
    /// <remarks>
    /// The scenario stage runs before the four content stages, unlike the
    /// task that first wrote this method: <see cref="ScreenState.Loading"/>
    /// is a fact about the scenario alone (its manifest says so), decided
    /// before this method would otherwise ask whether a content root even
    /// exists — asking that first would mean a loading scenario's manifest
    /// is never actually consulted, which defeats the one thing this stage
    /// exists to decide. Reordering does not change what any other scenario
    /// reports: <c>content_error</c>'s manifest is itself well-formed, so it
    /// still falls through to the unmoved content-root check below exactly
    /// as before.
    /// <para>
    /// Every stage past this one is caught the same way it always was — by
    /// which <see cref="InvalidDataException"/>-throwing call failed, never
    /// by matching on an exception message, which is free text meant for a
    /// person, not a stable identifier a tool compares runs on:
    /// <list type="bullet">
    /// <item><c>SCENARIO_INVALID</c> — <see cref="ScenarioManifest.Load"/> or <see cref="ScenarioCommands.Load"/> could not read the scenario's own files (missing, malformed, no commands).</item>
    /// <item><c>CHECKPOINT_UNKNOWN</c> — <see cref="CheckpointResolver.Resolve"/> could not resolve <c>--checkpoint</c> against an otherwise valid scenario (unknown name, or a manifest with no checkpoints at all).</item>
    /// <item><c>CONTENT_ROOT_NOT_FOUND</c> — the content directory itself is missing, checked directly rather than inferred from <see cref="ContentSet.Load"/>'s own message.</item>
    /// <item><c>SCHEMA_INVALID</c> — <see cref="ContentSchemas.ValidateOrThrow"/> (validation stage 1, TDD §11.2) rejected a file.</item>
    /// <item><c>CONTENT_INVALID</c> — <see cref="ContentSet.Load"/> itself rejected a file past schema validation (an id reused, a value out of range).</item>
    /// </list>
    /// </para>
    /// </remarks>
    private static LoadResult LoadModel(GameArguments arguments)
    {
        var manifestPath = Path.Combine(arguments.ScenarioRoot, $"{arguments.Scenario}.manifest.json");
        var commandsPath = Path.Combine(arguments.ScenarioRoot, $"{arguments.Scenario}.commands.json");

        ScenarioManifest manifest;
        IReadOnlyList<ScenarioCommand> commands;
        try
        {
            manifest = ScenarioManifest.Load(manifestPath);

            // A scenario that fails before any command runs has no command
            // file at all (see scenarios/content_error.manifest.json), and
            // neither does one that is shown before any content is read at
            // all (scenarios/screen_loading.manifest.json). Resolve still
            // refuses a checkpoint that names a command id, so a command
            // file that has genuinely gone missing is caught there rather
            // than assumed away.
            commands = File.Exists(commandsPath)
                ? ScenarioCommands.Load(commandsPath)
                : Array.Empty<ScenarioCommand>();
        }
        catch (InvalidDataException exception)
        {
            return new LoadResult(
                ContractOfferScreenModelFactory.FromOutcome(("SCENARIO_INVALID", exception.Message)),
                ContentVersion: null,
                CanonicalHash: null);
        }

        Checkpoint checkpoint;
        try
        {
            checkpoint = CheckpointResolver.Resolve(manifest, commands, arguments.Checkpoint);
        }
        catch (InvalidDataException exception)
        {
            return new LoadResult(
                ContractOfferScreenModelFactory.FromOutcome(("CHECKPOINT_UNKNOWN", exception.Message)),
                ContentVersion: null,
                CanonicalHash: null);
        }

        if (manifest.ExpectedOutcome == ScenarioOutcomeKind.Loading)
        {
            return new LoadResult(LoadingModel, ContentVersion: null, CanonicalHash: null);
        }

        var contentRoot = Path.GetFullPath(arguments.ContentRoot);
        if (!Directory.Exists(contentRoot))
        {
            return new LoadResult(
                ContractOfferScreenModelFactory.FromOutcome(
                    ("CONTENT_ROOT_NOT_FOUND", $"Content root '{contentRoot}' does not exist.")),
                ContentVersion: null,
                CanonicalHash: null);
        }

        try
        {
            // Stage 1 (TDD §11.2) runs before the loader, mirroring
            // OathAndCoin.SimulationRunner.Program: a content error is
            // reported as a schema problem when that is what it is, rather
            // than as whatever ContentSet.Load happens to say about the same
            // file once schema validation would already have caught it.
            ContentSchemas.Load(arguments.SchemaRoot).ValidateOrThrow(contentRoot);
        }
        catch (InvalidDataException exception)
        {
            return new LoadResult(
                ContractOfferScreenModelFactory.FromOutcome(("SCHEMA_INVALID", exception.Message)),
                ContentVersion: null,
                CanonicalHash: null);
        }

        ContentSet content;
        try
        {
            content = ContentSet.Load(contentRoot);
        }
        catch (InvalidDataException exception)
        {
            return new LoadResult(
                ContractOfferScreenModelFactory.FromOutcome(("CONTENT_INVALID", exception.Message)),
                ContentVersion: null,
                CanonicalHash: null);
        }

        var commandsUpTo = CheckpointResolver.CommandsUpTo(commands, checkpoint);

        var outcome = ScenarioRunner.Run(content, commandsUpTo, arguments.Seed);
        return new LoadResult(
            ContractOfferScreenModelFactory.FromOutcome(outcome),
            content.ContentVersion,
            DeterminismArtifact.Hash(outcome));
    }

    /// <summary>
    /// The locale catalogue's file, resolved from the repository root rather
    /// than <see cref="GameArguments.ContentRoot"/>: a scenario that points
    /// <c>--content</c> at a faulted or substituted root
    /// (<c>content_error</c>, <c>screen_empty</c>) still has to resolve
    /// <see cref="ContractOfferScreenModelFactory.TitleKey"/> to something a
    /// player reads, and neither of those roots carries a
    /// <c>locale/</c> directory. <see cref="GameArguments.ScenarioRoot"/> is
    /// never faulted or substituted by anything this codebase does today
    /// (see <c>OathAndCoin.Harness.SmokeRun.GameRequest</c>), so its parent
    /// is a stable way to find the repository root back.
    /// </summary>
    private static string ResolveLocaleFile(GameArguments arguments)
    {
        var repositoryRoot = Path.GetDirectoryName(Path.GetFullPath(arguments.ScenarioRoot))
            ?? throw new InvalidOperationException(
                $"Could not determine the repository root from scenario root '{arguments.ScenarioRoot}'.");

        return Path.Combine(repositoryRoot, "content", "locale", "ru.json");
    }

    /// <summary>
    /// Builds the wire-format terminal line for a successful capture. The
    /// JSON itself is <see cref="TerminalEvent.ToLine"/>'s business: this
    /// file only decides which values go in. Composing the object here
    /// against <see cref="TerminalEvent.Parse"/>'s required field set used to
    /// be the writer, and nothing in the build would have caught the two
    /// drifting apart — <c>game/</c> has no test project, and CI only
    /// compiles it.
    /// </summary>
    private static string BuildTerminalLine(
        GameArguments arguments,
        string outcomeKind,
        LoadResult loaded,
        string readModelHash,
        string renderedUiHash,
        CaptureResult capture)
    {
        // An invariant, not a case: CaptureProtocol.Run builds a line only for
        // a succeeded capture, and CaptureResult.Success refuses an empty
        // hash. It is stated because moving to the typed writer is what made
        // the nullability visible at all — the hand-written JSON object took
        // a null here without a word and would have emitted
        // "frame_sha256": null, which Parse accepts as present.
        ArgumentException.ThrowIfNullOrEmpty(capture.FrameSha256);

        return new TerminalEvent(
            SchemaVersion: TerminalEvent.SupportedSchemaVersion,
            Event: "terminal",
            OutcomeKind: outcomeKind,
            Scenario: arguments.Scenario,
            Seed: arguments.Seed,
            Checkpoint: arguments.Checkpoint,
            ErrorCode: loaded.Model.ErrorCode,
            ContentVersion: loaded.ContentVersion,
            CanonicalHash: loaded.CanonicalHash,
            ReadModelHash: readModelHash,
            RenderedUiHash: renderedUiHash,
            FrameSha256: capture.FrameSha256,
            FrameWidth: capture.FrameWidth,
            FrameHeight: capture.FrameHeight,
            FrameDistinctColors: capture.FrameDistinctColors).ToLine();
    }
}
