using System.Collections.Immutable;
using OathAndCoin.Simulation.Decisions;
using OathAndCoin.Simulation.Events;
using OathAndCoin.Simulation.Ids;

namespace OathAndCoin.Simulation.State;

/// <summary>
/// The reproducibility contract carried alongside the campaign (TDD §7.1,
/// §7.4): the (ruleset, content, RNG seed) tuple a replay or bug report must
/// pin down, plus the counters that make the campaign log and the RNG
/// stateless.
/// </summary>
public sealed record GameMetadata
{
    public required int SaveSchemaVersion { get; init; }

    public required string RulesetVersion { get; init; }

    public required string ContentVersion { get; init; }

    public required ulong CampaignSeed { get; init; }

    /// <summary>
    /// Increases on every <see cref="GameState.WithEvent"/> transition, so a
    /// stale in-flight decision can be detected against a newer state
    /// (checked by commands against an expected version in plan B).
    /// </summary>
    public required long StateVersion { get; init; }

    public required long LogicalTime { get; init; }

    public required long NextEventId { get; init; }

    public required long NextTraceId { get; init; }

    /// <summary>
    /// The ordinal to feed the counter-based RNG (ADR-003) for the next
    /// draw. Living in state rather than beside it is what keeps the engine
    /// stateless: randomness is derived from
    /// <c>(CampaignSeed, stream, NextDecisionOrdinal)</c>, never kept in a
    /// generator's own memory.
    /// </summary>
    public required long NextDecisionOrdinal { get; init; }
}

/// <summary>
/// Campaign state (ADR-007). Every collection here is a physically
/// immutable BCL type (<see cref="ImmutableSortedDictionary{TKey,TValue}"/>,
/// <see cref="ImmutableSortedSet{T}"/>, <see cref="ImmutableArray{T}"/>)
/// rather than a read-only interface over a mutable collection: an
/// interface only stops this type's own consumers from mutating what they
/// were given, it does nothing to stop the original owner of a source
/// collection from mutating it after handing it over. The sorted variants
/// also give deterministic enumeration order for free.
/// </summary>
public sealed record GameState
{
    public required GameMetadata Metadata { get; init; }

    public required ImmutableSortedDictionary<HeroId, HeroState> Heroes { get; init; }

    public required ImmutableSortedDictionary<ContentId, ContractState> Contracts { get; init; }

    /// <summary>
    /// Explanations for past decisions, addressable by the
    /// <see cref="DomainEvent.CausalTraceId"/> carried on the event that
    /// produced them. Stored here — not only returned alongside a command's
    /// result — so a trace survives save/load and a decision can still be
    /// explained afterwards.
    /// </summary>
    public required ImmutableSortedDictionary<long, CausalTrace> Traces { get; init; }

    public required ImmutableArray<DomainEvent> History { get; init; }

    /// <exception cref="KeyNotFoundException">No hero with <paramref name="id"/> exists.</exception>
    public HeroState Hero(HeroId id) =>
        Heroes.TryGetValue(id, out var hero)
            ? hero
            : throw new KeyNotFoundException($"Unknown hero 'hero#{id.Value}'.");

    /// <exception cref="KeyNotFoundException">No contract with <paramref name="id"/> exists.</exception>
    public ContractState Contract(ContentId id) =>
        Contracts.TryGetValue(id, out var contract)
            ? contract
            : throw new KeyNotFoundException($"Unknown contract '{id}'.");

    /// <summary>
    /// Appends <paramref name="domainEvent"/> to <see cref="History"/> and
    /// advances <see cref="GameMetadata.NextEventId"/> and
    /// <see cref="GameMetadata.StateVersion"/>. When <paramref name="trace"/>
    /// is given, it is stored in <see cref="Traces"/> keyed by
    /// <see cref="CausalTrace.TraceId"/> so it stays addressable by
    /// <paramref name="domainEvent"/>'s <see cref="DomainEvent.CausalTraceId"/>
    /// after this state is saved and reloaded. <paramref name="trace"/> is
    /// optional because not every event is a decision; when it is given,
    /// its <see cref="CausalTrace.TraceId"/> must match the event's
    /// <see cref="DomainEvent.CausalTraceId"/> — otherwise the event would
    /// point at an explanation that is not actually its own.
    /// </summary>
    /// <exception cref="ArgumentException">
    /// <paramref name="domainEvent"/>'s <see cref="DomainEvent.EventId"/>
    /// does not equal <see cref="GameMetadata.NextEventId"/>, or
    /// <paramref name="trace"/> is given and its
    /// <see cref="CausalTrace.TraceId"/> does not match
    /// <paramref name="domainEvent"/>'s <see cref="DomainEvent.CausalTraceId"/>.
    /// </exception>
    public GameState WithEvent(DomainEvent domainEvent, CausalTrace? trace)
    {
        ArgumentNullException.ThrowIfNull(domainEvent);

        if (domainEvent.EventId != Metadata.NextEventId)
        {
            throw new ArgumentException(
                $"Event id {domainEvent.EventId} is out of order; expected {Metadata.NextEventId}.",
                nameof(domainEvent));
        }

        if (trace is not null && trace.TraceId != domainEvent.CausalTraceId)
        {
            throw new ArgumentException(
                $"Trace id {trace.TraceId} does not match event's CausalTraceId "
                + $"({(domainEvent.CausalTraceId is { } id ? id.ToString() : "null")}).",
                nameof(trace));
        }

        return this with
        {
            Metadata = Metadata with
            {
                NextEventId = Metadata.NextEventId + 1,
                StateVersion = Metadata.StateVersion + 1,
            },
            History = History.Add(domainEvent),
            Traces = trace is null ? Traces : Traces.SetItem(trace.TraceId, trace),
        };
    }
}
