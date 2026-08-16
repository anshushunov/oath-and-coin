using System.Reflection;
using OathAndCoin.Simulation.Decisions;

namespace OathAndCoin.Simulation.Tests;

/// <summary>
/// <see cref="ReasonCodes.All"/> is a hand-written list next to a comment
/// warning that a hand-written list drifts from the class's own constants —
/// and nothing checked that it hadn't already, or wouldn't the next time a
/// code is added or renamed (review finding, Important 6). A code missing
/// from <c>All</c> would silently drop out of
/// <c>ContractOfferScreenModelTests.EveryTagReasonAndGradeKeyExistsInTheCatalogue</c>,
/// which is the one place <c>All</c> exists to feed.
/// </summary>
public class ReasonCodesTests
{
    [Fact]
    public void All_ListsEveryPublicConstant()
    {
        var declaredConstants = typeof(ReasonCodes)
            .GetFields(BindingFlags.Public | BindingFlags.Static | BindingFlags.FlattenHierarchy)
            .Where(field => field.IsLiteral && field.FieldType == typeof(string))
            .Select(field => (string)field.GetRawConstantValue()!)
            .ToHashSet(StringComparer.Ordinal);

        Assert.True(
            declaredConstants.SetEquals(ReasonCodes.All),
            "ReasonCodes.All does not list exactly the class's own public string constants.");
    }

    [Fact]
    public void All_HasNoDuplicates()
    {
        Assert.Equal(ReasonCodes.All.Length, ReasonCodes.All.ToHashSet(StringComparer.Ordinal).Count);
    }
}
