using System.Globalization;

namespace OathAndCoin.SimulationRunner;

/// <summary>A fully specified <c>run-scenario</c> invocation.</summary>
public sealed record ParsedArguments(
    string ContentRoot,
    string SchemaRoot,
    string CommandsPath,
    ulong Seed,
    string? ArtifactPath,
    string? ReportPath);

/// <summary>
/// Parses the runner's arguments, refusing everything it does not recognize.
/// </summary>
/// <remarks>
/// Strict on purpose, in all three directions: an unknown argument, a repeated
/// one and a missing required one are each an error rather than something
/// silently ignored or defaulted. A runner that quietly drops <c>--sed 5</c>
/// still produces a run — with a different seed than the operator asked for,
/// and a report that looks exactly as trustworthy as a correct one. That
/// failure has no symptom, which is why it is worth the extra code here.
/// </remarks>
public static class CommandLine
{
    public const string RunScenarioCommand = "run-scenario";

    public const string Usage =
        "usage: simulation-runner run-scenario --content <dir> --schemas <dir> "
        + "--commands <file> --seed <n> [--artifact <path>] [--report <path>]";

    private const string Content = "--content";
    private const string Schemas = "--schemas";
    private const string Commands = "--commands";
    private const string Seed = "--seed";
    private const string Artifact = "--artifact";
    private const string Report = "--report";

    private static readonly string[] Required = { Content, Schemas, Commands, Seed };

    private static readonly string[] Optional = { Artifact, Report };

    /// <exception cref="ArgumentException">
    /// The command is missing or unknown; an argument is unknown, repeated, or
    /// has no value; a required argument is absent; or the seed is not an
    /// invariant unsigned integer.
    /// </exception>
    public static ParsedArguments Parse(string[] args)
    {
        ArgumentNullException.ThrowIfNull(args);

        if (args.Length == 0)
        {
            throw new ArgumentException($"No command given. {Usage}");
        }

        if (!string.Equals(args[0], RunScenarioCommand, StringComparison.Ordinal))
        {
            throw new ArgumentException(
                $"Unknown command '{args[0]}'. The only command is '{RunScenarioCommand}'. {Usage}");
        }

        var known = Required.Concat(Optional).ToHashSet(StringComparer.Ordinal);
        var values = new Dictionary<string, string>(StringComparer.Ordinal);

        for (var index = 1; index < args.Length; index++)
        {
            var name = args[index];

            if (!name.StartsWith("--", StringComparison.Ordinal))
            {
                throw new ArgumentException(
                    $"Unexpected value '{name}' with no argument in front of it. {Usage}");
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

            if (index + 1 >= args.Length)
            {
                throw new ArgumentException($"Argument '{name}' has no value. {Usage}");
            }

            values.Add(name, args[index + 1]);

            // Skip the value: without this the parser reads it as the next
            // argument name on the following pass.
            index++;
        }

        var missing = Required.Where(name => !values.ContainsKey(name)).ToList();
        if (missing.Count > 0)
        {
            throw new ArgumentException(
                $"Missing required argument(s): {string.Join(", ", missing)}. {Usage}");
        }

        // Invariant, and NumberStyles.None: no thousands separators, no sign,
        // no leading or trailing space. A seed is an identifier written down in
        // a bug report, and it has to mean the same number on every machine
        // that reads it back (TDD §7.3).
        if (!ulong.TryParse(values[Seed], NumberStyles.None, CultureInfo.InvariantCulture, out var seed))
        {
            throw new ArgumentException(
                $"Argument '{Seed}' must be an unsigned integer, but was '{values[Seed]}'.");
        }

        return new ParsedArguments(
            values[Content],
            values[Schemas],
            values[Commands],
            seed,
            values.GetValueOrDefault(Artifact),
            values.GetValueOrDefault(Report));
    }
}
