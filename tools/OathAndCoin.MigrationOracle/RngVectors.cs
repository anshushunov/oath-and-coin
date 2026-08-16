using System.Globalization;
using System.Text.Json.Nodes;
using OathAndCoin.Simulation.Random;

namespace OathAndCoin.MigrationOracle;

/// <summary>
/// Every draw the migration has to reproduce exactly, frozen as rows.
/// </summary>
/// <remarks>
/// <para>
/// Values and ordinals are recorded as decimal strings, not JSON numbers: a
/// draw is a full 64-bit value, and JSON's number type is a double in every
/// reader the TypeScript port will use. A row written as a number would be
/// silently rounded on the way in and the port would then "match" a vector
/// that had already lost its low bits.
/// </para>
/// <para>
/// <see cref="DeterministicRng.DrawInt32"/> rows carry
/// <c>ordinals_consumed</c> because a rejected sample burns an ordinal the
/// value alone cannot report — the exact failure
/// <see cref="Int32Draw"/>'s own remarks record, where callers reported one
/// draw and the next decision restarted on an ordinal already used.
/// </para>
/// </remarks>
internal static class RngVectors
{
    /// <summary>
    /// Seeds every row is drawn under: zero and one (a mixer that dropped its
    /// seed entirely still differs from the golden values only away from
    /// them), the corpus seed, the seed the repository's own golden fixture
    /// and CI replay use, the SplitMix64 gamma constant itself, and both ends
    /// of the 64-bit range.
    /// </summary>
    private static readonly ulong[] Seeds =
    {
        0UL, 1UL, OracleEnvelope.Seed, 424242UL, 0x9E3779B97F4A7C15UL, ulong.MaxValue - 1UL, ulong.MaxValue,
    };

    /// <summary>
    /// Ordinals around zero — where every scenario in the corpus actually
    /// draws — plus both ends of the range, because the ordinal is added to a
    /// key before the second mix and the addition is unchecked.
    /// </summary>
    private static readonly ulong[] Ordinals =
    {
        0UL, 1UL, 2UL, 3UL, ulong.MaxValue - 1UL, ulong.MaxValue,
    };

    /// <summary>
    /// The range the production rules draw on
    /// (<c>ContractDecisionRule.MoodMin..MoodMax + 1</c>) first, then ranges
    /// that exercise the rejection arithmetic: the narrowest possible span,
    /// a power of two (which never rejects), and the widest span an
    /// <see cref="int"/> range can ask for.
    /// </summary>
    private static readonly (int Min, int Max)[] Ranges =
    {
        (-5, 6), (0, 1), (0, 2), (-1, 1), (0, 256), (int.MinValue, int.MaxValue),
    };

    /// <summary>
    /// The simulation's own golden fixture, restated as rows so deleting that
    /// file together with the C# tree does not delete the evidence it held.
    /// </summary>
    private const ulong GoldenSeed = 424242UL;

    private const int GoldenOrdinals = 16;

    internal static JsonObject Build() => new()
    {
        ["artifact_schema_version"] = OracleEnvelope.ArtifactSchemaVersion,
        ["algorithm_version"] = DeterministicRng.AlgorithmVersion,
        ["streams"] = new JsonArray(Enum.GetValues<RngStream>()
            .Select(stream => (JsonNode?)new JsonObject
            {
                ["name"] = stream.ToString(),
                ["value"] = (int)stream,
            })
            .ToArray()),
        ["raw_draws"] = RawDraws(),
        ["int32_draws"] = Int32Draws(),
        ["golden_fixture"] = new JsonObject
        {
            ["source"] = "tests/OathAndCoin.Simulation.Tests/Fixtures/rng-golden.json",
            ["campaign_seed"] = Text(GoldenSeed),
            ["stream"] = nameof(RngStream.HeroDecision),
            ["ordinals"] = GoldenOrdinals,
        },
    };

    private static JsonArray RawDraws()
    {
        var rows = new JsonArray();
        var seen = new HashSet<(ulong Seed, RngStream Stream, ulong Ordinal)>();

        void Add(ulong seed, RngStream stream, ulong ordinal)
        {
            if (!seen.Add((seed, stream, ordinal)))
            {
                return;
            }

            rows.Add(new JsonObject
            {
                ["campaign_seed"] = Text(seed),
                ["stream"] = stream.ToString(),
                ["stream_value"] = (int)stream,
                ["ordinal"] = Text(ordinal),
                ["value"] = Text(DeterministicRng.Draw(seed, stream, ordinal)),
            });
        }

        // Ordered stream-major, then seed, then ordinal, so the file reads in
        // one predictable order and a diff between two exports is a diff in
        // values rather than in layout.
        foreach (var stream in Enum.GetValues<RngStream>())
        {
            foreach (var seed in Seeds)
            {
                foreach (var ordinal in Ordinals)
                {
                    Add(seed, stream, ordinal);
                }
            }
        }

        for (var ordinal = 0UL; ordinal < GoldenOrdinals; ordinal++)
        {
            Add(GoldenSeed, RngStream.HeroDecision, ordinal);
        }

        return rows;
    }

    private static JsonArray Int32Draws()
    {
        var rows = new JsonArray();

        foreach (var stream in Enum.GetValues<RngStream>())
        {
            foreach (var seed in Seeds)
            {
                foreach (var (min, max) in Ranges)
                {
                    foreach (var ordinal in Ordinals)
                    {
                        var draw = DeterministicRng.DrawInt32(seed, stream, ordinal, min, max);

                        rows.Add(new JsonObject
                        {
                            ["campaign_seed"] = Text(seed),
                            ["stream"] = stream.ToString(),
                            ["stream_value"] = (int)stream,
                            ["ordinal"] = Text(ordinal),
                            ["min_inclusive"] = min,
                            ["max_exclusive"] = max,
                            ["value"] = draw.Value,
                            ["ordinals_consumed"] = Text(draw.OrdinalsConsumed),
                        });
                    }
                }
            }
        }

        return rows;
    }

    private static string Text(ulong value) => value.ToString(CultureInfo.InvariantCulture);
}
