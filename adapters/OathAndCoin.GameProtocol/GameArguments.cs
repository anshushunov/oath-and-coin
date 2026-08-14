using System.Globalization;

namespace OathAndCoin.GameProtocol;

/// <summary>
/// One fully specified request to launch the game and drive it to a
/// checkpoint. This is the "user args" half of the protocol — the flags
/// Godot hands the running game verbatim through
/// <c>OS.get_cmdline_user_args()</c>, i.e. everything after the engine's own
/// <c>--</c> separator (see <see cref="GameInvocation.BuildArgv"/>). It lives
/// in its own assembly, referenced by neither the tool nor the game
/// exclusively, because both sides have to agree on its shape: the tool
/// builds it, the game parses it, and there is exactly one place that gets
/// to say what a field means.
/// </summary>
/// <param name="Smoke">
/// Whether the game should run in smoke mode — headless-friendly, driven
/// entirely by the scenario rather than player input. A bare switch
/// (<c>--smoke</c>, no value) rather than a boolean flag with a value:
/// there is no meaningful "false" invocation this protocol needs to spell
/// out, only "present" or "absent".
/// </param>
/// <param name="Scenario">The scenario id to run, as named in the scenario manifest.</param>
/// <param name="Checkpoint">The named checkpoint to stop at and report on.</param>
/// <param name="Seed">
/// The simulation seed, parsed as an invariant unsigned integer for the same
/// reason <c>OathAndCoin.SimulationRunner.CommandLine</c> parses it that way:
/// a seed is copied into bug reports, and has to mean the same number on
/// every machine that reads one back.
/// </param>
/// <param name="ContentRoot">Absolute path to the content root, as the game should read it.</param>
/// <param name="SchemaRoot">Absolute path to the schema root.</param>
/// <param name="ScenarioRoot">Absolute path to the scenario root.</param>
/// <param name="ScreenshotPath">Absolute path the game should write its checkpoint screenshot to.</param>
/// <param name="Width">
/// The window width the invocation asked for. Carried here so the tool can
/// state it once and reuse it (e.g. to size the screenshot it expects back),
/// even though it never travels as a user arg — see the remarks on
/// <see cref="Parse"/>.
/// </param>
/// <param name="Height">The window height the invocation asked for.</param>
/// <param name="Locale">The locale the game should run under, e.g. <c>"en"</c>.</param>
public sealed record GameArguments(
    bool Smoke,
    string Scenario,
    string Checkpoint,
    ulong Seed,
    string ContentRoot,
    string SchemaRoot,
    string ScenarioRoot,
    string ScreenshotPath,
    int Width,
    int Height,
    string Locale)
{
    /// <summary>
    /// The resolution assumed when an invocation does not state one via
    /// <c>--resolution</c>. Matches the value <see cref="GameInvocation"/>
    /// puts on every argv it builds today — see the remarks on
    /// <see cref="Parse"/> for why that value, not an arbitrary one, is the
    /// only one this type can currently recover from user args alone.
    /// </summary>
    public const int DefaultWidth = 1280;

    /// <summary>See <see cref="DefaultWidth"/>.</summary>
    public const int DefaultHeight = 720;

    private const string SmokeFlag = "--smoke";
    private const string ScenarioFlag = "--scenario";
    private const string CheckpointFlag = "--checkpoint";
    private const string SeedFlag = "--seed";
    private const string ContentFlag = "--content";
    private const string SchemasFlag = "--schemas";
    private const string ScenariosFlag = "--scenarios";
    private const string ScreenshotFlag = "--screenshot";
    private const string ResolutionFlag = "--resolution";
    private const string LocaleFlag = "--locale";

    private static readonly string[] RequiredValueFlags =
    {
        ScenarioFlag, CheckpointFlag, SeedFlag, ContentFlag, SchemasFlag, ScenariosFlag, ScreenshotFlag, LocaleFlag,
    };

    private static readonly string[] OptionalValueFlags = { ResolutionFlag };

    private const string Usage =
        "usage: [--smoke] --scenario <id> --checkpoint <name> --seed <n> --content <dir> "
        + "--schemas <dir> --scenarios <dir> --screenshot <path> [--resolution <w>x<h>] --locale <id>";

    /// <summary>
    /// Parses the game's own user args back into a <see cref="GameArguments"/>.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <c>--resolution</c> is optional here, and that is not an oversight:
    /// Godot's own <c>--resolution</c> is a genuine engine flag, consumed by
    /// the engine before the <c>--</c> separator, so it never reaches
    /// <c>OS.get_cmdline_user_args()</c> in a real invocation (see
    /// <see cref="GameInvocation.BuildArgv"/>). A required flag this type can
    /// never actually observe would make every real launch fail to parse.
    /// Accepting it here anyway — defaulting to <see cref="DefaultWidth"/>/
    /// <see cref="DefaultHeight"/> when absent — lets a caller that already
    /// has the full argv (tests, or a future direct invocation) pass it
    /// through and be believed.
    /// </para>
    /// </remarks>
    /// <exception cref="ArgumentException">
    /// An argument is unknown, repeated, has no value, or a required one is
    /// missing; a stray value has no flag in front of it; the seed is not an
    /// invariant unsigned integer; or <c>--resolution</c> is not of the form
    /// <c>&lt;width&gt;x&lt;height&gt;</c> with both parts positive invariant integers.
    /// </exception>
    public static GameArguments Parse(IReadOnlyList<string> userArgs)
    {
        ArgumentNullException.ThrowIfNull(userArgs);

        var known = RequiredValueFlags.Concat(OptionalValueFlags).ToHashSet(StringComparer.Ordinal);
        var values = new Dictionary<string, string>(StringComparer.Ordinal);
        var smoke = false;

        for (var index = 0; index < userArgs.Count; index++)
        {
            var name = userArgs[index];

            if (!name.StartsWith("--", StringComparison.Ordinal))
            {
                throw new ArgumentException(
                    $"Unexpected value '{name}' with no argument in front of it. {Usage}");
            }

            if (string.Equals(name, SmokeFlag, StringComparison.Ordinal))
            {
                if (smoke)
                {
                    throw new ArgumentException(
                        $"Argument '{SmokeFlag}' was given more than once; which one was meant is not for this "
                        + "program to guess.");
                }

                smoke = true;
                continue;
            }

            if (!known.Contains(name))
            {
                throw new ArgumentException($"Unknown argument '{name}'. {Usage}");
            }

            if (values.ContainsKey(name))
            {
                throw new ArgumentException(
                    $"Argument '{name}' was given more than once; which one was meant is not for this "
                    + "program to guess.");
            }

            if (index + 1 >= userArgs.Count)
            {
                throw new ArgumentException($"Argument '{name}' has no value. {Usage}");
            }

            values.Add(name, userArgs[index + 1]);

            // Skip the value: without this the loop reads it as the next
            // argument name on its following pass.
            index++;
        }

        var missing = RequiredValueFlags.Where(name => !values.ContainsKey(name)).ToList();
        if (missing.Count > 0)
        {
            throw new ArgumentException(
                $"Missing required argument(s): {string.Join(", ", missing)}. {Usage}");
        }

        if (!ulong.TryParse(values[SeedFlag], NumberStyles.None, CultureInfo.InvariantCulture, out var seed))
        {
            throw new ArgumentException(
                $"Argument '{SeedFlag}' must be an unsigned integer, but was '{values[SeedFlag]}'.");
        }

        var (width, height) = ParseResolution(values.GetValueOrDefault(ResolutionFlag));

        return new GameArguments(
            smoke,
            values[ScenarioFlag],
            values[CheckpointFlag],
            seed,
            values[ContentFlag],
            values[SchemasFlag],
            values[ScenariosFlag],
            values[ScreenshotFlag],
            width,
            height,
            values[LocaleFlag]);
    }

    private static (int Width, int Height) ParseResolution(string? value)
    {
        if (value is null)
        {
            return (DefaultWidth, DefaultHeight);
        }

        var separatorIndex = value.IndexOf('x', StringComparison.Ordinal);
        if (separatorIndex <= 0 || separatorIndex == value.Length - 1)
        {
            throw new ArgumentException(
                $"Argument '{ResolutionFlag}' must be of the form '<width>x<height>', but was '{value}'.");
        }

        var widthText = value[..separatorIndex];
        var heightText = value[(separatorIndex + 1)..];

        if (!int.TryParse(widthText, NumberStyles.None, CultureInfo.InvariantCulture, out var width)
            || width <= 0
            || !int.TryParse(heightText, NumberStyles.None, CultureInfo.InvariantCulture, out var height)
            || height <= 0)
        {
            throw new ArgumentException(
                $"Argument '{ResolutionFlag}' must be of the form '<width>x<height>' with positive integers, "
                + $"but was '{value}'.");
        }

        return (width, height);
    }
}
