namespace OathAndCoin.Simulation.Ids;

/// <summary>
/// A stable identifier for a hero instance (ADR-005, planned — TDD §21).
/// Ordering is a plain integer comparison, which is inherently
/// locale-independent.
/// </summary>
public readonly record struct HeroId(int Value) : IComparable<HeroId>
{
    public int CompareTo(HeroId other) => Value.CompareTo(other.Value);
}
