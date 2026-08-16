using System.Collections.Immutable;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using OathAndCoin.Content;
using OathAndCoin.Content.Scenarios;
using OathAndCoin.Simulation.Random;

namespace OathAndCoin.MigrationOracle;

/// <summary>
/// Writes the immutable migration oracle: the observable behaviour of this C#
/// build, frozen as data that outlives the code producing it.
/// </summary>
/// <remarks>
/// <para>
/// Read-only with respect to the repository. It loads content, scenarios and
/// schemas, runs the production rules and the production presentation factory,
/// and writes only under <c>--output</c>.
/// </para>
/// <para>
/// Exit codes are part of the interface, for the same reason
/// <c>OathAndCoin.SimulationRunner</c> states its own: <c>0</c> the export
/// completed, <c>1</c> the data was wrong (bad content, bad scenario, a run
/// that did not reproduce the screen its manifest declares), <c>2</c> the
/// arguments were wrong.
/// </para>
/// </remarks>
public static class Program
{
    private const int ExitSuccess = 0;
    private const int ExitDataError = 1;
    private const int ExitArgumentError = 2;

    /// <summary>
    /// The commit whose behaviour this corpus describes — the migration
    /// baseline, merge of PR #9.
    /// </summary>
    /// <remarks>
    /// A constant rather than <c>git rev-parse HEAD</c>, deliberately. The
    /// corpus has to re-export byte-for-byte identically so that
    /// <c>git diff --exit-code</c> proves the exporter is deterministic; a
    /// commit read from the working tree would change the moment the corpus
    /// itself was committed, and every later export would differ for a reason
    /// that has nothing to do with behaviour. The commit is also a claim about
    /// which rules were frozen, and that claim does not become false when
    /// someone runs the exporter again on a later commit — what would become
    /// false is the corpus content, which is exactly what the byte comparison
    /// and the reproduction tests catch.
    /// </remarks>
    private const string SourceCommit = "12565862b1e88e0524f95def18c023571ec4269f";

    /// <summary>
    /// What a corpus manifest names as its generator. Also the marker
    /// <see cref="RequireCorpusTarget"/> refuses to overwrite a directory
    /// without.
    /// </summary>
    private const string GeneratedBy = "tools/OathAndCoin.MigrationOracle";

    private static readonly UTF8Encoding Utf8NoBom = new(encoderShouldEmitUTF8Identifier: false);

    private static readonly JsonWriterOptions WriterOptions = new()
    {
        Indented = true,
        SkipValidation = false,
    };

    public static int Main(string[] args)
    {
        string root;
        string output;

        try
        {
            (root, output) = ParseExport(args);
        }
        catch (ArgumentException exception)
        {
            Console.Error.WriteLine(exception.Message);
            return ExitArgumentError;
        }

        try
        {
            var written = Export(root, output);
            Console.Out.Write($"oracle: {written} files under {output}\n");
            return ExitSuccess;
        }
        catch (InvalidDataException exception)
        {
            Console.Error.WriteLine(exception.Message);
            return ExitDataError;
        }
    }

    private static (string Root, string Output) ParseExport(string[] args)
    {
        if (args.Length == 0 || args[0] != "export")
        {
            throw new ArgumentException(
                "usage: export --root <repository-root> --output <corpus-directory>");
        }

        string? root = null;
        string? output = null;

        for (var index = 1; index < args.Length; index += 2)
        {
            if (index + 1 >= args.Length)
            {
                throw new ArgumentException($"Argument '{args[index]}' has no value.");
            }

            switch (args[index])
            {
                case "--root":
                    root = args[index + 1];
                    break;
                case "--output":
                    output = args[index + 1];
                    break;
                default:
                    throw new ArgumentException($"Unknown argument '{args[index]}'.");
            }
        }

        if (root is null || output is null)
        {
            throw new ArgumentException("Both '--root' and '--output' are required.");
        }

        return (Path.GetFullPath(root), Path.GetFullPath(output));
    }

    /// <summary>
    /// Exports into a staging directory beside <paramref name="output"/> and
    /// replaces the target only once the whole export succeeded.
    /// </summary>
    /// <remarks>
    /// External review finding (blocker). This used to delete a fixed list of
    /// names directly inside <c>--output</c>, with a comment claiming that
    /// deleting by name rather than wiping a directory made a typo harmless.
    /// It did not: the list contains <c>scenarios</c>, and
    /// <c>--output .</c> would therefore have deleted the repository's own
    /// <c>scenarios/</c> tree — all 27 manifests, every command file and every
    /// committed canonical artifact — before failing. Staging removes the
    /// whole class: nothing under <paramref name="output"/> is touched until
    /// there is a complete corpus to put there, and the target is refused
    /// outright unless it is empty or already a corpus this tool wrote. It
    /// also fixes the quieter half of the same finding — a stray file left in
    /// the output directory used to survive an export and be digested into the
    /// manifest, making the corpus depend on leftovers.
    /// </remarks>
    private static int Export(string root, string output)
    {
        var scenarioRoot = Path.Combine(root, "scenarios");
        if (!Directory.Exists(scenarioRoot))
        {
            throw new InvalidDataException($"Scenario directory '{scenarioRoot}' does not exist.");
        }

        RequireCorpusTarget(output);

        var staging = output + ".staging";
        if (Directory.Exists(staging))
        {
            Directory.Delete(staging, recursive: true);
        }

        try
        {
            var written = Fill(root, staging);

            if (Directory.Exists(output))
            {
                Directory.Delete(output, recursive: true);
            }

            Directory.Move(staging, output);
            return written;
        }
        finally
        {
            if (Directory.Exists(staging))
            {
                Directory.Delete(staging, recursive: true);
            }
        }
    }

    /// <summary>
    /// Refuses any target that is neither empty nor a corpus this tool wrote.
    /// The marker is the manifest's own <c>generated_by</c>, because a
    /// directory that merely happens to contain a <c>manifest.json</c> is not
    /// evidence of anything.
    /// </summary>
    private static void RequireCorpusTarget(string output)
    {
        if (!Directory.Exists(output) || Directory.GetFileSystemEntries(output).Length == 0)
        {
            return;
        }

        var manifestPath = Path.Combine(output, "manifest.json");
        var generatedBy = File.Exists(manifestPath)
            ? (string?)JsonNode.Parse(File.ReadAllText(manifestPath))?["generated_by"]
            : null;

        if (generatedBy == GeneratedBy)
        {
            return;
        }

        throw new InvalidDataException(
            $"'{output}' is not empty and does not hold a corpus written by {GeneratedBy}: its "
            + "manifest.json is missing or names a different generator. Refusing to replace it — point "
            + "'--output' at the corpus directory, not at a tree that happens to be nearby.");
    }

    private static int Fill(string root, string output)
    {
        var scenarioRoot = Path.Combine(root, "scenarios");

        var manifests = Directory
            .GetFiles(scenarioRoot, "*.manifest.json")
            .OrderBy(path => path, StringComparer.Ordinal)
            .Select(ScenarioManifest.Load)
            .ToImmutableArray();

        if (manifests.IsEmpty)
        {
            // Exporting nothing and calling it a corpus would satisfy every
            // digest check forever — the same failure `code-lines.sh` guards
            // against when it refuses to count zero files.
            throw new InvalidDataException($"No scenario manifests found under '{scenarioRoot}'.");
        }

        var scenarios = new JsonArray();

        foreach (var manifest in manifests)
        {
            var checkpoints = new JsonArray();

            foreach (var checkpoint in manifest.Checkpoints)
            {
                var entries = new JsonArray();

                // The seed is part of an entry's identity, not a constant of
                // the corpus — see OracleEnvelope.Seeds for the mutant that
                // made that necessary.
                foreach (var seed in OracleEnvelope.Seeds)
                {
                    var entry = OracleEnvelope.Build(root, SourceCommit, manifest, checkpoint, seed);
                    var relative =
                        $"scenarios/{entry.Scenario}/{entry.Checkpoint}/seed-{Text(entry.Seed)}.json";

                    WriteJson(Path.Combine(output, ToNativePath(relative)), entry.Envelope);

                    entries.Add(new JsonObject
                    {
                        ["seed"] = Text(entry.Seed),
                        ["path"] = relative,
                    });
                }

                checkpoints.Add(new JsonObject
                {
                    ["checkpoint"] = checkpoint.Name,
                    ["after_command_id"] = checkpoint.AfterCommandId,
                    ["entries"] = entries,
                });
            }

            scenarios.Add(new JsonObject
            {
                ["scenario"] = manifest.Scenario,
                ["expected_outcome"] = manifest.ExpectedOutcome.ToString().ToLowerInvariant(),
                ["expected_screen_state"] = manifest.ExpectedScreenState,
                ["checkpoints"] = checkpoints,
            });
        }

        WriteJson(Path.Combine(output, "rng-vectors.json"), RngVectors.Build());
        WriteJson(Path.Combine(output, "jcs-compatibility-vectors.json"), JcsVectors.Build());
        WriteText(Path.Combine(output, "README.md"), Readme());

        WriteJson(Path.Combine(output, "manifest.json"), new JsonObject
        {
            ["artifact_schema_version"] = OracleEnvelope.ArtifactSchemaVersion,
            ["source_commit"] = SourceCommit,
            ["seeds"] = new JsonArray(OracleEnvelope.Seeds
                .Select(seed => (JsonNode?)Text(seed))
                .ToArray()),
            ["canonical_artifact_seed"] = Text(OracleEnvelope.CanonicalSeed),
            ["generated_by"] = GeneratedBy,
            ["ruleset_version"] = ScenarioRunner.RulesetVersion,
            ["determinism_artifact_version"] = DeterminismArtifact.ArtifactVersion,
            ["rng_algorithm"] = DeterministicRng.AlgorithmVersion,
            ["content_schema_version"] = ContentSet.SupportedContentSchemaVersion,
            ["manifest_schema_version"] = ScenarioManifest.SupportedManifestSchemaVersion,
            ["scenario_count"] = manifests.Length,
            ["scenarios"] = scenarios,
            ["files"] = Digests(output),
        });

        return Directory.GetFiles(output, "*", SearchOption.AllDirectories).Length;
    }

    private static string Text(ulong value) => value.ToString(CultureInfo.InvariantCulture);

    /// <summary>
    /// SHA-256 over the bytes of every file in the corpus except the manifest
    /// itself, which cannot carry its own digest. Sorted ordinally by the
    /// repository-relative POSIX path so two exports produce the same list in
    /// the same order on any filesystem.
    /// </summary>
    private static JsonArray Digests(string output)
    {
        var files = Directory
            .GetFiles(output, "*", SearchOption.AllDirectories)
            .Select(path => Path.GetRelativePath(output, path).Replace('\\', '/'))
            .Where(relative => relative != "manifest.json")
            .OrderBy(relative => relative, StringComparer.Ordinal);

        var digests = new JsonArray();

        foreach (var relative in files)
        {
            var bytes = File.ReadAllBytes(Path.Combine(output, ToNativePath(relative)));

            digests.Add(new JsonObject
            {
                ["path"] = relative,
                ["bytes"] = bytes.Length,
                ["sha256"] = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(),
            });
        }

        return digests;
    }

    private static string ToNativePath(string relative) =>
        relative.Replace('/', Path.DirectorySeparatorChar);

    /// <summary>
    /// Writes a node through the production canonicalizer, so the corpus obeys
    /// the same key-ordering rule every artifact in this repository already
    /// does, and indented, so a reviewer can actually read what is being
    /// frozen.
    /// </summary>
    private static void WriteJson(string path, JsonNode node)
    {
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream, WriterOptions))
        {
            CanonicalJson.Write(node, writer);
        }

        WriteText(path, Encoding.UTF8.GetString(stream.ToArray()) + "\n");
    }

    /// <summary>
    /// Writes UTF-8 without a BOM and with LF line endings, both explicitly.
    /// </summary>
    /// <remarks>
    /// The newline normalization is not trusted to the writer or to the host:
    /// every file here is covered by a SHA-256 in the corpus manifest, so a
    /// CRLF written on a Windows workstation would make the corpus fail its
    /// own digests on a Linux runner — and <c>.gitattributes</c> only fixes
    /// what the checkout does, not what this tool writes. A byte-order mark
    /// would be three more bytes of difference saying nothing about the
    /// simulation, the same reason <c>OathAndCoin.SimulationRunner</c> refuses
    /// one.
    /// </remarks>
    private static void WriteText(string path, string text)
    {
        var directory = Path.GetDirectoryName(path);
        if (!string.IsNullOrEmpty(directory))
        {
            Directory.CreateDirectory(directory);
        }

        var normalized = text.Replace("\r\n", "\n", StringComparison.Ordinal)
            .Replace("\r", "\n", StringComparison.Ordinal);

        File.WriteAllBytes(path, Utf8NoBom.GetBytes(normalized));
    }

    private static string Readme() =>
        $"""
        # Migration oracle corpus v1

        The observable behaviour of the Godot/C# implementation at commit
        `{SourceCommit}`, frozen as data.

        **Generated. Never edited by hand.** Every file here is written by
        `tools/OathAndCoin.MigrationOracle` and covered by a SHA-256 in
        `manifest.json`. To reproduce:

        ```powershell
        dotnet run --project tools/OathAndCoin.MigrationOracle -c Release -- export --root . --output migration/oracle/v1
        git diff --exit-code -- migration/oracle/v1
        ```

        The second command must print nothing. Changing a byte here requires an
        artifact-version bump and a recorded reason
        (`docs/production/FULL_TYPESCRIPT_MIGRATION.md`), because this corpus is
        what the TypeScript port is compared against — and it is what the
        behaviour of this build will still be provable from after the C# tree is
        deleted (`ADR-010`).

        ## Contents

        | File | What it freezes |
        |---|---|
        | `manifest.json` | Artifact schema version, source commit, seeds, per-file SHA-256, every scenario, checkpoint and entry |
        | `scenarios/<scenario>/<checkpoint>/seed-<seed>.json` | Inputs, outcome, final state, steps, events, traces, draws consumed, presentation read model, canonical bytes and hash |
        | `rng-vectors.json` | Every RNG stream, boundary seeds, ordinals around zero and both ends of the range, and the cases from the simulation's own golden fixture |
        | `jcs-compatibility-vectors.json` | Where this build's canonical JSON and RFC 8785 agree, and where they do not |

        ## Reading it

        - 64-bit values (seeds, ordinals, draws) are decimal **strings**: JSON's
          number type is an IEEE 754 double in every reader the port will use,
          and a value above 2^53 written as a number is silently rounded.
        - `final_state`, `steps`, `events` and `traces` are slices of the same
          canonical artifact `canonical_base64` holds, not a second projection.
        - `read_model` carries no `error_detail`: it holds a machine-specific
          path, which would make this corpus differ between the machine that
          generated it and the one validating it. The presentation factory's own
          hash excludes it for the same reason.
        - An entry with `outcome.kind` other than `success` has no
          `final_state` and no canonical bytes, and says so with explicit
          `null`s rather than by omitting the keys.
        - The seed is part of an entry's identity, not a constant of the
          corpus: every checkpoint is frozen at each seed in `manifest.json`'s
          `seeds`. Only entries at `canonical_artifact_seed` reproduce the
          repository's committed `scenarios/<scenario>.canonical.json`; a port
          that ignored the seed it was handed would match one of the two and
          fail the other.

        Validated by `tests/OathAndCoin.MigrationOracle.Tests`, which re-derives
        every fact here from the production loaders, rules and presentation
        factory instead of trusting the exporter that wrote it.

        """;
}
