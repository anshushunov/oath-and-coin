using System.Collections.Immutable;

namespace OathAndCoin.Content.Scenarios;

/// <summary>
/// Whether a scenario is expected to complete normally or to fail with a
/// specific, named error. Kept as its own field on the manifest rather than
/// inferred from whether a <see cref="FaultInjection"/> is present: a caller
/// running a scenario to a checkpoint needs to know in advance what to assert
/// about the outcome, not guess it from another field's shape.
/// </summary>
public enum ScenarioOutcomeKind
{
    Success,
    Error,
}

/// <summary>
/// How to break the game before running the scenario, and where.
/// <paramref name="Kind"/> and <paramref name="Path"/> are free text rather
/// than a closed set this assembly enumerates: this manifest format is read
/// by later runtime-harness tasks that do not exist yet, and a closed enum
/// here would have to be extended every time one of them invents a new fault.
/// </summary>
public sealed record FaultInjection(string Kind, string Path);

/// <summary>
/// A named point in a scenario's command sequence: everything up to and
/// including the command whose id is <paramref name="AfterCommandId"/> has
/// run. A checkpoint is named rather than addressed by a raw command id so a
/// scenario file's commands can be edited without renumbering every caller
/// that stops at one of them.
/// </summary>
public sealed record Checkpoint(string Name, long AfterCommandId);

/// <summary>
/// The contract a scenario states about itself before anyone runs it: which
/// outcome it is expected to produce, how to break the game when that
/// outcome is an error, and the named checkpoints a caller can stop it at.
/// This is the input format every later runtime-harness task consumes — it
/// exists before any of them does, so "run to checkpoint X and expect outcome
/// Y" is a fact read from a file instead of one an executor has to invent per
/// scenario.
/// </summary>
public sealed record ScenarioManifest(
    int SchemaVersion,
    string Scenario,
    ScenarioOutcomeKind ExpectedOutcome,
    FaultInjection? Fault,
    string? ExpectedErrorCode,
    ImmutableArray<Checkpoint> Checkpoints)
{
    /// <summary>
    /// The manifest format this build reads. Mirrors
    /// <see cref="ContentSet.SupportedContentSchemaVersion"/>: a manifest
    /// authored for a later format is refused rather than read under this
    /// version's assumptions.
    /// </summary>
    public const int SupportedManifestSchemaVersion = 1;

    /// <exception cref="InvalidDataException">
    /// The file is missing, malformed, has an unknown property, declares an
    /// unsupported schema version, repeats a checkpoint name, or states an
    /// outcome inconsistent with its own fields (an error outcome without an
    /// error code, or a success outcome with a fault).
    /// </exception>
    public static ScenarioManifest Load(string path)
    {
        ArgumentException.ThrowIfNullOrEmpty(path);

        var fullPath = Path.GetFullPath(path);
        if (!File.Exists(fullPath))
        {
            throw new InvalidDataException($"Scenario manifest '{fullPath}' does not exist.");
        }

        var displayPath = Path.GetFileName(fullPath);
        var file = StrictJson.ReadFile<ManifestFile>(displayPath, fullPath);

        if (file.SchemaVersion != SupportedManifestSchemaVersion)
        {
            throw new InvalidDataException(
                $"Scenario manifest '{displayPath}' declares schema_version {file.SchemaVersion}, but this "
                + $"build reads version {SupportedManifestSchemaVersion}. Migrate the file, or run a build "
                + "that understands its version — reading it under the wrong version would be a guess.");
        }

        var expectedOutcome = ParseOutcome(file.ExpectedOutcome, displayPath);

        var fault = file.Fault is null
            ? null
            : new FaultInjection(file.Fault.Kind, file.Fault.Path);

        if (expectedOutcome == ScenarioOutcomeKind.Error && file.ExpectedErrorCode is null)
        {
            throw new InvalidDataException(
                $"Scenario manifest '{displayPath}' declares expected_outcome 'error' but no "
                + "expected_error_code — a caller checking the outcome would have nothing to compare against.");
        }

        if (expectedOutcome == ScenarioOutcomeKind.Success && fault is not null)
        {
            throw new InvalidDataException(
                $"Scenario manifest '{displayPath}' declares a fault but expected_outcome 'success' — "
                + "a scenario that breaks the game cannot also claim it runs cleanly.");
        }

        var checkpoints = ImmutableArray.CreateBuilder<Checkpoint>();
        var seenNames = new HashSet<string>(StringComparer.Ordinal);
        foreach (var checkpointFile in file.Checkpoints)
        {
            if (!seenNames.Add(checkpointFile.Name))
            {
                throw new InvalidDataException(
                    $"Scenario manifest '{displayPath}' declares checkpoint '{checkpointFile.Name}' more than "
                    + "once — a caller resolving it by name would not know which one was meant.");
            }

            checkpoints.Add(new Checkpoint(checkpointFile.Name, checkpointFile.AfterCommandId));
        }

        return new ScenarioManifest(
            file.SchemaVersion,
            file.Scenario,
            expectedOutcome,
            fault,
            file.ExpectedErrorCode,
            checkpoints.ToImmutable());
    }

    private static ScenarioOutcomeKind ParseOutcome(string value, string displayPath) => value switch
    {
        "success" => ScenarioOutcomeKind.Success,
        "error" => ScenarioOutcomeKind.Error,
        _ => throw new InvalidDataException(
            $"Scenario manifest '{displayPath}' has expected_outcome '{value}'; expected 'success' or 'error'."),
    };

    private sealed record ManifestFile
    {
        public required int SchemaVersion { get; init; }

        public required string Scenario { get; init; }

        public required string ExpectedOutcome { get; init; }

        public FaultInjectionFile? Fault { get; init; }

        public string? ExpectedErrorCode { get; init; }

        public required IReadOnlyList<CheckpointFile> Checkpoints { get; init; }
    }

    private sealed record FaultInjectionFile
    {
        public required string Kind { get; init; }

        public required string Path { get; init; }
    }

    private sealed record CheckpointFile
    {
        public required string Name { get; init; }

        public required long AfterCommandId { get; init; }
    }
}
