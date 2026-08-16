using System.Collections.Immutable;

namespace OathAndCoin.Presentation;

/// <summary>
/// The localization keys <see cref="ResponseLine.Wavered"/> resolves to. A
/// bare <see cref="bool.ToString"/> is exactly the kind of code-composed,
/// unresolved player-facing string TDD §11.1 forbids — English
/// <c>True</c>/<c>False</c> reaching the frame regardless of locale — so
/// this gives the two-value flag the same key treatment as everything else
/// on the screen.
/// </summary>
public static class WaveredKeys
{
    public const string True = "response.wavered.true";

    public const string False = "response.wavered.false";

    /// <summary>Both keys <see cref="For"/> can produce, for the catalogue-completeness test.</summary>
    public static readonly ImmutableArray<string> AllKeys = ImmutableArray.Create(True, False);

    public static string For(bool wavered) => wavered ? True : False;
}
