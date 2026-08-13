using System.Collections.Immutable;
using OathAndCoin.Simulation.Decisions;
using OathAndCoin.Simulation.Events;
using OathAndCoin.Simulation.State;

namespace OathAndCoin.Simulation.Commands;

/// <summary>
/// Stable codes for every way a command can be refused. Named constants for
/// the same reason <see cref="ReasonCodes"/> is: a code assembled inline at
/// one call site drifts from the "same" code assembled at another, and these
/// end up in logs, tests and — eventually — localized UI text.
/// </summary>
public static class RejectionCodes
{
    /// <summary>The campaign moved on since the command was composed.</summary>
    public const string StaleState = "rejected.stale_state";

    /// <summary>This command id was already applied to this campaign.</summary>
    public const string DuplicateCommand = "rejected.duplicate_command";

    public const string UnknownHero = "rejected.unknown_hero";

    public const string UnknownContract = "rejected.unknown_contract";

    /// <summary>The contract is no longer on offer — somebody took it.</summary>
    public const string ContractAlreadyResolved = "rejected.contract_already_resolved";

    /// <summary>This hero already answered this offer; nobody is asked twice.</summary>
    public const string AlreadyResponded = "rejected.already_responded";
}

/// <summary>
/// What a command did: the resulting state, the events it produced, and — when
/// it was a hero's decision — the explanation that came out of the same
/// computation as the choice itself.
/// </summary>
/// <remarks>
/// A rejection carries the <em>same</em> state instance it was given, not a
/// copy of it: <c>Assert.Same</c> in the tests is then a real statement that
/// nothing was rebuilt along the way, and a caller can compare by reference to
/// know that nothing happened.
/// </remarks>
public sealed record CommandResult
{
    private CommandResult(
        bool applied,
        string? rejectionCode,
        GameState state,
        ImmutableArray<DomainEvent> events,
        DecisionResult? decision)
    {
        Applied = applied;
        RejectionCode = rejectionCode;
        State = state;
        Events = events;
        Decision = decision;
    }

    public bool Applied { get; }

    /// <summary>
    /// A code from <see cref="RejectionCodes"/> when <see cref="Applied"/> is
    /// <c>false</c>; <c>null</c> otherwise.
    /// </summary>
    public string? RejectionCode { get; }

    /// <summary>
    /// The state after the command, or the untouched input state if it was
    /// rejected.
    /// </summary>
    public GameState State { get; }

    public ImmutableArray<DomainEvent> Events { get; }

    /// <summary>
    /// The hero's decision, when the command produced one. <c>null</c> for
    /// every rejection — a refused command explains itself through
    /// <see cref="RejectionCode"/>, which is a fact about the command, not a
    /// decision anybody made.
    /// </summary>
    public DecisionResult? Decision { get; }

    public static CommandResult Rejected(GameState state, string rejectionCode)
    {
        ArgumentNullException.ThrowIfNull(state);
        ArgumentException.ThrowIfNullOrEmpty(rejectionCode);

        return new CommandResult(
            applied: false,
            rejectionCode,
            state,
            ImmutableArray<DomainEvent>.Empty,
            decision: null);
    }

    public static CommandResult FromDecision(GameState state, DomainEvent domainEvent, DecisionResult decision)
    {
        ArgumentNullException.ThrowIfNull(state);
        ArgumentNullException.ThrowIfNull(domainEvent);
        ArgumentNullException.ThrowIfNull(decision);

        return new CommandResult(
            applied: true,
            rejectionCode: null,
            state,
            ImmutableArray.Create(domainEvent),
            decision);
    }

    /// <summary>
    /// Element-wise on <see cref="Events"/>, for the reason spelled out in
    /// <see cref="StructuralEquality"/>: the generated record equality would
    /// compare the array's backing storage by reference.
    /// </summary>
    public bool Equals(CommandResult? other) =>
        other is not null
        && (ReferenceEquals(this, other)
            || (Applied == other.Applied
                && string.Equals(RejectionCode, other.RejectionCode, StringComparison.Ordinal)
                && State == other.State
                && Decision == other.Decision
                && StructuralEquality.ElementsEqual(Events, other.Events)));

    public override int GetHashCode() => HashCode.Combine(
        Applied,
        RejectionCode is null ? 0 : StringComparer.Ordinal.GetHashCode(RejectionCode),
        State,
        Decision,
        StructuralEquality.ElementsHash(Events));
}
