using System.Text.Json;
using OathAndCoin.Simulation.Random;

namespace OathAndCoin.Simulation.Tests;

/// <summary>
/// Task 2 (ADR-003): the deterministic RNG must be a pure function of
/// (campaignSeed, stream, ordinal) with no internal state, so a saved game
/// can resume the exact same sequence just by knowing how many draws each
/// stream has already produced.
/// </summary>
public class DeterministicRngTests
{
    [Fact]
    public void Draw_IsPureFunctionOfItsArguments()
    {
        const ulong seed = 12345UL;
        const RngStream stream = RngStream.Combat;
        const ulong ordinal = 42UL;

        var first = DeterministicRng.Draw(seed, stream, ordinal);

        // Interleave unrelated draws in between: a stateful generator would
        // drift here, a pure function of its arguments cannot.
        _ = DeterministicRng.Draw(seed + 1UL, stream, ordinal);
        _ = DeterministicRng.Draw(seed, RngStream.WorldTick, ordinal);
        _ = DeterministicRng.Draw(seed, stream, ordinal + 1UL);

        var second = DeterministicRng.Draw(seed, stream, ordinal);

        Assert.Equal(first, second);
    }

    [Fact]
    public void Draw_DiffersAcrossStreams()
    {
        const ulong seed = 777UL;
        const ulong ordinal = 3UL;

        var streams = Enum.GetValues<RngStream>();
        var values = streams.Select(stream => DeterministicRng.Draw(seed, stream, ordinal)).ToArray();

        Assert.Equal(streams.Length, values.Distinct().Count());
    }

    [Fact]
    public void Draw_DiffersAcrossOrdinals()
    {
        const ulong seed = 99UL;
        const RngStream stream = RngStream.WorldGeneration;

        var values = Enumerable.Range(0, 1000)
            .Select(i => DeterministicRng.Draw(seed, stream, (ulong)i))
            .ToHashSet();

        Assert.True(values.Count >= 999, $"expected at least 999 distinct values, got {values.Count}");
    }

    [Fact]
    public void Draw_DiffersAcrossSeeds()
    {
        const RngStream stream = RngStream.ExpeditionEvent;
        const ulong ordinal = 5UL;

        var values = Enumerable.Range(0, 1000)
            .Select(i => DeterministicRng.Draw((ulong)i, stream, ordinal))
            .ToHashSet();

        Assert.True(values.Count >= 999, $"expected at least 999 distinct values, got {values.Count}");
    }

    [Fact]
    public void DrawInt32_StaysWithinRange()
    {
        const ulong seed = 2024UL;
        const RngStream stream = RngStream.HeroDecision;

        for (ulong ordinal = 0; ordinal < 100_000UL; ordinal++)
        {
            var value = DeterministicRng.DrawInt32(seed, stream, ordinal, -5, 6);
            Assert.InRange(value, -5, 5);
        }
    }

    [Fact]
    public void DrawInt32_HandlesFullIntRange()
    {
        const ulong seed = 55555UL;
        const RngStream stream = RngStream.WorldGeneration;
        const int minInclusive = int.MinValue;
        const int maxExclusive = int.MaxValue;

        // Independent oracle: widen to long/ulong before subtracting so the
        // width computation itself cannot overflow, mirroring what the
        // production formula must do for this exact edge case.
        var span = (ulong)((long)maxExclusive - (long)minInclusive);

        for (ulong ordinal = 0; ordinal < 500UL; ordinal++)
        {
            var exception = Record.Exception(
                () => DeterministicRng.DrawInt32(seed, stream, ordinal, minInclusive, maxExclusive));
            Assert.Null(exception);

            var actual = DeterministicRng.DrawInt32(seed, stream, ordinal, minInclusive, maxExclusive);
            var rawSample = DeterministicRng.Draw(seed, stream, ordinal);
            var expected = (int)((long)minInclusive + (long)(rawSample % span));

            Assert.Equal(expected, actual);
            Assert.True(actual >= minInclusive && (long)actual < (long)maxExclusive);
        }
    }

    [Fact]
    public void DrawInt32_RejectsEmptyRange()
    {
        Assert.Throws<ArgumentOutOfRangeException>(
            () => DeterministicRng.DrawInt32(1UL, RngStream.Combat, 0UL, 5, 5));
        Assert.Throws<ArgumentOutOfRangeException>(
            () => DeterministicRng.DrawInt32(1UL, RngStream.Combat, 0UL, 5, 4));
    }

    [Fact]
    public void Draw_MatchesCommittedGoldenVector()
    {
        // Golden vector generated once via a throwaway console app (deleted
        // afterwards, never committed) and pinned here so an accidental
        // change to the algorithm shows up as a failing test rather than a
        // silent replay break:
        //
        //   dotnet new console -o /tmp/rng-golden -f net8.0
        //   dotnet add /tmp/rng-golden reference simulation/OathAndCoin.Simulation
        //   # Program.cs: prints JSON array of Draw(424242, HeroDecision, i) for i in 0..15
        //   dotnet run --project /tmp/rng-golden > tests/OathAndCoin.Simulation.Tests/Fixtures/rng-golden.json
        //   rm -rf /tmp/rng-golden
        const ulong seed = 424242UL;
        const RngStream stream = RngStream.HeroDecision;

        var path = Path.Combine(AppContext.BaseDirectory, "Fixtures", "rng-golden.json");
        var json = File.ReadAllText(path);
        var expected = JsonSerializer.Deserialize<ulong[]>(json);

        Assert.NotNull(expected);
        Assert.Equal(16, expected!.Length);

        for (var i = 0; i < expected.Length; i++)
        {
            var actual = DeterministicRng.Draw(seed, stream, (ulong)i);
            Assert.Equal(expected[i], actual);
        }
    }
}
