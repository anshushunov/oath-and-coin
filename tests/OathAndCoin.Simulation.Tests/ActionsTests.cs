using System.Reflection;
using OathAndCoin.Simulation.Decisions;
using OathAndCoin.Simulation.Ids;

namespace OathAndCoin.Simulation.Tests;

/// <summary>
/// The same guard <see cref="ReasonCodesTests"/> puts on
/// <see cref="ReasonCodes.All"/>, for the action vocabulary: a third action
/// added to <see cref="Actions"/> and left out of <see cref="Actions.All"/>
/// would drop out of <c>OathAndCoin.Presentation.ActionKeys.AllKeys</c>, and
/// therefore out of the catalogue-completeness test that list exists to feed
/// — silently, with nothing red.
/// </summary>
public class ActionsTests
{
    [Fact]
    public void All_ListsEveryPublicAction()
    {
        var declared = typeof(Actions)
            .GetFields(BindingFlags.Public | BindingFlags.Static | BindingFlags.FlattenHierarchy)
            .Where(field => field.FieldType == typeof(ContentId))
            .Select(field => (ContentId)field.GetValue(null)!)
            .ToHashSet();

        Assert.True(
            declared.SetEquals(Actions.All),
            "Actions.All does not list exactly the class's own public ContentId fields.");
    }

    [Fact]
    public void All_HasNoDuplicates() => Assert.Equal(Actions.All.Length, Actions.All.ToHashSet().Count);
}
