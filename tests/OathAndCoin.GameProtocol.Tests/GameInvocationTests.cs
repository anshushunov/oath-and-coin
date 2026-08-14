using OathAndCoin.GameProtocol;

namespace OathAndCoin.GameProtocol.Tests;

/// <summary>
/// <see cref="GameInvocation.BuildArgv"/> is the other half of the protocol
/// from <see cref="GameArguments.Parse"/>: it decides where the game's own
/// roots come from, and that decision has to be explicit in a fixed argv
/// shape, not something a reader infers from behaviour.
/// </summary>
public class GameInvocationTests
{
    // An already-absolute, already-native-separator path on whichever OS the
    // tests run on: GameInvocation.BuildArgv normalizes every path through
    // Path.GetFullPath, so a fixture has to already be in that OS's own
    // canonical shape for the "was already absolute, comes back unchanged"
    // tests below to mean anything. A literal "C:\..." is that shape only on
    // Windows — Path.GetFullPath does not treat it as rooted on Linux, so it
    // gets resolved against the working directory instead of preserved.
    private static readonly string RepoRoot = Path.GetFullPath(Path.Combine(Path.GetTempPath(), "repo"));

    private static GameArguments SmokeArguments() => new(
        Smoke: true,
        Scenario: "gate0",
        Checkpoint: "decisions_complete",
        Seed: 424242UL,
        ContentRoot: Path.Combine(RepoRoot, "content"),
        SchemaRoot: Path.Combine(RepoRoot, "schemas"),
        ScenarioRoot: Path.Combine(RepoRoot, "scenarios"),
        ScreenshotPath: Path.Combine(RepoRoot, "artifacts", "smoke", "run", "frame.png"),
        Width: 1280,
        Height: 720,
        Locale: "en");

    [Fact]
    public void BuildArgv_PutsEngineFlagsBeforeSeparatorAndUserArgsAfter()
    {
        var arguments = SmokeArguments();
        var gamePath = Path.Combine(RepoRoot, "game");

        var argv = GameInvocation.BuildArgv(gamePath, arguments);

        Assert.Equal(
            new[]
            {
                "--path", gamePath,
                "--resolution", "1280x720",
                "--",
                "--smoke",
                "--scenario", "gate0",
                "--checkpoint", "decisions_complete",
                "--seed", "424242",
                "--content", arguments.ContentRoot,
                "--schemas", arguments.SchemaRoot,
                "--scenarios", arguments.ScenarioRoot,
                "--screenshot", arguments.ScreenshotPath,
                "--locale", "en",
            },
            argv);
    }

    /// <summary>
    /// A relative path is only meaningful relative to whatever the tool
    /// process's working directory happened to be — the game process Godot
    /// starts has no reason to share it. The exact-equality assertions below
    /// pin the normalization fully (including which separator the current
    /// OS's own <see cref="Path.GetFullPath(string)"/> uses — backslash on
    /// Windows, forward slash on Linux — so nothing here hardcodes either).
    /// </summary>
    [Fact]
    public void BuildArgv_UsesAbsoluteNormalizedPaths()
    {
        var arguments = SmokeArguments() with
        {
            ContentRoot = "content/root",
            ScreenshotPath = "artifacts/smoke/frame.png",
        };

        var argv = GameInvocation.BuildArgv("game", arguments).ToArray();
        var pathValue = argv[Array.IndexOf(argv, "--path") + 1];
        var contentValue = argv[Array.IndexOf(argv, "--content") + 1];
        var screenshotValue = argv[Array.IndexOf(argv, "--screenshot") + 1];

        // Independent of how BuildArgv computes it: a relative input must not
        // survive as a relative path.
        Assert.True(Path.IsPathRooted(pathValue));
        Assert.True(Path.IsPathRooted(contentValue));
        Assert.True(Path.IsPathRooted(screenshotValue));

        Assert.Equal(Path.GetFullPath("game"), pathValue);
        Assert.Equal(Path.GetFullPath("content/root"), contentValue);
        Assert.Equal(Path.GetFullPath("artifacts/smoke/frame.png"), screenshotValue);
    }

    /// <summary>
    /// Arguments travel as array elements to a child process, never through a
    /// shell — so a path with a space in it needs no quoting, and adding any
    /// would corrupt it (the quotes would become part of the path).
    /// </summary>
    [Fact]
    public void BuildArgv_KeepsPathsWithSpacesAsSingleArguments()
    {
        var screenshotPath = Path.Combine(RepoRoot, "artifacts", "smoke run", "frame.png");
        var arguments = SmokeArguments() with
        {
            ScreenshotPath = screenshotPath,
        };

        var argv = GameInvocation.BuildArgv(Path.Combine(RepoRoot, "game"), arguments).ToArray();

        Assert.Equal(
            screenshotPath,
            argv[Array.IndexOf(argv, "--screenshot") + 1]);
        Assert.DoesNotContain(argv, element => element.Contains('"', StringComparison.Ordinal));
    }

    /// <summary>
    /// The load-bearing test: the two halves of the protocol are only
    /// provably consistent if what one side writes is exactly what the other
    /// side reads back. Deliberately scoped to the nine fields that actually
    /// travel through the <c>--</c>-separated user-args slice this test
    /// round-trips: <see cref="GameArguments.Width"/>/
    /// <see cref="GameArguments.Height"/> are excluded on purpose, not by
    /// omission — <see cref="BuildArgv"/> folds them into Godot's own
    /// <c>--resolution</c> flag ahead of the separator, so they never reach
    /// this slice at all (see <see cref="GameArguments.Parse"/>'s remarks).
    /// Asserting full record equality here would look like it proves those
    /// two fields too, when it would really only be relying on
    /// <see cref="SmokeArguments"/> happening to use the default resolution.
    /// The resolution half of the protocol is proven separately by
    /// <see cref="BuildArgv_EncodesResolutionAsWidthxHeightWithoutTransposing"/>
    /// (what <see cref="BuildArgv"/> emits) and
    /// <see cref="BuildArgv_NonDefaultResolutionDoesNotSurviveGameArgumentsParse"/>
    /// (that <see cref="GameArguments.Parse"/> cannot recover it from user
    /// args alone, which is the asymmetry this test's name would otherwise
    /// paper over).
    /// </summary>
    [Fact]
    public void BuildArgv_RoundTripsThroughGameArgumentsParse()
    {
        var arguments = SmokeArguments();

        var argv = GameInvocation.BuildArgv(Path.Combine(RepoRoot, "game"), arguments).ToArray();
        var separatorIndex = Array.IndexOf(argv, "--");
        var userArgs = argv[(separatorIndex + 1)..];

        var parsed = GameArguments.Parse(userArgs);

        Assert.Equal(arguments.Smoke, parsed.Smoke);
        Assert.Equal(arguments.Scenario, parsed.Scenario);
        Assert.Equal(arguments.Checkpoint, parsed.Checkpoint);
        Assert.Equal(arguments.Seed, parsed.Seed);
        Assert.Equal(arguments.ContentRoot, parsed.ContentRoot);
        Assert.Equal(arguments.SchemaRoot, parsed.SchemaRoot);
        Assert.Equal(arguments.ScenarioRoot, parsed.ScenarioRoot);
        Assert.Equal(arguments.ScreenshotPath, parsed.ScreenshotPath);
        Assert.Equal(arguments.Locale, parsed.Locale);
    }

    /// <summary>
    /// Guards the other direction of the same asymmetry: a resolution other
    /// than <see cref="GameArguments.DefaultWidth"/>/
    /// <see cref="GameArguments.DefaultHeight"/> does not survive
    /// <see cref="GameArguments.Parse"/>(argv-after-<c>--</c>), because
    /// <c>--resolution</c> never appears in that slice — Godot's engine
    /// consumes it before the separator. Without this test, that gap is only
    /// prose; a reader trusting
    /// <see cref="BuildArgv_RoundTripsThroughGameArgumentsParse"/>'s name has
    /// no signal that Width/Height are excluded from what it proves.
    /// </summary>
    [Fact]
    public void BuildArgv_NonDefaultResolutionDoesNotSurviveGameArgumentsParse()
    {
        var arguments = SmokeArguments() with { Width = 1600, Height = 900 };

        var argv = GameInvocation.BuildArgv(Path.Combine(RepoRoot, "game"), arguments).ToArray();
        var separatorIndex = Array.IndexOf(argv, "--");
        var userArgs = argv[(separatorIndex + 1)..];

        var parsed = GameArguments.Parse(userArgs);

        // The deliberate asymmetry, pinned rather than merely described: the
        // parsed result falls back to the defaults, not to what was asked
        // for, because there is nowhere in the user-args slice for a
        // non-default resolution to have survived.
        Assert.NotEqual(arguments.Width, parsed.Width);
        Assert.NotEqual(arguments.Height, parsed.Height);
        Assert.Equal(GameArguments.DefaultWidth, parsed.Width);
        Assert.Equal(GameArguments.DefaultHeight, parsed.Height);
    }

    /// <summary>
    /// Catches both a transposed width/height and a <see cref="BuildArgv"/>
    /// that ignores <see cref="GameArguments.Width"/>/
    /// <see cref="GameArguments.Height"/> altogether: both bugs would slip
    /// past <see cref="BuildArgv_PutsEngineFlagsBeforeSeparatorAndUserArgsAfter"/>
    /// undetected if they only ever coincided with
    /// <see cref="SmokeArguments"/>'s resolution equalling
    /// <see cref="GameArguments.DefaultWidth"/>/<see cref="GameArguments.DefaultHeight"/>
    /// — so this uses a non-default, non-square resolution instead.
    /// </summary>
    [Fact]
    public void BuildArgv_EncodesResolutionAsWidthxHeightWithoutTransposing()
    {
        var arguments = SmokeArguments() with { Width = 1600, Height = 900 };

        var argv = GameInvocation.BuildArgv(Path.Combine(RepoRoot, "game"), arguments).ToArray();

        Assert.Equal("1600x900", argv[Array.IndexOf(argv, "--resolution") + 1]);
    }
}
