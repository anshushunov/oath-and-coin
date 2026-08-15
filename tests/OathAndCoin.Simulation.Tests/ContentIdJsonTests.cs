using System.Collections.Immutable;
using System.Text.Json;
using OathAndCoin.Simulation.Ids;
using OathAndCoin.Simulation.State;

namespace OathAndCoin.Simulation.Tests;

/// <summary>
/// Pins that <see cref="ContentId"/> survives JSON in both directions, and
/// that an identifier which is not a valid <c>namespace:name</c> fails loudly
/// on the way in.
/// </summary>
/// <remarks>
/// Before the converter shipped with the type, the round trip was silently
/// lossy: serializing produced
/// <c>{"Namespace":"core","Name":"bram","Value":"core:bram"}</c> (the struct's
/// three read-only properties), and deserializing that same document returned
/// <c>default(ContentId)</c> with no exception, because there was nothing for
/// the serializer to assign. A <see cref="HeroState"/> read back that way
/// looked entirely valid, went into a dictionary as a key, and threw
/// somewhere else entirely — which is exactly what the next plan (content
/// loading from JSON) would have walked into on day one.
/// </remarks>
public class ContentIdJsonTests
{
    // Deliberately the plain default options: the converter has to be found
    // through the attribute on the type, because a caller who has to
    // remember to register it is a caller who will eventually forget.
    private static readonly JsonSerializerOptions Options = new();

    [Theory]
    [InlineData("core:bram")]
    [InlineData("core:escort_the_caravan")]
    [InlineData("mod_north:hero_2")]
    public void ContentId_RoundTripsThroughJson(string text)
    {
        var original = ContentId.Parse(text);

        var json = JsonSerializer.Serialize(original, Options);
        var restored = JsonSerializer.Deserialize<ContentId>(json, Options);

        Assert.Equal($"\"{text}\"", json);
        Assert.Equal(original, restored);
        Assert.Equal(text, restored.Value);
        Assert.Equal(original.Namespace, restored.Namespace);
        Assert.Equal(original.Name, restored.Name);
    }

    [Fact]
    public void ContentId_RoundTripsAsPartOfAnEnclosingObject()
    {
        var hero = new HeroState
        {
            Id = new HeroId(1),
            Definition = ContentId.Parse("core:bram"),
            DisplayNameKey = "hero.display_name.bram",
            Greed = 5,
            Caution = 4,
            Pride = 2,
            TrustInGuild = 3,
            Traits = ImmutableArray<ContentId>.Empty,
            Relationships = ImmutableSortedDictionary<ContentId, int>.Empty,
        };

        var restored = JsonSerializer.Deserialize<HeroState>(JsonSerializer.Serialize(hero, Options), Options);

        Assert.NotNull(restored);
        Assert.Equal(hero.Definition, restored!.Definition);
        Assert.Equal("core:bram", restored.Definition.Value);
    }

    // Dictionary keys go through a different path in System.Text.Json than
    // values do (WriteAsPropertyName/ReadAsPropertyName), so a converter that
    // only implements Read/Write leaves this case broken while the value case
    // looks fixed. Contracts are keyed by ContentId in campaign state.
    [Fact]
    public void ContentId_RoundTripsAsADictionaryKey()
    {
        var source = ImmutableSortedDictionary<ContentId, int>.Empty
            .Add(ContentId.Parse("core:escort_the_caravan"), 100)
            .Add(ContentId.Parse("core:clear_the_mine"), 250);

        var json = JsonSerializer.Serialize(source, Options);
        var restored = JsonSerializer.Deserialize<Dictionary<ContentId, int>>(json, Options);

        Assert.Contains("\"core:escort_the_caravan\":", json, StringComparison.Ordinal);
        Assert.NotNull(restored);
        Assert.Equal(2, restored!.Count);
        Assert.Equal(100, restored[ContentId.Parse("core:escort_the_caravan")]);
        Assert.Equal(250, restored[ContentId.Parse("core:clear_the_mine")]);
    }

    [Theory]
    [InlineData("\"\"")]
    [InlineData("\"bram\"")]
    [InlineData("\"core:\"")]
    [InlineData("\"Core:bram\"")]
    [InlineData("\"core:bram:extra\"")]
    [InlineData("\"core: bram\"")]
    public void Deserialize_RejectsMalformedIdWithADiagnosticMessage(string json)
    {
        var exception = Assert.Throws<JsonException>(() => JsonSerializer.Deserialize<ContentId>(json, Options));

        Assert.Contains("namespace:name", exception.Message, StringComparison.Ordinal);
        Assert.IsType<FormatException>(exception.InnerException);
    }

    // The shape that used to succeed: the object System.Text.Json itself
    // produced before the converter existed must now be rejected outright
    // rather than quietly becoming default(ContentId).
    [Fact]
    public void Deserialize_RejectsTheOldPropertyBagShapeInsteadOfYieldingDefault()
    {
        const string legacyShape = """{"Namespace":"core","Name":"bram","Value":"core:bram"}""";

        var exception = Assert.Throws<JsonException>(() => JsonSerializer.Deserialize<ContentId>(legacyShape, Options));

        Assert.Contains("ContentId", exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Deserialize_RejectsAnEnclosingObjectCarryingAnInvalidId()
    {
        const string json = """
            {"Id":{"Value":1},"Definition":"NOT AN ID","DisplayNameKey":"k","Greed":1,"Caution":1,"TrustInGuild":1}
            """;

        var exception = Assert.Throws<JsonException>(() => JsonSerializer.Deserialize<HeroState>(json, Options));

        Assert.Contains("NOT AN ID", exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Deserialize_RejectsAMalformedDictionaryKey()
    {
        const string json = """{"not an id":1}""";

        Assert.Throws<JsonException>(() => JsonSerializer.Deserialize<Dictionary<ContentId, int>>(json, Options));
    }
}
