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

    /// <summary>
    /// The schema pins the content format version with <c>const</c> and the
    /// loader states it as a constant; this keeps the two numbers equal. The
    /// same argument as the range bounds above: two statements of one rule are
    /// safe only while something checks they still agree.
    /// </summary>
    [Fact]
    public void SchemaVersionConst_MatchesLoaderSupportedVersion()
    {
        foreach (var schemaFile in new[] { "hero.schema.json", "contract.schema.json" })
        {
            using var schema = OpenSchema(schemaFile);

            Assert.Equal(
                ContentSet.SupportedContentSchemaVersion,
                schema.RootElement.GetProperty("properties").GetProperty("schema_version")
                    .GetProperty("const").GetInt32());

            Assert.Contains(
                schema.RootElement.GetProperty("required").EnumerateArray().Select(item => item.GetString()),
                name => name == "schema_version");
        }
    }

    /// <summary>
    /// Validation reads external data under the same ceilings the loader does
    /// (TDD §18), and reports a breach as a violation rather than as an
    /// exception or an out-of-memory kill.
    /// </summary>
    /// <remarks>
    /// This is where the depth limit is actually exercised: a validator walks
    /// whatever document it is handed, so unlike the loader — whose model has
    /// nothing to nest under — it can be given 40 nested arrays. Before this,
    /// validation read files with a bare <c>File.ReadAllText</c> and parsed
    /// them at the parser's default depth, so the most permissive way into the
    /// program was also the unbounded one.
    /// </remarks>
    [Fact]
    public void Validate_ReportsFilesThatBreachTheExternalDataLimits()
    {
        var schemas = ContentSchemas.Load(RepositoryFixtures.SchemaRoot);

        using var oversized = TempContentRoot.CreateEmpty();
        oversized.WriteHero(
            "bloated.json",
            "{\"display_name_key\": \"" + new string('x', (int)ContentLimits.MaxFileSizeBytes) + "\"}");

        var oversizedViolation = Assert.Single(schemas.Validate(oversized.Root));
        Assert.Contains("bloated.json", oversizedViolation.RelativePath, StringComparison.Ordinal);
        Assert.Contains("limit", oversizedViolation.Message, StringComparison.Ordinal);

        using var deep = TempContentRoot.CreateEmpty();
        var depth = ContentLimits.MaxJsonDepth + 8;
        deep.WriteHero("deep.json", new string('[', depth) + new string(']', depth));

        var deepViolation = Assert.Single(schemas.Validate(deep.Root));
        Assert.Contains("deep.json", deepViolation.RelativePath, StringComparison.Ordinal);
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
              "schema_version": 1,
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
