using System.Collections.Immutable;
using OathAndCoin.Simulation.Ids;

namespace OathAndCoin.Simulation.State;

/// <summary>
/// Lifecycle of a contract offer. Deliberately has only two members: a hero
/// declining does not close the offer for everyone else — it adds that hero
/// to <see cref="ContractState.RespondedBy"/> instead (see
/// <see cref="Events.HeroDeclinedContract"/>). A third "Declined" status
/// would make the first refusal remove the offer for every other hero,
/// which would make the two-autonomous-decisions scenario the spike needs
/// to demonstrate impossible.
/// </summary>
public enum ContractStatus
{
    Offered,
    Accepted,
}

/// <summary>A contract offer's terms and lifecycle state.</summary>
public sealed record ContractState
{
    public required ContentId Id { get; init; }

    public required int Payment { get; init; }

    public required int Risk { get; init; }

    public required ContractStatus Status { get; init; }

    /// <summary>
    /// Heroes who have already responded — accepted or declined — to this
    /// offer, so the same hero is never asked twice. Sorted for
    /// deterministic enumeration order.
    /// </summary>
    public required ImmutableSortedSet<HeroId> RespondedBy { get; init; }

    /// <summary>
    /// Member-wise on <see cref="RespondedBy"/>.
    /// <see cref="ImmutableSortedSet{T}"/> does not override
    /// <c>Equals</c>, so the compiler-generated record equality compares it
    /// by reference: two contracts each answered by hero 1 would be unequal,
    /// while two untouched contracts would be equal only because both hold
    /// the shared <c>Empty</c> singleton. That inconsistency propagates
    /// straight into <see cref="GameState"/> equality, which compares
    /// <see cref="GameState.Contracts"/> value by value.
    /// </summary>
    public bool Equals(ContractState? other) =>
        other is not null
        && (ReferenceEquals(this, other)
            || (Id == other.Id
                && Payment == other.Payment
                && Risk == other.Risk
                && Status == other.Status
                && StructuralEquality.MembersEqual(RespondedBy, other.RespondedBy)));

    public override int GetHashCode() => HashCode.Combine(
        Id,
        Payment,
        Risk,
        Status,
        StructuralEquality.MembersHash(RespondedBy));
}
