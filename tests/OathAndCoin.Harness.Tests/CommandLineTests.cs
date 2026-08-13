using System.Globalization;
using OathAndCoin.Harness;

namespace OathAndCoin.Harness.Tests;

/// <summary>
/// <see cref="CommandLine.Parse"/> reads the <c>run-smoke</c> invocation.
/// Tested at the same strictness as <c>OathAndCoin.SimulationRunner.CommandLine</c>
/// and <c>OathAndCoin.GameProtocol.GameArguments.Parse</c>: an unknown,
/// repeated, or missing required argument is a loud failure at launch, not a
/// silently wrong run.
/// </summary>
public class CommandLineTests
{
    private static readonly string[] CompleteArguments =
    {
        CommandLine.RunSmokeCommand,
        "--scenario", "gate0",
        "--checkpoint", "decisions_complete",
        "--godot", @"C:\godot\godot.exe",
        "--seed", "123456",
        "--output", @"C:\repo\artifacts\smoke",
        "--timeout", "45",
        "--allow-dirty",
    };

    private static readonly ParsedArguments CompleteExpected = new(
        Scenario: "gate0",
        Checkpoint: "decisions_complete",
        GodotPath: @"C:\godot\godot.exe",
        Seed: 123456UL,
        OutputRoot: @"C:\repo\artifacts\smoke",
        TimeoutSeconds: 45,
        AllowDirty: true);

    [Fact]
    public void Parse_AcceptsMinimalArguments()
    {
        var arguments = new[] { CommandLine.RunSmokeCommand, "--scenario", "gate0" };

        var parsed = CommandLine.Parse(arguments);

        Assert.Equal(
            new ParsedArguments(
                Scenario: "gate0",
                Checkpoint: null,
                GodotPath: null,
                Seed: CommandLine.DefaultSeed,
                OutputRoot: null,
                TimeoutSeconds: CommandLine.DefaultTimeoutSeconds,
                AllowDirty: false),
            parsed);
    }

    [Fact]
    public void Parse_AcceptsCompleteArgumentList()
    {
        var parsed = CommandLine.Parse(CompleteArguments);

        Assert.Equal(CompleteExpected, parsed);
    }

    [Fact]
    public void Parse_RejectsUnknownArgument()
    {
        var arguments = CompleteArguments.Concat(new[] { "--colour", "red" }).ToArray();

        var exception = Assert.Throws<ArgumentException>(() => CommandLine.Parse(arguments));

        Assert.Contains("--colour", exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Parse_RejectsDuplicateArgument()
    {
        var arguments = CompleteArguments.Concat(new[] { "--seed", "2" }).ToArray();

        var exception = Assert.Throws<ArgumentException>(() => CommandLine.Parse(arguments));

        Assert.Contains("--seed", exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Parse_RejectsMissingScenario()
    {
        var arguments = new[] { CommandLine.RunSmokeCommand, "--seed", "1" };

        var exception = Assert.Throws<ArgumentException>(() => CommandLine.Parse(arguments));

        Assert.Contains("--scenario", exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Parse_RejectsMissingCommand()
    {
        var exception = Assert.Throws<ArgumentException>(() => CommandLine.Parse(Array.Empty<string>()));

        Assert.Contains(CommandLine.RunSmokeCommand, exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Parse_RejectsDanglingValue()
    {
        var arguments = CompleteArguments.Concat(new[] { "stray-value" }).ToArray();

        var exception = Assert.Throws<ArgumentException>(() => CommandLine.Parse(arguments));

        Assert.Contains("stray-value", exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Parse_RejectsNonNumericSeed()
    {
        var arguments = Replace(CompleteArguments, "--seed", "abc");

        var exception = Assert.Throws<ArgumentException>(() => CommandLine.Parse(arguments));

        Assert.Contains("--seed", exception.Message, StringComparison.Ordinal);
        Assert.Contains("abc", exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Parse_RejectsNonPositiveTimeout()
    {
        var arguments = Replace(CompleteArguments, "--timeout", "0");

        var exception = Assert.Throws<ArgumentException>(() => CommandLine.Parse(arguments));

        Assert.Contains("--timeout", exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Parse_IsCultureInvariant()
    {
        // A culture that would parse "123456" or "45" differently if the
        // parser ever consulted CultureInfo.CurrentCulture instead of
        // InvariantCulture (TDD §7.3: no host-dependent inputs) — a seed
        // copied into a bug report has to mean the same number on every
        // machine that reads it back.
        var original = CultureInfo.CurrentCulture;
        CultureInfo.CurrentCulture = CultureInfo.GetCultureInfo("de-DE");
        try
        {
            var parsed = CommandLine.Parse(CompleteArguments);

            Assert.Equal(CompleteExpected, parsed);
        }
        finally
        {
            CultureInfo.CurrentCulture = original;
        }
    }

    private static string[] Replace(string[] arguments, string name, string value)
    {
        var copy = arguments.ToArray();
        copy[Array.IndexOf(copy, name) + 1] = value;
        return copy;
    }
}
