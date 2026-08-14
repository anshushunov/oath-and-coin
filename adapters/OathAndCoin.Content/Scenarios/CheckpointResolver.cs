using System.Collections.Immutable;

namespace OathAndCoin.Content.Scenarios;

/// <summary>
/// Turns a manifest's checkpoint (a name) and a scenario's command list (an
/// ordered sequence) into the concrete slice of commands a caller should
/// replay to reach it. Kept separate from <see cref="ScenarioManifest"/>:
/// resolving a checkpoint needs the command list to validate the checkpoint
/// against, and a manifest is loaded from its own file without ever seeing a
/// scenario's commands.
/// </summary>
/// <remarks>
/// The command list below is the scenario's own — the same type
/// <see cref="ScenarioCommands.Load"/> returns — passed in rather than
/// re-read from disk, so a caller that already loaded the scenario does not
/// pay for it twice and this class never touches the filesystem itself.
/// </remarks>
public static class CheckpointResolver
{
    /// <summary>
    /// Picks the checkpoint named <paramref name="requestedName"/>, or the
    /// last one declared in the manifest when no name is given — a caller
    /// driving a scenario end-to-end should not have to spell out its final
    /// checkpoint by name.
    /// </summary>
    /// <exception cref="InvalidDataException">
    /// The manifest declares no checkpoints, <paramref name="requestedName"/>
    /// does not match any of them, or the matched checkpoint's
    /// <see cref="Checkpoint.AfterCommandId"/> does not correspond to any
    /// command in <paramref name="commands"/>.
    /// </exception>
    public static Checkpoint Resolve(
        ScenarioManifest manifest,
        IReadOnlyList<ScenarioCommand> commands,
        string? requestedName)
    {
        ArgumentNullException.ThrowIfNull(manifest);
        ArgumentNullException.ThrowIfNull(commands);

        var checkpoint = requestedName is null
            ? DefaultCheckpoint(manifest)
            : FindByName(manifest, requestedName);

        // 0 is the one value that never has to appear in the scenario: it
        // means "before the first command", not "after some command with id
        // 0" — command ids in a scenario file start at 1.
        if (checkpoint.AfterCommandId != 0
            && !commands.Any(command => command.CommandId == checkpoint.AfterCommandId))
        {
            throw new InvalidDataException(
                $"Checkpoint '{checkpoint.Name}' in scenario '{manifest.Scenario}' names command id "
                + $"{checkpoint.AfterCommandId}, which is not in the scenario's command list.");
        }

        return checkpoint;
    }

    /// <summary>
    /// The commands a run must replay to reach <paramref name="checkpoint"/>:
    /// everything up to and including the command whose id equals
    /// <see cref="Checkpoint.AfterCommandId"/> — not everything strictly
    /// before it, which would silently drop the boundary command from every
    /// checkpoint's slice. An <c>AfterCommandId</c> of 0 always yields an
    /// empty slice: the checkpoint sits before any command has run.
    /// </summary>
    public static ImmutableArray<ScenarioCommand> CommandsUpTo(
        IReadOnlyList<ScenarioCommand> commands,
        Checkpoint checkpoint)
    {
        ArgumentNullException.ThrowIfNull(commands);
        ArgumentNullException.ThrowIfNull(checkpoint);

        if (checkpoint.AfterCommandId == 0)
        {
            return ImmutableArray<ScenarioCommand>.Empty;
        }

        return commands
            .Where(command => command.CommandId <= checkpoint.AfterCommandId)
            .ToImmutableArray();
    }

    private static Checkpoint DefaultCheckpoint(ScenarioManifest manifest)
    {
        if (manifest.Checkpoints.IsEmpty)
        {
            throw new InvalidDataException(
                $"Scenario '{manifest.Scenario}' declares no checkpoints to default to.");
        }

        return manifest.Checkpoints[^1];
    }

    private static Checkpoint FindByName(ScenarioManifest manifest, string requestedName)
    {
        foreach (var checkpoint in manifest.Checkpoints)
        {
            if (string.Equals(checkpoint.Name, requestedName, StringComparison.Ordinal))
            {
                return checkpoint;
            }
        }

        var available = string.Join(", ", manifest.Checkpoints.Select(checkpoint => checkpoint.Name));
        throw new InvalidDataException(
            $"Scenario '{manifest.Scenario}' has no checkpoint named '{requestedName}'. "
            + $"Available checkpoints: {available}.");
    }
}
