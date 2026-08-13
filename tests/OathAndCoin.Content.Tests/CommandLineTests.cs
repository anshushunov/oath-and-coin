using System.Globalization;
using OathAndCoin.SimulationRunner;

namespace OathAndCoin.Content.Tests;

/// <summary>
/// Argument parsing, tested at the same depth as the domain.
/// </summary>
/// <remarks>
/// The previous sketch of this CLI accepted unknown parameters silently,
/// allowed <c>--seed</c> to be absent, and did not skip the index past a value
/// it had already consumed — so <c>--seed 5 --artifact x</c> parsed into
/// something nobody asked for. None of that fails loudly at run time: it
/// produces a run, with a report, from arguments the operator did not give.
/// Parsing is exactly the kind of code that is wrong quietly, which is why it
/// is not left to a manual check.
/// </remarks>
public class CommandLineTests
{
    private static readonly string[] CompleteArguments =
    {
        "run-scenario",
        "--content", "content",
        "--schemas", "schemas",
        "--commands", "scenarios/gate0.commands.json",
        "--seed", "424242",
        "--artifact", "artifacts/gate0-canonical.json",
        "--report", "artifacts/gate0-report.txt",
    };

    [Fact]
    public void Parse_AcceptsCompleteArgumentList()
    {
        var parsed = CommandLine.Parse(CompleteArguments);

        Assert.Equal("content", parsed.ContentRoot);
        Assert.Equal("schemas", parsed.SchemaRoot);
        Assert.Equal("scenarios/gate0.commands.json", parsed.CommandsPath);
        Assert.Equal(424242UL, parsed.Seed);
        Assert.Equal("artifacts/gate0-canonical.json", parsed.ArtifactPath);
        Assert.Equal("artifacts/gate0-report.txt", parsed.ReportPath);
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
    public void Parse_RejectsMissingRequiredArgument()
    {
        var arguments = new[]
        {
            "run-scenario",
            "--content", "content",
            "--schemas", "schemas",
        };

        var exception = Assert.Throws<ArgumentException>(() => CommandLine.Parse(arguments));

        Assert.Contains("--commands", exception.Message, StringComparison.Ordinal);
        Assert.Contains("--seed", exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Parse_RejectsValueWithoutArgument()
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

    /// <summary>
    /// The seed is a number in the reproducibility tuple (TDD §7.1), so it must
    /// mean the same thing on every machine that reads a bug report. A seed
    /// parsed through the host's culture would accept digit groupings on one
    /// machine and refuse them on another.
    /// </summary>
    [Fact]
    public void Parse_TreatsSeedAsInvariant()
    {
        var hostile = (CultureInfo)CultureInfo.GetCultureInfo("de-DE").Clone();
        hostile.NumberFormat.NumberGroupSeparator = ".";

        var previousCulture = CultureInfo.CurrentCulture;
        try
        {
            CultureInfo.CurrentCulture = hostile;

            Assert.Equal(1000UL, CommandLine.Parse(Replace(CompleteArguments, "--seed", "1000")).Seed);

            // "1.000" is one thousand in this culture and nonsense in an
            // invariant parse — refusing it is the point.
            Assert.Throws<ArgumentException>(() => CommandLine.Parse(Replace(CompleteArguments, "--seed", "1.000")));
        }
        finally
        {
            CultureInfo.CurrentCulture = previousCulture;
        }
    }

    private static string[] Replace(string[] arguments, string name, string value)
    {
        var copy = arguments.ToArray();
        copy[Array.IndexOf(copy, name) + 1] = value;
        return copy;
    }
}
