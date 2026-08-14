using System.Globalization;
using OathAndCoin.GameProtocol;

namespace OathAndCoin.GameProtocol.Tests;

/// <summary>
/// <see cref="GameArguments.Parse"/> reads the user args the running game
/// actually sees (Godot's own <c>OS.get_cmdline_user_args()</c> — everything
/// after the engine's <c>--</c> separator). Tested at the same strictness as
/// <c>OathAndCoin.SimulationRunner.CommandLine</c>: an unknown, repeated or
/// missing argument is a loud failure at launch, not a silently wrong run.
/// </summary>
public class GameArgumentsTests
{
    private static readonly string[] CompleteArguments =
    {
        "--smoke",
        "--scenario", "gate0",
        "--checkpoint", "decisions_complete",
        "--seed", "424242",
        "--content", @"C:\repo\content",
        "--schemas", @"C:\repo\schemas",
        "--scenarios", @"C:\repo\scenarios",
        "--screenshot", @"C:\repo\artifacts\smoke\run\frame.png",
        "--resolution", "1280x720",
        "--locale", "en",
    };

    private static readonly GameArguments CompleteExpected = new(
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
    public void Parse_AcceptsCompleteArgumentList()
    {
        var parsed = GameArguments.Parse(CompleteArguments);

        Assert.Equal(CompleteExpected, parsed);
    }

    [Fact]
    public void Parse_RejectsUnknownArgument()
    {
        var arguments = CompleteArguments.Concat(new[] { "--colour", "red" }).ToArray();

        var exception = Assert.Throws<ArgumentException>(() => GameArguments.Parse(arguments));

        Assert.Contains("--colour", exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Parse_RejectsDuplicateArgument()
    {
        var arguments = CompleteArguments.Concat(new[] { "--seed", "2" }).ToArray();

        var exception = Assert.Throws<ArgumentException>(() => GameArguments.Parse(arguments));

        Assert.Contains("--seed", exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Parse_RejectsMissingRequiredArgument()
    {
        var arguments = new[]
        {
            "--scenario", "gate0",
            "--seed", "424242",
            "--content", @"C:\repo\content",
            "--schemas", @"C:\repo\schemas",
            "--scenarios", @"C:\repo\scenarios",
            "--screenshot", @"C:\repo\artifacts\smoke\run\frame.png",
        };

        var exception = Assert.Throws<ArgumentException>(() => GameArguments.Parse(arguments));

        Assert.Contains("--checkpoint", exception.Message, StringComparison.Ordinal);
        Assert.Contains("--locale", exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Parse_RejectsDanglingValue()
    {
        var arguments = CompleteArguments.Concat(new[] { "stray-value" }).ToArray();

        var exception = Assert.Throws<ArgumentException>(() => GameArguments.Parse(arguments));

        Assert.Contains("stray-value", exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Parse_RejectsNonNumericSeed()
    {
        var arguments = Replace(CompleteArguments, "--seed", "abc");

        var exception = Assert.Throws<ArgumentException>(() => GameArguments.Parse(arguments));

        Assert.Contains("--seed", exception.Message, StringComparison.Ordinal);
        Assert.Contains("abc", exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Parse_RejectsNonNumericWindowSize()
    {
        var arguments = Replace(CompleteArguments, "--resolution", "1280xNaN");

        var exception = Assert.Throws<ArgumentException>(() => GameArguments.Parse(arguments));

        Assert.Contains("--resolution", exception.Message, StringComparison.Ordinal);
        Assert.Contains("1280xNaN", exception.Message, StringComparison.Ordinal);
    }

    private static string[] Replace(string[] arguments, string name, string value)
    {
        var copy = arguments.ToArray();
        copy[Array.IndexOf(copy, name) + 1] = value;
        return copy;
    }
}
