using System.Collections.Immutable;
using OathAndCoin.Simulation.Ids;

namespace OathAndCoin.Simulation.State;

/// <summary>
/// A hero's decision-relevant state (TDD §8). Three traits are a deliberate
/// spike minimum: MVP_PLAN §5.2 sketches 6-8, and the choice between a
/// utility model and a rule model is BQ-004, left open for Milestone 1.
/// </summary>
public sealed record HeroState
{
    public required HeroId Id { get; init; }

    /// <summary>The content definition this hero instance was created from.</summary>
    public required ContentId Definition { get; init; }

    /// <summary>
    /// Localization key for the hero's display name (TDD §11.1: gameplay
    /// values are kept separate from localization keys) — never a literal,
    /// player-facing string.
    /// </summary>
    public required string DisplayNameKey { get; init; }

    public required int Greed { get; init; }

    public required int Caution { get; init; }

    public required int Pride { get; init; }

    public required int TrustInGuild { get; init; }

    /// <summary>
    /// Trait ids the hero carries. Identifiers, not the
    /// <c>Content.TraitDefinition</c> objects themselves: state must stay
    /// serializable and must never pull the content it was built from along
    /// with it (TDD §11.1).
    /// </summary>
    public required ImmutableArray<ContentId> Traits { get; init; }

    /// <summary>
    /// This hero's opinion of other heroes, keyed by the other hero's content
    /// id. A sorted dictionary rather than <c>Content.HeroDefinition</c>'s
    /// array-of-pairs shape, because the decision rule needs to look a bond
    /// up by id, not scan a list for it — and sorted, like every other
    /// collection in state, for deterministic enumeration order.
    /// </summary>
    public required ImmutableSortedDictionary<ContentId, int> Relationships { get; init; }

    /// <summary>
    /// Member-wise on <see cref="Traits"/> and <see cref="Relationships"/>.
    /// Neither <see cref="ImmutableArray{T}"/> nor
    /// <see cref="ImmutableSortedDictionary{TKey,TValue}"/> overrides
    /// <c>Equals</c>, so the compiler-generated record equality this type
    /// would otherwise get compares them by reference — the same
    /// inconsistency described on <see cref="ContractState.Equals"/>, and for
    /// the same reason it has to be routed through
    /// <see cref="StructuralEquality"/> instead.
    /// </summary>
    public bool Equals(HeroState? other) =>
        other is not null
        && (ReferenceEquals(this, other)
            || (Id == other.Id
                && Definition == other.Definition
                && DisplayNameKey == other.DisplayNameKey
                && Greed == other.Greed
                && Caution == other.Caution
                && Pride == other.Pride
                && TrustInGuild == other.TrustInGuild
                && StructuralEquality.ElementsEqual(Traits, other.Traits)
                && StructuralEquality.EntriesEqual(Relationships, other.Relationships)));

    public override int GetHashCode()
    {
        var hash = default(HashCode);
        hash.Add(Id);
        hash.Add(Definition);
        hash.Add(DisplayNameKey);
        hash.Add(Greed);
        hash.Add(Caution);
        hash.Add(Pride);
        hash.Add(TrustInGuild);
        hash.Add(StructuralEquality.ElementsHash(Traits));
        hash.Add(StructuralEquality.EntriesHash(Relationships));
        return hash.ToHashCode();
    }
}
