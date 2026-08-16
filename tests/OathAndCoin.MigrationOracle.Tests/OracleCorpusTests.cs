using System.Collections.Immutable;
using System.Globalization;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using OathAndCoin.Content;
using OathAndCoin.Content.Scenarios;
using OathAndCoin.Presentation;
using OathAndCoin.Simulation.Random;

namespace OathAndCoin.MigrationOracle.Tests;

/// <summary>
/// Holds the committed corpus under <c>migration/oracle/v1</c> to what this
/// build actually does.
/// </summary>
/// <remarks>
/// <para>
/// Two kinds of check live here, and the difference matters. The structural
/// ones (coverage, digests, line endings, declared versions) prove the corpus
/// is a complete, self-describing, byte-stable artifact. The reproduction ones
/// re-run the production loaders, rules and presentation factory and compare
/// what they produce against what the corpus says they produced — those are
/// the ones that go red when a decision magnitude or an RNG stream mapping is
/// mutated. A corpus checked only by digests would stay green through any
/// change to the rules it exists to describe: the files on disk would be
/// untouched and every hash of them would still match.
/// </para>
/// <para>
/// Nothing here goes through <c>tools/OathAndCoin.MigrationOracle</c>. The
/// exporter and this reader compose the same production calls independently,
/// so a mistake in the exporter's own composition shows up as a disagreement
/// rather than as a shared assumption.
/// </para>
/// </remarks>
public class OracleCorpusTests
{
    /// <summary>
    /// The shape version of every file in this corpus. Bumping it is how a
    /// change to the envelope is declared; it is not a version of the rules,
    /// which <c>ScenarioRunner.RulesetVersion</c> and
    /// <c>DeterminismArtifact.ArtifactVersion</c> already carry inside the
    /// canonical bytes.
    /// </summary>
    private const int ArtifactSchemaVersion = 1;

    /// <summary>
    /// The seed every scenario in the corpus is frozen at — the same one
    /// <c>ScenarioCoverageTests.EveryScenarioReplaysToItsCanonicalArtifact</c>
    /// replays under, so a corpus entry whose checkpoint covers the whole
    /// command list has to reproduce the committed
    /// <c>scenarios/&lt;scenario&gt;.canonical.json</c> byte for byte. Freezing
    /// the corpus at some other seed would have made it self-consistent and
    /// unrelated to the repository's own checked-in evidence.
    /// </summary>
    private const ulong CorpusSeed = 7UL;

    private static readonly string RepositoryRoot = Resolve("RepositoryRoot");

    private static readonly string OracleRoot = Resolve("OracleRoot");

    private static string ScenarioRoot => Path.Combine(RepositoryRoot, "scenarios");

    private static string ContentRoot => Path.Combine(RepositoryRoot, "content");

    private static string SchemaRoot => Path.Combine(RepositoryRoot, "schemas");

    // ---- structure -------------------------------------------------------

    [Fact]
    public void Manifest_DeclaresTheArtifactSchemaVersionAndTheCommitItFroze()
    {
        var manifest = ReadJson(Path.Combine(OracleRoot, "manifest.json"));

        Assert.Equal(ArtifactSchemaVersion, (int)manifest["artifact_schema_version"]!);

        var commit = (string)manifest["source_commit"]!;
        Assert.Equal(40, commit.Length);
        Assert.All(commit, character => Assert.True(
            "0123456789abcdef".Contains(character, StringComparison.Ordinal),
            $"source_commit must be lowercase hex, but holds '{character}'."));

        Assert.Equal(CorpusSeed.ToString(CultureInfo.InvariantCulture), (string)manifest["seed"]!);
    }

    /// <summary>
    /// Every <c>*.manifest.json</c> in the repository appears in the corpus —
    /// counted from the directory, never from a list someone has to remember
    /// to extend when a scenario is added.
    /// </summary>
    [Fact]
    public void Manifest_CoversEveryScenarioManifestInTheRepository()
    {
        var expected = RepositoryScenarioNames();
        var covered = CorpusScenarios().Select(scenario => (string)scenario["scenario"]!).ToImmutableSortedSet();

        Assert.Equal(expected, covered);
    }

    [Fact]
    public void Manifest_CoversEveryNamedCheckpointAndPointsAtAnEntryThatExists()
    {
        foreach (var scenario in CorpusScenarios())
        {
            var name = (string)scenario["scenario"]!;
            var manifest = ScenarioManifest.Load(Path.Combine(ScenarioRoot, $"{name}.manifest.json"));

            var declared = manifest.Checkpoints.Select(checkpoint => checkpoint.Name).ToImmutableSortedSet();
            var covered = scenario["checkpoints"]!.AsArray()
                .Select(checkpoint => (string)checkpoint!["checkpoint"]!)
                .ToImmutableSortedSet();

            Assert.Equal(declared, covered);
            Assert.NotEmpty(covered);

            foreach (var checkpoint in scenario["checkpoints"]!.AsArray())
            {
                var entry = (string)checkpoint!["path"]!;
                Assert.True(
                    File.Exists(Path.Combine(OracleRoot, entry)),
                    $"Corpus manifest points at '{entry}', which does not exist.");
            }
        }
    }

    [Fact]
    public void EveryEntry_CarriesEveryFieldTheCorpusPromises()
    {
        foreach (var (scenario, checkpoint, entry) in Entries())
        {
            var where = $"{scenario}/{checkpoint}";

            foreach (var field in new[]
                     {
                         "artifact_schema_version", "source_commit", "scenario", "checkpoint", "seed", "inputs",
                         "outcome", "final_state", "steps", "events", "traces", "draws", "read_model",
                         "canonical_base64", "canonical_sha256",
                     })
            {
                Assert.True(
                    entry.ContainsKey(field), $"Corpus entry {where} has no '{field}'.");
            }

            Assert.Equal(ArtifactSchemaVersion, (int)entry["artifact_schema_version"]!);
            Assert.Equal(scenario, (string)entry["scenario"]!);
            Assert.Equal(checkpoint, (string)entry["checkpoint"]!);

            var inputs = entry["inputs"]!;
            Assert.NotNull(inputs["manifest"]);
            Assert.NotNull(inputs["commands"]);
            Assert.NotNull(inputs["schema_root"]);

            var outcome = entry["outcome"]!;
            Assert.Contains((string)outcome["kind"]!, new[] { "success", "error", "loading" });
            Assert.NotNull(outcome["screen_state"]);

            var readModel = entry["read_model"]!;
            Assert.NotNull(readModel["state"]);
            Assert.NotNull(readModel["sha256"]);

            // A run that produced no ScenarioOutcome has no canonical bytes,
            // and says so with an explicit null rather than by leaving the key
            // out: a reader must be able to tell "this run had none" from
            // "this corpus forgot to write one".
            var ran = (string)outcome["kind"]! == "success";
            Assert.Equal(ran, entry["final_state"] is not null);
            Assert.Equal(ran, entry["canonical_base64"] is not null);
            Assert.Equal(ran, entry["canonical_sha256"] is not null);
        }
    }

    [Fact]
    public void EveryFileDigestInTheManifest_MatchesTheBytesOnDisk()
    {
        var manifest = ReadJson(Path.Combine(OracleRoot, "manifest.json"));

        foreach (var file in manifest["files"]!.AsArray())
        {
            var relative = (string)file!["path"]!;
            var path = Path.Combine(OracleRoot, relative);

            Assert.True(File.Exists(path), $"Corpus manifest lists '{relative}', which does not exist.");
            Assert.Equal((string)file["sha256"]!, Sha256Hex(File.ReadAllBytes(path)));
        }
    }

    /// <summary>
    /// The other direction of the same claim. Without it a file could be added
    /// to the corpus, be read by nothing, be covered by no digest, and drift
    /// unnoticed — the manifest would still be internally consistent.
    /// </summary>
    [Fact]
    public void EveryFileUnderTheCorpus_IsCoveredByADigest()
    {
        var manifest = ReadJson(Path.Combine(OracleRoot, "manifest.json"));
        var listed = manifest["files"]!.AsArray()
            .Select(file => (string)file!["path"]!)
            .ToImmutableSortedSet(StringComparer.Ordinal);

        var onDisk = Directory
            .GetFiles(OracleRoot, "*", SearchOption.AllDirectories)
            .Select(path => Path.GetRelativePath(OracleRoot, path).Replace('\\', '/'))

            // The manifest is the one file that cannot carry its own digest.
            .Where(path => path != "manifest.json")
            .ToImmutableSortedSet(StringComparer.Ordinal);

        Assert.Equal(onDisk, listed);
    }

    /// <summary>
    /// The corpus's line-ending contract, read from the bytes rather than
    /// inferred from <c>.gitattributes</c>: a digest is over bytes, and a
    /// checkout that turned LF into CRLF would invalidate every digest in the
    /// manifest at once.
    /// </summary>
    [Fact]
    public void NoFileInTheCorpus_ContainsACarriageReturn()
    {
        // Every file, not only the JSON ones: the manifest digests all of them,
        // so the README is as much a part of the byte contract as an envelope.
        foreach (var path in Directory.GetFiles(OracleRoot, "*", SearchOption.AllDirectories))
        {
            var bytes = File.ReadAllBytes(path);
            var index = Array.IndexOf(bytes, (byte)0x0D);

            Assert.True(
                index < 0,
                $"'{Path.GetRelativePath(OracleRoot, path)}' contains 0x0D at byte {index}. The corpus is "
                + "compared byte for byte across machines; a carriage return makes every digest over it "
                + "machine-dependent.");
        }
    }

    // ---- reproduction ----------------------------------------------------

    /// <summary>
    /// The check a mutated decision magnitude has to fail: the corpus's
    /// canonical bytes are re-derived from the production rules and compared,
    /// not merely re-hashed from disk.
    /// </summary>
    [Fact]
    public void EveryEntry_ReproducesTheCanonicalArtifactThisBuildProduces()
    {
        foreach (var (scenario, checkpoint, entry) in Entries())
        {
            var reproduced = Reproduce(scenario, checkpoint);
            if (reproduced.Outcome is null)
            {
                Assert.Null(entry["canonical_sha256"]);
                continue;
            }

            var canonical = DeterminismArtifact.ToCanonicalJson(reproduced.Outcome);

            Assert.Equal(
                canonical,
                Encoding.UTF8.GetString(Convert.FromBase64String((string)entry["canonical_base64"]!)));
            Assert.Equal(DeterminismArtifact.Hash(reproduced.Outcome), (string)entry["canonical_sha256"]!);

            // The three fields the plan asks for by name are lifted out of the
            // canonical artifact rather than projected a second time, so this
            // proves the corpus did the lifting rather than inventing a shape.
            var artifact = JsonNode.Parse(canonical)!;
            Assert.Equal(artifact["final_state"]!.ToJsonString(), entry["final_state"]!.ToJsonString());
            Assert.Equal(artifact["steps"]!.ToJsonString(), entry["steps"]!.ToJsonString());
            Assert.Equal(
                artifact["final_state"]!["traces"]!.ToJsonString(), entry["traces"]!.ToJsonString());

            var events = new JsonArray(artifact["steps"]!.AsArray()
                .SelectMany(step => step!["events"]!.AsArray())
                .Select(domainEvent => JsonNode.Parse(domainEvent!.ToJsonString()))
                .ToArray());
            Assert.Equal(events.ToJsonString(), entry["events"]!.ToJsonString());
        }
    }

    [Fact]
    public void EveryEntry_ReproducesTheReadModelThisBuildProduces()
    {
        foreach (var (scenario, checkpoint, entry) in Entries())
        {
            var model = Reproduce(scenario, checkpoint).Model;
            var readModel = entry["read_model"]!;

            Assert.Equal(model.State.ToString(), (string)readModel["state"]!);
            Assert.Equal(model.TitleKey, (string)readModel["title_key"]!);
            Assert.Equal(model.ErrorCode, (string?)readModel["error_code"]);
            Assert.Equal(model.Roster.Length, readModel["roster"]!.AsArray().Count);
            Assert.Equal(model.Responses.Length, readModel["responses"]!.AsArray().Count);
            Assert.Equal(
                ContractOfferScreenModelFactory.ReadModelHash(model), (string)readModel["sha256"]!);
        }
    }

    /// <summary>
    /// The corpus states the outcome and screen state its own manifest
    /// declares. Without this a corpus could faithfully record a run that had
    /// quietly stopped demonstrating what its scenario is named after.
    /// </summary>
    [Fact]
    public void EveryEntry_StatesTheOutcomeAndScreenStateItsManifestDeclares()
    {
        foreach (var (scenario, checkpoint, entry) in Entries())
        {
            var manifest = ScenarioManifest.Load(Path.Combine(ScenarioRoot, $"{scenario}.manifest.json"));
            var outcome = entry["outcome"]!;

            Assert.Equal(manifest.ExpectedOutcome.ToString().ToLowerInvariant(), (string)outcome["kind"]!);
            Assert.Equal(manifest.ExpectedErrorCode, (string?)outcome["error_code"]);

            if (manifest.ExpectedScreenState is { } expected)
            {
                Assert.Equal(expected, (string)outcome["screen_state"]!);
            }

            Assert.Equal(
                Reproduce(scenario, checkpoint).Model.State.ToString().ToLowerInvariant(),
                (string)outcome["screen_state"]!);
        }
    }

    /// <summary>
    /// The corpus meets the repository's own checked-in evidence: an entry
    /// whose checkpoint covers the whole command list must decode to exactly
    /// the committed <c>scenarios/&lt;scenario&gt;.canonical.json</c>.
    /// <c>screen_incomplete</c> is the one scenario this cannot hold for — its
    /// checkpoint stops after the first of six commands on purpose — and it is
    /// asserted to differ rather than skipped, so a checkpoint that silently
    /// started covering everything would be noticed.
    /// </summary>
    [Fact]
    public void EntriesThatReplayTheWholeCommandList_MatchTheCommittedCanonicalArtifact()
    {
        var partial = 0;

        foreach (var (scenario, checkpoint, entry) in Entries())
        {
            var committed = Path.Combine(ScenarioRoot, $"{scenario}.canonical.json");
            if (!File.Exists(committed))
            {
                continue;
            }

            var commands = ScenarioCommands.Load(Path.Combine(ScenarioRoot, $"{scenario}.commands.json"));
            var manifest = ScenarioManifest.Load(Path.Combine(ScenarioRoot, $"{scenario}.manifest.json"));
            var resolved = CheckpointResolver.Resolve(manifest, commands, checkpoint);
            var replayed = Encoding.UTF8.GetString(Convert.FromBase64String((string)entry["canonical_base64"]!));

            if (CheckpointResolver.CommandsUpTo(commands, resolved).Length == commands.Count)
            {
                Assert.Equal(File.ReadAllText(committed), replayed);
            }
            else
            {
                partial++;
                Assert.NotEqual(File.ReadAllText(committed), replayed);
            }
        }

        Assert.Equal(1, partial);
    }

    [Fact]
    public void DrawsPerStep_MatchTheOrdinalsThisBuildConsumes()
    {
        foreach (var (scenario, checkpoint, entry) in Entries())
        {
            var reproduced = Reproduce(scenario, checkpoint);
            var draws = entry["draws"]!;

            if (reproduced.Outcome is null)
            {
                Assert.Equal("0", (string)draws["total_consumed"]!);
                Assert.Empty(draws["per_step"]!.AsArray());
                continue;
            }

            var final = reproduced.Outcome.FinalState.Metadata.NextDecisionOrdinal;
            Assert.Equal(final.ToString(CultureInfo.InvariantCulture), (string)draws["next_decision_ordinal_final"]!);
            Assert.Equal(final.ToString(CultureInfo.InvariantCulture), (string)draws["total_consumed"]!);

            var perStep = draws["per_step"]!.AsArray();
            Assert.Equal(reproduced.Outcome.Steps.Length, perStep.Count);

            var consumed = perStep.Aggregate(
                0UL, (total, step) => total + ulong.Parse((string)step!["consumed"]!, CultureInfo.InvariantCulture));
            Assert.Equal(final, consumed);

            for (var index = 0; index < perStep.Count; index++)
            {
                Assert.Equal(
                    reproduced.Outcome.Steps[index].Command.CommandId,
                    (long)perStep[index]!["command_id"]!);
            }
        }
    }

    // ---- RNG vectors -----------------------------------------------------

    /// <summary>
    /// The check a mutated RNG stream mapping has to fail. Every row is
    /// re-drawn from <see cref="DeterministicRng"/> and compared to what the
    /// corpus recorded — values and ordinals both, because a rejection burns
    /// an ordinal that a value alone cannot report.
    /// </summary>
    [Fact]
    public void RngVectors_ReproduceThisBuildsGenerator()
    {
        var vectors = ReadJson(Path.Combine(OracleRoot, "rng-vectors.json"));

        Assert.Equal(DeterministicRng.AlgorithmVersion, (string)vectors["algorithm_version"]!);

        foreach (var row in vectors["raw_draws"]!.AsArray())
        {
            var seed = ParseUInt64(row!["campaign_seed"]!);
            var stream = ParseStream(row["stream"]!);
            var ordinal = ParseUInt64(row["ordinal"]!);

            Assert.Equal(
                DeterministicRng.Draw(seed, stream, ordinal).ToString(CultureInfo.InvariantCulture),
                (string)row["value"]!);
        }

        foreach (var row in vectors["int32_draws"]!.AsArray())
        {
            var draw = DeterministicRng.DrawInt32(
                ParseUInt64(row!["campaign_seed"]!),
                ParseStream(row["stream"]!),
                ParseUInt64(row["ordinal"]!),
                (int)row["min_inclusive"]!,
                (int)row["max_exclusive"]!);

            Assert.Equal(draw.Value, (int)row["value"]!);
            Assert.Equal(
                draw.OrdinalsConsumed.ToString(CultureInfo.InvariantCulture),
                (string)row["ordinals_consumed"]!);
        }
    }

    [Fact]
    public void RngVectors_CoverEveryStreamAndTheProductionMoodRange()
    {
        var vectors = ReadJson(Path.Combine(OracleRoot, "rng-vectors.json"));

        var declared = vectors["streams"]!.AsArray()
            .Select(stream => (string)stream!["name"]!)
            .ToImmutableSortedSet(StringComparer.Ordinal);
        Assert.Equal(Enum.GetNames<RngStream>().ToImmutableSortedSet(StringComparer.Ordinal), declared);

        foreach (var stream in vectors["streams"]!.AsArray())
        {
            Assert.Equal(
                (int)Enum.Parse<RngStream>((string)stream!["name"]!), (int)stream["value"]!);
        }

        var drawnStreams = vectors["raw_draws"]!.AsArray()
            .Select(row => (string)row!["stream"]!)
            .ToImmutableSortedSet(StringComparer.Ordinal);
        Assert.Equal(declared, drawnStreams);

        // The only range the production rules actually draw on today
        // (ContractDecisionRule.MoodMin..MoodMax + 1). A vector set that
        // covered every stream but not this range would prove the generator
        // and miss the one call the game makes.
        Assert.Contains(
            vectors["int32_draws"]!.AsArray(),
            row => (int)row!["min_inclusive"]! == -5
                && (int)row["max_exclusive"]! == 6
                && (string)row["stream"]! == nameof(RngStream.HeroDecision));
    }

    /// <summary>
    /// The corpus carries the cases the simulation's own golden fixture
    /// already froze, so deleting that fixture with the C# tree does not
    /// delete the evidence it held.
    /// </summary>
    [Fact]
    public void RngVectors_CarryEveryCaseFromTheSimulationsGoldenFixture()
    {
        var golden = ReadJson(Path.Combine(
            RepositoryRoot, "tests", "OathAndCoin.Simulation.Tests", "Fixtures", "rng-golden.json"));

        var seed = ((ulong)(long)golden["campaignSeed"]!).ToString(CultureInfo.InvariantCulture);
        var stream = (string)golden["stream"]!;
        var values = golden["values"]!.AsArray();

        var rows = ReadJson(Path.Combine(OracleRoot, "rng-vectors.json"))["raw_draws"]!.AsArray();

        for (var ordinal = 0; ordinal < values.Count; ordinal++)
        {
            var expected = values[ordinal]!.ToJsonString();
            var at = ordinal.ToString(CultureInfo.InvariantCulture);

            Assert.Contains(
                rows,
                row => (string)row!["campaign_seed"]! == seed
                    && (string)row["stream"]! == stream
                    && (string)row["ordinal"]! == at
                    && (string)row["value"]! == expected);
        }
    }

    // ---- canonicalization vectors ---------------------------------------

    [Fact]
    public void JcsVectors_ReproduceThisBuildsCanonicalSerializer()
    {
        var vectors = ReadJson(Path.Combine(OracleRoot, "jcs-compatibility-vectors.json"));

        Assert.Equal(ArtifactSchemaVersion, (int)vectors["artifact_schema_version"]!);
        Assert.NotEmpty(vectors["vectors"]!.AsArray());

        foreach (var vector in vectors["vectors"]!.AsArray())
        {
            var current = vector!["current"]!;
            var bytes = Convert.FromBase64String((string)current["canonical_base64"]!);

            Assert.Equal(Sha256Hex(bytes), (string)current["sha256"]!);
            Assert.Equal(
                CanonicalBytesOf(vector["input"]!.ToJsonString()),
                bytes);
        }
    }

    /// <summary>
    /// The difference between the serializer this build ships and RFC 8785 is
    /// stated per vector, never averaged away: an entry claiming the two agree
    /// has to actually carry identical bytes, and one claiming they differ has
    /// to actually differ. Silently rewriting old evidence to the new shape is
    /// what this rules out.
    /// </summary>
    [Fact]
    public void JcsVectors_StateTheDifferenceFromRfc8785Honestly()
    {
        var vectors = ReadJson(Path.Combine(OracleRoot, "jcs-compatibility-vectors.json"));

        var divergent = 0;

        foreach (var vector in vectors["vectors"]!.AsArray())
        {
            var current = (string)vector!["current"]!["canonical_base64"]!;
            var target = (string)vector["rfc8785"]!["canonical_base64"]!;
            var same = (bool)vector["same_artifact_version"]!;

            Assert.Equal(same, string.Equals(current, target, StringComparison.Ordinal));

            Assert.Equal(
                Sha256Hex(Convert.FromBase64String(target)), (string)vector["rfc8785"]!["sha256"]!);

            if (!same)
            {
                divergent++;
                Assert.False(
                    string.IsNullOrWhiteSpace((string?)vector["difference"]),
                    "A vector whose canonical output differs from RFC 8785 must name the difference.");
            }
        }

        // A vector set in which nothing ever diverges would prove only that it
        // avoided the cases where the two disagree.
        Assert.True(divergent > 0, "No vector exercises a case where this build's output differs from RFC 8785.");
    }

    [Fact]
    public void CorpusCanonicalBytes_AreProducedByTheCurrentSerializer()
    {
        var vectors = ReadJson(Path.Combine(OracleRoot, "jcs-compatibility-vectors.json"));

        // The corpus's own canonical bytes are written by the serializer this
        // build ships, so the version they are readable under is the one the
        // vectors describe as "current" — stated in the file rather than left
        // for a reader of the TypeScript port to infer.
        Assert.Equal(
            DeterminismArtifact.ArtifactVersion, (int)vectors["determinism_artifact_version"]!);
        Assert.Equal(ScenarioRunner.RulesetVersion, (string)vectors["ruleset_version"]!);
    }

    // ---- helpers ---------------------------------------------------------

    /// <summary>
    /// What one corpus entry describes, rebuilt from production code alone:
    /// the run's outcome (null when the scenario never produced one) and the
    /// screen the presentation factory builds from it.
    /// </summary>
    private sealed record Reproduction(ScenarioOutcome? Outcome, ContractOfferScreenModel Model);

    /// <summary>
    /// The game's own load sequence (<c>game/app/Main.cs</c>,
    /// <c>LoadModel</c>), composed here from the same public production calls:
    /// manifest, checkpoint, the loading short-circuit, the content root, the
    /// schema stage, the content set, the run, the factory. Composed rather
    /// than called into because the game is a Godot process; nothing about the
    /// rules is restated.
    /// </summary>
    private static Reproduction Reproduce(string scenario, string checkpointName)
    {
        var manifest = ScenarioManifest.Load(Path.Combine(ScenarioRoot, $"{scenario}.manifest.json"));

        var commandsPath = Path.Combine(ScenarioRoot, $"{scenario}.commands.json");
        var commands = File.Exists(commandsPath)
            ? ScenarioCommands.Load(commandsPath)
            : Array.Empty<ScenarioCommand>();

        var checkpoint = CheckpointResolver.Resolve(manifest, commands, checkpointName);

        if (manifest.ExpectedOutcome == ScenarioOutcomeKind.Loading)
        {
            return new Reproduction(null, ContractOfferScreenModelFactory.Loading);
        }

        var contentRoot = ContentRootFor(manifest);
        if (!Directory.Exists(contentRoot))
        {
            return new Reproduction(
                null,
                ContractOfferScreenModelFactory.FromOutcome(
                    (ErrorCodes.ContentRootNotFound, $"Content root '{contentRoot}' does not exist.")));
        }

        ContentSchemas.Load(SchemaRoot).ValidateOrThrow(contentRoot);

        var outcome = ScenarioRunner.Run(
            ContentSet.Load(contentRoot),
            CheckpointResolver.CommandsUpTo(commands, checkpoint),
            CorpusSeed);

        return new Reproduction(outcome, ContractOfferScreenModelFactory.FromOutcome(outcome));
    }

    /// <summary>
    /// The content root a scenario reads from: its own override, the
    /// repository's tree, or — for a manifest that injects one — a root the
    /// fault says is missing. Read from the fault's own <c>kind</c> and
    /// <c>path</c>, never from the scenario's name, for the reason
    /// <c>SmokeRun.Expectation</c> already records: recognising a scenario by
    /// name would agree with a manifest whose fault was never reproduced.
    /// </summary>
    private static string ContentRootFor(ScenarioManifest manifest)
    {
        if (manifest.ContentRoot is { } overrideRoot)
        {
            return Path.GetFullPath(Path.Combine(RepositoryRoot, overrideRoot));
        }

        return manifest.Fault switch
        {
            null => ContentRoot,
            { Kind: "missing_content_root" } fault => Path.GetFullPath(
                Path.Combine(RepositoryRoot, "artifacts", "oracle-faults", fault.Path)),
            var fault => throw new InvalidOperationException(
                $"Scenario fault kind '{fault.Kind}' has no reproduction here. Add one — a reader that "
                + "skips the fault it was told to reproduce validates the corpus against the wrong screen."),
        };
    }

    private static ImmutableSortedSet<string> RepositoryScenarioNames() =>
        Directory.GetFiles(ScenarioRoot, "*.manifest.json")
            .Select(path => Path.GetFileName(path).Split('.')[0])
            .ToImmutableSortedSet(StringComparer.Ordinal);

    private static IEnumerable<JsonNode> CorpusScenarios() =>
        ReadJson(Path.Combine(OracleRoot, "manifest.json"))["scenarios"]!.AsArray()
            .Select(scenario => scenario!);

    private static IEnumerable<(string Scenario, string Checkpoint, JsonObject Entry)> Entries()
    {
        foreach (var scenario in CorpusScenarios())
        {
            foreach (var checkpoint in scenario["checkpoints"]!.AsArray())
            {
                yield return (
                    (string)scenario["scenario"]!,
                    (string)checkpoint!["checkpoint"]!,
                    ReadJson(Path.Combine(OracleRoot, (string)checkpoint["path"]!)));
            }
        }
    }

    private static JsonObject ReadJson(string path) =>
        JsonNode.Parse(File.ReadAllText(path))!.AsObject();

    private static byte[] CanonicalBytesOf(string json)
    {
        using var stream = new MemoryStream();
        using (var writer = new System.Text.Json.Utf8JsonWriter(
                   stream, new System.Text.Json.JsonWriterOptions { Indented = false, SkipValidation = false }))
        {
            CanonicalJson.Write(JsonNode.Parse(json), writer);
        }

        return stream.ToArray();
    }

    private static ulong ParseUInt64(JsonNode node) =>
        ulong.Parse((string)node!, CultureInfo.InvariantCulture);

    private static RngStream ParseStream(JsonNode node) => Enum.Parse<RngStream>((string)node!);

    private static string Sha256Hex(byte[] bytes) =>
        Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();

    private static string Resolve(string key)
    {
        var value = typeof(OracleCorpusTests).Assembly
            .GetCustomAttributes<AssemblyMetadataAttribute>()
            .SingleOrDefault(attribute => attribute.Key == key)
            ?.Value ?? throw new InvalidOperationException(
                $"Assembly metadata '{key}' is missing; it is written by this project's .csproj.");

        return Path.GetFullPath(value);
    }
}
