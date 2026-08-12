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
public sealed record CausalTrace
{
    public required long TraceId { get; init; }

    public required ImmutableArray<TraceFactor> PositiveFactors { get; init; }

    public required ImmutableArray<TraceFactor> NegativeFactors { get; init; }

    /// <summary>
    /// Reason codes for hard constraints that ruled an action out entirely,
    /// independent of score (TDD §8 invariant: "hard taboo/constraint не
    /// обходится обычным положительным score"). Empty when nothing was
    /// blocked.
    /// </summary>
    public required ImmutableArray<string> BlockedBy { get; init; }

    /// <summary>
    /// Reason code that broke a tie between equally-scored actions; null
    /// when the decision did not involve a tie. Tie-breaking must be
    /// deterministic (TDD §8 invariant), so this is always a stable code,
    /// never a description generated on the spot.
    /// </summary>
    public string? TieBreak { get; init; }
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
            _consideredActions = value;
            _consideredActionsAssigned = true;
            ValidateSelectedActionIsConsidered();
        }
    }

    public required int SelectedScore { get; init; }

    public required CausalTrace Trace { get; init; }

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
