using System.Globalization;
using System.Security.Cryptography;

namespace OathAndCoin.Harness;

/// <summary>
/// Everything a run needs from the engine before the game itself is launched:
/// finding it, proving which build it is, compiling the game against it,
/// importing the project's assets, and reading back the visual environment
/// the project pins.
/// </summary>
/// <remarks>
/// Each step throws <see cref="InvalidOperationException"/> rather than
/// returning a status: none of them has a meaningful "carried on anyway"
/// outcome, and a run that continues past a failed import proves nothing
/// about the build it claims to have tested.
/// </remarks>
public static class GodotEngine
{
    /// <summary>The environment variable consulted when <c>--godot</c> is absent.</summary>
    public const string EnvironmentVariable = "GODOT";

    /// <summary>
    /// The engine version a run is allowed to use, pinned by ADR-001 and by
    /// the game project's own <c>Godot.NET.Sdk</c> reference. A different
    /// build may render the same scene differently, so a run under one is not
    /// evidence about this one.
    /// </summary>
    public const string RequiredVersion = "4.7.1";

    /// <summary>
    /// The .NET-enabled flavour. The game is C#; a plain build would load the
    /// project and quietly run none of it.
    /// </summary>
    private const string RequiredFlavor = "mono";

    /// <summary>
    /// Bound for the engine and build tools this class drives. Long because a
    /// cold NuGet restore or a first shader import genuinely takes minutes,
    /// and short enough that a wedged tool is not left to sit forever.
    /// </summary>
    private static readonly TimeSpan ToolTimeout = TimeSpan.FromMinutes(10);

    /// <summary>
    /// Resolves the engine from <c>--godot</c>, then <see cref="EnvironmentVariable"/>.
    /// </summary>
    /// <exception cref="InvalidOperationException">
    /// Neither names an engine, or the one they name does not exist. The
    /// message names both ways in: an operator who set neither should not
    /// have to guess which one this tool wanted.
    /// </exception>
    public static string Resolve(string? godotFlag)
    {
        var fromEnvironment = Environment.GetEnvironmentVariable(EnvironmentVariable);
        var named = godotFlag ?? fromEnvironment;

        if (string.IsNullOrEmpty(named))
        {
            throw new InvalidOperationException(
                "No Godot engine was named. Pass '--godot <path>', or set the GODOT environment variable. "
                + $"A run needs a {RequiredVersion} {RequiredFlavor} build.");
        }

        var full = Path.GetFullPath(named);
        if (!File.Exists(full))
        {
            var source = godotFlag is null ? $"the {EnvironmentVariable} environment variable" : "'--godot'";
            throw new InvalidOperationException($"The Godot engine at '{full}', named by {source}, does not exist.");
        }

        return full;
    }

    /// <summary>
    /// Asks the engine what it is, checks it against
    /// <see cref="RequiredVersion"/> and <see cref="RequiredFlavor"/>, and
    /// hashes the binary so the report identifies the build by its bytes and
    /// not merely by a string any build could print.
    /// </summary>
    public static EngineFacts Verify(IProcessRunner runner, string enginePath)
    {
        ArgumentNullException.ThrowIfNull(runner);

        var outcome = runner.Run(enginePath, new[] { "--version" }, ToolTimeout);
        Require(outcome, $"'{enginePath}' --version");

        var version = outcome.Lines
            .Where(line => line.Stream == ProcessStream.StandardOutput && line.Text.Trim().Length > 0)
            .Select(line => line.Text.Trim())
            .LastOrDefault() ?? string.Empty;

        // Version first, flavour second, both against the printed string:
        // "4.7.1.stable.mono.official.<hash>". The trailing dot on the
        // version keeps a future 4.7.10 from passing as 4.7.1.
        if (!version.StartsWith(RequiredVersion + ".", StringComparison.Ordinal)
            || !version.Contains(RequiredFlavor, StringComparison.Ordinal))
        {
            throw new InvalidOperationException(
                $"The engine at '{enginePath}' reports '{version}', but a run needs a "
                + $"{RequiredVersion} {RequiredFlavor} build.");
        }

        using var stream = File.OpenRead(enginePath);
        var sha256 = Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();

        return new EngineFacts(enginePath, version, sha256);
    }

    /// <summary>Compiles the game's assembly, which the engine loads at startup.</summary>
    public static void Build(IProcessRunner runner, string repositoryRoot)
    {
        ArgumentNullException.ThrowIfNull(runner);

        var project = Path.Combine(repositoryRoot, "game", "OathAndCoin.Game.csproj");
        var outcome = runner.Run("dotnet", new[] { "build", project, "-c", "Debug" }, ToolTimeout);
        Require(outcome, $"dotnet build {project} -c Debug");
    }

    /// <summary>
    /// Imports the project's assets, so the run does not race the engine
    /// building its <c>.godot/</c> cache while it is being screenshotted.
    /// </summary>
    /// <remarks>
    /// A non-zero exit is an error, full stop. An exception to that is
    /// introduced only with a case reproduced on <see cref="RequiredVersion"/>,
    /// in its own commit, with the log and a link to the engine issue — never
    /// as a quiet bypass here, which is how a harness ends up proving nothing.
    /// </remarks>
    public static void Import(IProcessRunner runner, string enginePath, string repositoryRoot)
    {
        ArgumentNullException.ThrowIfNull(runner);

        var project = Path.Combine(repositoryRoot, "game");
        var argv = new[] { "--headless", "--import", "--path", project };
        Require(runner.Run(enginePath, argv, ToolTimeout), $"'{enginePath}' {string.Join(' ', argv)}");
    }

    /// <summary>
    /// Reads back what <c>game/project.godot</c> pins about how a frame will
    /// look, so the report quotes the project rather than restating constants
    /// that could drift away from it.
    /// </summary>
    /// <param name="width">The width the invocation asked the engine for.</param>
    /// <param name="height">The height the invocation asked the engine for.</param>
    /// <param name="locale">The locale the invocation carries in argv.</param>
    public static VisualEnvironment ReadVisualEnvironment(
        string projectFile, int width, int height, string locale)
    {
        ArgumentException.ThrowIfNullOrEmpty(projectFile);

        // project.godot is an INI-like file of `key=value` lines under
        // `[section]` headers, with `;` comments. Only the flat keys matter
        // here, and they are unique across the file, so the sections are not
        // tracked — a full parser would be more machinery than one report
        // field is worth.
        var settings = new Dictionary<string, string>(StringComparer.Ordinal);
        var assignments = File.ReadAllLines(projectFile)
            .Where(line => !line.StartsWith(';') && line.IndexOf('=', StringComparison.Ordinal) > 0);

        foreach (var line in assignments)
        {
            var separator = line.IndexOf('=', StringComparison.Ordinal);
            settings[line[..separator].Trim()] = line[(separator + 1)..].Trim().Trim('"');
        }

        return new VisualEnvironment(
            string.Create(CultureInfo.InvariantCulture, $"{width}x{height}"),
            settings.GetValueOrDefault("renderer/rendering_method", "unstated"),
            locale,
            WindowMode(settings.GetValueOrDefault("window/size/mode", "0")));
    }

    /// <summary>
    /// Godot's <c>DisplayServer.WindowMode</c>, spelled out. An unknown value
    /// is reported as itself rather than guessed at: the report's job is to
    /// say what the project settings said.
    /// </summary>
    private static string WindowMode(string value) => value switch
    {
        "0" => "windowed",
        "1" => "minimized",
        "2" => "maximized",
        "3" => "fullscreen",
        "4" => "exclusive_fullscreen",
        _ => $"mode_{value}",
    };

    private static void Require(ProcessOutcome outcome, string command)
    {
        if (outcome.TimedOut)
        {
            // Ticks, not TotalSeconds: this project uses no floating-point
            // type, and TimeSpan's Total* properties are all double.
            var seconds = ToolTimeout.Ticks / TimeSpan.TicksPerSecond;
            throw new InvalidOperationException($"{command} did not finish within {seconds} seconds and was killed.");
        }

        if (outcome.ExitCode != 0)
        {
            throw new InvalidOperationException(
                $"{command} exited with code {outcome.ExitCode}. Last output: {LastLines(outcome)}");
        }
    }

    /// <summary>
    /// The tail of a failed tool's output — enough to see the actual error
    /// without copying a whole MSBuild log into an exception message, which
    /// the report then carries as that phase's detail. <c>run.log</c> holds
    /// the game process's own output, not these build-time tools'.
    /// </summary>
    private static string LastLines(ProcessOutcome outcome) =>
        string.Join(" | ", outcome.Lines.TakeLast(5).Select(line => line.Text));
}
