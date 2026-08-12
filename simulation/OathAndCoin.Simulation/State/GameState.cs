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
    /// <see cref="GameState.WithEvent"/> is the only place this may change —
    /// see the remarks on <see cref="GameState"/>.
    /// </summary>
    public required long StateVersion { get; init; }

    public required long LogicalTime { get; init; }

    public required long NextEventId { get; init; }

    /// <summary>
    /// The id to use for the next <see cref="CausalTrace"/> stored via
    /// <see cref="GameState.WithEvent"/>. Only advances when
    /// <see cref="GameState.WithEvent"/> actually stores a new trace — not
    /// on every call — so two decisions in a row get two distinct,
    /// addressable explanations instead of the second one silently
    /// overwriting the first at trace id 0.
    /// </summary>
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
/// <remarks>
/// <see cref="WithEvent"/> is the only sanctioned campaign-transition
/// entrypoint: it is the only place <see cref="GameMetadata.StateVersion"/>
/// may advance. <see cref="GameState"/> is still a public record with public
/// <c>init</c> properties — needed so tests, save/load, and replay code can
/// construct and inspect it structurally — which means a bare
/// <c>state with { ... }</c> expression always compiles and always produces
/// a new <see cref="GameState"/> value. That bare <c>with</c> is a value
/// copy, not a campaign transition: it must never be used in place of
/// <see cref="WithEvent"/> to apply an event's effects, and it does not
/// advance <see cref="GameMetadata.StateVersion"/>
/// (<c>PlainWithExpression_DoesNotAdvanceStateVersion</c> pins this). Task 4
/// does not implement effect application (which state changes
/// <see cref="Events.HeroAcceptedContract"/>/<see cref="Events.HeroDeclinedContract"/>
/// actually cause) — that is Plan B's command layer; folding it into
/// <see cref="WithEvent"/> now would require this task to also own rules
/// that belong to Plan B. Plan B's commands must call
/// <see cref="WithEvent"/> for every transition and never assemble a
/// competing <c>with</c> expression alongside it.
/// </remarks>
public sealed record GameState
{
    private ImmutableArray<DomainEvent> _history;

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

    public required ImmutableArray<DomainEvent> History
    {
        get => _history;
        init => _history = !value.IsDefault
            ? value
            : throw new ArgumentException(
                "History must not be a default(ImmutableArray<DomainEvent>); "
                + "use ImmutableArray<DomainEvent>.Empty instead.",
                nameof(History));
    }

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
    /// <see cref="GameMetadata.StateVersion"/> — the only place either does.
    /// </summary>
    /// <remarks>
    /// <paramref name="trace"/> is optional because not every event is a
    /// decision. When <paramref name="domainEvent"/>.<see cref="DomainEvent.CausalTraceId"/>
    /// is set, exactly one of two things must be true, or the reference
    /// would be dangling (nothing to explain the decision) or the trace
    /// would be stored unreachably (nothing ever points at it):
    /// <list type="bullet">
    /// <item><paramref name="trace"/> is given, and its
    /// <see cref="CausalTrace.TraceId"/> matches
    /// <see cref="DomainEvent.CausalTraceId"/> — this is a new explanation,
    /// stored under that id and addressable from now on. If that id is
    /// already occupied by a <em>different</em> trace, the call is rejected
    /// rather than silently overwriting the earlier explanation (a second
    /// decision must never erase what the first one already explained). If
    /// the stored trace is equivalent (same content), the call is a no-op
    /// on <see cref="Traces"/> — a second event may legitimately reference
    /// an explanation that was already stored.</item>
    /// <item><paramref name="trace"/> is <c>null</c>, and a trace with that
    /// id is already in <see cref="Traces"/> — a later event legitimately
    /// referencing an earlier decision's explanation.</item>
    /// </list>
    /// Conversely, passing <paramref name="trace"/> when
    /// <paramref name="domainEvent"/> does not reference any
    /// <see cref="DomainEvent.CausalTraceId"/> is also rejected: it would
    /// land in <see cref="Traces"/> unreachable from any event.
    /// <see cref="GameMetadata.NextTraceId"/> only advances when this call
    /// actually stores a <em>new</em> trace.
    /// </remarks>
    /// <exception cref="ArgumentException">
    /// <paramref name="domainEvent"/>'s <see cref="DomainEvent.EventId"/>
    /// does not equal <see cref="GameMetadata.NextEventId"/>; or the
    /// trace/event-reference pairing described above is violated.
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

        var storesNewTrace = false;

        if (domainEvent.CausalTraceId is { } causalTraceId)
        {
            if (trace is not null)
            {
                if (trace.TraceId != causalTraceId)
                {
                    throw new ArgumentException(
                        $"Trace id {trace.TraceId} does not match event's CausalTraceId ({causalTraceId}).",
                        nameof(trace));
                }

                if (Traces.TryGetValue(trace.TraceId, out var existingTrace))
                {
                    if (!AreEquivalent(existingTrace, trace))
                    {
                        throw new ArgumentException(
                            $"Trace id {trace.TraceId} is already stored with different content; "
                            + "a stored explanation cannot be overwritten.",
                            nameof(trace));
                    }
                }
                else
                {
                    storesNewTrace = true;
                }
            }
            else if (!Traces.ContainsKey(causalTraceId))
            {
                throw new ArgumentException(
                    $"Event references CausalTraceId {causalTraceId}, but no trace with that id has been "
                    + "stored yet and none was provided; the reference would dangle.",
                    nameof(domainEvent));
            }
        }
        else if (trace is not null)
        {
            throw new ArgumentException(
                "A trace was provided, but the event does not reference any CausalTraceId; "
                + "it would be stored unreachably.",
                nameof(trace));
        }

        return this with
        {
            Metadata = Metadata with
            {
                NextEventId = Metadata.NextEventId + 1,
                StateVersion = Metadata.StateVersion + 1,
                NextTraceId = storesNewTrace ? Metadata.NextTraceId + 1 : Metadata.NextTraceId,
            },
            History = History.Add(domainEvent),
            Traces = storesNewTrace ? Traces.SetItem(trace!.TraceId, trace) : Traces,
        };
    }

    /// <summary>
    /// Structural equality for <see cref="CausalTrace"/> that does not rely
    /// on the record's generated <c>Equals</c>: <see cref="ImmutableArray{T}"/>'s
    /// own <c>Equals</c> compares the backing array by reference, not by
    /// element, so two traces built independently with the same factors
    /// would otherwise compare unequal.
    /// </summary>
    private static bool AreEquivalent(CausalTrace left, CausalTrace right) =>
        left.TraceId == right.TraceId
        && left.PositiveFactors.SequenceEqual(right.PositiveFactors)
        && left.NegativeFactors.SequenceEqual(right.NegativeFactors)
        && left.BlockedBy.SequenceEqual(right.BlockedBy)
        && left.TieBreak == right.TieBreak;
}
