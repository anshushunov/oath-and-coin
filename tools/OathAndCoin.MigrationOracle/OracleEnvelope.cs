using System.Collections.Immutable;
using System.Globalization;
using System.Text;
using System.Text.Json.Nodes;
using OathAndCoin.Content;
using OathAndCoin.Content.Scenarios;
using OathAndCoin.Presentation;

namespace OathAndCoin.MigrationOracle;

/// <summary>
/// One scenario checkpoint, frozen as data: what went in, what the run
/// produced, and the screen the presentation factory built from it.
/// </summary>
/// <remarks>
/// <para>
/// Everything here is produced by calling the production loaders, rules and
/// factory — <see cref="ScenarioManifest"/>, <see cref="ScenarioCommands"/>,
/// <see cref="CheckpointResolver"/>, <see cref="ContentSchemas"/>,
/// <see cref="ContentSet"/>, <see cref="ScenarioRunner"/>,
/// <see cref="DeterminismArtifact"/> and
/// <see cref="ContractOfferScreenModelFactory"/>. No decision, ranking,
/// ordering or tie-break is restated in this file. An oracle that computed its
/// own answer from a second implementation would freeze that implementation's
/// bugs and agree with the first one only by luck.
/// </para>
/// <para>
/// <c>final_state</c>, <c>steps</c>, <c>events</c> and <c>traces</c> are
/// <em>lifted out of</em> the canonical artifact rather than projected a
/// second time, so the envelope's readable fields and its
/// <c>canonical_base64</c> cannot disagree: they are the same bytes, sliced.
/// </para>
/// <para>
/// <see cref="ContractOfferScreenModel.ErrorDetail"/> is deliberately absent.
/// It carries a machine-specific path (see <c>game/app/Main.cs</c>'s
/// "Content root '…' does not exist."), which would make this corpus differ
/// between the workstation that generated it and the runner that validates it
/// — on an artifact whose entire contract is byte stability. The presentation
/// factory's own hash excludes it for the same reason.
/// </para>
/// </remarks>
internal static class OracleEnvelope
{
    /// <summary>
    /// The shape version of every file in this corpus. Independent of
    /// <see cref="DeterminismArtifact.ArtifactVersion"/> and
    /// <see cref="ScenarioRunner.RulesetVersion"/>, which describe the bytes
    /// this envelope carries rather than the envelope.
    /// </summary>
    internal const int ArtifactSchemaVersion = 1;

    /// <summary>
    /// The seed every entry whose checkpoint covers the whole command list
    /// reproduces the committed <c>scenarios/&lt;scenario&gt;.canonical.json</c>
    /// under — the one
    /// <c>ScenarioCoverageTests.EveryScenarioReplaysToItsCanonicalArtifact</c>
    /// already replays every scenario at. It makes the corpus meet the
    /// repository's own checked-in evidence instead of being a second,
    /// self-consistent island.
    /// </summary>
    internal const ulong CanonicalSeed = 7UL;

    /// <summary>
    /// The seed the live harness actually runs under
    /// (<c>OathAndCoin.Harness.CommandLine.DefaultSeed</c>) and the one the CI
    /// determinism replay uses.
    /// </summary>
    internal const ulong HarnessSeed = 424242UL;

    /// <summary>
    /// Every seed the corpus is frozen at.
    /// </summary>
    /// <remarks>
    /// Two, not one, and the reason is a hole a single seed leaves open.
    /// External review found it and a mutant confirmed it: replacing
    /// <c>ScenarioRunner.Run</c>'s <c>content.CreateInitialState(seed, …)</c>
    /// with a hard-coded <c>7UL</c> left every corpus test green, because
    /// every entry had been recorded at 7 and the RNG vectors prove the
    /// generator rather than its use. A port that ignored the seed it was
    /// handed would have matched the oracle perfectly. Today that mutant is
    /// caught by exactly one C# test — which is deleted at cutover, taking the
    /// guarantee with it. Freezing the same scenarios at a second seed makes
    /// the seed part of each entry's identity and closes it in the artifact
    /// that survives.
    /// </remarks>
    internal static readonly ImmutableArray<ulong> Seeds = ImmutableArray.Create(CanonicalSeed, HarnessSeed);

    /// <summary>What one checkpoint's export produced, at one seed.</summary>
    internal sealed record Entry(string Scenario, string Checkpoint, ulong Seed, JsonObject Envelope);

    internal static Entry Build(
        string repositoryRoot, string sourceCommit, ScenarioManifest manifest, Checkpoint checkpoint, ulong seed)
    {
        var scenarioRoot = Path.Combine(repositoryRoot, "scenarios");
        var schemaRoot = Path.Combine(repositoryRoot, "schemas");

        var commandsPath = Path.Combine(scenarioRoot, $"{manifest.Scenario}.commands.json");
        var allCommands = File.Exists(commandsPath)
            ? ScenarioCommands.Load(commandsPath)
            : Array.Empty<ScenarioCommand>();

        var replayed = CheckpointResolver.CommandsUpTo(allCommands, checkpoint);
        var contentRoot = ContentRootFor(repositoryRoot, manifest);

        var run = Execute(manifest, schemaRoot, contentRoot.Absolute, replayed, seed);

        // The tool's own self-check, and the reason it is here rather than in
        // a test: a corpus generated from a run that had quietly stopped
        // landing on the outcome its scenario names would be a wrong oracle
        // written confidently. `SmokeRun.Expectation.RequireReproduced` makes
        // the identical check for the identical reason.
        RequireReproduced(manifest, "error code", run.Model.ErrorCode, manifest.ExpectedErrorCode);
        if (manifest.ExpectedScreenState is { } expectedState)
        {
            RequireReproduced(
                manifest, "screen state", run.Model.State.ToString().ToLowerInvariant(), expectedState);
        }

        var envelope = new JsonObject
        {
            ["artifact_schema_version"] = ArtifactSchemaVersion,
            ["source_commit"] = sourceCommit,
            ["scenario"] = manifest.Scenario,
            ["checkpoint"] = checkpoint.Name,
            ["seed"] = Text(seed),
            ["inputs"] = Inputs(manifest, checkpoint, contentRoot, replayed, run),
            ["outcome"] = new JsonObject
            {
                ["kind"] = manifest.ExpectedOutcome.ToString().ToLowerInvariant(),
                ["error_code"] = run.Model.ErrorCode,
                ["screen_state"] = run.Model.State.ToString().ToLowerInvariant(),
            },
            ["read_model"] = ReadModel(run.Model),
        };

        if (run.Outcome is null)
        {
            envelope["final_state"] = null;
            envelope["steps"] = new JsonArray();
            envelope["events"] = new JsonArray();
            envelope["traces"] = new JsonArray();
            envelope["draws"] = new JsonObject
            {
                ["next_decision_ordinal_initial"] = Text(0UL),
                ["next_decision_ordinal_final"] = Text(0UL),
                ["total_consumed"] = Text(0UL),
                ["per_step"] = new JsonArray(),
            };
            envelope["canonical_base64"] = null;
            envelope["canonical_sha256"] = null;

            return new Entry(manifest.Scenario, checkpoint.Name, seed, envelope);
        }

        var canonical = DeterminismArtifact.ToCanonicalJson(run.Outcome);
        var artifact = JsonNode.Parse(canonical)!;

        envelope["final_state"] = Detach(artifact["final_state"]);
        envelope["steps"] = Detach(artifact["steps"]);
        envelope["traces"] = Detach(artifact["final_state"]!["traces"]);
        envelope["events"] = new JsonArray(artifact["steps"]!.AsArray()
            .SelectMany(step => step!["events"]!.AsArray())
            .Select(Detach)
            .ToArray());
        envelope["draws"] = Draws(run, replayed, seed);
        envelope["canonical_base64"] = Convert.ToBase64String(Encoding.UTF8.GetBytes(canonical));
        envelope["canonical_sha256"] = DeterminismArtifact.Hash(run.Outcome);

        return new Entry(manifest.Scenario, checkpoint.Name, seed, envelope);
    }

    /// <summary>
    /// The content root a scenario reads from, in both the form a run needs
    /// (absolute) and the form the corpus records (repository-relative, POSIX
    /// separators). The recorded form is deliberately not the absolute one:
    /// the machine that generated this corpus must not be visible in it.
    /// </summary>
    private static ContentRootChoice ContentRootFor(string repositoryRoot, ScenarioManifest manifest)
    {
        if (manifest.ContentRoot is { } overrideRoot)
        {
            return new ContentRootChoice(
                Path.GetFullPath(Path.Combine(repositoryRoot, overrideRoot)), overrideRoot.Replace('\\', '/'));
        }

        // Read from the fault's own kind and path, never from the scenario's
        // name: a tool that recognised `screen_error` by name would agree with
        // a manifest whose fault it had never actually reproduced — the one
        // thing this comparison exists to rule out (`SmokeRun.Expectation`).
        return manifest.Fault switch
        {
            null => new ContentRootChoice(Path.Combine(repositoryRoot, "content"), "content"),

            // Nothing is created: the fault is the absence itself. The root is
            // named under `artifacts/`, which is .gitignored, so a repository
            // that somehow grew this path would still not have it checked in.
            { Kind: "missing_content_root" } fault => new ContentRootChoice(
                Path.GetFullPath(Path.Combine(repositoryRoot, "artifacts", "oracle-faults", fault.Path)),
                $"artifacts/oracle-faults/{fault.Path.Replace('\\', '/')}"),

            var fault => throw new InvalidDataException(
                $"Scenario fault kind '{fault.Kind}' has no reproduction here. Add one — an exporter that "
                + "skips the fault it was told to reproduce freezes the wrong screen forever."),
        };
    }

    private sealed record ContentRootChoice(string Absolute, string Recorded);

    private sealed record Run(
        ScenarioOutcome? Outcome, ContractOfferScreenModel Model, ContentSet? Content, string? ContentVersion);

    /// <summary>
    /// The game's own load sequence (<c>game/app/Main.cs</c>,
    /// <c>LoadModel</c>), composed from the same public production calls in
    /// the same order: the loading short-circuit, the content root, schema
    /// stage 1, the content set, the run, the factory. Errors are data — a
    /// stable <see cref="ErrorCodes"/> value on the screen — not a failure of
    /// this tool.
    /// </summary>
    private static Run Execute(
        ScenarioManifest manifest,
        string schemaRoot,
        string contentRoot,
        ImmutableArray<ScenarioCommand> replayed,
        ulong seed)
    {
        if (manifest.ExpectedOutcome == ScenarioOutcomeKind.Loading)
        {
            return new Run(null, ContractOfferScreenModelFactory.Loading, null, null);
        }

        if (!Directory.Exists(contentRoot))
        {
            return new Run(
                null,
                ContractOfferScreenModelFactory.FromOutcome(
                    (ErrorCodes.ContentRootNotFound, $"Content root '{contentRoot}' does not exist.")),
                null,
                null);
        }

        try
        {
            ContentSchemas.Load(schemaRoot).ValidateOrThrow(contentRoot);
        }
        catch (InvalidDataException exception)
        {
            return new Run(
                null,
                ContractOfferScreenModelFactory.FromOutcome((ErrorCodes.SchemaInvalid, exception.Message)),
                null,
                null);
        }

        ContentSet content;
        try
        {
            content = ContentSet.Load(contentRoot);
        }
        catch (InvalidDataException exception)
        {
            return new Run(
                null,
                ContractOfferScreenModelFactory.FromOutcome((ErrorCodes.ContentInvalid, exception.Message)),
                null,
                null);
        }

        var outcome = ScenarioRunner.Run(content, replayed, seed);

        return new Run(
            outcome, ContractOfferScreenModelFactory.FromOutcome(outcome), content, content.ContentVersion);
    }

    /// <summary>
    /// How much randomness each step spent. Derived by replaying prefixes of
    /// the same command list through the same production runner and reading
    /// <c>NextDecisionOrdinal</c> off each resulting state — never by counting
    /// draws in a second implementation of the rule. A blocked decision spends
    /// nothing and an accepted one spends one or more (a rejected sample burns
    /// an ordinal), and that difference is exactly what a port has to
    /// reproduce, so it is recorded per command rather than summed away.
    /// </summary>
    private static JsonObject Draws(Run run, ImmutableArray<ScenarioCommand> replayed, ulong seed)
    {
        var outcome = run.Outcome!;
        var content = run.Content!;

        var ordinals = new ulong[replayed.Length + 1];
        for (var prefix = 0; prefix <= replayed.Length; prefix++)
        {
            ordinals[prefix] = prefix == replayed.Length
                ? outcome.FinalState.Metadata.NextDecisionOrdinal
                : ScenarioRunner.Run(content, replayed.Take(prefix).ToImmutableArray(), seed)
                    .FinalState.Metadata.NextDecisionOrdinal;
        }

        var perStep = new JsonArray();
        for (var index = 0; index < replayed.Length; index++)
        {
            perStep.Add(new JsonObject
            {
                ["command_id"] = replayed[index].CommandId,
                ["ordinal_before"] = Text(ordinals[index]),
                ["ordinal_after"] = Text(ordinals[index + 1]),
                ["consumed"] = Text(ordinals[index + 1] - ordinals[index]),
            });
        }

        return new JsonObject
        {
            ["next_decision_ordinal_initial"] = Text(ordinals[0]),
            ["next_decision_ordinal_final"] = Text(ordinals[^1]),
            ["total_consumed"] = Text(ordinals[^1] - ordinals[0]),
            ["per_step"] = perStep,
        };
    }

    private static JsonObject Inputs(
        ScenarioManifest manifest,
        Checkpoint checkpoint,
        ContentRootChoice contentRoot,
        ImmutableArray<ScenarioCommand> replayed,
        Run run) => new()
        {
            ["manifest"] = new JsonObject
            {
                ["schema_version"] = manifest.SchemaVersion,
                ["scenario"] = manifest.Scenario,
                ["expected_outcome"] = manifest.ExpectedOutcome.ToString().ToLowerInvariant(),
                ["expected_error_code"] = manifest.ExpectedErrorCode,
                ["expected_screen_state"] = manifest.ExpectedScreenState,
                ["content_root"] = manifest.ContentRoot,
                ["fault"] = manifest.Fault is null
                    ? null
                    : new JsonObject
                    {
                        ["kind"] = manifest.Fault.Kind,
                        ["path"] = manifest.Fault.Path,
                    },
                ["checkpoints"] = new JsonArray(manifest.Checkpoints
                    .Select(declared => (JsonNode?)new JsonObject
                    {
                        ["name"] = declared.Name,
                        ["after_command_id"] = declared.AfterCommandId,
                    })
                    .ToArray()),
            },
            ["checkpoint_after_command_id"] = checkpoint.AfterCommandId,
            ["content_root"] = contentRoot.Recorded,
            ["content_root_exists"] = Directory.Exists(contentRoot.Absolute),
            ["content_version"] = run.ContentVersion,
            ["schema_root"] = "schemas",
            ["commands"] = new JsonArray(replayed
                .Select(command => (JsonNode?)new JsonObject
                {
                    ["command_id"] = command.CommandId,
                    ["hero_index"] = command.HeroIndex,
                    ["contract"] = command.Contract.Value,
                    ["expected_state_version"] = command.ExpectedStateVersion,
                })
                .ToArray()),
            ["ruleset_version"] = ScenarioRunner.RulesetVersion,
            ["determinism_artifact_version"] = DeterminismArtifact.ArtifactVersion,
            ["rng_algorithm"] = Simulation.Random.DeterministicRng.AlgorithmVersion,
            ["content_schema_version"] = ContentSet.SupportedContentSchemaVersion,
            ["save_schema_version"] = ContentSet.SaveSchemaVersion,
            ["manifest_schema_version"] = ScenarioManifest.SupportedManifestSchemaVersion,
        };

    /// <summary>
    /// The read model as data, in the same field names and the same closed
    /// vocabularies <see cref="ContractOfferScreenModelFactory.ReadModelHash"/>
    /// hashes, plus that hash itself. The hash is what keeps this projection
    /// honest: a field spelled differently here than the factory spells it
    /// would still have to agree with a digest this file did not compute.
    /// </summary>
    private static JsonObject ReadModel(ContractOfferScreenModel model) => new()
    {
        ["state"] = model.State.ToString(),
        ["title_key"] = model.TitleKey,
        ["error_code"] = model.ErrorCode,
        ["contract"] = model.Contract is null
            ? null
            : new JsonObject
            {
                ["definition"] = model.Contract.Definition,
                ["display_name_key"] = model.Contract.DisplayNameKey,
                ["payment"] = model.Contract.Payment,
                ["risk"] = model.Contract.Risk.ToString(),
                ["tag_keys"] = Strings(model.Contract.TagKeys),
                ["required_crew"] = model.Contract.RequiredCrew,
                ["accepted_count"] = model.Contract.AcceptedCount,
            },
        ["roster"] = new JsonArray(model.Roster
            .Select(hero => (JsonNode?)new JsonObject
            {
                ["definition"] = hero.Definition,
                ["display_name_key"] = hero.DisplayNameKey,
                ["greed"] = hero.Greed.ToString(),
                ["caution"] = hero.Caution.ToString(),
                ["pride"] = hero.Pride.ToString(),
                ["principle_keys"] = Strings(hero.PrincipleKeys),
                ["inclination_keys"] = Strings(hero.InclinationKeys),
            })
            .ToArray()),
        ["responses"] = new JsonArray(model.Responses
            .Select(response => (JsonNode?)new JsonObject
            {
                ["hero_definition"] = response.HeroDefinition,
                ["hero_display_name_key"] = response.HeroDisplayNameKey,
                ["action"] = response.Action,
                ["reasons"] = new JsonArray(response.Reasons
                    .Select(reason => (JsonNode?)new JsonObject
                    {
                        ["reason_code"] = reason.ReasonCode,
                        ["source_entity"] = reason.SourceEntity,
                        ["strength"] = reason.Strength.ToString(),
                        ["source_display_name_key"] = reason.SourceDisplayNameKey,
                        ["direction"] = reason.Direction.ToString(),
                    })
                    .ToArray()),
                ["blocked_by_entity"] = response.BlockedByEntity,
                ["blocked_by_display_name_key"] = response.BlockedByDisplayNameKey,
                ["tie_break_code"] = response.TieBreakCode,
                ["wavered"] = response.Wavered,
            })
            .ToArray()),
        ["sha256"] = ContractOfferScreenModelFactory.ReadModelHash(model),
    };

    private static JsonArray Strings(ImmutableArray<string> values) =>
        new(values.Select(value => (JsonNode?)value).ToArray());

    /// <summary>
    /// A <see cref="JsonNode"/> belongs to at most one parent, so a node
    /// lifted out of the canonical artifact has to be copied before it is
    /// attached to the envelope. Round-tripped through its own text rather
    /// than deep-cloned by hand: the text is what the digest is over.
    /// </summary>
    private static JsonNode? Detach(JsonNode? node) =>
        node is null ? null : JsonNode.Parse(node.ToJsonString());

    /// <summary>
    /// A 64-bit value as a decimal string. JSON's number type is an IEEE 754
    /// double in every reader the TypeScript port will use, so a seed or an
    /// ordinal above 2^53 written as a number would be silently rounded on the
    /// way in. Written as text here and parsed explicitly there.
    /// </summary>
    private static string Text(ulong value) => value.ToString(CultureInfo.InvariantCulture);

    private static void RequireReproduced(
        ScenarioManifest manifest, string what, string? actual, string? expected)
    {
        if (string.Equals(actual, expected, StringComparison.Ordinal))
        {
            return;
        }

        throw new InvalidDataException(
            $"Exporting scenario '{manifest.Scenario}' produced {what} '{actual ?? "(none)"}', but its "
            + $"manifest expects '{expected ?? "(none)"}'. Freezing this run would freeze a screen the "
            + "scenario does not describe.");
    }
}
