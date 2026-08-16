using System.Collections.Immutable;
using System.Linq;
using OathAndCoin.Simulation.Decisions;

namespace OathAndCoin.Presentation;

/// <summary>
/// Builds the localization key for a <see cref="ResponseLine.Action"/> (e.g.
/// <c>action:accept</c> → <c>action.accept</c>). <c>ResponseLine.Action</c>
/// is a plain string carrying <see cref="OathAndCoin.Simulation.Decisions.Actions"/>'s
/// own wire text rather than a <see cref="OathAndCoin.Simulation.Ids.ContentId"/>
/// (see that field's remarks), so this splits the same
/// <c>"namespace:name"</c> shape by hand instead of reusing
/// <see cref="TagKeys.For"/>, which takes a typed id.
/// </summary>
public static class ActionKeys
{
    /// <summary>
    /// Every key <see cref="For"/> can produce, for the catalogue-completeness
    /// test — derived from <see cref="Actions.All"/> rather than naming the
    /// two actions again here, so a third action cannot arrive in the core
    /// and quietly go unchecked against the catalogue.
    /// </summary>
    public static readonly ImmutableArray<string> AllKeys =
        Actions.All.Select(action => For(action.Value)).ToImmutableArray();

    public static string For(string action) => action.Replace(':', '.');
}
