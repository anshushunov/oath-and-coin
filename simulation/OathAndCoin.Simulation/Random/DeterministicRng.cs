using System.Runtime.CompilerServices;

[assembly: InternalsVisibleTo("OathAndCoin.Simulation.Tests")]

// The name of this namespace is load-bearing, not just descriptive.
// `OathAndCoin.Simulation.Random` shadows `System.Random` for every type
// nested anywhere under `OathAndCoin.Simulation`: name lookup finds this
// namespace first, so `new Random()` inside the core does not compile at
// all (CS0118, "Random is a namespace but is used like a type"). That is
// accidental defence in depth on top of the ("System", "Random") entry in
// CoreBoundaryTests.BannedTypes — it fails at build time rather than at
// test time, and it also catches the case where the guard itself is
// weakened. Renaming this namespace removes that protection silently, and
// nothing else in the repository would notice.

namespace OathAndCoin.Simulation.Random;

/// <summary>
/// Counter-based deterministic RNG (ADR-003, planned — TDD §21). Every draw
/// is a pure function of (campaignSeed, stream, ordinal) — there is no instance, no field, no
/// counter kept anywhere in this type. The caller supplies the ordinal (how
/// many draws have already been made on that stream), so the same
/// (seed, stream, ordinal) triple always reproduces the same value no
/// matter when, how often, or in what order it is asked for. That is what
/// makes save/continue and replay possible: the sequence is derived from
/// game state, not from a generator's memory.
///
/// Algorithm: two composed applications of the SplitMix64 finalizer/mixer.
/// The stream is folded into the first mix to derive a per-stream key; the
/// ordinal is folded into the second mix to derive the actual draw. This
/// keeps different streams from correlating and keeps consecutive ordinals
/// from correlating, without needing to store per-stream state anywhere.
/// </summary>
public static class DeterministicRng
{
    public const string AlgorithmVersion = "splitmix64-composed/1";

    private const ulong GoldenGamma = 0x9E3779B97F4A7C15UL;

    /// <summary>
    /// Draws a raw 64-bit value for the given seed/stream/ordinal. Pure
    /// function: calling it again with the same arguments — in any order,
    /// interleaved with any other calls — returns the same value.
    /// </summary>
    public static ulong Draw(ulong campaignSeed, RngStream stream, ulong ordinal)
    {
        ulong key = Mix(unchecked(campaignSeed + ((ulong)stream + 1UL) * GoldenGamma));
        return Mix(unchecked(key + ordinal * GoldenGamma));
    }

    /// <summary>
    /// Draws an <see cref="int"/> uniformly in [minInclusive, maxExclusive),
    /// reporting how many ordinals it cost.
    /// The range width is computed in <see cref="ulong"/> because
    /// <c>maxExclusive - minInclusive</c> in <see cref="int"/> arithmetic
    /// can overflow for wide ranges (e.g. int.MinValue..int.MaxValue): the
    /// widest possible span, 2^32 - 1, does not fit in a signed 32-bit
    /// value, so the subtraction must be widened before it happens, not
    /// after. Out-of-range draws near the top of the 64-bit space are
    /// rejected and re-drawn (advancing only a local ordinal, never mutating
    /// any state) so every remaining outcome is equally likely.
    /// </summary>
    /// <returns>
    /// The drawn value together with
    /// <see cref="Int32Draw.OrdinalsConsumed"/> — the number of ordinals
    /// burned starting at <paramref name="ordinal"/>, which is greater than
    /// 1 whenever a sample was rejected.
    /// </returns>
    /// <remarks>
    /// The return type carries the ordinal count because a rejected sample
    /// burns an ordinal that the caller must still account for. This method
    /// used to return a bare <see cref="int"/>; the extra ordinals were
    /// invisible, callers reported <c>drawsConsumed: 1</c>, and the next
    /// decision restarted on an ordinal already drawn and accepted —
    /// silently repeating that sample. See the remarks on
    /// <see cref="Int32Draw"/>.
    /// </remarks>
    public static Int32Draw DrawInt32(ulong campaignSeed, RngStream stream, ulong ordinal, int minInclusive, int maxExclusive)
    {
        if (maxExclusive <= minInclusive)
        {
            throw new ArgumentOutOfRangeException(
                nameof(maxExclusive),
                maxExclusive,
                "maxExclusive must be greater than minInclusive.");
        }

        ulong span = (ulong)((long)maxExclusive - minInclusive);
        ulong threshold = AcceptanceThreshold(span);

        ulong currentOrdinal = ordinal;
        ulong ordinalsConsumed = 1UL;
        ulong sample;
        while (true)
        {
            sample = Draw(campaignSeed, stream, currentOrdinal);
            if (sample < threshold)
            {
                break;
            }

            currentOrdinal = unchecked(currentOrdinal + 1UL);
            ordinalsConsumed = checked(ordinalsConsumed + 1UL);
        }

        return new Int32Draw((int)((long)minInclusive + (long)(sample % span)), ordinalsConsumed);
    }

    /// <summary>
    /// The rejection-sampling cutoff for a range of width <paramref name="span"/>:
    /// the largest multiple of <paramref name="span"/> that fits in a
    /// <see cref="ulong"/>. Samples at or above this value are re-drawn
    /// (see <see cref="DrawInt32"/>) so that every value in
    /// <c>[0, span)</c> is equally likely — without the cutoff, values near
    /// the top of the 64-bit space would be under-represented by
    /// <c>ulong.MaxValue % span</c> counts relative to the rest, biasing the
    /// draw. Internal (not private) so the invariant — <c>threshold % span
    /// == 0</c> and <c>threshold</c> within one <paramref name="span"/> of
    /// <see cref="ulong.MaxValue"/> — can be asserted directly for a range
    /// of span values, rather than only inferred from sampled draws: random
    /// sampling cannot reach the rejection branch, since for realistic spans
    /// the rejection probability is astronomically small (e.g. ~5.4e-20 for
    /// span = 2^32 - 1). The branch itself is still covered, by a campaign
    /// seed constructed to land on it — see
    /// <c>DeterministicRngTests.DrawInt32_ReportsEveryOrdinalARejectionBurned</c>.
    /// </summary>
    internal static ulong AcceptanceThreshold(ulong span)
    {
        return ulong.MaxValue - (ulong.MaxValue % span);
    }

    private static ulong Mix(ulong z)
    {
        z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9UL;
        z = (z ^ (z >> 27)) * 0x94D049BB133111EBUL;
        return z ^ (z >> 31);
    }
}
