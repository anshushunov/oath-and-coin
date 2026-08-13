using System.Collections.Immutable;
using System.Text.Json.Nodes;
using Json.Schema;
using OathAndCoin.Content.Scenarios;
using OathAndCoin.Simulation.Ids;

namespace OathAndCoin.Content.Tests;

/// <summary>
/// The contract every later runtime-harness task reads: what a scenario
/// manifest declares about its own expected outcome, and how a named
/// checkpoint resolves against a scenario's command list. This is the input
/// format for "run to checkpoint X, expect outcome Y" — introduced before
/// anything consumes it, so a later executor never has to invent it silently
/// (task 1's own rationale).
/// </summary>
public class ScenarioManifestTests
{
    private const string ValidManifestJson = """
        {
          "schema_version": 1,
          "scenario": "gate0",
          "expected_outcome": "success",
          "checkpoints": [{ "name": "decisions_complete", "after_command_id": 2 }]
        }
        """;

    [Fact]
    public void Load_ReadsSuccessManifest()
    {
        var path = System.IO.Path.Combine(RepositoryFixtures.ScenarioRoot, "gate0.manifest.json");

        var manifest = ScenarioManifest.Load(path);

        Assert.Equal(1, manifest.SchemaVersion);
        Assert.Equal("gate0", manifest.Scenario);
        Assert.Equal(ScenarioOutcomeKind.Success, manifest.ExpectedOutcome);
        Assert.Null(manifest.Fault);
        Assert.Null(manifest.ExpectedErrorCode);

        var checkpoint = Assert.Single(manifest.Checkpoints);
        Assert.Equal("decisions_complete", checkpoint.Name);
        Assert.Equal(2, checkpoint.AfterCommandId);
    }

    [Fact]
    public void Load_ReadsErrorManifestWithFault()
    {
        var path = System.IO.Path.Combine(RepositoryFixtures.ScenarioRoot, "content_error.manifest.json");

        var manifest = ScenarioManifest.Load(path);

        Assert.Equal(ScenarioOutcomeKind.Error, manifest.ExpectedOutcome);
        Assert.NotNull(manifest.Fault);
        Assert.Equal("missing_content_root", manifest.Fault!.Kind);
        Assert.Equal("fixtures/does-not-exist", manifest.Fault.Path);
        Assert.Equal("CONTENT_ROOT_NOT_FOUND", manifest.ExpectedErrorCode);
    }

    /// <summary>
    /// Mirrors <c>ContentSetTests.Load_FailsOnUnsupportedSchemaVersion</c>: a
    /// manifest authored for a later format is refused, not read under this
    /// version's assumptions.
    /// </summary>
    [Fact]
    public void Load_FailsOnUnsupportedSchemaVersion()
    {
        using var temp = TempManifest.Write(ValidManifestJson.Replace(
            "\"schema_version\": 1",
            "\"schema_version\": 2",
            StringComparison.Ordinal));

        var exception = Assert.Throws<InvalidDataException>(() => ScenarioManifest.Load(temp.FullPath));

        Assert.Contains("manifest.json", exception.Message, StringComparison.Ordinal);
        Assert.Contains("schema_version 2", exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Load_FailsOnUnknownProperty()
    {
        using var temp = TempManifest.Write("""
            {
              "schema_version": 1,
              "scenario": "gate0",
              "expected_outcome": "success",
              "checkpoints": [{ "name": "decisions_complete", "after_command_id": 2 }],
              "unexpected_field": true
            }
            """);

        var exception = Assert.Throws<InvalidDataException>(() => ScenarioManifest.Load(temp.FullPath));

        Assert.Contains("unexpected_field", exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Load_FailsOnDuplicateCheckpointName()
    {
        using var temp = TempManifest.Write("""
            {
              "schema_version": 1,
              "scenario": "gate0",
              "expected_outcome": "success",
              "checkpoints": [
                { "name": "decisions_complete", "after_command_id": 1 },
                { "name": "decisions_complete", "after_command_id": 2 }
              ]
            }
            """);

        var exception = Assert.Throws<InvalidDataException>(() => ScenarioManifest.Load(temp.FullPath));

        Assert.Contains("decisions_complete", exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Load_FailsWhenErrorOutcomeHasNoErrorCode()
    {
        using var temp = TempManifest.Write("""
            {
              "schema_version": 1,
              "scenario": "content_error",
              "expected_outcome": "error",
              "checkpoints": [{ "name": "load_failed", "after_command_id": 0 }]
            }
            """);

        var exception = Assert.Throws<InvalidDataException>(() => ScenarioManifest.Load(temp.FullPath));

        Assert.Contains("expected_error_code", exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Load_FailsWhenSuccessOutcomeDeclaresFault()
    {
        using var temp = TempManifest.Write("""
            {
              "schema_version": 1,
              "scenario": "gate0",
              "expected_outcome": "success",
              "fault": { "kind": "missing_content_root", "path": "fixtures/does-not-exist" },
              "checkpoints": [{ "name": "decisions_complete", "after_command_id": 2 }]
            }
            """);

        var exception = Assert.Throws<InvalidDataException>(() => ScenarioManifest.Load(temp.FullPath));

        Assert.Contains("fault", exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Resolve_ReturnsRequestedCheckpoint()
    {
        var manifest = ManifestWithTwoCheckpoints();
        var commands = TwoCommands();

        var checkpoint = CheckpointResolver.Resolve(manifest, commands, "first");

        Assert.Equal("first", checkpoint.Name);
        Assert.Equal(1, checkpoint.AfterCommandId);
    }

    [Fact]
    public void Resolve_DefaultsToLastCheckpoint()
    {
        var manifest = ManifestWithTwoCheckpoints();
        var commands = TwoCommands();

        var checkpoint = CheckpointResolver.Resolve(manifest, commands, requestedName: null);

        Assert.Equal("second", checkpoint.Name);
        Assert.Equal(2, checkpoint.AfterCommandId);
    }

    [Fact]
    public void Resolve_FailsOnUnknownCheckpoint()
    {
        var manifest = ManifestWithTwoCheckpoints();
        var commands = TwoCommands();

        var exception = Assert.Throws<InvalidDataException>(
            () => CheckpointResolver.Resolve(manifest, commands, "does_not_exist"));

        Assert.Contains("does_not_exist", exception.Message, StringComparison.Ordinal);
        Assert.Contains("first", exception.Message, StringComparison.Ordinal);
        Assert.Contains("second", exception.Message, StringComparison.Ordinal);
    }

    /// <summary>
    /// A checkpoint is data an author can get wrong just as easily as any
    /// other content file: nothing stops a manifest from naming a command id
    /// the scenario never declares.
    /// </summary>
    [Fact]
    public void Resolve_FailsWhenCommandIdIsNotInScenario()
    {
        var manifest = new ScenarioManifest(
            1,
            "gate0",
            ScenarioOutcomeKind.Success,
            Fault: null,
            ExpectedErrorCode: null,
            Checkpoints: ImmutableArray.Create(new Checkpoint("orphan", 99)));
        var commands = TwoCommands();

        var exception = Assert.Throws<InvalidDataException>(
            () => CheckpointResolver.Resolve(manifest, commands, "orphan"));

        Assert.Contains("99", exception.Message, StringComparison.Ordinal);
    }

    /// <summary>
    /// The owner ruling this test exists to pin down: a checkpoint's slice of
    /// commands includes the boundary command rather than stopping right
    /// before it. Left ambiguous, this would be decided silently, and
    /// differently, by every caller that has to slice a command list.
    /// </summary>
    [Fact]
    public void Resolve_IncludesBoundaryCommand()
    {
        var manifest = ManifestWithTwoCheckpoints();
        var commands = TwoCommands();

        var checkpoint = CheckpointResolver.Resolve(manifest, commands, "second");
        var slice = CheckpointResolver.CommandsUpTo(commands, checkpoint);

        Assert.Equal(2, slice.Length);
        Assert.Equal(1, slice[0].CommandId);
        Assert.Equal(2, slice[1].CommandId);
    }

    /// <summary>
    /// The schema in <c>schemas/</c> is validated independently from
    /// <c>SchemaAgreementTests.AllContentFiles_SatisfyTheirSchema</c>: that
    /// test only walks the <c>content/</c> tree and picks a schema by
    /// top-level directory name, so it never sees <c>scenarios/*.manifest.json</c>
    /// on its own.
    /// </summary>
    [Fact]
    public void AllScenarioManifests_SatisfyTheirSchema()
    {
        var schema = JsonSchema.FromText(
            File.ReadAllText(System.IO.Path.Combine(RepositoryFixtures.SchemaRoot, "scenario-manifest.schema.json")));
        var options = new EvaluationOptions { OutputFormat = OutputFormat.List };

        var manifestPaths = Directory.GetFiles(RepositoryFixtures.ScenarioRoot, "*.manifest.json")
            .OrderBy(path => path, StringComparer.Ordinal)
            .ToList();

        Assert.Contains(manifestPaths, path => System.IO.Path.GetFileName(path) == "gate0.manifest.json");
        Assert.Contains(manifestPaths, path => System.IO.Path.GetFileName(path) == "content_error.manifest.json");

        foreach (var manifestPath in manifestPaths)
        {
            var instance = JsonNode.Parse(File.ReadAllText(manifestPath));
            var result = schema.Evaluate(instance, options);

            Assert.True(
                result.IsValid,
                $"Production manifest '{System.IO.Path.GetFileName(manifestPath)}' violates scenario-manifest.schema.json.");
        }

        // Positive control: a green run above must mean "checked and clean",
        // not "checked nothing" (spec §8.3) — the same idiom
        // AllContentFiles_SatisfyTheirSchema uses.
        using var invalid = TempManifest.Write("""
            {
              "schema_version": 1,
              "scenario": "broken",
              "expected_outcome": "success",
              "checkpoints": [{ "name": "x", "after_command_id": 1 }],
              "unexpected_field": true
            }
            """);

        var invalidInstance = JsonNode.Parse(File.ReadAllText(invalid.FullPath));
        var invalidResult = schema.Evaluate(invalidInstance, options);

        Assert.False(invalidResult.IsValid);
    }

    private static ScenarioManifest ManifestWithTwoCheckpoints() => new(
        1,
        "gate0",
        ScenarioOutcomeKind.Success,
        Fault: null,
        ExpectedErrorCode: null,
        Checkpoints: ImmutableArray.Create(
            new Checkpoint("first", 1),
            new Checkpoint("second", 2)));

    private static IReadOnlyList<ScenarioCommand> TwoCommands() => new List<ScenarioCommand>
    {
        new(1, HeroIndex: 0, ContentId.Parse("core:escort_the_caravan"), ExpectedStateVersion: 0),
        new(2, HeroIndex: 1, ContentId.Parse("core:escort_the_caravan"), ExpectedStateVersion: 1),
    };

    /// <summary>
    /// A single throwaway manifest file. Mirrors <see cref="TempContentRoot"/>'s
    /// reasoning at file scope: a negative-path manifest test writes one bad
    /// value without touching the production files in <c>scenarios/</c>.
    /// </summary>
    private sealed class TempManifest : IDisposable
    {
        private readonly string _directory;

        private TempManifest(string directory, string fullPath)
        {
            _directory = directory;
            FullPath = fullPath;
        }

        public string FullPath { get; }

        public static TempManifest Write(string json)
        {
            var directory = System.IO.Path.Combine(
                System.IO.Path.GetTempPath(), "oath-and-coin-tests", Guid.NewGuid().ToString("n"));
            Directory.CreateDirectory(directory);

            var fullPath = System.IO.Path.Combine(directory, "manifest.json");
            File.WriteAllText(fullPath, json);
            return new TempManifest(directory, fullPath);
        }

        public void Dispose()
        {
            try
            {
                if (Directory.Exists(_directory))
                {
                    Directory.Delete(_directory, recursive: true);
                }
            }
            catch (IOException)
            {
                // A leaked temp directory is not worth failing a green test over.
            }
        }
    }
}
