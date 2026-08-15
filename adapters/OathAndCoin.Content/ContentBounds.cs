using OathAndCoin.Simulation.Decisions;

namespace OathAndCoin.Content;

/// <summary>
/// The one place a content range is written down as a number. The JSON
/// schemas in <c>schemas/</c> state the same ranges again, in the only form a
/// schema can state them — as literals — and
/// <c>SchemaAgreementTests</c> asserts the two statements agree.
/// </summary>
/// <remarks>
/// Both statements are needed and neither is redundant: the schema is what an
/// author's editor and the validation stage check against (TDD §11.2 stage 1),
/// the constants are what the loader enforces on every load, including the
/// loads that never ran validation. What must not exist is a third,
/// hand-copied statement of the same range inside a scoring function.
/// </remarks>
public static class ContentBounds
{
    public const int TraitMin = 0;

    /// <summary>
    /// Derived from <see cref="ContractDecisionRule.TraitScale"/>, not stated
    /// again as a literal: the scoring function divides trait-weighted terms
    /// by that span, so a ceiling raised here without the divisor following
    /// would be accepted by this loader and by the schema while every one of
    /// those terms quietly weakened. <c>SchemaAgreementTests</c> holds the
    /// schema literal to this value, which now makes one chain — divisor,
    /// bound, schema — rather than three independent numbers that happen to
    /// read 100.
    /// </summary>
    public const int TraitMax = TraitMin + ContractDecisionRule.TraitScale;

    public const int PaymentMin = 0;
    public const int PaymentMax = 100;

    public const int RiskMin = 0;
    public const int RiskMax = 100;

    public const int InclinationWeightMin = -30;
    public const int InclinationWeightMax = 30;

    public const int RelationshipWeightMin = -20;
    public const int RelationshipWeightMax = 20;

    public const int RequiredCrewMin = 1;
    public const int RequiredCrewMax = 6;

    // Pride deliberately gets no constants of its own: it is a hero scale,
    // the same kind of value greed, caution and trust_in_guild are, so its
    // range is TraitMin..TraitMax. A second pair of constants carrying the
    // same numbers would drift from this one the first time either changed.
}
