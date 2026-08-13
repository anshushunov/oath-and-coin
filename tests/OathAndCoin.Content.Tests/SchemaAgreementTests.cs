using System.Text.Json;

namespace OathAndCoin.Content.Tests;

/// <summary>
/// The tests that keep the two independent statements of the same rule from
/// drifting apart: the JSON Schema an author's editor checks against, and the
/// <see cref="ContentBounds"/> constants the loader enforces at runtime. A
/// schema that says 0..200 while the loader says 0..100 is not a harmless
/// mismatch — it is content that validates in tooling and then fails to load,
/// or worse, the reverse.
///
/// <see cref="AllContentFiles_SatisfyTheirSchema"/> is validation stage 1 from
/// TDD §11.2, implemented as a test rather than as a separate CLI: it runs in
/// every PR without anything else having to remember to invoke it.
/// </summary>
public class SchemaAgreementTests
{
    [Fact]
    public void HeroSchemaBounds_MatchContentBounds()
    {
        using var schema = OpenSchema("hero.schema.json");

        foreach (var trait in new[] { "greed", "caution", "trust_in_guild" })
        {
            Assert.Equal(ContentBounds.TraitMin, ReadBound(schema, trait, "minimum"));
            Assert.Equal(ContentBounds.TraitMax, ReadBound(schema, trait, "maximum"));
        }
    }

    [Fact]
    public void ContractSchemaBounds_MatchContentBounds()
    {
        using var schema = OpenSchema("contract.schema.json");

        Assert.Equal(ContentBounds.PaymentMin, ReadBound(schema, "payment", "minimum"));
        Assert.Equal(ContentBounds.PaymentMax, ReadBound(schema, "payment", "maximum"));
        Assert.Equal(ContentBounds.RiskMin, ReadBound(schema, "risk", "minimum"));
        Assert.Equal(ContentBounds.RiskMax, ReadBound(schema, "risk", "maximum"));
    }

    [Fact]
    public void AllContentFiles_SatisfyTheirSchema()
    {
        var schemas = ContentSchemas.Load(RepositoryFixtures.SchemaRoot);

        var violations = schemas.Validate(RepositoryFixtures.ContentRoot);

        Assert.True(
            violations.IsEmpty,
            "Production content violates its schema:" + Environment.NewLine
            + string.Join(Environment.NewLine, violations.Select(v => $"  {v.RelativePath} {v.InstanceLocation}: {v.Message}")));

        // Positive control: a green run above must mean "checked and clean",
        // not "checked nothing". A validator that silently found no files to
        // validate would pass the assertion above forever (spec §8.3).
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

        var controlViolations = schemas.Validate(temp.Root);

        Assert.Contains(
            controlViolations,
            violation => violation.RelativePath.Contains("greedy.json", StringComparison.Ordinal));
    }

    private static JsonDocument OpenSchema(string fileName) =>
        JsonDocument.Parse(File.ReadAllText(Path.Combine(RepositoryFixtures.SchemaRoot, fileName)));

    private static int ReadBound(JsonDocument schema, string propertyName, string bound) =>
        schema.RootElement
            .GetProperty("properties")
            .GetProperty(propertyName)
            .GetProperty(bound)
            .GetInt32();
}
