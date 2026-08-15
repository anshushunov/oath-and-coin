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

        ContractOfferScreen screen;
        try
        {
            // The locale catalogue is loaded from the repository's own
            // content/locale tree, never from arguments.ContentRoot: a
            // scenario simulating a broken or substituted content root
            // (screen_error, screen_empty) still has to show a title, and
            // neither of those roots carries a locale/ directory (see
            // ResolveLocaleFile).
            var catalogue = LocaleCatalogue.Load(ResolveLocaleFile(arguments));
            var textSource = new TextSource(catalogue);

            screen = new ContractOfferScreen();
            screen.Render(loaded.Model, textSource);
        }
        catch (Exception exception)
        {
            // A missing or malformed catalogue, or a key the model needs
            // that the catalogue does not carry, is exactly the failure mode
            // the try/catch around CaptureProtocol.Run further down already
            // guards against: left uncaught here, it aborts _Ready before
            // any child is added and before a terminal line is printed, and
            // the harness would wait out its own external timeout for an
            // event that was never going to arrive. There is no screen left
            // to build at this point — TextSource is what resolves a key
            // into anything a person reads — so this reports loudly and
            // exits instead, the same shape GameArguments.Parse's own
            // failure above already takes.
            Console.Error.WriteLine($"SCRIPT ERROR: building the contract offer screen failed: {exception}");
            GetTree().Quit(1);
            return;
        }

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
    /// reports: <c>screen_error</c>'s manifest is itself well-formed, so it
    /// still falls through to the unmoved content-root check below exactly
    /// as before.
    /// <para>
    /// Every stage past this one is caught the same way it always was — by
    /// which <see cref="InvalidDataException"/>-throwing call failed, never
    /// by matching on an exception message, which is free text meant for a
    /// person, not a stable identifier a tool compares runs on:
    /// <list type="bullet">
    /// <item><see cref="ErrorCodes.ScenarioInvalid"/> — <see cref="ScenarioManifest.Load"/> or <see cref="ScenarioCommands.Load"/> could not read the scenario's own files (missing, malformed, no commands).</item>
    /// <item><see cref="ErrorCodes.CheckpointUnknown"/> — <see cref="CheckpointResolver.Resolve"/> could not resolve <c>--checkpoint</c> against an otherwise valid scenario (unknown name, or a manifest with no checkpoints at all).</item>
    /// <item><see cref="ErrorCodes.ContentRootNotFound"/> — the content directory itself is missing, checked directly rather than inferred from <see cref="ContentSet.Load"/>'s own message.</item>
    /// <item><see cref="ErrorCodes.SchemaInvalid"/> — <see cref="ContentSchemas.ValidateOrThrow"/> (validation stage 1, TDD §11.2) rejected a file.</item>
    /// <item><see cref="ErrorCodes.ContentInvalid"/> — <see cref="ContentSet.Load"/> itself rejected a file past schema validation (an id reused, a value out of range).</item>
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
            // file at all (see scenarios/screen_error.manifest.json), and
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
                ContractOfferScreenModelFactory.FromOutcome((ErrorCodes.ScenarioInvalid, exception.Message)),
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
                ContractOfferScreenModelFactory.FromOutcome((ErrorCodes.CheckpointUnknown, exception.Message)),
                ContentVersion: null,
                CanonicalHash: null);
        }

        if (manifest.ExpectedOutcome == ScenarioOutcomeKind.Loading)
        {
            // The one screen no ScenarioOutcome can produce, shown exactly
            // when a scenario's manifest declares it — a checkpoint stood in
            // for "before a ScenarioOutcome exists", never reached by
            // actually running anything. Taken from the factory rather than
            // written out here: the runtime harness needs the identical model
            // to compare against, and two hand-written copies of one value
            // drift (see ContractOfferScreenModelFactory.Loading).
            return new LoadResult(
                ContractOfferScreenModelFactory.Loading, ContentVersion: null, CanonicalHash: null);
        }

        var contentRoot = Path.GetFullPath(arguments.ContentRoot);
        if (!Directory.Exists(contentRoot))
        {
            return new LoadResult(
                ContractOfferScreenModelFactory.FromOutcome(
                    (ErrorCodes.ContentRootNotFound, $"Content root '{contentRoot}' does not exist.")),
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
                ContractOfferScreenModelFactory.FromOutcome((ErrorCodes.SchemaInvalid, exception.Message)),
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
                ContractOfferScreenModelFactory.FromOutcome((ErrorCodes.ContentInvalid, exception.Message)),
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
    /// (<c>screen_error</c>, <c>screen_empty</c>) still has to resolve
    /// <see cref="ContractOfferScreenModelFactory.TitleKey"/> to something a
    /// player reads, and neither of those roots carries a
    /// <c>locale/</c> directory. <see cref="GameArguments.ScenarioRoot"/> is
    /// never faulted or substituted by anything this codebase does today
    /// (see <c>OathAndCoin.Harness.SmokeRun.GameRequest</c>), so its parent
    /// is a stable way to find the repository root back.
    /// <para>
    /// Which catalogue, though, comes from <see cref="GameArguments.Locale"/>
    /// — the same value <see cref="TranslationServer.SetLocale"/> is given
    /// above, and the same one the harness names in its report. This used to
    /// be hard-coded to <c>ru.json</c> while <c>--locale</c> said something
    /// else entirely, which made the flag inert and the report wrong about
    /// the frame it was published beside.
    /// </para>
    /// </summary>
    private static string ResolveLocaleFile(GameArguments arguments)
    {
        var repositoryRoot = Path.GetDirectoryName(Path.GetFullPath(arguments.ScenarioRoot))
            ?? throw new InvalidOperationException(
                $"Could not determine the repository root from scenario root '{arguments.ScenarioRoot}'.");

        return Path.Combine(repositoryRoot, "content", "locale", $"{arguments.Locale}.json");
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

            // The screen's own state, verbatim (lowercase, matching
            // outcome_kind's own style) — SmokeVerdict compares this against
            // a manifest's own expected_screen_state, when it states one,
            // rather than only ever checking the coarser success/error/
            // loading split (see the remarks on ScenarioManifest.ExpectedScreenState).
            ScreenState: loaded.Model.State.ToString().ToLowerInvariant(),
            FrameSha256: capture.FrameSha256,
            FrameWidth: capture.FrameWidth,
            FrameHeight: capture.FrameHeight,
            FrameDistinctColors: capture.FrameDistinctColors).ToLine();
    }
}
