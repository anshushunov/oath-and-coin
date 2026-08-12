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

    // Fix round 1 / I-1: DrawInt32's rejection branch is exercised by
    // exactly zero draws across every test above — for the widest span
    // (2^32 - 1, used by DrawInt32_HandlesFullIntRange) the rejection
    // probability is ~5.4e-20, so black-box sampling can never reach it.
    // The invariant that makes rejection sampling unbiased is asserted
    // directly against DeterministicRng.AcceptanceThreshold (internal,
    // exposed via InternalsVisibleTo) instead: threshold must be an exact
    // multiple of span, and within one span of ulong.MaxValue, for every
    // span DrawInt32 can ever compute (1 through 2^32 - 1).
    [Fact]
    public void AcceptanceThreshold_IsMultipleOfSpanAndNearMax()
    {
        ulong[] spans = { 1UL, 2UL, 3UL, 6UL, 7UL, 16UL, 97UL, 1024UL, 4294967295UL };

        foreach (var span in spans)
        {
            var threshold = DeterministicRng.AcceptanceThreshold(span);

            Assert.True(threshold % span == 0UL, $"threshold {threshold} is not a multiple of span {span}");
            Assert.True(
                threshold > ulong.MaxValue - span,
                $"threshold {threshold} is not within one span of ulong.MaxValue for span {span}");
        }
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
        //   # Program.cs: prints JSON object {algorithmVersion, campaignSeed,
        //   # stream, values} for Draw(424242, HeroDecision, i), i in 0..15
        //   dotnet run --project /tmp/rng-golden > tests/OathAndCoin.Simulation.Tests/Fixtures/rng-golden.json
        //   rm -rf /tmp/rng-golden
        //
        // Fix round 1 / I-2: the fixture carries algorithmVersion, seed and
        // stream alongside the values, and this test asserts all of them —
        // not just the numbers. Without that, someone could change Mix,
        // watch this test go red, regenerate the fixture, and leave
        // AlgorithmVersion at "/1": every test would go green again while
        // old saves kept claiming a version their bytes no longer match.
        const ulong seed = 424242UL;
        const RngStream stream = RngStream.HeroDecision;

        var path = Path.Combine(AppContext.BaseDirectory, "Fixtures", "rng-golden.json");
        var json = File.ReadAllText(path);
        var options = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };
        var fixture = JsonSerializer.Deserialize<GoldenVectorFixture>(json, options);

        Assert.NotNull(fixture);
        Assert.Equal(DeterministicRng.AlgorithmVersion, fixture!.AlgorithmVersion);
        Assert.Equal(seed, fixture.CampaignSeed);
        Assert.Equal(nameof(RngStream.HeroDecision), fixture.Stream);
        Assert.Equal(16, fixture.Values.Length);

        for (var i = 0; i < fixture.Values.Length; i++)
        {
            var actual = DeterministicRng.Draw(seed, stream, (ulong)i);
            Assert.Equal(fixture.Values[i], actual);
        }
    }

    private sealed record GoldenVectorFixture(string AlgorithmVersion, ulong CampaignSeed, string Stream, ulong[] Values);
}
