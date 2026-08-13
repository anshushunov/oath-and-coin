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
    private static GameArguments SmokeArguments() => new(
        Smoke: true,
        Scenario: "gate0",
        Checkpoint: "decisions_complete",
        Seed: 424242UL,
        ContentRoot: @"C:\repo\content",
        SchemaRoot: @"C:\repo\schemas",
        ScenarioRoot: @"C:\repo\scenarios",
        ScreenshotPath: @"C:\repo\artifacts\smoke\run\frame.png",
        Width: 1280,
        Height: 720,
        Locale: "en");

    [Fact]
    public void BuildArgv_PutsEngineFlagsBeforeSeparatorAndUserArgsAfter()
    {
        var argv = GameInvocation.BuildArgv(@"C:\repo\game", SmokeArguments());

        Assert.Equal(
            new[]
            {
                "--path", @"C:\repo\game",
                "--resolution", "1280x720",
                "--",
                "--smoke",
                "--scenario", "gate0",
                "--checkpoint", "decisions_complete",
                "--seed", "424242",
                "--content", @"C:\repo\content",
                "--schemas", @"C:\repo\schemas",
                "--scenarios", @"C:\repo\scenarios",
                "--screenshot", @"C:\repo\artifacts\smoke\run\frame.png",
                "--locale", "en",
            },
            argv);
    }

    /// <summary>
    /// A relative path is only meaningful relative to whatever the tool
    /// process's working directory happened to be — the game process Godot
    /// starts has no reason to share it. Forward slashes are normalized too:
    /// a manifest or CLI author on this Windows-only project should not have
    /// to remember which separator the engine flag wants.
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
        // survive as a relative or forward-slashed output.
        Assert.True(Path.IsPathRooted(pathValue));
        Assert.True(Path.IsPathRooted(contentValue));
        Assert.True(Path.IsPathRooted(screenshotValue));
        Assert.DoesNotContain('/', contentValue);
        Assert.DoesNotContain('/', screenshotValue);

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
        var arguments = SmokeArguments() with
        {
            ScreenshotPath = @"C:\repo\artifacts\smoke run\frame.png",
        };

        var argv = GameInvocation.BuildArgv(@"C:\repo\game", arguments).ToArray();

        Assert.Equal(
            @"C:\repo\artifacts\smoke run\frame.png",
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

        var argv = GameInvocation.BuildArgv(@"C:\repo\game", arguments).ToArray();
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

        var argv = GameInvocation.BuildArgv(@"C:\repo\game", arguments).ToArray();
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

        var argv = GameInvocation.BuildArgv(@"C:\repo\game", arguments).ToArray();

        Assert.Equal("1600x900", argv[Array.IndexOf(argv, "--resolution") + 1]);
    }
}
