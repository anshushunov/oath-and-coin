using System.Collections.Immutable;
using System.Linq;

namespace OathAndCoin.Presentation;

/// <summary>
/// The localization keys <see cref="ReasonLine.Direction"/> resolves to —
/// the same treatment <see cref="WaveredKeys"/> gives the other two-value
/// flag on this screen, and for the same reason: an enum member's own name
/// reaching a label would be code-composed, unlocalized player-facing text
/// (TDD §11.1).
/// </summary>
public static class ReasonDirectionKeys
{
    public const string Supported = "reason.direction.supported";

    public const string Opposed = "reason.direction.opposed";

    /// <summary>
    /// Every key <see cref="For"/> can produce, for the
    /// catalogue-completeness test. Built from
    /// <see cref="Enum.GetValues{TEnum}"/> rather than by naming the two
    /// members again, for the reason <see cref="QualitativeScale.AllKeys"/>
    /// states: a written-out list is a second declaration of a closed set
    /// that the compiler cannot check against the first.
    /// </summary>
    public static readonly ImmutableArray<string> AllKeys =
        Enum.GetValues<ReasonDirection>().Select(For).ToImmutableArray();

    public static string For(ReasonDirection direction) => direction switch
    {
        ReasonDirection.Supported => Supported,
        ReasonDirection.Opposed => Opposed,
        _ => throw new ArgumentOutOfRangeException(nameof(direction), direction, "Unknown reason direction."),
    };
}
