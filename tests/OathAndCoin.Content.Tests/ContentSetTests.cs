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
          "schema_version": 2,
          "id": "core:hilda",
          "display_name_key": "hero.core.hilda.name",
          "greed": 50,
          "caution": 50,
          "pride": 50,
          "trust_in_guild": 50,
          "traits": [],
          "relationships": []
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

    [Fact]
    public void Load_ReadsTraitDefinitions()
    {
        using var root = TempContentRoot.CreateEmpty();
        root.WriteTrait("hates_the_cult", """
            {"schema_version":2,"id":"core:hates_the_cult","display_name_key":"trait.core.hates_the_cult.name",
             "kind":"inclination","tag":"target:cult","weight":12}
            """);

        var content = ContentSet.Load(root.Root);

        var trait = content.Traits[ContentId.Parse("core:hates_the_cult")];
        Assert.Equal(TraitKind.Inclination, trait.Kind);
        Assert.Equal(ContentId.Parse("target:cult"), trait.Tag);
        Assert.Equal(12, trait.Weight);
    }

    [Fact]
    public void Load_ReadsPrincipleWithoutWeight()
    {
        using var root = TempContentRoot.CreateEmpty();
        root.WriteTrait("will_not_strike_a_temple", """
            {"schema_version":2,"id":"core:will_not_strike_a_temple",
             "display_name_key":"trait.core.will_not_strike_a_temple.name",
             "kind":"principle","tag":"target:temple"}
            """);

        var trait = ContentSet.Load(root.Root).Traits[ContentId.Parse("core:will_not_strike_a_temple")];

        Assert.Equal(TraitKind.Principle, trait.Kind);
        Assert.Equal(0, trait.Weight);
    }

    [Fact]
    public void Load_RejectsWeightOnPrinciple()
    {
        using var root = TempContentRoot.CreateEmpty();
        root.WriteTrait("bad", """
            {"schema_version":2,"id":"core:bad","display_name_key":"trait.core.bad.name",
             "kind":"principle","tag":"target:temple","weight":5}
            """);

        var error = Assert.Throws<InvalidDataException>(() => ContentSet.Load(root.Root));

        Assert.Contains("principle", error.Message, StringComparison.Ordinal);
        Assert.Contains("weight", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Load_RejectsSchemaVersionOne()
    {
        using var root = TempContentRoot.CreateEmpty();
        root.WriteHero("bram", """
            {"schema_version":1,"id":"core:bram","display_name_key":"hero.core.bram.name",
             "greed":60,"caution":30,"trust_in_guild":50}
            """);

        var error = Assert.Throws<InvalidDataException>(() => ContentSet.Load(root.Root));

        Assert.Contains(
            $"version {ContentSet.SupportedContentSchemaVersion}",
            error.Message,
            StringComparison.Ordinal);
    }

    /// <summary>
    /// The scenario the previous test actually has to cover, and does not on
    /// its own: a real pre-Task-1 content tree has <c>heroes/</c> and
    /// <c>contracts/</c>, but no <c>traits/</c> directory at all —
    /// <see cref="TempContentRoot.CreateEmpty"/> always creates one, so the
    /// previous test alone would stay green even if <see cref="ContentSet.Load"/>
    /// tried <c>traits/</c> first and failed with "no 'traits' directory"
    /// instead of ever reporting the version mismatch.
    /// </summary>
    [Fact]
    public void Load_RejectsSchemaVersionOneWithoutTraitsDirectory()
    {
        var root = Path.Combine(Path.GetTempPath(), "oath-and-coin-tests", Guid.NewGuid().ToString("n"));
        Directory.CreateDirectory(Path.Combine(root, "heroes"));
        Directory.CreateDirectory(Path.Combine(root, "contracts"));
        try
        {
            File.WriteAllText(Path.Combine(root, "heroes", "bram.json"), """
                {"schema_version":1,"id":"core:bram","display_name_key":"hero.core.bram.name",
                 "greed":60,"caution":30,"trust_in_guild":50}
                """);

            var error = Assert.Throws<InvalidDataException>(() => ContentSet.Load(root));

            Assert.Contains(
                $"version {ContentSet.SupportedContentSchemaVersion}",
                error.Message,
                StringComparison.Ordinal);
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public void Load_ReadsHeroTraitsAndRelationships()
    {
        using var root = TempContentRoot.CreateEmpty();
        root.WriteTrait("hates_the_cult", """
            {"schema_version":2,"id":"core:hates_the_cult","display_name_key":"trait.core.hates_the_cult.name",
             "kind":"inclination","tag":"target:cult","weight":12}
            """);
        root.WriteHero("zara", HeroJson("core:zara"));
        root.WriteHero("bram", """
            {"schema_version":2,"id":"core:bram","display_name_key":"hero.core.bram.name",
             "greed":60,"caution":30,"pride":45,"trust_in_guild":50,
             "traits":["core:hates_the_cult"],
             "relationships":[{"hero":"core:zara","weight":-8}]}
            """);

        var hero = ContentSet.Load(root.Root).Heroes[ContentId.Parse("core:bram")];

        Assert.Equal(45, hero.Pride);
        Assert.Equal(ContentId.Parse("core:hates_the_cult"), Assert.Single(hero.Traits));
        var bond = Assert.Single(hero.Relationships);
        Assert.Equal(ContentId.Parse("core:zara"), bond.Hero);
        Assert.Equal(-8, bond.Weight);
    }

    [Fact]
    public void Load_ReadsContractTagsAndCrew()
    {
        using var root = TempContentRoot.CreateEmpty();
        root.WriteContract("escort", """
            {"schema_version":2,"id":"core:escort","display_name_key":"contract.core.escort.name",
             "payment":40,"risk":50,"required_crew":4,"tags":["target:bandits","patron:merchant_guild"]}
            """);

        var contract = ContentSet.Load(root.Root).Contracts[ContentId.Parse("core:escort")];

        Assert.Equal(4, contract.RequiredCrew);
        Assert.Equal(
            new[] { ContentId.Parse("patron:merchant_guild"), ContentId.Parse("target:bandits") },
            contract.Tags.OrderBy(t => t).ToArray());
    }

    [Theory]
    [InlineData(ContentBounds.InclinationWeightMin - 1)]
    [InlineData(ContentBounds.InclinationWeightMax + 1)]
    public void Load_RejectsInclinationWeightOutOfRange(int value)
    {
        using var root = TempContentRoot.CreateEmpty();
        root.WriteTrait("bad", $$"""
            {"schema_version":2,"id":"core:bad","display_name_key":"trait.core.bad.name",
             "kind":"inclination","tag":"target:cult","weight":{{value}}}
            """);

        var error = Assert.Throws<InvalidDataException>(() => ContentSet.Load(root.Root));

        Assert.Contains("weight", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Load_RejectsUnknownTraitKind()
    {
        using var root = TempContentRoot.CreateEmpty();
        root.WriteTrait("bad", """
            {"schema_version":2,"id":"core:bad","display_name_key":"trait.core.bad.name",
             "kind":"obsession","tag":"target:cult"}
            """);

        var error = Assert.Throws<InvalidDataException>(() => ContentSet.Load(root.Root));

        Assert.Contains("unknown kind", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Load_RejectsTooManyTraits()
    {
        using var root = TempContentRoot.CreateEmpty();
        var traits = string.Join(
            ",",
            Enumerable.Range(0, ContentLimits.MaxTraitsPerHero + 1).Select(i => $"\"core:trait_{i}\""));
        root.WriteHero("bram", $$"""
            {"schema_version":2,"id":"core:bram","display_name_key":"hero.core.bram.name",
             "greed":60,"caution":30,"pride":50,"trust_in_guild":50,
             "traits":[{{traits}}],"relationships":[]}
            """);

        var error = Assert.Throws<InvalidDataException>(() => ContentSet.Load(root.Root));

        Assert.Contains("traits", error.Message, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(ContentBounds.RelationshipWeightMin - 1)]
    [InlineData(ContentBounds.RelationshipWeightMax + 1)]
    public void Load_RejectsRelationshipWeightOutOfRange(int weight)
    {
        using var root = TempContentRoot.CreateEmpty();
        root.WriteHero("bram", $$"""
            {"schema_version":2,"id":"core:bram","display_name_key":"hero.core.bram.name",
             "greed":60,"caution":30,"pride":50,"trust_in_guild":50,
             "traits":[],"relationships":[{"hero":"core:zara","weight":{{weight}}}]}
            """);

        var error = Assert.Throws<InvalidDataException>(() => ContentSet.Load(root.Root));

        Assert.Contains("weight", error.Message, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(ContentBounds.RequiredCrewMin - 1)]
    [InlineData(ContentBounds.RequiredCrewMax + 1)]
    public void Load_RejectsRequiredCrewOutOfRange(int requiredCrew)
    {
        using var root = TempContentRoot.CreateEmpty();
        root.WriteContract("escort", $$"""
            {"schema_version":2,"id":"core:escort","display_name_key":"contract.core.escort.name",
             "payment":40,"risk":50,"required_crew":{{requiredCrew}},"tags":[]}
            """);

        var error = Assert.Throws<InvalidDataException>(() => ContentSet.Load(root.Root));

        Assert.Contains("required_crew", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Load_RejectsFileWithoutIntegerSchemaVersion()
    {
        using var root = TempContentRoot.CreateEmpty();
        root.WriteHero("bram", """
            {"id":"core:bram","display_name_key":"hero.core.bram.name",
             "greed":60,"caution":30,"pride":50,"trust_in_guild":50,"traits":[],"relationships":[]}
            """);

        var error = Assert.Throws<InvalidDataException>(() => ContentSet.Load(root.Root));

        Assert.Contains("schema_version", error.Message, StringComparison.Ordinal);
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
        temp.WriteHero("aaa", """
            {
              "schema_version": 2,
              "id": "core:zara",
              "display_name_key": "hero.core.zara.name",
              "greed": 20,
              "caution": 80,
              "pride": 50,
              "trust_in_guild": 40,
              "traits": [],
              "relationships": []
            }
            """);
        temp.WriteHero("zzz", """
            {
              "schema_version": 2,
              "id": "core:bram",
              "display_name_key": "hero.core.bram.name",
              "greed": 60,
              "caution": 30,
              "pride": 50,
              "trust_in_guild": 50,
              "traits": [],
              "relationships": []
            }
            """);

        var state = ContentSet.Load(temp.Root).CreateInitialState(campaignSeed: 1, rulesetVersion: "test");

        Assert.Equal(ContentId.Parse("core:bram"), state.Hero(new HeroId(0)).Definition);
        Assert.Equal(ContentId.Parse("core:zara"), state.Hero(new HeroId(1)).Definition);
    }

    [Fact]
    public void CreateInitialState_CopiesTraitsTagsAndCrew()
    {
        var content = ContentSet.Load(RepositoryFixtures.ContentRoot);

        var state = content.CreateInitialState(campaignSeed: 1, rulesetVersion: "test/1");

        var contract = state.Contracts[ContentId.Parse("core:escort_the_caravan")];
        Assert.Equal(4, contract.RequiredCrew);
        Assert.Empty(contract.AcceptedBy);
        Assert.Contains(ContentId.Parse("target:bandits"), contract.Tags);

        var bram = state.Heroes.Values.Single(h => h.Definition == ContentId.Parse("core:bram"));
        Assert.NotEmpty(bram.Traits);
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
        temp.WriteHero("first", ValidHeroJson);
        temp.WriteHero("second", ValidHeroJson);

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
        temp.WriteHero("greedy", """
            {
              "schema_version": 2,
              "id": "core:hilda",
              "display_name_key": "hero.core.hilda.name",
              "greed": 500,
              "caution": 50,
              "pride": 50,
              "trust_in_guild": 50,
              "traits": [],
              "relationships": []
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
        temp.WriteHero("typo", """
            {
              "schema_version": 2,
              "id": "core:hilda",
              "display_name_key": "hero.core.hilda.name",
              "greed": 50,
              "caution": 50,
              "pride": 50,
              "trust_in_guild": 50,
              "traits": [],
              "relationships": [],
              "trust_in_gild": 50
            }
            """);

        var exception = Assert.Throws<InvalidDataException>(() => ContentSet.Load(temp.Root));

        Assert.Contains("typo.json", exception.Message, StringComparison.Ordinal);
        Assert.Contains("trust_in_gild", exception.Message, StringComparison.Ordinal);
    }

    /// <summary>
    /// A file authored for another version of the format is refused, not read
    /// under this version's assumptions (TDD §11.1). The dangerous case is not
    /// a field that disappeared — that fails as a missing member — but one
    /// whose meaning changed while its name and type stayed put.
    /// </summary>
    [Fact]
    public void Load_FailsOnUnsupportedSchemaVersion()
    {
        using var temp = TempContentRoot.CreateEmpty();
        temp.WriteHero("future", ValidHeroJson.Replace(
            "\"schema_version\": 2",
            "\"schema_version\": 3",
            StringComparison.Ordinal));

        var exception = Assert.Throws<InvalidDataException>(() => ContentSet.Load(temp.Root));

        Assert.Contains("future.json", exception.Message, StringComparison.Ordinal);
        Assert.Contains("schema_version 3", exception.Message, StringComparison.Ordinal);
    }

    /// <summary>
    /// External data has a ceiling before it is allocated for (TDD §18).
    /// </summary>
    /// <remarks>
    /// The depth ceiling from the same options cannot be demonstrated on this
    /// path today, and that is a fact about the model rather than a gap in the
    /// test: every property of a hero or a contract is a scalar, so there is
    /// nothing legal to nest 32 levels deep — a deeply nested value is refused
    /// as a type mismatch or an unknown property before the reader ever gets
    /// that far. The depth limit is exercised where documents really are
    /// walked structurally: see
    /// <c>SchemaAgreementTests.Validate_ReportsFilesThatBreachTheExternalDataLimits</c>.
    /// </remarks>
    [Fact]
    public void Load_FailsOnOversizedFile()
    {
        using var temp = TempContentRoot.CreateEmpty();
        temp.WriteHero("bloated", ValidHeroJson.Replace(
            "\"display_name_key\": \"hero.core.hilda.name\"",
            "\"display_name_key\": \"" + new string('x', (int)ContentLimits.MaxFileSizeBytes) + "\"",
            StringComparison.Ordinal));

        var exception = Assert.Throws<InvalidDataException>(() => ContentSet.Load(temp.Root));

        Assert.Contains("bloated.json", exception.Message, StringComparison.Ordinal);
        Assert.Contains("limit", exception.Message, StringComparison.Ordinal);
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

        copy.WriteHero("bram", copy.ReadHero("bram").Replace("\"greed\": 60", "\"greed\": 61", StringComparison.Ordinal));

        Assert.NotEqual(production, ContentSet.Load(copy.Root).ContentVersion);
    }

    [Fact]
    public void ContentVersion_IsStableAcrossRuns()
    {
        Assert.Equal(
            ContentDigest.Compute(RepositoryFixtures.ContentRoot),
            ContentDigest.Compute(RepositoryFixtures.ContentRoot));
    }

    [Fact]
    public void Load_RejectsUnknownTraitReference()
    {
        using var root = TempContentRoot.CreateEmpty();
        root.WriteHero("bram", HeroJson("core:bram", traits: """["core:missing"]"""));

        var error = Assert.Throws<InvalidDataException>(() => ContentSet.Load(root.Root));

        Assert.Contains("core:missing", error.Message, StringComparison.Ordinal);
        Assert.Contains("core:bram", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Load_RejectsDuplicateTraitOnHero()
    {
        using var root = TempContentRoot.CreateEmpty();
        root.WriteTrait("hates_the_cult", InclinationJson("core:hates_the_cult", "target:cult", 12));
        root.WriteHero("bram", HeroJson("core:bram", traits: """["core:hates_the_cult","core:hates_the_cult"]"""));

        var error = Assert.Throws<InvalidDataException>(() => ContentSet.Load(root.Root));

        Assert.Contains("core:hates_the_cult", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Load_RejectsSelfRelationship()
    {
        using var root = TempContentRoot.CreateEmpty();
        root.WriteHero("bram", HeroJson("core:bram", relationships: """[{"hero":"core:bram","weight":5}]"""));

        var error = Assert.Throws<InvalidDataException>(() => ContentSet.Load(root.Root));

        Assert.Contains("itself", error.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Load_RejectsDuplicateRelationshipTarget()
    {
        using var root = TempContentRoot.CreateEmpty();
        root.WriteHero("zara", HeroJson("core:zara"));
        root.WriteHero("bram", HeroJson(
            "core:bram",
            relationships: """[{"hero":"core:zara","weight":5},{"hero":"core:zara","weight":-5}]"""));

        Assert.Throws<InvalidDataException>(() => ContentSet.Load(root.Root));
    }

    [Fact]
    public void Load_RejectsRelationshipToUnknownHero()
    {
        using var root = TempContentRoot.CreateEmpty();
        root.WriteHero("bram", HeroJson("core:bram", relationships: """[{"hero":"core:ghost","weight":5}]"""));

        var error = Assert.Throws<InvalidDataException>(() => ContentSet.Load(root.Root));

        Assert.Contains("core:ghost", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Load_AcceptsPartialSetWhereNoContractCarriesTheTag()
    {
        using var root = TempContentRoot.CreateEmpty();
        root.WriteTrait("hates_the_cult", InclinationJson("core:hates_the_cult", "target:cult", 12));
        root.WriteHero("bram", HeroJson("core:bram", traits: """["core:hates_the_cult"]"""));

        var content = ContentSet.Load(root.Root);

        Assert.Single(content.Heroes);
    }

    /// <summary>
    /// A valid version-2 hero file with every scalar at a neutral default, so
    /// a reference-integrity test only has to spell out the one field it
    /// cares about.
    /// </summary>
    private static string HeroJson(string id, string traits = "[]", string relationships = "[]") =>
        $$"""
        {
          "schema_version": 2,
          "id": "{{id}}",
          "display_name_key": "hero.test.name",
          "greed": 50,
          "caution": 50,
          "pride": 50,
          "trust_in_guild": 50,
          "traits": {{traits}},
          "relationships": {{relationships}}
        }
        """;

    /// <summary>A valid version-2 inclination trait file.</summary>
    private static string InclinationJson(string id, string tag, int weight) =>
        $$"""
        {
          "schema_version": 2,
          "id": "{{id}}",
          "display_name_key": "trait.test.name",
          "kind": "inclination",
          "tag": "{{tag}}",
          "weight": {{weight}}
        }
        """;
}
