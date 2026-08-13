using OathAndCoin.Simulation.Ids;

namespace OathAndCoin.Content.Scenarios;

/// <summary>
/// One step of a scenario: offer a contract to the hero at
/// <paramref name="HeroIndex"/>.
/// </summary>
/// <param name="HeroIndex">
/// Index into the campaign's heroes, which
/// <see cref="ContentSet.CreateInitialState"/> assigns in content-id order.
/// A scenario names a hero by position rather than by content id because it
/// is written against a campaign's roster, not against the content tree —
/// and the mapping from position to definition is deterministic, so this stays
/// reproducible.
/// </param>
public sealed record ScenarioCommand(
    long CommandId,
    int HeroIndex,
    ContentId Contract,
    long ExpectedStateVersion);

/// <summary>Reads a scenario file — the ordered command list of a run.</summary>
public static class ScenarioCommands
{
    /// <exception cref="InvalidDataException">
    /// The file is missing, malformed, has an unknown property, or declares no
    /// commands.
    /// </exception>
    public static IReadOnlyList<ScenarioCommand> Load(string scenarioPath)
    {
        ArgumentException.ThrowIfNullOrEmpty(scenarioPath);

        var fullPath = Path.GetFullPath(scenarioPath);
        if (!File.Exists(fullPath))
        {
            throw new InvalidDataException($"Scenario file '{fullPath}' does not exist.");
        }

        var displayPath = Path.GetFileName(fullPath);
        var file = StrictJson.ReadFile<ScenarioFile>(displayPath, fullPath);

        if (file.Commands.Count == 0)
        {
            // An empty scenario would "reproduce" perfectly and demonstrate
            // nothing — the most comfortable way for a determinism check to be
            // green about nothing at all.
            throw new InvalidDataException($"Scenario file '{displayPath}' declares no commands.");
        }

        return file.Commands
            .Select(command => new ScenarioCommand(
                command.CommandId,
                command.HeroIndex,
                command.Contract,
                command.ExpectedStateVersion))
            .ToList();
    }

    private sealed record ScenarioFile
    {
        public required IReadOnlyList<ScenarioCommandFile> Commands { get; init; }
    }

    private sealed record ScenarioCommandFile
    {
        public required long CommandId { get; init; }

        public required int HeroIndex { get; init; }

        public required ContentId Contract { get; init; }

        public required long ExpectedStateVersion { get; init; }
    }
}
