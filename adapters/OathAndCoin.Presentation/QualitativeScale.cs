using System.Collections.Immutable;
using System.Linq;

namespace OathAndCoin.Presentation;

/// <summary>
/// The five-step qualitative vocabulary every hero-facing number is
/// translated into before it reaches a screen. The interface never shows the
/// player a number besides an objective fact like a payment in coins — an
/// exact probability turns a hero's choice into an equation to solve instead
/// of a character to read, which is the interpretive space this game is
/// built around. Two different underlying scales map onto the same five
/// grades through two different thresholds (<see cref="ForValue"/> for a
/// 0..100 hero trait, <see cref="ForMagnitude"/> for a reason's unbounded
/// strength), because "35" means something different on each.
/// </summary>
public enum QualitativeGrade
{
    Negligible,
    Low,
    Moderate,
    High,
    Extreme,
}

/// <summary>
/// Maps a raw integer onto <see cref="QualitativeGrade"/>. Both scales are
/// plain integer comparisons — no floating point, matching every other
/// gameplay number in the core (TDD §7.4) — and both are total: every
/// <see cref="int"/> maps to exactly one grade, so a caller never has to ask
/// "what if the value is out of range".
/// </summary>
public static class QualitativeScale
{
    /// <summary>
    /// Every <c>qualitative.*</c> localization key this scale can produce,
    /// for <c>EveryTagReasonAndGradeKeyExistsInTheCatalogue</c> to check
    /// against a locale catalogue without enumerating the five grades by
    /// hand.
    /// </summary>
    /// <remarks>
    /// Built from <see cref="Enum.GetValues{TEnum}"/>, not from a written-out
    /// list of the five grades. A written-out list is a second declaration of
    /// a closed set that the compiler cannot check against the first: a sixth
    /// grade added to <see cref="QualitativeGrade"/> and forgotten here would
    /// simply stop being checked against the catalogue, and the completeness
    /// test this feeds would keep passing while the screen showed an
    /// untranslated key.
    /// </remarks>
    public static readonly ImmutableArray<string> AllKeys =
        Enum.GetValues<QualitativeGrade>().Select(KeyFor).ToImmutableArray();

    /// <summary>
    /// The hero scale: greed, caution, pride and a contract's risk are all
    /// authored within <c>ContentBounds.TraitMin..TraitMax</c> (0..100), and
    /// this is the fixed five-band split of that range.
    /// </summary>
    public static QualitativeGrade ForValue(int value) => value switch
    {
        <= 9 => QualitativeGrade.Negligible,
        <= 34 => QualitativeGrade.Low,
        <= 64 => QualitativeGrade.Moderate,
        <= 89 => QualitativeGrade.High,
        _ => QualitativeGrade.Extreme,
    };

    /// <summary>
    /// The reason scale: a <c>TraceFactor.Magnitude</c> has no authored
    /// ceiling — it is a product or a sum of several authored values — so
    /// this band is wider and open-ended at the top rather than clamped to
    /// 100.
    /// </summary>
    public static QualitativeGrade ForMagnitude(int magnitude) => magnitude switch
    {
        <= 4 => QualitativeGrade.Negligible,
        <= 14 => QualitativeGrade.Low,
        <= 29 => QualitativeGrade.Moderate,
        <= 59 => QualitativeGrade.High,
        _ => QualitativeGrade.Extreme,
    };

    /// <summary>
    /// The localization key a grade resolves to, in the game (a later task) —
    /// exposed publicly because building this key by hand at a call site
    /// would be exactly the kind of ad hoc string assembly <see cref="TagKeys"/>
    /// and <see cref="OathAndCoin.Simulation.Decisions.ReasonCodes"/> both
    /// exist to avoid.
    /// </summary>
    public static string KeyFor(QualitativeGrade grade) => "qualitative." + grade switch
    {
        QualitativeGrade.Negligible => "negligible",
        QualitativeGrade.Low => "low",
        QualitativeGrade.Moderate => "moderate",
        QualitativeGrade.High => "high",
        QualitativeGrade.Extreme => "extreme",
        _ => throw new ArgumentOutOfRangeException(nameof(grade), grade, "Unknown qualitative grade."),
    };
}
