using System.Collections.Immutable;
using OathAndCoin.Simulation.Ids;

namespace OathAndCoin.Simulation.Decisions;

/// <summary>
/// One contributing input to a decision (TDD §8): a stable reason code, the
/// entity that produced it, and how strongly it weighed in. The UI decides
/// how much of this to surface to the player, but it never invents a
/// different reason than the one the simulation actually used.
/// </summary>
/// <param name="ReasonCode">
/// A stable code from <see cref="ReasonCodes"/> — a plain string, and see
/// the remarks there for where that line is drawn.
/// </param>
/// <param name="SourceEntity">
/// The content-addressable entity this factor came from, as a
/// <see cref="ContentId"/> rather than free text. The argument that put
/// <see cref="Actions"/> behind <see cref="ContentId"/> — these values reach
/// explanations, saves and localization keys, so they need a stable
/// namespaced identifier — applies word for word to the source of a factor,
/// which is the one thing in an explanation a player might want to follow
/// back to the object that caused it. In a game whose value is understanding
/// why, an explanation you cannot navigate from is a weaker artifact.
///
/// For a hero this is the hero's <see cref="State.HeroState.Definition"/>,
/// not its runtime <see cref="HeroId"/>: the definition is stable across
/// saves and across campaigns, so a stored explanation stays meaningful even
/// where the instance it described no longer exists.
/// </param>
/// <param name="Magnitude">
/// How strongly this factor weighed in — integer, like every other
/// gameplay-relevant number in the core (TDD §7.4).
/// </param>
public sealed record TraceFactor(string ReasonCode, ContentId SourceEntity, int Magnitude);

/// <summary>
/// A hard constraint that ruled an action out entirely, together with the
/// content entity that carries it. A block has no magnitude on purpose: a red
/// line is not a very large negative contribution, it closes the path before
/// any contribution exists (HERO_DECISION_SPEC §2.2).
/// </summary>
/// <param name="ReasonCode">
/// A stable code from <see cref="ReasonCodes"/>, the same closed engine
/// vocabulary <see cref="TraceFactor.ReasonCode"/> draws from — never the
/// principle's own <see cref="ContentId"/>, for the same reason as there.
/// </param>
/// <param name="SourceEntity">
/// The content entity that carries the principle this block enforces (e.g.
/// the hero's own <see cref="State.HeroState.Definition"/> for a personal
/// conviction, or the target's entity for "will not work with X"). Without
/// this, a screen required to name the principle would have to guess at it
/// from the hero — which is exactly the invented explanation this trace
/// exists to rule out.
/// </param>
public sealed record TraceBlock(string ReasonCode, ContentId SourceEntity);

/// <summary>
/// The stored explanation for a decision (ADR-007, planned — TDD §21).
/// Addressed by
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
    private ImmutableArray<TraceBlock> _blockedBy;

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
    /// Hard constraints that ruled an action out entirely, independent of
    /// score (TDD §8 invariant: "hard taboo/constraint не обходится обычным
    /// положительным score"). Empty when nothing was blocked.
    /// </summary>
    /// <remarks>
    /// Non-empty here and a non-null <see cref="DecisionResult.SelectedScore"/>
    /// are mutually exclusive; that joint rule is enforced on
    /// <see cref="DecisionResult"/>, not here, because <see cref="CausalTrace"/>
    /// has no business knowing about the result that embeds it.
    /// </remarks>
    public required ImmutableArray<TraceBlock> BlockedBy
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
///
/// <see cref="SelectedScore"/> and <see cref="Trace"/> are checked against
/// each other the same way, for the same reason: a red line
/// (<see cref="CausalTrace.BlockedBy"/> non-empty) closes the decision before
/// any score exists, so exactly one of "there is a score" and "there is a
/// block" may hold, and that joint rule has to live wherever both halves are
/// visible together — which is here, not on <see cref="CausalTrace"/>, which
/// has no reason to know about the result that embeds it.
/// </remarks>
public sealed record DecisionResult
{
    private ContentId _selectedAction;
    private ImmutableArray<ContentId> _consideredActions;
    private int? _selectedScore;
    private CausalTrace _trace = null!;
    private bool _selectedActionAssigned;
    private bool _consideredActionsAssigned;
    private bool _selectedScoreAssigned;
    private bool _traceAssigned;

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

    /// <summary>
    /// The score that decided <see cref="SelectedAction"/> — null exactly
    /// when <see cref="Trace"/>'s <see cref="CausalTrace.BlockedBy"/> is
    /// non-empty (checked by <see cref="ValidateScoreMatchesBlock"/>). A red
    /// line has no score to report, and zero would be the worst possible
    /// stand-in: it is indistinguishable from an honest zero and, under the
    /// "accept at score &gt;= 0" rule, would read as consent.
    /// </summary>
    public required int? SelectedScore
    {
        get => _selectedScore;
        init
        {
            _selectedScore = value;
            _selectedScoreAssigned = true;
            ValidateScoreMatchesBlock();
        }
    }

    public required CausalTrace Trace
    {
        get => _trace;
        init
        {
            _trace = value;
            _traceAssigned = true;
            ValidateScoreMatchesBlock();
        }
    }

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

    /// <summary>
    /// Enforces "<see cref="SelectedScore"/> is null exactly when
    /// <see cref="Trace"/>'s <see cref="CausalTrace.BlockedBy"/> is
    /// non-empty" from both <see cref="SelectedScore"/>'s and
    /// <see cref="Trace"/>'s <c>init</c> accessors, the same way
    /// <see cref="ValidateSelectedActionIsConsidered"/> guards against
    /// object-initializer order: whichever of the two properties is written
    /// second is the one whose accessor actually runs the check, so the rule
    /// holds regardless of which one the caller happens to write first.
    /// </summary>
    private void ValidateScoreMatchesBlock()
    {
        if (!_selectedScoreAssigned || !_traceAssigned)
        {
            return;
        }

        var blocked = !_trace.BlockedBy.IsEmpty;

        if (blocked && _selectedScore is not null)
        {
            throw new ArgumentException(
                "SelectedScore must be null when Trace.BlockedBy is non-empty: a red line "
                + "closes the decision before any score exists.",
                nameof(SelectedScore));
        }

        if (!blocked && _selectedScore is null)
        {
            throw new ArgumentException(
                "SelectedScore must not be null when Trace.BlockedBy is empty: a scored "
                + "decision needs a score.",
                nameof(SelectedScore));
        }
    }
}
