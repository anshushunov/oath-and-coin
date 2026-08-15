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

    /// <summary>
    /// The campaign's current logical time (TDD §10). Moved forward only by
    /// <see cref="GameState.WithEvent"/>, to the logical time of the event
    /// being appended, and an event dated earlier than this is rejected — so
    /// <see cref="GameState.History"/> is monotone in logical time and this
    /// field always answers "when is the campaign now" consistently with the
    /// log.
    /// </summary>
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
    /// <remarks>
    /// "Next free" is enforced, not merely intended:
    /// <see cref="GameState.WithEvent"/> refuses to store a new trace under
    /// any id other than this one. Because the counter moves by exactly one
    /// per stored trace, a trace accepted out of sequence would make it point
    /// at an occupied id later on — storing id 7 while the counter reads 0
    /// leaves it at 1, and after ids 0..6 are stored it reads 7 again.
    /// </remarks>
    public required long NextTraceId { get; init; }

    /// <summary>
    /// The ordinal to feed the counter-based RNG (ADR-003, planned — TDD §21)
    /// for the next draw. Living in state rather than beside it is what keeps the engine
    /// stateless: randomness is derived from
    /// <c>(CampaignSeed, stream, NextDecisionOrdinal)</c>, never kept in a
    /// generator's own memory.
    /// </summary>
    /// <remarks>
    /// <see cref="ulong"/>, not <see cref="long"/>: this value is handed
    /// straight to <c>DeterministicRng.Draw</c>, whose ordinal parameter is
    /// <see cref="ulong"/>. Declaring it signed forced a cast at every call
    /// site, and that cast is exactly where a negative ordinal — which the
    /// RNG would silently accept as a huge unsigned one — would slip in. The
    /// two types now match, so there is nothing to cast and nothing to get
    /// wrong.
    ///
    /// Advanced only by <see cref="GameState.WithEvent"/>, through its
    /// <c>drawsConsumed</c> argument; see the remarks there.
    /// </remarks>
    public required ulong NextDecisionOrdinal { get; init; }
}

/// <summary>
/// Campaign state (ADR-007, planned — TDD §21). Every collection here is a
/// physically immutable BCL type (<see cref="ImmutableSortedDictionary{TKey,TValue}"/>,
/// <see cref="ImmutableSortedSet{T}"/>, <see cref="ImmutableArray{T}"/>)
/// rather than a read-only interface over a mutable collection: an
/// interface only stops this type's own consumers from mutating what they
/// were given, it does nothing to stop the original owner of a source
/// collection from mutating it after handing it over. The sorted variants
/// also give deterministic enumeration order for free.
/// </summary>
/// <remarks>
/// <see cref="WithEvent"/> is the only sanctioned campaign-transition
/// entrypoint: it is the only place <see cref="GameMetadata.StateVersion"/>,
/// <see cref="GameMetadata.LogicalTime"/>,
/// <see cref="GameMetadata.NextEventId"/>,
/// <see cref="GameMetadata.NextTraceId"/> or
/// <see cref="GameMetadata.NextDecisionOrdinal"/> may advance. <see cref="GameState"/> is still a public record with public
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
    /// Ids of the commands already applied to this campaign, so replaying one
    /// is refused instead of quietly happening twice (see
    /// <c>ProposeContractToHero.CommandId</c>). A command id nothing ever
    /// checks is worse than no command id at all: it looks like idempotency
    /// and provides none.
    /// </summary>
    /// <remarks>
    /// One of the two properties here without <c>required</c> — the other is
    /// <see cref="TraitRules"/> — and deliberately so.
    /// Every other member of this record was part of the contract package
    /// before any state existed to construct; this one arrived afterwards,
    /// with a default that is both correct and the only sensible reading of
    /// its absence — "no command has been applied yet". Making it
    /// <c>required</c> would have forced an edit to every construction site in
    /// the repository to restate that same empty set, which is churn that
    /// hides the one place where the value actually matters.
    ///
    /// Filled by the command layer through a plain <c>with</c> expression
    /// alongside the event's other effects, immediately before
    /// <see cref="WithEvent"/> — see the remarks on this type for why that
    /// pairing is the sanctioned shape and a bare <c>with</c> alone is not.
    /// </remarks>
    public ImmutableSortedSet<long> AppliedCommandIds { get; init; } = ImmutableSortedSet<long>.Empty;

    /// <summary>
    /// The rulebook's own trait dictionary — <c>ContentId → HeldTrait</c> —
    /// filled once by the content loader's initial-state builder
    /// (<c>ContentSet.CreateInitialState</c>) and carried in state from then
    /// on, never re-derived. The engine needs a hero's traits resolved into
    /// <see cref="HeldTrait"/> (kind, tag, weight) to build a
    /// <see cref="DecisionContext"/>, but it cannot reference the content
    /// assembly that defines <c>TraitDefinition</c> (ADR-002) — so the
    /// resolution happens exactly once, at content-load time, on the other
    /// side of that boundary, and only the result (a plain
    /// <see cref="HeldTrait"/> per id) crosses into state.
    /// </summary>
    /// <remarks>
    /// The other property here without <c>required</c>, for the same reason as
    /// <see cref="AppliedCommandIds"/>: it arrived after every existing
    /// construction site in this repository had already been written, and its
    /// absence has a single correct reading — "no trait carries any rule at
    /// all" — which is exactly what an empty dictionary means to a hero whose
    /// own <see cref="HeroState.Traits"/> is also empty. Forcing every
    /// pre-existing fixture to restate an empty dictionary would have been
    /// churn hiding the one place this value actually matters.
    /// </remarks>
    public ImmutableSortedDictionary<ContentId, HeldTrait> TraitRules { get; init; } =
        ImmutableSortedDictionary<ContentId, HeldTrait>.Empty;

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
    /// advances <see cref="GameMetadata.NextEventId"/>,
    /// <see cref="GameMetadata.StateVersion"/>,
    /// <see cref="GameMetadata.LogicalTime"/> and
    /// <see cref="GameMetadata.NextDecisionOrdinal"/> — the only place any of
    /// them does.
    /// </summary>
    /// <param name="domainEvent">The event to append.</param>
    /// <param name="trace">
    /// The explanation for <paramref name="domainEvent"/>, or <c>null</c>;
    /// see the remarks for exactly when each is required.
    /// </param>
    /// <param name="drawsConsumed">
    /// How many RNG ordinals producing <paramref name="domainEvent"/>
    /// consumed on <see cref="Random.RngStream.HeroDecision"/> — <c>0</c> for
    /// a transition that made no draw at all.
    /// </param>
    /// <remarks>
    /// <para>
    /// <paramref name="drawsConsumed"/> has no default value on purpose. The
    /// RNG is counter-based: a draw is a pure function of
    /// <c>(CampaignSeed, stream, ordinal)</c>, so if the ordinal does not
    /// move, the *same* random value comes back — two heroes deciding in a
    /// row would draw identically and the second explanation would be a copy
    /// of the first, with nothing anywhere to indicate it. A defaulted
    /// parameter would make that failure the one you get by forgetting to
    /// type anything; a required one makes every transition state, in the
    /// signature, how much randomness it spent. <c>0</c> at a non-decision
    /// call site is not noise, it is the claim "this transition consumed no
    /// randomness".
    /// </para>
    /// <para>
    /// The alternative shape — a separate <c>WithDecisionDraw</c> method —
    /// was rejected: it is equally forgettable and it would create a second
    /// campaign-transition entrypoint, which is exactly the invariant the
    /// remarks on <see cref="GameState"/> rely on.
    /// </para>
    /// <para>
    /// <see cref="GameMetadata.LogicalTime"/> follows
    /// <paramref name="domainEvent"/>'s own
    /// <see cref="DomainEvent.LogicalTime"/>, and an event dated before the
    /// campaign's current logical time is rejected. Without both halves the
    /// log was not monotone in time — an event at logical time -999 appended
    /// happily after one at 0 — and the campaign clock was a field nothing
    /// ever moved or checked, so "when did this happen" had no answer that
    /// history itself could confirm.
    /// </para>
    /// <para>
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
    /// an explanation that was already stored. Storing a <em>new</em>
    /// explanation additionally requires its id to be exactly
    /// <see cref="GameMetadata.NextTraceId"/>: the counter advances by one
    /// per stored trace, so accepting an arbitrary id would let it point at
    /// an id that is already occupied and stop meaning "next free" (store a
    /// trace at id 7 while the counter reads 0, then store ids 0..6, and the
    /// counter reads 7 again — over an existing key).</item>
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
    /// </para>
    /// </remarks>
    /// <exception cref="ArgumentException">
    /// <paramref name="domainEvent"/>'s <see cref="DomainEvent.EventId"/>
    /// does not equal <see cref="GameMetadata.NextEventId"/>; its
    /// <see cref="DomainEvent.LogicalTime"/> is earlier than
    /// <see cref="GameMetadata.LogicalTime"/>; or the trace/event-reference
    /// pairing described above is violated.
    /// </exception>
    public GameState WithEvent(DomainEvent domainEvent, CausalTrace? trace, ulong drawsConsumed)
    {
        ArgumentNullException.ThrowIfNull(domainEvent);

        if (domainEvent.EventId != Metadata.NextEventId)
        {
            throw new ArgumentException(
                $"Event id {domainEvent.EventId} is out of order; expected {Metadata.NextEventId}.",
                nameof(domainEvent));
        }

        if (domainEvent.LogicalTime < Metadata.LogicalTime)
        {
            throw new ArgumentException(
                $"Event logical time {domainEvent.LogicalTime} is before the campaign's current logical "
                + $"time ({Metadata.LogicalTime}); history must be monotone in logical time.",
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
                    if (existingTrace != trace)
                    {
                        throw new ArgumentException(
                            $"Trace id {trace.TraceId} is already stored with different content; "
                            + "a stored explanation cannot be overwritten.",
                            nameof(trace));
                    }
                }
                else
                {
                    if (trace.TraceId != Metadata.NextTraceId)
                    {
                        throw new ArgumentException(
                            $"Trace id {trace.TraceId} is not the campaign's next free trace id "
                            + $"({Metadata.NextTraceId}); a new explanation must be stored under "
                            + "GameMetadata.NextTraceId, because that counter only ever advances by one "
                            + "per stored trace and would otherwise stop meaning \"next free\" — a later "
                            + "decision would then be handed an id that is already occupied.",
                            nameof(trace));
                    }

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
                LogicalTime = domainEvent.LogicalTime,
                NextTraceId = storesNewTrace ? Metadata.NextTraceId + 1 : Metadata.NextTraceId,
                NextDecisionOrdinal = checked(Metadata.NextDecisionOrdinal + drawsConsumed),
            },
            History = History.Add(domainEvent),
            Traces = storesNewTrace ? Traces.SetItem(trace!.TraceId, trace) : Traces,
        };
    }

    /// <summary>
    /// Content equality, entry by entry and element by element. Two states
    /// assembled independently from the same data are equal; changing one
    /// factor of one explanation makes them unequal.
    /// </summary>
    /// <remarks>
    /// None of the collection types above override <c>Equals</c>
    /// (<see cref="ImmutableArray{T}"/> compares its backing array by
    /// reference; the immutable sorted dictionaries inherit plain reference
    /// equality), so the compiler-generated record <c>Equals</c> answered
    /// "not equal" for two identical states — except when every collection
    /// involved happened to be the shared <c>Empty</c> singleton, where it
    /// answered "equal". A save/load round-trip test written on an empty
    /// fixture would pass under that rule and only break on the first state
    /// that carried real data. This is the type-level fix; the shared
    /// element-wise rules live in <see cref="StructuralEquality"/>. It also
    /// replaces the private <c>AreEquivalent</c> helper
    /// <see cref="WithEvent"/> used to compare stored traces — that
    /// comparison is now just <c>existingTrace != trace</c>.
    /// </remarks>
    public bool Equals(GameState? other) =>
        other is not null
        && (ReferenceEquals(this, other)
            || (Metadata == other.Metadata
                && StructuralEquality.EntriesEqual(Heroes, other.Heroes)
                && StructuralEquality.EntriesEqual(Contracts, other.Contracts)
                && StructuralEquality.EntriesEqual(Traces, other.Traces)
                && StructuralEquality.MembersEqual(AppliedCommandIds, other.AppliedCommandIds)
                && StructuralEquality.EntriesEqual(TraitRules, other.TraitRules)
                && StructuralEquality.ElementsEqual(History, other.History)));

    public override int GetHashCode() => HashCode.Combine(
        Metadata,
        StructuralEquality.EntriesHash(Heroes),
        StructuralEquality.EntriesHash(Contracts),
        StructuralEquality.EntriesHash(Traces),
        StructuralEquality.MembersHash(AppliedCommandIds),
        StructuralEquality.EntriesHash(TraitRules),
        StructuralEquality.ElementsHash(History));
}
