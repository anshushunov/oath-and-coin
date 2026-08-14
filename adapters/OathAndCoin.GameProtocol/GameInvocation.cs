using System.Collections.Immutable;
using System.Globalization;

namespace OathAndCoin.GameProtocol;

/// <summary>
/// Builds the command line a tool process hands to Godot to launch the game
/// under a <see cref="GameArguments"/>. This is the "how does the game know
/// where its own roots are" question, answered once, in one place, as an
/// exact argv shape — not left for a reader to infer from whatever a launcher
/// script happens to do today.
/// </summary>
public static class GameInvocation
{
    /// <summary>
    /// Builds the full argv: Godot's own engine flags first, naming the
    /// project and the window size, then the engine's <c>--</c> separator,
    /// then every field of <paramref name="arguments"/> as a user arg the
    /// game reads back with <see cref="GameArguments.Parse"/> — except
    /// <see cref="GameArguments.Width"/> and <see cref="GameArguments.Height"/>,
    /// which are already spent on the engine's own <c>--resolution</c> flag
    /// and are not repeated (see the remarks on <see cref="GameArguments.Parse"/>).
    /// </summary>
    /// <param name="projectPath">Path to the Godot project to launch (its directory).</param>
    /// <param name="arguments">The launch request both sides of the protocol agree on.</param>
    /// <returns>
    /// The argv to start Godot with. Paths are made absolute and separator-
    /// normalized (<see cref="Path.GetFullPath(string)"/>) so a relative path
    /// meaningful only in the tool process's working directory never reaches
    /// a child process that does not share it. Every element is a single
    /// array entry passed to the child process directly — nothing here joins
    /// them into a string, so no quoting is added or needed even for a path
    /// containing spaces.
    /// </returns>
    public static ImmutableArray<string> BuildArgv(string projectPath, GameArguments arguments)
    {
        ArgumentException.ThrowIfNullOrEmpty(projectPath);
        ArgumentNullException.ThrowIfNull(arguments);

        var argv = ImmutableArray.CreateBuilder<string>();

        argv.Add("--path");
        argv.Add(Path.GetFullPath(projectPath));
        argv.Add("--resolution");
        argv.Add(FormatResolution(arguments.Width, arguments.Height));
        argv.Add("--");

        if (arguments.Smoke)
        {
            argv.Add("--smoke");
        }

        argv.Add("--scenario");
        argv.Add(arguments.Scenario);
        argv.Add("--checkpoint");
        argv.Add(arguments.Checkpoint);
        argv.Add("--seed");
        argv.Add(arguments.Seed.ToString(CultureInfo.InvariantCulture));
        argv.Add("--content");
        argv.Add(Path.GetFullPath(arguments.ContentRoot));
        argv.Add("--schemas");
        argv.Add(Path.GetFullPath(arguments.SchemaRoot));
        argv.Add("--scenarios");
        argv.Add(Path.GetFullPath(arguments.ScenarioRoot));
        argv.Add("--screenshot");
        argv.Add(Path.GetFullPath(arguments.ScreenshotPath));
        argv.Add("--locale");
        argv.Add(arguments.Locale);

        return argv.ToImmutable();
    }

    private static string FormatResolution(int width, int height) =>
        string.Create(
            CultureInfo.InvariantCulture,
            $"{width}x{height}");
}
