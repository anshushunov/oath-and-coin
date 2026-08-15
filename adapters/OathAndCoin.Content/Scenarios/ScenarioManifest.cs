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

    /// <summary>
    /// The game's pre-content "loading" screen (spec: the fifth
    /// <c>OathAndCoin.Presentation.ScreenState</c>). A scenario declaring this
    /// outcome is never actually run — no content is read, no command is
    /// applied — because that screen exists precisely for the moment before a
    /// <c>ScenarioOutcome</c> could exist at all (see the remarks on
    /// <c>OathAndCoin.Presentation.ScreenState.Loading</c>).
    /// </summary>
    Loading,
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
/// <param name="ContentRoot">
/// A repository-relative directory to read content from instead of the
/// production <c>content/</c> tree, or <c>null</c> to use that tree
/// unchanged. Unlike <paramref name="Fault"/> — which simulates a broken
/// content root for an <see cref="ScenarioOutcomeKind.Error"/> scenario —
/// this points at a real, loadable content set; it exists for a fixture that
/// has to be authored differently on purpose (e.g. heroes with no contracts,
/// for <c>OathAndCoin.Presentation.ScreenState.Empty</c>), not one that has
/// to be missing. Defaulted rather than required so every manifest predating
/// this field keeps parsing unchanged.
/// </param>
public sealed record ScenarioManifest(
    int SchemaVersion,
    string Scenario,
    ScenarioOutcomeKind ExpectedOutcome,
    FaultInjection? Fault,
    string? ExpectedErrorCode,
    ImmutableArray<Checkpoint> Checkpoints,
    string? ContentRoot = null)
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
    /// unsupported schema version, names a scenario other than the one its own
    /// file name names, repeats a checkpoint name, or states an outcome
    /// inconsistent with its own fields (an error outcome without an error
    /// code, or a success outcome with a fault).
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

        // Every caller addresses a scenario by file name and composes
        // "<scenario>.manifest.json" from it — SmokeRun from --scenario, the
        // game's Main.LoadModel from the same argv value — and then uses that
        // requested id for both execution and the terminal event. So nothing
        // downstream ever reads this field back, and a manifest naming a
        // different scenario than the file holding it would go unnoticed on
        // both sides at once while the file said something else about itself.
        var namedScenario = ScenarioIdIn(displayPath);
        if (!string.Equals(file.Scenario, namedScenario, StringComparison.Ordinal))
        {
            throw new InvalidDataException(
                $"Scenario manifest '{displayPath}' declares scenario '{file.Scenario}', but its file name "
                + $"names '{namedScenario}'. The field is this scenario's stable id and callers reach it by "
                + "file name — two spellings mean one of them is never read.");
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

        if (expectedOutcome != ScenarioOutcomeKind.Error && fault is not null)
        {
            throw new InvalidDataException(
                $"Scenario manifest '{displayPath}' declares a fault but expected_outcome "
                + $"'{file.ExpectedOutcome}' — only an 'error' scenario breaks the game on purpose.");
        }

        if (expectedOutcome == ScenarioOutcomeKind.Loading && file.ContentRoot is not null)
        {
            throw new InvalidDataException(
                $"Scenario manifest '{displayPath}' declares a content_root but expected_outcome 'loading' — "
                + "a loading screen is shown before any content is read, so there is nothing here to point "
                + "a content root at.");
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
            checkpoints.ToImmutable(),
            file.ContentRoot);
    }

    /// <summary>
    /// The scenario a file name names: everything before its first dot, so
    /// <c>gate0.manifest.json</c> names <c>gate0</c> rather than
    /// <c>gate0.manifest</c>. A name with no dot at all is taken whole rather
    /// than treated as an error here — this is a comparison, and the message
    /// it feeds is clearer than "not a manifest file name" would be.
    /// </summary>
    private static string ScenarioIdIn(string fileName)
    {
        var dot = fileName.IndexOf('.');
        return dot < 0 ? fileName : fileName[..dot];
    }

    private static ScenarioOutcomeKind ParseOutcome(string value, string displayPath) => value switch
    {
        "success" => ScenarioOutcomeKind.Success,
        "error" => ScenarioOutcomeKind.Error,
        "loading" => ScenarioOutcomeKind.Loading,
        _ => throw new InvalidDataException(
            $"Scenario manifest '{displayPath}' has expected_outcome '{value}'; expected 'success', 'error' "
            + "or 'loading'."),
    };

    private sealed record ManifestFile
    {
        public required int SchemaVersion { get; init; }

        public required string Scenario { get; init; }

        public required string ExpectedOutcome { get; init; }

        public FaultInjectionFile? Fault { get; init; }

        public string? ExpectedErrorCode { get; init; }

        public string? ContentRoot { get; init; }

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
