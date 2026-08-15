using System.Text.Json.Nodes;
using Json.Schema;
using OathAndCoin.Content.Scenarios;
using OathAndCoin.Simulation.Decisions;

namespace OathAndCoin.Content.Tests;

/// <summary>
/// Milestone 1's exit criterion, made automatic: changing one understandable
/// condition predictably changes a hero's answer. Each shipped contrast under
/// <see cref="RepositoryFixtures.ContrastFiles"/> is exactly one such claim —
/// same content, same seed, same hero, same contract, one named input varied
/// — and <see cref="EveryShippedContrastFlipsAsDeclared"/> is the test that
/// none of them is lying about the direction it claims.
/// </summary>
public class ContrastTests
{
    [Fact]
    public void EveryShippedContrastFlipsAsDeclared()
    {
        foreach (var path in RepositoryFixtures.ContrastFiles())
        {
            var definition = ContrastDefinition.Load(path);

            var result = ContrastRunner.Run(definition);

            Assert.True(
                result.Flipped,
                $"Contrast '{definition.Name}' varies {definition.Input} from {definition.From} to "
                + $"{definition.To} and expected {definition.Expect}, but the answer stayed {result.ActionFrom}.");
        }
    }

    /// <summary>
    /// <c>schemas/contrast.schema.json</c> was named by no <c>.cs</c> file in
    /// the repository: shipped contrasts were never validated against their
    /// own schema, unlike content files and scenario manifests. A schema
    /// nothing loads is documentation, not validation.
    /// </summary>
    /// <remarks>
    /// The positive control is the same idiom
    /// <c>SchemaAgreementTests.AllContentFiles_SatisfyTheirSchema</c> and
    /// <c>ScenarioManifestTests.AllScenarioManifests_SatisfyTheirSchema</c>
    /// use: a green loop has to mean "checked and clean", not "found nothing
    /// to check".
    /// </remarks>
    [Fact]
    public void EveryShippedContrast_SatisfiesItsSchema()
    {
        var schema = JsonSchema.FromText(
            File.ReadAllText(Path.Combine(RepositoryFixtures.SchemaRoot, "contrast.schema.json")));
        var options = new EvaluationOptions { OutputFormat = OutputFormat.List };

        var files = RepositoryFixtures.ContrastFiles();
        Assert.NotEmpty(files);

        foreach (var path in files)
        {
            var result = schema.Evaluate(JsonNode.Parse(File.ReadAllText(path)), options);

            Assert.True(
                result.IsValid,
                $"Shipped contrast '{Path.GetFileName(path)}' violates contrast.schema.json.");
        }

        var rejected = schema.Evaluate(
            JsonNode.Parse("""
                {"schema_version":1,"contrast":"broken","content_root":"content","seed":1,
                 "hero":"core:bram","contract":"core:escort_the_caravan",
                 "vary":{"input":"hero.greed","from":10,"to":90},"expect":"decline_to_accept"}
                """),
            options);

        Assert.False(rejected.IsValid, "The schema accepted a vary.input outside its own closed list.");
    }

    /// <summary>
    /// The floor <c>ScenarioCoverageTests.AtLeastTwentyScenariosAreShipped</c>
    /// already gives the scenarios, applied to contrasts, which had none:
    /// <see cref="EveryShippedContrastFlipsAsDeclared"/> walks a directory, so
    /// an emptied, renamed or moved <c>scenarios/contrasts/</c> turns
    /// Milestone 1's exit criterion into a green loop over nothing.
    /// </summary>
    /// <remarks>
    /// Two claims, because a count alone would be satisfied by four contrasts
    /// all varying the payment. Every input a contrast is allowed to vary
    /// (<see cref="ContrastDefinition.AllowedInputs"/>) must have a shipped
    /// contrast demonstrating it — the closed list and the shipped set are
    /// checked against each other rather than each being trusted on its own,
    /// so adding a fifth allowed input without a contrast for it fails here
    /// instead of silently widening what "one understandable condition" may
    /// mean.
    /// </remarks>
    [Fact]
    public void EveryAllowedContrastInputHasAShippedContrast()
    {
        var inputs = RepositoryFixtures.ContrastFiles()
            .Select(ContrastDefinition.Load)
            .Select(definition => definition.Input)
            .ToHashSet(StringComparer.Ordinal);

        Assert.Equal(ContrastDefinition.AllowedInputs.Order(StringComparer.Ordinal), inputs.Order(StringComparer.Ordinal));
        Assert.True(
            RepositoryFixtures.ContrastFiles().Count >= ContrastDefinition.AllowedInputs.Length,
            $"Only {RepositoryFixtures.ContrastFiles().Count} contrasts are shipped, fewer than the "
            + $"{ContrastDefinition.AllowedInputs.Length} inputs a contrast may vary.");
    }

    /// <summary>
    /// The ordinals are compared after each branch's one command, not before
    /// it — see the remarks on <see cref="ContrastResult"/>. Read beforehand
    /// this compared 0 with 0 on two freshly built states and could not have
    /// failed; the assertion below fails the moment one branch takes the gate
    /// path and spends nothing while the other scores and draws a mood.
    /// </summary>
    [Fact]
    public void ContrastRunner_UsesTheSameSeedAndOrdinalOnBothSides()
    {
        foreach (var path in RepositoryFixtures.ContrastFiles())
        {
            var definition = ContrastDefinition.Load(path);

            var result = ContrastRunner.Run(definition);

            Assert.Equal(result.OrdinalUsedFrom, result.OrdinalUsedTo);

            // And that the number means something: a pair of zeroes would be
            // equal too, and would say the decision never reached the dice.
            Assert.Equal(1UL, result.OrdinalUsedFrom);
        }
    }

    [Fact]
    public void ContrastDefinition_RejectsAnInputOutsideTheClosedList()
    {
        var error = Assert.Throws<InvalidDataException>(() =>
            ContrastDefinition.Parse("""
                {"schema_version":1,"contrast":"bad","content_root":"content","seed":1,
                 "hero":"core:bram","contract":"core:escort_the_caravan",
                 "vary":{"input":"hero.greed","from":10,"to":90},"expect":"decline_to_accept"}
                """));

        Assert.Contains("hero.greed", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void ContrastDefinition_RejectsFromEqualToTo()
    {
        Assert.Throws<InvalidDataException>(() => ContrastDefinition.Parse(
            ContrastJson(input: "contract.payment", from: "30", to: "30")));
    }

    /// <summary>
    /// Guards <see cref="ContrastResult.Flipped"/>'s own honesty: a contrast
    /// whose declared direction does not match what its two branches actually
    /// answered must not be reported as flipped, even though the two answers
    /// genuinely differ. Built from the real, shipped <c>payment_raised</c>
    /// contrast (which does decline-to-accept) with its own
    /// <see cref="ContrastDefinition.Expect"/> overridden to the wrong
    /// direction — so this is a permanent stand-in for the manual check this
    /// task's report once described as a one-off edit-and-revert: a future
    /// change to <see cref="ContrastRunner.Run"/> that loosened "matches the
    /// declared direction" into "the two answers differ" would fail this test
    /// immediately.
    /// </summary>
    [Fact]
    public void ContrastRunner_DoesNotCountAMismatchedDirectionAsFlipped()
    {
        var declaredBackwards = ContrastDefinition.Load(RepositoryFixtures.Contrast("payment_raised"))
            with
        {
            Expect = "accept_to_decline",
        };

        var result = ContrastRunner.Run(declaredBackwards);

        Assert.Equal(Actions.Decline, result.ActionFrom);
        Assert.Equal(Actions.Accept, result.ActionTo);
        Assert.False(
            result.Flipped,
            "The two answers differ, but the declared direction (accept_to_decline) does not match them "
            + "(decline_to_accept) — this must not count as flipped.");
    }

    /// <summary>
    /// Builds a minimal, otherwise-valid contrast JSON body with
    /// <paramref name="input"/>, <paramref name="from"/> and
    /// <paramref name="to"/> substituted in raw — the latter two as literal
    /// JSON text, not C# values, so a caller can hand either a number
    /// (<c>"30"</c>) or an array (<c>"[\"target:undead\"]"</c>) through the
    /// same helper.
    /// </summary>
    private static string ContrastJson(string input, string from, string to) =>
        $$"""
        {"schema_version":1,"contrast":"test","content_root":"content","seed":1,
         "hero":"core:bram","contract":"core:escort_the_caravan",
         "vary":{"input":"{{input}}","from":{{from}},"to":{{to}}},"expect":"decline_to_accept"}
        """;
}
