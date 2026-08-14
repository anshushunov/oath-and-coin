using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;

namespace OathAndCoin.Harness;

/// <summary>
/// What <see cref="FrameFile.Inspect"/> found out about a screenshot frame:
/// whether its PNG header actually validates, its claimed dimensions, how
/// many bytes are on disk, and the file's own SHA-256 — the fact
/// <see cref="SmokeVerdict"/> uses to prove a frame was written by the run
/// being checked, not left over from a previous one.
/// </summary>
/// <param name="HasValidPngHeader">
/// Whether the file starts with the PNG signature and an <c>IHDR</c> chunk
/// of the right length and type, with dimensions in sane bounds and a CRC32
/// that actually matches the chunk's bytes. Named for exactly what it
/// checks — the header — not <c>IsPng</c>: a file can fail every other way
/// a real PNG decoder would reject it (bad <c>IDAT</c>, missing
/// <c>IEND</c>) and this field would still be <c>true</c>, because nothing
/// past the header is read.
/// </param>
/// <param name="Width">
/// The width <c>IHDR</c> declares, or <c>0</c> when the header did not
/// validate far enough to trust it.
/// </param>
/// <param name="Height">The height <c>IHDR</c> declares, under the same rule as <see cref="Width"/>.</param>
/// <param name="ByteLength">The file's size on disk, regardless of whether it is a valid PNG.</param>
/// <param name="Sha256">SHA-256 of the whole file, lowercase hex, regardless of validity.</param>
public sealed record FrameInspection(bool HasValidPngHeader, int Width, int Height, long ByteLength, string Sha256);

/// <summary>
/// Inspects a screenshot frame's PNG header without decoding the image.
/// </summary>
/// <remarks>
/// Deliberately shallow: a runtime harness proving what is on screen only
/// needs the frame's declared dimensions and a hash to compare against what
/// the game reported (see <c>OathAndCoin.GameProtocol.TerminalEvent</c>); it
/// never needs the pixels. Checking the signature, the <c>IHDR</c> chunk's
/// length and type, and its CRC32 is what makes that check honest — a
/// version that only read fixed byte offsets would call a file with a
/// forged header and garbage after it a valid PNG.
/// </remarks>
public static class FrameFile
{
    // The eight fixed bytes every PNG file starts with (PNG spec §5.2).
    private static readonly byte[] Signature = { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A };

    // signature(8) + length(4) + type(4) + IHDR data(13) + crc(4).
    private const int MinimumHeaderLength = 33;

    // IHDR's data is always exactly this many bytes (PNG spec §11.2.2):
    // width, height, bit depth, colour type, compression, filter, interlace.
    private const int IhdrDataLength = 13;

    /// <summary>
    /// The bound every declared dimension is checked against. No frame this
    /// harness ever writes comes close — real runs use window sizes like
    /// 1280x720 — so this exists only to reject a structurally well-formed
    /// chunk whose declared size would otherwise be believed outright.
    /// </summary>
    private const int MaxSaneDimension = 16384;

    /// <exception cref="IOException">
    /// <paramref name="path"/> could not be read (missing file, access
    /// denied, or similar). Left to propagate rather than folded into
    /// <see cref="FrameInspection"/>: a run that never wrote its screenshot
    /// at all is a different failure than one whose screenshot fails
    /// validation, and the caller building a <see cref="SmokeVerdict"/>
    /// observation is the one that knows which story to tell.
    /// </exception>
    public static FrameInspection Inspect(string path)
    {
        ArgumentException.ThrowIfNullOrEmpty(path);

        var bytes = File.ReadAllBytes(path);
        var sha256 = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
        var byteLength = bytes.LongLength;

        if (bytes.Length < MinimumHeaderLength || !bytes.AsSpan(0, Signature.Length).SequenceEqual(Signature))
        {
            return new FrameInspection(false, 0, 0, byteLength, sha256);
        }

        var chunkLength = BinaryPrimitives.ReadUInt32BigEndian(bytes.AsSpan(8, 4));
        var chunkType = Encoding.ASCII.GetString(bytes, 12, 4);

        if (chunkLength != IhdrDataLength || !string.Equals(chunkType, "IHDR", StringComparison.Ordinal))
        {
            return new FrameInspection(false, 0, 0, byteLength, sha256);
        }

        var width = (int)BinaryPrimitives.ReadUInt32BigEndian(bytes.AsSpan(16, 4));
        var height = (int)BinaryPrimitives.ReadUInt32BigEndian(bytes.AsSpan(20, 4));

        if (width <= 0 || width > MaxSaneDimension || height <= 0 || height > MaxSaneDimension)
        {
            return new FrameInspection(false, 0, 0, byteLength, sha256);
        }

        // The CRC covers the chunk's type and data together (PNG spec
        // §5.5): 4 bytes of "IHDR" starting at offset 12, plus the 13 bytes
        // of IHDR data that follow it — 17 bytes in total, ending right
        // before the stored CRC at offset 12 + 4 + IhdrDataLength = 29.
        var storedCrc = BinaryPrimitives.ReadUInt32BigEndian(bytes.AsSpan(12 + 4 + IhdrDataLength, 4));
        var computedCrc = Crc32.Compute(bytes.AsSpan(12, 4 + IhdrDataLength));

        // Width and height are trusted here even when the CRC does not
        // match: the chunk is structurally a well-formed IHDR either way,
        // and a caller comparing against a claimed resolution (see
        // SmokeVerdict) should see that mismatch as its own reason rather
        // than have it hidden behind a zeroed-out frame.
        return new FrameInspection(storedCrc == computedCrc, width, height, byteLength, sha256);
    }
}

/// <summary>
/// The CRC32 variant PNG chunks use (PNG spec §D), used only to validate an
/// <c>IHDR</c> chunk: polynomial 0xEDB88320, initial value and final XOR
/// both all-ones. Implemented locally rather than pulled from a package —
/// it is a dozen lines, and validating one 17-byte chunk does not justify a
/// new dependency for this tool.
/// </summary>
internal static class Crc32
{
    private static readonly uint[] Table = BuildTable();

    public static uint Compute(ReadOnlySpan<byte> data)
    {
        var crc = 0xFFFFFFFFu;
        foreach (var value in data)
        {
            crc = Table[(crc ^ value) & 0xFF] ^ (crc >> 8);
        }

        return crc ^ 0xFFFFFFFFu;
    }

    private static uint[] BuildTable()
    {
        var table = new uint[256];
        for (uint i = 0; i < 256; i++)
        {
            var c = i;
            for (var bit = 0; bit < 8; bit++)
            {
                c = (c & 1) != 0 ? 0xEDB88320u ^ (c >> 1) : c >> 1;
            }

            table[i] = c;
        }

        return table;
    }
}
