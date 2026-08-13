using OathAndCoin.Simulation.Ids;

namespace OathAndCoin.Simulation.Tests;

/// <summary>
/// Verifies <see cref="ContentId"/> (ADR-005, planned — TDD §21): a
/// stable, namespaced content identifier that cannot exist in an invalid
/// state. Construction goes only
/// through <see cref="ContentId.Parse"/>/<see cref="ContentId.TryParse"/>,
/// ordering is ordinal (never culture-dependent), and the struct's own
/// <c>default</c> value is treated as uninitialized rather than a silent
/// empty id.
/// </summary>
public class ContentIdTests
{
    [Theory]
    [InlineData("core:bram", "core", "bram")]
    [InlineData("core:escort_the_caravan", "core", "escort_the_caravan")]
    [InlineData("mod_north:hero_2", "mod_north", "hero_2")]
    public void Parse_AcceptsValidNamespacedId(string input, string expectedNamespace, string expectedName)
    {
        var id = ContentId.Parse(input);

        Assert.Equal(input, id.Value);
        Assert.Equal(expectedNamespace, id.Namespace);
        Assert.Equal(expectedName, id.Name);
    }

    [Theory]
    [InlineData("")]
    [InlineData("bram")]
    [InlineData("core:")]
    [InlineData(":bram")]
    [InlineData("Core:bram")]
    [InlineData("core:Bram")]
    [InlineData("core:bram:extra")]
    [InlineData("core: bram")]
    [InlineData("1core:bram")]
    [InlineData(null)]
    public void TryParse_RejectsMalformedId(string? input)
    {
        var accepted = ContentId.TryParse(input, out var result);

        Assert.False(accepted);
        Assert.Equal(default, result);
    }

    [Theory]
    [InlineData("")]
    [InlineData("bram")]
    [InlineData("core:")]
    [InlineData(":bram")]
    [InlineData("Core:bram")]
    [InlineData("core:Bram")]
    [InlineData("core:bram:extra")]
    [InlineData("core: bram")]
    [InlineData("1core:bram")]
    [InlineData(null)]
    public void Parse_ThrowsWithDiagnosticMessage(string? input)
    {
        var exception = Assert.Throws<FormatException>(() => ContentId.Parse(input));

        Assert.Contains(input ?? "null", exception.Message, StringComparison.Ordinal);
        Assert.Contains("namespace:name", exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Sorting_IsOrdinal()
    {
        var ids = new[]
        {
            ContentId.Parse("core:zara"),
            ContentId.Parse("core:bram"),
            ContentId.Parse("alt:bram"),
        };

        Array.Sort(ids);

        Assert.Equal(
            new[] { "alt:bram", "core:bram", "core:zara" },
            Array.ConvertAll(ids, id => id.Value));
    }

    [Fact]
    public void Equality_IsByValue()
    {
        var left = ContentId.Parse("core:bram");
        var right = ContentId.Parse("core:bram");
        var different = ContentId.Parse("core:zara");

        Assert.Equal(left, right);
        Assert.True(left == right);
        Assert.False(left != right);
        Assert.Equal(left.GetHashCode(), right.GetHashCode());

        Assert.NotEqual(left, different);
        Assert.False(left == different);
        Assert.True(left != different);
    }

    [Fact]
    public void Default_ThrowsOnAccess()
    {
        var id = default(ContentId);

        var exception = Assert.Throws<InvalidOperationException>(() => id.Value);
        Assert.Contains("ContentId", exception.Message, StringComparison.Ordinal);
    }
}
