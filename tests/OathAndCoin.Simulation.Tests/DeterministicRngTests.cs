using System.Text.Json;
using OathAndCoin.Simulation.Random;

namespace OathAndCoin.Simulation.Tests;

/// <summary>
/// Task 2 (ADR-003, planned — TDD §21): the deterministic RNG must be a pure
/// function of (campaignSeed, stream, ordinal) with no internal state, so a saved game
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
            var draw = DeterministicRng.DrawInt32(seed, stream, ordinal, -5, 6);
            Assert.InRange(draw.Value, -5, 5);
            Assert.Equal(1UL, draw.OrdinalsConsumed);
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

            Assert.Equal(expected, actual.Value);
            Assert.Equal(1UL, actual.OrdinalsConsumed);
            Assert.True(actual.Value >= minInclusive && (long)actual.Value < (long)maxExclusive);
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

    // Fix round 6 / R-1: on rejection DrawInt32 advanced a *local* ordinal
    // and returned a bare int, so the extra ordinals it burned were invisible
    // to the caller. The caller could only report `drawsConsumed: 1` to
    // GameState.WithEvent, leaving NextDecisionOrdinal on an ordinal that had
    // already been drawn *and accepted* — so the next decision reproduced
    // that exact sample, with replay, save/continue and the golden vectors
    // all agreeing with each other and all wrong.
    //
    // The rejection branch cannot be reached by sampling (see the remarks on
    // AcceptanceThreshold), so the seed below was *constructed*, not
    // searched for: Draw(seed, stream, 0) == Mix(Mix(seed + (stream+1)*GAMMA)),
    // and SplitMix64's finalizer Mix is a bijection on 64 bits (xor-shift-right
    // and odd-constant multiplication are both invertible mod 2^64).
    // Inverting it twice starting from ulong.MaxValue yields the one campaign
    // seed whose ordinal-0 sample is exactly ulong.MaxValue — a value at or
    // above every possible acceptance threshold, hence rejected for every
    // span.
    //
    // Produced by a throwaway console app (deleted afterwards, never
    // committed), the same way the golden vector below was:
    //
    //   dotnet new console -f net8.0 -o /tmp/rng-reject
    //   # Program.cs: reimplements Mix/Draw; inverts Mix via a fixed-point
    //   # undo of `x ^ (x >> s)` plus Newton modular inverses of the two odd
    //   # constants; self-checks UnMix(Mix(x)) == x on probes; then prints
    //   #   seed = UnMix(UnMix(ulong.MaxValue)) - (HeroDecision + 1) * GAMMA
    //   # and, for a table of spans, whether ordinal 0 is rejected.
    //   dotnet run --project /tmp/rng-reject
    //   rm -rf /tmp/rng-reject
    //
    // Pinned output: campaignSeed = 4892902761533153534,
    // Draw(seed, HeroDecision, 0) = 18446744073709551615 == ulong.MaxValue,
    // ordinal0Rejected = True for every span in {2,3,4,5,6,7,10,20,100}.
    [Fact]
    public void DrawInt32_ReportsEveryOrdinalARejectionBurned()
    {
        const ulong seed = 4892902761533153534UL;
        const RngStream stream = RngStream.HeroDecision;
        const int minInclusive = 0;
        const int maxExclusive = 6;
        const ulong span = 6UL;

        // The premise of the test, asserted rather than assumed: without this
        // the test below would pass on a draw that was never rejected.
        Assert.Equal(ulong.MaxValue, DeterministicRng.Draw(seed, stream, 0UL));
        Assert.True(
            DeterministicRng.Draw(seed, stream, 0UL) >= DeterministicRng.AcceptanceThreshold(span),
            $"ordinal 0 must sit at or above the acceptance threshold for span {span}, "
            + "otherwise the rejection branch is not entered at all");

        var draw = DeterministicRng.DrawInt32(seed, stream, 0UL, minInclusive, maxExclusive);

        Assert.True(
            draw.OrdinalsConsumed > 1UL,
            $"the sample at ordinal 0 was rejected, so more than one ordinal was burned, but the "
            + $"draw reported {draw.OrdinalsConsumed}; a caller forwarding that to "
            + "GameState.WithEvent would leave NextDecisionOrdinal on an ordinal already drawn "
            + "and accepted, and the next decision would repeat this very sample");
        Assert.Equal(2UL, draw.OrdinalsConsumed);

        // The accepted sample is the last ordinal burned, not the first.
        var acceptedOrdinal = draw.OrdinalsConsumed - 1UL;
        var acceptedSample = DeterministicRng.Draw(seed, stream, acceptedOrdinal);
        Assert.True(acceptedSample < DeterministicRng.AcceptanceThreshold(span));
        Assert.Equal((int)(acceptedSample % span), draw.Value);

        // What the reported count buys: resuming at ordinal + OrdinalsConsumed
        // is a genuinely fresh draw.
        var next = DeterministicRng.DrawInt32(seed, stream, draw.OrdinalsConsumed, minInclusive, maxExclusive);
        Assert.NotEqual(acceptedSample, DeterministicRng.Draw(seed, stream, draw.OrdinalsConsumed));
        Assert.NotEqual(draw.Value, next.Value);

        // And the consequence of getting the count wrong, shown directly:
        // resuming one ordinal on — what a caller hard-coding 1 would do —
        // replays the sample this call already consumed and accepted.
        var repeated = DeterministicRng.DrawInt32(seed, stream, 1UL, minInclusive, maxExclusive);
        Assert.Equal(draw.Value, repeated.Value);
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
