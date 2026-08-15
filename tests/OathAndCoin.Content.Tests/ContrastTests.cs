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

    [Fact]
    public void ContrastRunner_UsesTheSameSeedAndOrdinalOnBothSides()
    {
        var definition = ContrastDefinition.Load(RepositoryFixtures.Contrast("payment_raised"));

        var result = ContrastRunner.Run(definition);

        Assert.Equal(result.OrdinalUsedFrom, result.OrdinalUsedTo);
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
