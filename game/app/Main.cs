using System.Text.Json.Nodes;
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
/// checkpoint, shows the result on <see cref="SpikeScreen"/>, and — in
/// <c>--smoke</c> mode only — drives an automated capture of that checkpoint
/// through <see cref="CaptureProtocol"/>. There is exactly one scene
/// (<c>Main.tscn</c>) and exactly one script; later runtime-harness tasks are
/// expected to grow the game, not this file.
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

        var screen = new SpikeScreen();
        screen.Render(loaded.Model);
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

        var readModelHash = SpikeScreenModelFactory.ReadModelHash(loaded.Model);
        var renderedUiHash = RenderedUiSnapshot.Hash(screen.Snapshot());
        var outcomeKind = loaded.Model.ErrorCode is null ? "success" : "error";
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

    /// <summary>What loading content and running the scenario up to its checkpoint produced.</summary>
    /// <param name="Model">The screen to show — an error model when loading failed before any decision ran.</param>
    /// <param name="ContentVersion">
    /// <see cref="ContentSet.ContentVersion"/> of the loaded content, or
    /// <c>null</c> when content never finished loading.
    /// </param>
    /// <param name="CanonicalHash">
    /// <see cref="DeterminismArtifact.Hash"/> of the run, or <c>null</c> for the same reason.
    /// </param>
    private readonly record struct LoadResult(SpikeScreenModel Model, string? ContentVersion, string? CanonicalHash);

    /// <summary>
    /// Loads content and runs the requested scenario up to its checkpoint.
    /// </summary>
    /// <remarks>
    /// Content loading happens in three stages, each mapped to its own error
    /// code by which stage failed to load — never by matching on an exception
    /// message, which is free text meant for a person, not a stable
    /// identifier a tool compares runs on:
    /// <list type="bullet">
    /// <item><c>CONTENT_ROOT_NOT_FOUND</c> — the content directory itself is missing, checked directly rather than inferred from <see cref="ContentSet.Load"/>'s own message.</item>
    /// <item><c>SCHEMA_INVALID</c> — <see cref="ContentSchemas.ValidateOrThrow"/> (validation stage 1, TDD §11.2) rejected a file.</item>
    /// <item><c>CONTENT_INVALID</c> — <see cref="ContentSet.Load"/> itself rejected a file past schema validation (an id reused, a value out of range).</item>
    /// </list>
    /// Scenario, manifest and checkpoint failures are not caught here: none of
    /// the fixtures this build ships trigger them, and the runtime harness
    /// plan names error codes only for content loading (see the plan brief) —
    /// inventing codes for cases nothing exercises would be a guess this
    /// class has no way to validate.
    /// </remarks>
    private static LoadResult LoadModel(GameArguments arguments)
    {
        var contentRoot = Path.GetFullPath(arguments.ContentRoot);
        if (!Directory.Exists(contentRoot))
        {
            return new LoadResult(
                SpikeScreenModelFactory.FromError(
                    "CONTENT_ROOT_NOT_FOUND",
                    $"Content root '{contentRoot}' does not exist."),
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
                SpikeScreenModelFactory.FromError("SCHEMA_INVALID", exception.Message),
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
                SpikeScreenModelFactory.FromError("CONTENT_INVALID", exception.Message),
                ContentVersion: null,
                CanonicalHash: null);
        }

        // Scenario and commands files follow the naming convention every
        // scenario under scenarios/ already uses: "<id>.manifest.json" and
        // "<id>.commands.json" (see scenarios/gate0.manifest.json and
        // scenarios/gate0.commands.json).
        var manifestPath = Path.Combine(arguments.ScenarioRoot, $"{arguments.Scenario}.manifest.json");
        var commandsPath = Path.Combine(arguments.ScenarioRoot, $"{arguments.Scenario}.commands.json");

        var manifest = ScenarioManifest.Load(manifestPath);
        var commands = ScenarioCommands.Load(commandsPath);
        var checkpoint = CheckpointResolver.Resolve(manifest, commands, arguments.Checkpoint);
        var commandsUpTo = CheckpointResolver.CommandsUpTo(commands, checkpoint);

        var outcome = ScenarioRunner.Run(content, commandsUpTo, arguments.Seed);
        return new LoadResult(
            SpikeScreenModelFactory.FromOutcome(outcome),
            content.ContentVersion,
            DeterminismArtifact.Hash(outcome));
    }

    /// <summary>
    /// Builds the wire-format terminal line (<see cref="TerminalEvent"/>'s
    /// snake_case JSON) for a successful capture. Written by hand against the
    /// same field set <see cref="TerminalEvent.Parse"/> reads, rather than
    /// through a shared writer, for the reason <see cref="TerminalEvent"/>
    /// itself gives for owning its strict reader independently: this line is
    /// external data the moment it leaves this process, and the two sides of
    /// the protocol are not meant to share code across the process boundary.
    /// </summary>
    private static string BuildTerminalLine(
        GameArguments arguments,
        string outcomeKind,
        LoadResult loaded,
        string readModelHash,
        string renderedUiHash,
        CaptureResult capture)
    {
        var json = new JsonObject
        {
            ["schema_version"] = TerminalEvent.SupportedSchemaVersion,
            ["event"] = "terminal",
            ["outcome_kind"] = outcomeKind,
            ["scenario"] = arguments.Scenario,
            ["seed"] = JsonValue.Create(arguments.Seed),
            ["checkpoint"] = arguments.Checkpoint,
            ["error_code"] = loaded.Model.ErrorCode,
            ["content_version"] = loaded.ContentVersion,
            ["canonical_hash"] = loaded.CanonicalHash,
            ["read_model_hash"] = readModelHash,
            ["rendered_ui_hash"] = renderedUiHash,
            ["frame_sha256"] = capture.FrameSha256,
            ["frame_width"] = capture.FrameWidth,
            ["frame_height"] = capture.FrameHeight,
            ["frame_distinct_colors"] = capture.FrameDistinctColors,
        };

        return json.ToJsonString();
    }
}
