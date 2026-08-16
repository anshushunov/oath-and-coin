using System.Text.Json;
using OathAndCoin.Content.Scenarios;
using OathAndCoin.Simulation.Decisions;

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
    /// <summary>
    /// The one check that links the hero-trait range to the divisor the
    /// scoring function actually uses. <see cref="ContentBounds.TraitMax"/> is
    /// derived from <see cref="ContractDecisionRule.TraitScale"/>, so this
    /// cannot fail today — which is the point: it fails the moment someone
    /// writes the number back in as a literal, which is how the third
    /// statement of this range got into the scoring function the first time.
    /// </summary>
    [Fact]
    public void TraitRange_IsTheSameSpanTheDecisionRuleDividesBy()
    {
        Assert.Equal(ContractDecisionRule.TraitScale, ContentBounds.TraitMax - ContentBounds.TraitMin);
    }

    [Fact]
    public void HeroSchemaBounds_MatchContentBounds()
    {
        using var schema = OpenSchema("hero.schema.json");

        foreach (var trait in new[] { "greed", "caution", "pride", "trust_in_guild" })
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
        Assert.Equal(ContentBounds.RequiredCrewMin, ReadBound(schema, "required_crew", "minimum"));
        Assert.Equal(ContentBounds.RequiredCrewMax, ReadBound(schema, "required_crew", "maximum"));
    }

    [Fact]
    public void TraitSchemaBounds_MatchContentBounds()
    {
        using var schema = OpenSchema("trait.schema.json");

        Assert.Equal(ContentBounds.InclinationWeightMin, ReadBound(schema, "weight", "minimum"));
        Assert.Equal(ContentBounds.InclinationWeightMax, ReadBound(schema, "weight", "maximum"));
    }

    [Fact]
    public void HeroSchemaRelationshipBounds_MatchContentBounds()
    {
        using var schema = OpenSchema("hero.schema.json");

        var weight = schema.RootElement
            .GetProperty("properties")
            .GetProperty("relationships")
            .GetProperty("items")
            .GetProperty("properties")
            .GetProperty("weight");

        Assert.Equal(ContentBounds.RelationshipWeightMin, weight.GetProperty("minimum").GetInt32());
        Assert.Equal(ContentBounds.RelationshipWeightMax, weight.GetProperty("maximum").GetInt32());
    }

    [Fact]
    public void HeroSchemaLimits_MatchContentLimits()
    {
        using var schema = OpenSchema("hero.schema.json");

        Assert.Equal(
            ContentLimits.MaxTraitsPerHero,
            schema.RootElement.GetProperty("properties").GetProperty("traits").GetProperty("maxItems").GetInt32());
        Assert.Equal(
            ContentLimits.MaxRelationshipsPerHero,
            schema.RootElement.GetProperty("properties").GetProperty("relationships")
                .GetProperty("maxItems").GetInt32());
    }

    [Fact]
    public void ContractSchemaLimits_MatchContentLimits()
    {
        using var schema = OpenSchema("contract.schema.json");

        Assert.Equal(
            ContentLimits.MaxTagsPerContract,
            schema.RootElement.GetProperty("properties").GetProperty("tags").GetProperty("maxItems").GetInt32());
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
        foreach (var schemaFile in new[] { "hero.schema.json", "contract.schema.json", "trait.schema.json" })
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
    /// The rule the whole trait format exists for — a principle never carries
    /// weight — is expressed in the schema only through <c>oneOf</c>. Nothing
    /// else in this file exercises that branch: every other schema test here
    /// runs valid content through it. Collapsing <c>oneOf</c> into a flat
    /// schema (say, just making <c>weight</c> optional) would leave every
    /// other test in this class green while this exact combination stopped
    /// being rejected.
    /// </summary>
    [Fact]
    public void TraitSchema_RejectsPrincipleWithWeight()
    {
        var schemas = ContentSchemas.Load(RepositoryFixtures.SchemaRoot);

        using var temp = TempContentRoot.CreateEmpty();
        temp.WriteTrait("bad", """
            {"schema_version":2,"id":"core:bad","display_name_key":"trait.core.bad.name",
             "kind":"principle","tag":"target:temple","weight":5}
            """);

        var violations = schemas.Validate(temp.Root);

        Assert.NotEmpty(violations);
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
            "bloated",
            "{\"display_name_key\": \"" + new string('x', (int)ContentLimits.MaxFileSizeBytes) + "\"}");

        var oversizedViolation = Assert.Single(schemas.Validate(oversized.Root));
        Assert.Contains("bloated.json", oversizedViolation.RelativePath, StringComparison.Ordinal);
        Assert.Contains("limit", oversizedViolation.Message, StringComparison.Ordinal);

        using var deep = TempContentRoot.CreateEmpty();
        var depth = ContentLimits.MaxJsonDepth + 8;
        deep.WriteHero("deep", new string('[', depth) + new string(']', depth));

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
        // validate would pass the assertion above forever (AGENTS.md §8).
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

        var controlViolations = schemas.Validate(temp.Root);

        Assert.Contains(
            controlViolations,
            violation => violation.RelativePath.Contains("greedy.json", StringComparison.Ordinal));
    }

    /// <summary>
    /// The fixture content roots under <c>scenarios/fixtures/</c> get the same
    /// stage-1 validation the production tree gets.
    /// </summary>
    /// <remarks>
    /// Review finding (branch-level): these roots are loaded by
    /// <see cref="RepositoryFixtures.RunScenario"/> through
    /// <c>ContentSet.Load</c>, which enforces the loader's own invariants but
    /// never runs a schema over anything — so a fixture could carry a field no
    /// schema allows, or miss one every schema requires, and nothing would
    /// say so. Discovered by walking <c>scenarios/fixtures/</c> rather than
    /// from a list, so a fixture added tomorrow is covered by the same rule as
    /// today's.
    /// </remarks>
    [Fact]
    public void EveryScenarioFixtureContentRoot_SatisfiesItsSchema()
    {
        var schemas = ContentSchemas.Load(RepositoryFixtures.SchemaRoot);
        var roots = Directory.GetDirectories(Path.Combine(RepositoryFixtures.ScenarioRoot, "fixtures"))
            .OrderBy(path => path, StringComparer.Ordinal)
            .ToList();

        // A floor, for the same reason the contrast and scenario counts have
        // one: an emptied or renamed fixtures/ directory would otherwise make
        // this a green loop over nothing.
        Assert.NotEmpty(roots);

        foreach (var root in roots)
        {
            var violations = schemas.Validate(root);

            Assert.True(
                violations.IsEmpty,
                $"Fixture content root '{Path.GetFileName(root)}' violates its schema:" + Environment.NewLine
                + string.Join(
                    Environment.NewLine,
                    violations.Select(v => $"  {v.RelativePath} {v.InstanceLocation}: {v.Message}")));
        }
    }

    /// <summary>
    /// The closed sets a contrast may name, stated twice — once in
    /// <c>schemas/contrast.schema.json</c> for an author's editor, once in
    /// <see cref="ContrastDefinition"/> for the loader — and, until now,
    /// never compared. A schema listing an input the loader rejects is
    /// content that validates in tooling and then fails to load; the reverse
    /// is worse.
    /// </summary>
    [Fact]
    public void ContrastSchemaEnums_MatchTheClosedListsInCode()
    {
        using var schema = OpenSchema("contrast.schema.json");

        var inputs = schema.RootElement
            .GetProperty("properties").GetProperty("vary")
            .GetProperty("properties").GetProperty("input")
            .GetProperty("enum").EnumerateArray().Select(value => value.GetString()!);

        Assert.Equal(ContrastDefinition.AllowedInputs, inputs);

        var expectations = schema.RootElement
            .GetProperty("properties").GetProperty("expect")
            .GetProperty("enum").EnumerateArray().Select(value => value.GetString()!);

        Assert.Equal(ContrastDefinition.AllowedExpectations, expectations);
    }

    /// <summary>
    /// The same comparison for the manifest format's own two closed sets:
    /// which outcomes a scenario may declare, and which screen state it may
    /// name. <see cref="ScenarioManifest.KnownScreenStates"/> is itself held
    /// to the <c>ScreenState</c> enum by
    /// <c>OathAndCoin.Presentation.Tests.ClosedListTests</c>, so the schema,
    /// the manifest reader and the enum are one chain rather than three
    /// independent opinions.
    /// </summary>
    [Fact]
    public void ScenarioManifestSchemaEnums_MatchTheClosedListsInCode()
    {
        using var schema = OpenSchema("scenario-manifest.schema.json");

        var outcomes = schema.RootElement
            .GetProperty("properties").GetProperty("expected_outcome")
            .GetProperty("enum").EnumerateArray().Select(value => value.GetString()!);

        Assert.Equal(
            Enum.GetValues<ScenarioOutcomeKind>().Select(kind => kind.ToString().ToLowerInvariant()),
            outcomes);

        var screenStates = schema.RootElement
            .GetProperty("properties").GetProperty("expected_screen_state")
            .GetProperty("enum").EnumerateArray().Select(value => value.GetString()!);

        Assert.Equal(ScenarioManifest.KnownScreenStates, screenStates);
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
