using System.Collections.Immutable;
using System.Reflection;
using OathAndCoin.Content.Scenarios;
using OathAndCoin.Simulation.Decisions;

namespace OathAndCoin.Presentation.Tests;

/// <summary>
/// Every closed list this screen depends on, held to the thing it is a list
/// of.
/// </summary>
/// <remarks>
/// <para>
/// Review finding (branch-level): the drift guard existed in exactly one
/// place — <c>ReasonCodesTests.All_ListsEveryPublicConstant</c> — while five
/// more closed sets fed the same catalogue-completeness check with nothing
/// holding them to their own source of truth. A key family that silently
/// stopped listing one of its members would not fail anything: it would just
/// stop being checked, and the screen would show an untranslated key.
/// </para>
/// <para>
/// The enum-backed families (<see cref="QualitativeScale.AllKeys"/>,
/// <see cref="ScreenStateKeys.AllKeys"/>) are now built from
/// <see cref="Enum.GetValues{TEnum}"/>, so drift is impossible by
/// construction rather than merely detected; the tests below still assert the
/// count, because "derived from the enum" is a property of today's
/// implementation and a future hand-written literal would look identical from
/// the outside. The constant-backed families are held by reflection, the same
/// way reason codes already were.
/// </para>
/// </remarks>
public class ClosedListTests
{
    [Fact]
    public void QualitativeKeys_CoverEveryGrade()
    {
        Assert.Equal(Enum.GetValues<QualitativeGrade>().Length, QualitativeScale.AllKeys.Length);
        Assert.Equal(
            Enum.GetValues<QualitativeGrade>().Select(QualitativeScale.KeyFor),
            QualitativeScale.AllKeys);
    }

    [Fact]
    public void ScreenStateKeys_CoverEveryScreenState()
    {
        Assert.Equal(Enum.GetValues<ScreenState>().Length, ScreenStateKeys.AllKeys.Length);
        Assert.Equal(Enum.GetValues<ScreenState>().Select(ScreenStateKeys.For), ScreenStateKeys.AllKeys);
    }

    /// <summary>
    /// The manifest format cannot reference <see cref="ScreenState"/> — this
    /// assembly already depends on <c>OathAndCoin.Content</c>, so the reverse
    /// reference would be circular, and
    /// <see cref="ScenarioManifest.KnownScreenStates"/> therefore restates the
    /// five spellings by hand. Restated is fine; unchecked is not. This is the
    /// one place both sides are visible at once, so it is the one place the
    /// restatement can be held to the enum it restates.
    /// </summary>
    [Fact]
    public void ManifestKnownScreenStates_AreExactlyTheScreenStateNames()
    {
        var fromEnum = Enum.GetValues<ScreenState>()
            .Select(state => state.ToString().ToLowerInvariant())
            .ToImmutableArray();

        Assert.Equal(fromEnum, ScenarioManifest.KnownScreenStates);
    }

    [Fact]
    public void ActionKeys_CoverEveryAction()
    {
        Assert.Equal(Actions.All.Length, ActionKeys.AllKeys.Length);
        Assert.Equal(Actions.All.Select(action => ActionKeys.For(action.Value)), ActionKeys.AllKeys);
    }

    /// <summary>
    /// <see cref="WaveredKeys"/> has no enum to derive from — its domain is
    /// <see cref="bool"/> — so this states the exhaustiveness the type claims:
    /// both values of the flag resolve to a key, and to different ones.
    /// </summary>
    [Fact]
    public void WaveredKeys_CoverBothValuesOfTheFlag()
    {
        Assert.Equal(new[] { WaveredKeys.For(true), WaveredKeys.For(false) }, WaveredKeys.AllKeys);
        Assert.NotEqual(WaveredKeys.For(true), WaveredKeys.For(false));
    }

    [Fact]
    public void ErrorCodes_AllListsEveryPublicConstant()
    {
        var declared = PublicStringConstants(typeof(ErrorCodes));

        Assert.True(
            declared.SetEquals(ErrorCodes.All),
            "ErrorCodes.All does not list exactly the class's own public string constants.");
        Assert.Equal(ErrorCodes.All.Length, ErrorCodes.All.ToHashSet(StringComparer.Ordinal).Count);
    }

    [Fact]
    public void ErrorKeys_CoverEveryErrorCode()
    {
        Assert.Equal(ErrorCodes.All.Select(ErrorKeys.For), ErrorKeys.AllKeys);
    }

    private static HashSet<string> PublicStringConstants(Type type) => type
        .GetFields(BindingFlags.Public | BindingFlags.Static | BindingFlags.FlattenHierarchy)
        .Where(field => field.IsLiteral && field.FieldType == typeof(string))
        .Select(field => (string)field.GetRawConstantValue()!)
        .ToHashSet(StringComparer.Ordinal);
}
