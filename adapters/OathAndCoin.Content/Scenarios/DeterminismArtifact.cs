using System.Runtime.CompilerServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using OathAndCoin.Simulation.Decisions;
using OathAndCoin.Simulation.Events;
using OathAndCoin.Simulation.State;

[assembly: InternalsVisibleTo("OathAndCoin.Content.Tests")]

namespace OathAndCoin.Content.Scenarios;

/// <summary>
/// The machine-readable half of a run's output (AGENTS.md §11): the seed, the
/// versions, every command, every decision, and the final state with its whole
/// event log and every stored explanation. This is what two runs are compared
/// on — never the human-readable report, which exists to be reworded.
/// </summary>
/// <remarks>
/// "Canonical" is a property, not a label: object keys are written in ordinal
/// order regardless of the order they were built in, numbers are written by
/// <see cref="Utf8JsonWriter"/> and therefore never through the host's locale
/// (TDD §7.3), and the output is compact so no formatting choice can drift.
/// Enum-shaped values are mapped through explicit switches rather than
/// <c>ToString</c>, so adding a member to <see cref="ContractStatus"/> or a new
/// event type fails here loudly instead of silently changing every artifact.
/// </remarks>
public static class DeterminismArtifact
{
    /// <summary>
    /// Shape version of this artifact. A comparison across builds that
    /// disagree on the shape is not a determinism failure, and this is what
    /// tells them apart. Bumped to 2 for the M1 decision rules (Tasks 3-8):
    /// the projected state and trace shapes changed underneath the same
    /// number, and an artifact built under the old rules must not look
    /// comparable to one built under these. Bumped to 3 when
    /// <c>trait_rules</c> was added: the projection had been silent about the
    /// rulebook every decision is weighed against, so a version 2 artifact
    /// cannot be compared to one of these field for field.
    /// </summary>
    public const int ArtifactVersion = 3;

    private static readonly JsonWriterOptions WriterOptions = new()
    {
        Indented = false,
        SkipValidation = false,
    };

    public static string ToCanonicalJson(ScenarioOutcome outcome)
    {
        ArgumentNullException.ThrowIfNull(outcome);

        var root = new JsonObject
        {
            ["artifact_version"] = ArtifactVersion,
            ["rng_algorithm"] = Simulation.Random.DeterministicRng.AlgorithmVersion,
            ["seed"] = outcome.FinalState.Metadata.CampaignSeed,
            ["ruleset_version"] = outcome.FinalState.Metadata.RulesetVersion,
            ["content_version"] = outcome.FinalState.Metadata.ContentVersion,
            ["steps"] = new JsonArray(outcome.Steps.Select(Describe).ToArray<JsonNode?>()),
            ["final_state"] = Describe(outcome.FinalState),
        };

        return SerializeNode(root);
    }

    /// <summary>SHA-256 of <see cref="ToCanonicalJson"/>'s output, lowercase hex.</summary>
    public static string Hash(ScenarioOutcome outcome) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(ToCanonicalJson(outcome)))).ToLowerInvariant();

    /// <summary>
    /// The canonical rendering of a single stored explanation, on its own
    /// rather than embedded in a whole run's artifact. Exposed to tests via
    /// <see cref="InternalsVisibleTo"/> (see the assembly attribute above),
    /// the same pattern <c>OathAndCoin.Simulation.Random.DeterministicRng</c>
    /// uses, so a test can prove one field distinguishes two traces without
    /// building a whole scenario run around it.
    /// </summary>
    internal static string RenderTrace(CausalTrace trace)
    {
        ArgumentNullException.ThrowIfNull(trace);
        return SerializeNode(BuildTraceNode(trace));
    }

    /// <summary>The canonical rendering of a single decision, on its own. See <see cref="RenderTrace"/>.</summary>
    internal static string RenderDecision(DecisionResult decision)
    {
        ArgumentNullException.ThrowIfNull(decision);
        return SerializeNode(BuildDecisionNode(decision));
    }

    private static string SerializeNode(JsonNode? node)
    {
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream, WriterOptions))
        {
            CanonicalJson.Write(node, writer);
        }

        return Encoding.UTF8.GetString(stream.ToArray());
    }

    private static JsonNode Describe(StepOutcome step) => new JsonObject
    {
        ["command"] = new JsonObject
        {
            ["command_id"] = step.Command.CommandId,
            ["hero_index"] = step.Command.HeroIndex,
            ["contract"] = step.Command.Contract.Value,
            ["expected_state_version"] = step.Command.ExpectedStateVersion,
        },
        ["applied"] = step.Applied,
        ["rejection_code"] = step.RejectionCode,
        ["hero_definition"] = step.HeroDefinition?.Value,
        ["decision"] = step.Decision is null ? null : BuildDecisionNode(step.Decision),
        ["events"] = new JsonArray(step.Events.Select(Describe).ToArray<JsonNode?>()),
    };

    /// <summary>
    /// A decision's projection, with <c>selected_score</c> omitted entirely
    /// (not written as <c>null</c>) when the decision was blocked. The
    /// canonical artifact carries no empty slots — a key present with a null
    /// value and a key absent must not become two different-looking ways of
    /// saying "no score", or a comparison keyed on key presence would drift
    /// from one keyed on value.
    /// </summary>
    private static JsonObject BuildDecisionNode(DecisionResult decision)
    {
        var node = new JsonObject
        {
            ["selected_action"] = decision.SelectedAction.Value,
            ["considered_actions"] = new JsonArray(
                decision.ConsideredActions.Select(action => (JsonNode?)action.Value).ToArray()),
            ["trace_id"] = decision.Trace.TraceId,
        };

        if (decision.SelectedScore is { } score)
        {
            node["selected_score"] = score;
        }

        return node;
    }

    private static JsonNode Describe(GameState state) => new JsonObject
    {
        ["metadata"] = new JsonObject
        {
            ["save_schema_version"] = state.Metadata.SaveSchemaVersion,
            ["ruleset_version"] = state.Metadata.RulesetVersion,
            ["content_version"] = state.Metadata.ContentVersion,
            ["campaign_seed"] = state.Metadata.CampaignSeed,
            ["state_version"] = state.Metadata.StateVersion,
            ["logical_time"] = state.Metadata.LogicalTime,
            ["next_event_id"] = state.Metadata.NextEventId,
            ["next_trace_id"] = state.Metadata.NextTraceId,
            ["next_decision_ordinal"] = state.Metadata.NextDecisionOrdinal,
        },
        ["heroes"] = new JsonArray(state.Heroes.Values.Select(hero => (JsonNode?)new JsonObject
        {
            ["hero_id"] = hero.Id.Value,
            ["definition"] = hero.Definition.Value,
            ["display_name_key"] = hero.DisplayNameKey,
            ["greed"] = hero.Greed,
            ["caution"] = hero.Caution,
            ["pride"] = hero.Pride,
            ["trust_in_guild"] = hero.TrustInGuild,
            ["traits"] = new JsonArray(hero.Traits.Select(trait => (JsonNode?)trait.Value).ToArray()),
            ["relationships"] = new JsonObject(
                hero.Relationships.Select(pair => KeyValuePair.Create(pair.Key.Value, (JsonNode?)pair.Value))),
        }).ToArray()),
        ["contracts"] = new JsonArray(state.Contracts.Values.Select(contract => (JsonNode?)new JsonObject
        {
            ["id"] = contract.Id.Value,
            ["payment"] = contract.Payment,
            ["risk"] = contract.Risk,
            ["required_crew"] = contract.RequiredCrew,
            ["tags"] = new JsonArray(contract.Tags.Select(tag => (JsonNode?)tag.Value).ToArray()),
            ["status"] = Describe(contract.Status),
            ["responded_by"] = new JsonArray(contract.RespondedBy.Select(id => (JsonNode?)id.Value).ToArray()),
            ["accepted_by"] = new JsonArray(contract.AcceptedBy.Select(id => (JsonNode?)id.Value).ToArray()),
        }).ToArray()),
        ["traces"] = new JsonArray(state.Traces.Values.Select(BuildTraceNode).ToArray()),
        ["history"] = new JsonArray(state.History.Select(Describe).ToArray<JsonNode?>()),
        ["applied_command_ids"] = new JsonArray(
            state.AppliedCommandIds.Select(id => (JsonNode?)id).ToArray()),

        // Review finding (branch-level): the rulebook every decision is
        // weighed against was the one part of GameState this projection did
        // not carry, so two states differing only in what a trait means —
        // its tag, whether it is a red line, what it weighs — produced
        // byte-identical artifacts. That is a state a replay cannot
        // reconstruct from its own artifact, which is the one thing an
        // artifact is for. Keyed by trait id, which is already the
        // dictionary's sort order.
        ["trait_rules"] = new JsonArray(state.TraitRules.Values.Select(trait => (JsonNode?)new JsonObject
        {
            ["id"] = trait.Id.Value,
            ["tag"] = trait.Tag.Value,
            ["is_principle"] = trait.IsPrinciple,
            ["weight"] = trait.Weight,
        }).ToArray()),
    };

    /// <summary>
    /// A stored explanation's projection. Named <c>BuildTraceNode</c> rather
    /// than another overload of <c>Describe</c> because it is also called
    /// directly by <see cref="RenderTrace"/>, which serializes one trace on
    /// its own rather than embedded in a whole run.
    /// </summary>
    private static JsonNode BuildTraceNode(CausalTrace trace) => new JsonObject
    {
        ["trace_id"] = trace.TraceId,
        ["positive_factors"] = new JsonArray(trace.PositiveFactors.Select(Describe).ToArray()),
        ["negative_factors"] = new JsonArray(trace.NegativeFactors.Select(Describe).ToArray()),
        ["blocked_by"] = new JsonArray(trace.BlockedBy.Select(Describe).ToArray()),
        ["tie_break"] = trace.TieBreak,
    };

    private static JsonNode? Describe(TraceFactor factor) => new JsonObject
    {
        ["reason_code"] = factor.ReasonCode,
        ["source_entity"] = factor.SourceEntity.Value,
        ["magnitude"] = factor.Magnitude,
    };

    private static JsonNode? Describe(TraceBlock block) => new JsonObject
    {
        ["reason_code"] = block.ReasonCode,
        ["source_entity"] = block.SourceEntity.Value,
    };

    private static JsonNode Describe(DomainEvent domainEvent)
    {
        var described = new JsonObject
        {
            ["kind"] = DescribeKind(domainEvent),
            ["event_id"] = domainEvent.EventId,
            ["logical_time"] = domainEvent.LogicalTime,
            ["causal_trace_id"] = domainEvent.CausalTraceId,
        };

        switch (domainEvent)
        {
            case HeroAcceptedContract accepted:
                described["hero_id"] = accepted.HeroId.Value;
                described["contract_id"] = accepted.ContractId.Value;
                break;

            case HeroDeclinedContract declined:
                described["hero_id"] = declined.HeroId.Value;
                described["contract_id"] = declined.ContractId.Value;
                break;
        }

        return described;
    }

    private static string DescribeKind(DomainEvent domainEvent) => domainEvent switch
    {
        HeroAcceptedContract => "hero_accepted_contract",
        HeroDeclinedContract => "hero_declined_contract",
        _ => throw new ArgumentOutOfRangeException(
            nameof(domainEvent),
            domainEvent.GetType().Name,
            "This event type has no artifact projection yet; add one rather than letting it "
            + "serialize under a name derived from its class."),
    };

    private static string Describe(ContractStatus status) => status switch
    {
        ContractStatus.Offered => "offered",
        ContractStatus.Crewed => "crewed",
        _ => throw new ArgumentOutOfRangeException(nameof(status), status, "Unmapped contract status."),
    };
}
