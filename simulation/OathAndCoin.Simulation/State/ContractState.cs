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
///
/// <see cref="Crewed"/> is the state that matters for a contract with a
/// <see cref="ContractState.RequiredCrew"/> greater than one: it means the
/// offer has recruited a full crew — every seat in
/// <see cref="ContractState.AcceptedBy"/> filled — not merely that one hero
/// among several said yes. That rule is implemented — see
/// <see cref="Simulation.SimulationEngine.Apply(GameState,Commands.ProposeContractToHero)"/>,
/// which reads <see cref="ContractState.AcceptedBy"/>'s count against
/// <see cref="ContractState.RequiredCrew"/> rather than the single acceptance
/// in front of it, and <c>ScenarioCoverageTests.CrewFilled_StatusBecomesCrewedOnceEverySeatIsTaken</c>,
/// which drives it end to end. This comment used to call it a later task's
/// concern; that stopped being true in this milestone.
/// </summary>
public enum ContractStatus
{
    Offered,
    Crewed,
}

/// <summary>A contract offer's terms and lifecycle state.</summary>
public sealed record ContractState
{
    public required ContentId Id { get; init; }

    public required int Payment { get; init; }

    public required int Risk { get; init; }

    /// <summary>
    /// How many heroes must accept before this offer is
    /// <see cref="ContractStatus.Crewed"/> (HERO_DECISION_SPEC §1.5).
    /// </summary>
    public required int RequiredCrew { get; init; }

    /// <summary>
    /// Content ids a hero's traits latch onto (HERO_DECISION_SPEC §1.5). Identifiers, not
    /// the <c>Content.TraitDefinition</c> objects the tags happen to name —
    /// same reason as <see cref="HeroState.Traits"/>.
    /// </summary>
    public required ImmutableSortedSet<ContentId> Tags { get; init; }

    public required ContractStatus Status { get; init; }

    /// <summary>
    /// Heroes who have already responded — accepted or declined — to this
    /// offer, so the same hero is never asked twice. Sorted for
    /// deterministic enumeration order.
    /// </summary>
    public required ImmutableSortedSet<HeroId> RespondedBy { get; init; }

    /// <summary>
    /// Heroes who have accepted this offer and joined its crew — a subset of
    /// <see cref="RespondedBy"/>. Sorted for deterministic enumeration order.
    /// </summary>
    public required ImmutableSortedSet<HeroId> AcceptedBy { get; init; }

    /// <summary>
    /// Member-wise on <see cref="RespondedBy"/>, <see cref="AcceptedBy"/> and
    /// <see cref="Tags"/>. <see cref="ImmutableSortedSet{T}"/> does not
    /// override <c>Equals</c>, so the compiler-generated record equality
    /// compares it by reference: two contracts each answered by hero 1 would
    /// be unequal, while two untouched contracts would be equal only because
    /// both hold the shared <c>Empty</c> singleton. That inconsistency
    /// propagates straight into <see cref="GameState"/> equality, which
    /// compares <see cref="GameState.Contracts"/> value by value.
    /// </summary>
    public bool Equals(ContractState? other) =>
        other is not null
        && (ReferenceEquals(this, other)
            || (Id == other.Id
                && Payment == other.Payment
                && Risk == other.Risk
                && RequiredCrew == other.RequiredCrew
                && Status == other.Status
                && StructuralEquality.MembersEqual(RespondedBy, other.RespondedBy)
                && StructuralEquality.MembersEqual(AcceptedBy, other.AcceptedBy)
                && StructuralEquality.MembersEqual(Tags, other.Tags)));

    public override int GetHashCode() => HashCode.Combine(
        Id,
        Payment,
        Risk,
        RequiredCrew,
        Status,
        StructuralEquality.MembersHash(RespondedBy),
        StructuralEquality.MembersHash(AcceptedBy),
        StructuralEquality.MembersHash(Tags));
}
