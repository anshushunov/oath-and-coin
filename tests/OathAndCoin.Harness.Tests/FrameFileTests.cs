using System.Security.Cryptography;
using OathAndCoin.Harness;

namespace OathAndCoin.Harness.Tests;

/// <summary>
/// <see cref="FrameFile.Inspect"/> validates a screenshot frame's PNG header
/// for real: signature, the <c>IHDR</c> chunk's length and type, sane
/// positive dimensions, and the chunk's own CRC32. A version that only read
/// fixed byte offsets would call a forged header with garbage after it a
/// valid PNG — see the type's remarks.
/// </summary>
public class FrameFileTests
{
    private static readonly string TinyPngPath = Path.Combine(AppContext.BaseDirectory, "Fixtures", "tiny.png");

    /// <summary>The exact bytes committed at <c>Fixtures/tiny.png</c> — a real 4x2 PNG (see the test project's fixture generation notes).</summary>
    private static byte[] ReadTinyPngBytes() => File.ReadAllBytes(TinyPngPath);

    [Fact]
    public void Inspect_ReadsRealPngDimensionsAndHash()
    {
        var bytes = ReadTinyPngBytes();
        var expectedSha256 = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();

        var inspection = FrameFile.Inspect(TinyPngPath);

        Assert.True(inspection.HasValidPngHeader);
        Assert.Equal(4, inspection.Width);
        Assert.Equal(2, inspection.Height);
        Assert.Equal(bytes.LongLength, inspection.ByteLength);
        Assert.Equal(expectedSha256, inspection.Sha256);
    }

    [Fact]
    public void Inspect_RejectsPlainTextFile()
    {
        // Long enough to clear FrameFile's minimum header length, so this
        // exercises the signature mismatch itself, not merely a short file.
        var text = string.Concat(Enumerable.Repeat("this is not a png file\n", 4));
        var path = WriteTempFile(System.Text.Encoding.ASCII.GetBytes(text));

        var inspection = FrameFile.Inspect(path);

        Assert.False(inspection.HasValidPngHeader);
        Assert.Equal(0, inspection.Width);
        Assert.Equal(0, inspection.Height);
    }

    [Fact]
    public void Inspect_RejectsTruncatedFileWithoutThrowing()
    {
        var truncated = ReadTinyPngBytes().Take(10).ToArray();
        var path = WriteTempFile(truncated);

        FrameInspection? inspection = null;
        var exception = Record.Exception(() => inspection = FrameFile.Inspect(path));

        Assert.Null(exception);
        Assert.NotNull(inspection);
        Assert.False(inspection!.HasValidPngHeader);
        Assert.Equal(0, inspection.Width);
        Assert.Equal(0, inspection.Height);
        Assert.Equal(10, inspection.ByteLength);
    }

    [Fact]
    public void Inspect_RejectsFileWithCorruptedIhdrCrc()
    {
        var bytes = ReadTinyPngBytes();

        // Byte 29 is the first byte of the IHDR chunk's stored CRC32 (see
        // FrameFile's offset layout); flipping it leaves the signature,
        // chunk length/type and declared dimensions untouched.
        bytes[29] ^= 0xFF;
        var path = WriteTempFile(bytes);

        var inspection = FrameFile.Inspect(path);

        Assert.False(inspection.HasValidPngHeader);
        // The chunk is otherwise well-formed: a caller comparing declared
        // dimensions against a claim should still see the real numbers, not
        // have them hidden behind a zeroed-out frame.
        Assert.Equal(4, inspection.Width);
        Assert.Equal(2, inspection.Height);
    }

    [Fact]
    public void Inspect_RejectsZeroDimensions()
    {
        var bytes = ReadTinyPngBytes();

        // Bytes 16..19 are IHDR's big-endian width field; zeroing it leaves
        // everything else (including the now-stale CRC, irrelevant here
        // since the dimension check runs first) untouched.
        bytes[16] = 0;
        bytes[17] = 0;
        bytes[18] = 0;
        bytes[19] = 0;
        var path = WriteTempFile(bytes);

        var inspection = FrameFile.Inspect(path);

        Assert.False(inspection.HasValidPngHeader);
        Assert.Equal(0, inspection.Width);
        Assert.Equal(0, inspection.Height);
    }

    private static string WriteTempFile(byte[] bytes)
    {
        var path = Path.Combine(Path.GetTempPath(), $"frame-file-tests-{Guid.NewGuid():N}.bin");
        File.WriteAllBytes(path, bytes);
        return path;
    }
}
