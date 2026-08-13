using OathAndCoin.Simulation.Ids;
using OathAndCoin.Simulation.State;

namespace OathAndCoin.Content.Tests;

/// <summary>
/// The loader's contract: what it reads, what it refuses to read, and what it
/// hands to the simulation as an initial state.
/// </summary>
public class ContentSetTests
{
    private const string ValidHeroJson = """
        {
          "id": "core:hilda",
          "display_name_key": "hero.core.hilda.name",
          "greed": 50,
          "caution": 50,
          "trust_in_guild": 50
        }
        """;

    [Fact]
    public void Load_ReadsHeroesAndContracts()
    {
        var content = ContentSet.Load(RepositoryFixtures.ContentRoot);

        Assert.Equal(2, content.Heroes.Count);
        Assert.Single(content.Contracts);

        var bram = content.Heroes[ContentId.Parse("core:bram")];
        Assert.Equal("hero.core.bram.name", bram.DisplayNameKey);
        Assert.Equal(60, bram.Greed);
        Assert.Equal(30, bram.Caution);
        Assert.Equal(50, bram.TrustInGuild);

        var zara = content.Heroes[ContentId.Parse("core:zara")];
        Assert.Equal(20, zara.Greed);
        Assert.Equal(80, zara.Caution);
        Assert.Equal(40, zara.TrustInGuild);

        var contract = content.Contracts[ContentId.Parse("core:escort_the_caravan")];
        Assert.Equal("contract.core.escort_the_caravan.name", contract.DisplayNameKey);
        Assert.Equal(40, contract.Payment);
        Assert.Equal(50, contract.Risk);
    }

    /// <summary>
    /// Hero ids are assigned by content id, never by the order the filesystem
    /// happens to return files in — otherwise the same content would produce
    /// different states on different machines, and every seed-based
    /// reproduction claim below it would be worthless.
    /// </summary>
    [Fact]
    public void CreateInitialState_AssignsHeroIdsInContentIdOrder()
    {
        using var temp = TempContentRoot.CreateEmpty();

        // File names deliberately in the opposite order to the ids they carry:
        // ordinal file order is aaa < zzz, content id order is core:bram < core:zara.
        temp.WriteHero("aaa.json", """
            {
              "id": "core:zara",
              "display_name_key": "hero.core.zara.name",
              "greed": 20,
              "caution": 80,
              "trust_in_guild": 40
            }
            """);
        temp.WriteHero("zzz.json", """
            {
              "id": "core:bram",
              "display_name_key": "hero.core.bram.name",
              "greed": 60,
              "caution": 30,
              "trust_in_guild": 50
            }
            """);

        var state = ContentSet.Load(temp.Root).CreateInitialState(campaignSeed: 1, rulesetVersion: "test");

        Assert.Equal(ContentId.Parse("core:bram"), state.Hero(new HeroId(0)).Definition);
        Assert.Equal(ContentId.Parse("core:zara"), state.Hero(new HeroId(1)).Definition);
    }

    [Fact]
    public void CreateInitialState_IsRepeatable()
    {
        var first = ContentSet.Load(RepositoryFixtures.ContentRoot)
            .CreateInitialState(campaignSeed: 424242, rulesetVersion: "gate0");
        var second = ContentSet.Load(RepositoryFixtures.ContentRoot)
            .CreateInitialState(campaignSeed: 424242, rulesetVersion: "gate0");

        Assert.Equal(first, second);
    }

    [Fact]
    public void Load_FailsOnDuplicateId()
    {
        using var temp = TempContentRoot.CreateEmpty();
        temp.WriteHero("first.json", ValidHeroJson);
        temp.WriteHero("second.json", ValidHeroJson);

        var exception = Assert.Throws<InvalidDataException>(() => ContentSet.Load(temp.Root));

        Assert.Contains("core:hilda", exception.Message, StringComparison.Ordinal);
        Assert.Contains("first.json", exception.Message, StringComparison.Ordinal);
        Assert.Contains("second.json", exception.Message, StringComparison.Ordinal);
    }

    /// <summary>
    /// The range check belongs to the loader, not only to the schema: nothing
    /// forces a caller to run schema validation before loading, so a loader
    /// that trusted the file would let a 500-greed hero into the simulation
    /// through any path that skipped validation.
    /// </summary>
    [Fact]
    public void Load_FailsOnOutOfRangeValue()
    {
        using var temp = TempContentRoot.CreateEmpty();
        temp.WriteHero("greedy.json", """
            {
              "id": "core:hilda",
              "display_name_key": "hero.core.hilda.name",
              "greed": 500,
              "caution": 50,
              "trust_in_guild": 50
            }
            """);

        var exception = Assert.Throws<InvalidDataException>(() => ContentSet.Load(temp.Root));

        Assert.Contains("greedy.json", exception.Message, StringComparison.Ordinal);
        Assert.Contains("greed", exception.Message, StringComparison.Ordinal);
        Assert.Contains("500", exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Load_FailsOnUnknownProperty()
    {
        using var temp = TempContentRoot.CreateEmpty();
        temp.WriteHero("typo.json", """
            {
              "id": "core:hilda",
              "display_name_key": "hero.core.hilda.name",
              "greed": 50,
              "caution": 50,
              "trust_in_guild": 50,
              "trust_in_gild": 50
            }
            """);

        var exception = Assert.Throws<InvalidDataException>(() => ContentSet.Load(temp.Root));

        Assert.Contains("typo.json", exception.Message, StringComparison.Ordinal);
        Assert.Contains("trust_in_gild", exception.Message, StringComparison.Ordinal);
    }

    /// <summary>
    /// The version is computed from the bytes, not declared in a constant
    /// somebody has to remember to bump (spec §8.7).
    /// </summary>
    [Fact]
    public void ContentVersion_ChangesWhenContentChanges()
    {
        using var copy = TempContentRoot.CopyOfProductionContent();

        var production = ContentSet.Load(RepositoryFixtures.ContentRoot).ContentVersion;
        var untouchedCopy = ContentSet.Load(copy.Root).ContentVersion;

        // Same relative paths, same bytes, different absolute location: the
        // digest must not depend on where the tree lives.
        Assert.Equal(production, untouchedCopy);

        copy.WriteHero("bram.json", copy.ReadHero("bram.json").Replace("\"greed\": 60", "\"greed\": 61", StringComparison.Ordinal));

        Assert.NotEqual(production, ContentSet.Load(copy.Root).ContentVersion);
    }

    [Fact]
    public void ContentVersion_IsStableAcrossRuns()
    {
        Assert.Equal(
            ContentDigest.Compute(RepositoryFixtures.ContentRoot),
            ContentDigest.Compute(RepositoryFixtures.ContentRoot));
    }
}
