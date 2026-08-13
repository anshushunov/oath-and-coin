using System.Collections.Immutable;
using OathAndCoin.Simulation.Ids;

namespace OathAndCoin.Simulation.Decisions;

/// <summary>
/// One contributing input to a decision (TDD §8): a stable reason code, the
/// entity that produced it, and how strongly it weighed in. The UI decides
/// how much of this to surface to the player, but it never invents a
/// different reason than the one the simulation actually used.
/// </summary>
public sealed record TraceFactor(string ReasonCode, string SourceEntity, int Magnitude);

/// <summary>
/// The stored explanation for a decision (ADR-007). Addressed by
/// <see cref="TraceId"/> from <see cref="Events.DomainEvent.CausalTraceId"/>
/// and kept in <see cref="State.GameState.Traces"/> rather than only on a
/// command's return value: if it lived only on the result, the reference
/// left on the event would dangle the moment the game is saved and
/// reloaded, and the decision could no longer be explained.
/// </summary>
/// <remarks>
/// A <see cref="CausalTrace"/> is not self-contained on its own — it
/// explains an action (see <see cref="Actions"/>), not a target. Which hero
/// and which contract the decision concerned already lives on the
/// <see cref="Events.DomainEvent"/> that references this trace (e.g.
/// <c>HeroAcceptedContract.HeroId</c>/<c>ContractId</c>), and a trace is
/// only ever looked up together with that event by
/// <see cref="Events.DomainEvent.CausalTraceId"/>. Repeating the target here
/// would just be a second place for it to drift out of sync with the event.
/// A trace is self-contained only in the pair <c>(event, trace)</c>, never
/// in isolation.
/// </remarks>
public sealed record CausalTrace
{
    private ImmutableArray<TraceFactor> _positiveFactors;
    private ImmutableArray<TraceFactor> _negativeFactors;
    private ImmutableArray<string> _blockedBy;

    public required long TraceId { get; init; }

    public required ImmutableArray<TraceFactor> PositiveFactors
    {
        get => _positiveFactors;
        init => _positiveFactors = RejectDefault(value, nameof(PositiveFactors));
    }

    public required ImmutableArray<TraceFactor> NegativeFactors
    {
        get => _negativeFactors;
        init => _negativeFactors = RejectDefault(value, nameof(NegativeFactors));
    }

    /// <summary>
    /// Reason codes for hard constraints that ruled an action out entirely,
    /// independent of score (TDD §8 invariant: "hard taboo/constraint не
    /// обходится обычным положительным score"). Empty when nothing was
    /// blocked.
    /// </summary>
    public required ImmutableArray<string> BlockedBy
    {
        get => _blockedBy;
        init => _blockedBy = RejectDefault(value, nameof(BlockedBy));
    }

    /// <summary>
    /// Reason code that broke a tie between equally-scored actions; null
    /// when the decision did not involve a tie. Tie-breaking must be
    /// deterministic (TDD §8 invariant), so this is always a stable code,
    /// never a description generated on the spot.
    /// </summary>
    public string? TieBreak { get; init; }

    /// <summary>
    /// Element-wise, not reference-wise. The compiler-generated
    /// <c>Equals</c> compares each <see cref="ImmutableArray{T}"/> field by
    /// its backing array's identity, which made two independently built
    /// traces with the same factors unequal — while two traces whose arrays
    /// are all the shared <c>Empty</c> singleton compared equal. A
    /// save/load round-trip test written against an empty fixture would
    /// therefore pass and only start failing once an explanation had its
    /// first real factor. <see cref="TieBreak"/> is compared ordinally, like
    /// every other identifier-shaped string in this assembly (TDD §7.3).
    /// </summary>
    public bool Equals(CausalTrace? other) =>
        other is not null
        && (ReferenceEquals(this, other)
            || (TraceId == other.TraceId
                && string.Equals(TieBreak, other.TieBreak, StringComparison.Ordinal)
                && StructuralEquality.ElementsEqual(PositiveFactors, other.PositiveFactors)
                && StructuralEquality.ElementsEqual(NegativeFactors, other.NegativeFactors)
                && StructuralEquality.ElementsEqual(BlockedBy, other.BlockedBy)));

    public override int GetHashCode() => HashCode.Combine(
        TraceId,
        TieBreak is null ? 0 : StringComparer.Ordinal.GetHashCode(TieBreak),
        StructuralEquality.ElementsHash(PositiveFactors),
        StructuralEquality.ElementsHash(NegativeFactors),
        StructuralEquality.ElementsHash(BlockedBy));

    /// <summary>
    /// <c>default(ImmutableArray&lt;T&gt;)</c> is an uninitialized struct,
    /// not an empty array — <c>required</c> only guards against "never
    /// assigned," not "assigned a default struct value." Left unchecked,
    /// any read that touches the array's backing storage (e.g.
    /// <c>Contains</c>, <c>SequenceEqual</c>) throws a
    /// <see cref="NullReferenceException"/> far from the actual mistake.
    /// Rejecting it here turns that into an immediate, diagnostic
    /// <see cref="ArgumentException"/> at construction.
    /// </summary>
    private static ImmutableArray<T> RejectDefault<T>(ImmutableArray<T> value, string propertyName) =>
        !value.IsDefault
            ? value
            : throw new ArgumentException(
                $"{propertyName} must not be a default(ImmutableArray<{typeof(T).Name}>); "
                + $"use ImmutableArray<{typeof(T).Name}>.Empty instead.",
                propertyName);
}

/// <summary>
/// The full result of one decision (TDD §8): the chosen action and its
/// explanation come out of the same computation, never reconstructed
/// after the fact via <see cref="Trace"/>.
/// </summary>
/// <remarks>
/// The invariant "the selection is among what was considered" is checked
/// from both <see cref="SelectedAction"/>'s and
/// <see cref="ConsideredActions"/>'s <c>init</c> accessors against explicit
/// backing fields, and silently returns while only one half of the data has
/// been set — object-initializer assignment order is not guaranteed by the
/// language, so the check cannot assume <see cref="ConsideredActions"/> was
/// already assigned when <see cref="SelectedAction"/> is. The C# 13 <c>field</c>
/// keyword would remove the need for explicit backing fields, but this
/// project is pinned to <c>LangVersion 12.0</c>.
/// </remarks>
public sealed record DecisionResult
{
    private ContentId _selectedAction;
    private ImmutableArray<ContentId> _consideredActions;
    private bool _selectedActionAssigned;
    private bool _consideredActionsAssigned;

    /// <summary>
    /// The chosen action (see <see cref="Actions"/>) — not a target. Which
    /// hero and which contract this decision concerned is carried by the
    /// <see cref="Events.DomainEvent"/> the caller derives from this result,
    /// not repeated here.
    /// </summary>
    public required ContentId SelectedAction
    {
        get => _selectedAction;
        init
        {
            _selectedAction = value;
            _selectedActionAssigned = true;
            ValidateSelectedActionIsConsidered();
        }
    }

    public required ImmutableArray<ContentId> ConsideredActions
    {
        get => _consideredActions;
        init
        {
            if (value.IsDefault)
            {
                throw new ArgumentException(
                    "ConsideredActions must not be a default(ImmutableArray<ContentId>); "
                    + "use ImmutableArray<ContentId>.Empty instead.",
                    nameof(ConsideredActions));
            }

            _consideredActions = value;
            _consideredActionsAssigned = true;
            ValidateSelectedActionIsConsidered();
        }
    }

    public required int SelectedScore { get; init; }

    public required CausalTrace Trace { get; init; }

    /// <summary>
    /// Element-wise, for the same reason as
    /// <see cref="CausalTrace.Equals(CausalTrace)"/>: the generated
    /// <c>Equals</c> compares <see cref="ConsideredActions"/> by backing-array
    /// identity. The two assignment-tracking fields are deliberately not part
    /// of equality — they are construction bookkeeping, not decision content.
    /// </summary>
    public bool Equals(DecisionResult? other) =>
        other is not null
        && (ReferenceEquals(this, other)
            || (SelectedAction == other.SelectedAction
                && SelectedScore == other.SelectedScore
                && StructuralEquality.ElementsEqual(ConsideredActions, other.ConsideredActions)
                && Trace == other.Trace));

    public override int GetHashCode() => HashCode.Combine(
        SelectedAction,
        SelectedScore,
        StructuralEquality.ElementsHash(ConsideredActions),
        Trace);

    private void ValidateSelectedActionIsConsidered()
    {
        if (!_selectedActionAssigned || !_consideredActionsAssigned)
        {
            return;
        }

        if (!_consideredActions.Contains(_selectedAction))
        {
            throw new ArgumentException(
                $"SelectedAction '{_selectedAction}' must be among ConsideredActions.",
                nameof(SelectedAction));
        }
    }
}
