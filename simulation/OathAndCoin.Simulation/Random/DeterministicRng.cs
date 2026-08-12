namespace OathAndCoin.Simulation.Random;

/// <summary>
/// Counter-based deterministic RNG (ADR-003). Every draw is a pure function
/// of (campaignSeed, stream, ordinal) — there is no instance, no field, no
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
    /// Draws an <see cref="int"/> uniformly in [minInclusive, maxExclusive).
    /// The range width is computed in <see cref="ulong"/> because
    /// <c>maxExclusive - minInclusive</c> in <see cref="int"/> arithmetic
    /// can overflow for wide ranges (e.g. int.MinValue..int.MaxValue): the
    /// widest possible span, 2^32 - 1, does not fit in a signed 32-bit
    /// value, so the subtraction must be widened before it happens, not
    /// after. Out-of-range draws near the top of the 64-bit space are
    /// rejected and re-drawn (advancing only a local ordinal, never mutating
    /// any state) so every remaining outcome is equally likely.
    /// </summary>
    public static int DrawInt32(ulong campaignSeed, RngStream stream, ulong ordinal, int minInclusive, int maxExclusive)
    {
        if (maxExclusive <= minInclusive)
        {
            throw new ArgumentOutOfRangeException(
                nameof(maxExclusive),
                maxExclusive,
                "maxExclusive must be greater than minInclusive.");
        }

        ulong span = (ulong)((long)maxExclusive - minInclusive);
        ulong threshold = ulong.MaxValue - (ulong.MaxValue % span);

        ulong currentOrdinal = ordinal;
        ulong sample;
        while (true)
        {
            sample = Draw(campaignSeed, stream, currentOrdinal);
            if (sample < threshold)
            {
                break;
            }

            currentOrdinal = unchecked(currentOrdinal + 1UL);
        }

        return (int)((long)minInclusive + (long)(sample % span));
    }

    private static ulong Mix(ulong z)
    {
        z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9UL;
        z = (z ^ (z >> 27)) * 0x94D049BB133111EBUL;
        return z ^ (z >> 31);
    }
}
