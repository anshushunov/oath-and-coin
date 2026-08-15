using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using OathAndCoin.Simulation.Decisions;
using OathAndCoin.Simulation.Events;
using OathAndCoin.Simulation.State;

namespace OathAndCoin.Content.Scenarios;

/// <summary>
/// The machine-readable half of a run's output (spec §8.6): the seed, the
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
    /// tells them apart.
    /// </summary>
    public const int ArtifactVersion = 1;

    private static readonly JsonWriterOptions WriterOptions = new()
    {
        Indented = false,
        SkipValidation = false,
    };

    public static string Serialize(ScenarioOutcome outcome)
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

        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream, WriterOptions))
        {
            CanonicalJson.Write(root, writer);
        }

        return Encoding.UTF8.GetString(stream.ToArray());
    }

    /// <summary>SHA-256 of <see cref="Serialize"/>'s output, lowercase hex.</summary>
    public static string Hash(ScenarioOutcome outcome) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(Serialize(outcome)))).ToLowerInvariant();

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
        ["decision"] = step.Decision is null ? null : new JsonObject
        {
            ["selected_action"] = step.Decision.SelectedAction.Value,
            ["selected_score"] = step.Decision.SelectedScore,
            ["considered_actions"] = new JsonArray(
                step.Decision.ConsideredActions.Select(action => (JsonNode?)action.Value).ToArray()),
            ["trace_id"] = step.Decision.Trace.TraceId,
        },
        ["events"] = new JsonArray(step.Events.Select(Describe).ToArray<JsonNode?>()),
    };

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
            ["trust_in_guild"] = hero.TrustInGuild,
        }).ToArray()),
        ["contracts"] = new JsonArray(state.Contracts.Values.Select(contract => (JsonNode?)new JsonObject
        {
            ["id"] = contract.Id.Value,
            ["payment"] = contract.Payment,
            ["risk"] = contract.Risk,
            ["status"] = Describe(contract.Status),
            ["responded_by"] = new JsonArray(contract.RespondedBy.Select(id => (JsonNode?)id.Value).ToArray()),
        }).ToArray()),
        ["traces"] = new JsonArray(state.Traces.Values.Select(Describe).ToArray()),
        ["history"] = new JsonArray(state.History.Select(Describe).ToArray<JsonNode?>()),
        ["applied_command_ids"] = new JsonArray(
            state.AppliedCommandIds.Select(id => (JsonNode?)id).ToArray()),
    };

    private static JsonNode? Describe(CausalTrace trace) => new JsonObject
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
