using System.Globalization;

namespace OathAndCoin.Harness;

/// <summary>
/// One fully specified <c>run-smoke</c> invocation: which scenario to drive,
/// where to stop, how to launch Godot, and the knobs that make an
/// unattended run different from an interactive one. Optional fields are
/// left <c>null</c> here rather than defaulted: deciding where an unset
/// <c>--godot</c> or <c>--output</c> resolves to is process-orchestration's
/// job (a later runtime-harness task), and this type only records what the
/// operator actually typed.
/// </summary>
/// <param name="Scenario">The scenario id to run, as named in its manifest.</param>
/// <param name="Checkpoint">
/// The checkpoint to stop at, or <c>null</c> to let
/// <c>OathAndCoin.Content.Scenarios.CheckpointResolver</c> default to the
/// scenario's last one.
/// </param>
/// <param name="GodotPath">Path to the Godot executable, or <c>null</c> to let the caller locate one.</param>
/// <param name="Seed">The simulation seed to run under.</param>
/// <param name="OutputRoot">Directory to write the run's artifacts under, or <c>null</c> for a caller-chosen default.</param>
/// <param name="TimeoutSeconds">How long to wait for the game process before treating the run as timed out.</param>
/// <param name="AllowDirty">Whether to run despite an uncommitted working tree.</param>
public sealed record ParsedArguments(
    string Scenario,
    string? Checkpoint,
    string? GodotPath,
    ulong Seed,
    string? OutputRoot,
    int TimeoutSeconds,
    bool AllowDirty);

/// <summary>
/// Parses the <c>run-smoke</c> command line. Strict in the same three
/// directions as <c>OathAndCoin.SimulationRunner.CommandLine</c> and
/// <c>OathAndCoin.GameProtocol.GameArguments.Parse</c>: an unknown argument,
/// a repeated one, and a missing required one are each a loud failure at
/// launch rather than a silently wrong run.
/// </summary>
public static class CommandLine
{
    public const string RunSmokeCommand = "run-smoke";

    /// <summary>
    /// The seed a run uses when the operator does not name one — the same
    /// seed <c>.github/workflows/dotnet.yml</c> pins for gate0's determinism
    /// replay, so an unattended <c>run-smoke</c> reproduces the CI run by
    /// default instead of an unrecorded random one.
    /// </summary>
    public const ulong DefaultSeed = 424242UL;

    /// <summary>
    /// How long a run waits for the game before giving up when the operator
    /// does not name a timeout. A smoke run drives a handful of commands to
    /// one checkpoint and screenshots it; a minute is generous headroom for
    /// that on a cold engine start without leaving a hung process unnoticed
    /// for long.
    /// </summary>
    public const int DefaultTimeoutSeconds = 60;

    public const string Usage =
        "usage: run-smoke --scenario <id> [--checkpoint <name>] [--godot <path>] "
        + "[--seed <n>] [--output <dir>] [--timeout <seconds>] [--allow-dirty]";

    private const string ScenarioFlag = "--scenario";
    private const string CheckpointFlag = "--checkpoint";
    private const string GodotFlag = "--godot";
    private const string SeedFlag = "--seed";
    private const string OutputFlag = "--output";
    private const string TimeoutFlag = "--timeout";
    private const string AllowDirtyFlag = "--allow-dirty";

    private static readonly string[] RequiredValueFlags = { ScenarioFlag };

    private static readonly string[] OptionalValueFlags =
    {
        CheckpointFlag, GodotFlag, SeedFlag, OutputFlag, TimeoutFlag,
    };

    /// <exception cref="ArgumentException">
    /// The command is missing or unknown; an argument is unknown, repeated,
    /// or has no value; a stray value has no flag in front of it;
    /// <c>--scenario</c> is absent; the seed is not an invariant unsigned
    /// integer; or the timeout is not a positive invariant integer.
    /// </exception>
    public static ParsedArguments Parse(string[] args)
    {
        ArgumentNullException.ThrowIfNull(args);

        if (args.Length == 0)
        {
            throw new ArgumentException($"No command given. {Usage}");
        }

        if (!string.Equals(args[0], RunSmokeCommand, StringComparison.Ordinal))
        {
            throw new ArgumentException(
                $"Unknown command '{args[0]}'. The only command is '{RunSmokeCommand}'. {Usage}");
        }

        var known = RequiredValueFlags.Concat(OptionalValueFlags).ToHashSet(StringComparer.Ordinal);
        var values = new Dictionary<string, string>(StringComparer.Ordinal);
        var allowDirty = false;

        // Flags start at index 1: index 0 is the command word itself, not an
        // argument. Losing track of that offset — reading flags starting at
        // index 0, or skipping an extra position after a value — is the
        // exact off-by-two mistake a previous version of this runner made.
        for (var index = 1; index < args.Length; index++)
        {
            var name = args[index];

            if (!name.StartsWith("--", StringComparison.Ordinal))
            {
                throw new ArgumentException(
                    $"Unexpected value '{name}' with no argument in front of it. {Usage}");
            }

            if (string.Equals(name, AllowDirtyFlag, StringComparison.Ordinal))
            {
                if (allowDirty)
                {
                    throw new ArgumentException(
                        $"Argument '{AllowDirtyFlag}' was given more than once; which one was meant is not for "
                        + "this program to guess.");
                }

                allowDirty = true;
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

            if (index + 1 >= args.Length)
            {
                throw new ArgumentException($"Argument '{name}' has no value. {Usage}");
            }

            values.Add(name, args[index + 1]);

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

        var seed = DefaultSeed;
        if (values.TryGetValue(SeedFlag, out var seedText)
            && !ulong.TryParse(seedText, NumberStyles.None, CultureInfo.InvariantCulture, out seed))
        {
            throw new ArgumentException(
                $"Argument '{SeedFlag}' must be an unsigned integer, but was '{seedText}'.");
        }

        var timeoutSeconds = DefaultTimeoutSeconds;
        if (values.TryGetValue(TimeoutFlag, out var timeoutText)
            && (!int.TryParse(timeoutText, NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out timeoutSeconds)
                || timeoutSeconds <= 0))
        {
            throw new ArgumentException(
                $"Argument '{TimeoutFlag}' must be a positive integer, but was '{timeoutText}'.");
        }

        return new ParsedArguments(
            values[ScenarioFlag],
            values.GetValueOrDefault(CheckpointFlag),
            values.GetValueOrDefault(GodotFlag),
            seed,
            values.GetValueOrDefault(OutputFlag),
            timeoutSeconds,
            allowDirty);
    }
}
