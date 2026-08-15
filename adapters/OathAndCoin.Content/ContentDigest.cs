using System.Security.Cryptography;
using System.Text;

namespace OathAndCoin.Content;

/// <summary>
/// The content version, computed from the content itself (HERO_DECISION_SPEC §1.6) rather
/// than declared in a constant somebody has to remember to bump. A declared
/// version is wrong exactly when it matters most — after an edit — and a
/// replay that says "same content version" while the numbers underneath moved
/// is worse than one that admits it cannot reproduce the run.
/// </summary>
public static class ContentDigest
{
    /// <summary>
    /// Number of leading hex characters of <see cref="Compute"/>'s output used
    /// as <see cref="ContentSet.ContentVersion"/>. 16 hex characters are 64
    /// bits — short enough to read out of a bug report, far past any accident.
    /// </summary>
    public const int VersionLength = 16;

    private const byte FieldSeparator = 0x1F;

    private const int BufferSizeBytes = 64 * 1024;

    /// <summary>
    /// SHA-256 over every file under <paramref name="contentRoot"/>: each
    /// file's repository-relative path and then its bytes, in ordinal path
    /// order, lowercase hex.
    /// </summary>
    /// <remarks>
    /// Three details are what make the result a property of the content and
    /// not of the machine that computed it:
    /// <list type="bullet">
    /// <item>paths are made relative to <paramref name="contentRoot"/> and
    /// normalized to <c>/</c>, so the same tree hashes the same on Windows and
    /// on Linux and does not change when the checkout moves;</item>
    /// <item>ordering is <see cref="StringComparer.Ordinal"/>, never the
    /// filesystem's own enumeration order or a culture-aware sort;</item>
    /// <item>paths and contents are separated by a byte that cannot occur in
    /// a path, so <c>ab</c> + <c>c</c> and <c>a</c> + <c>bc</c> cannot hash
    /// alike.</item>
    /// </list>
    /// The path is part of the hash, not just the bytes: renaming a file
    /// changes what content exists, so it must change the version.
    /// </remarks>
    public static string Compute(string contentRoot)
    {
        ArgumentException.ThrowIfNullOrEmpty(contentRoot);

        var root = Path.GetFullPath(contentRoot);
        if (!Directory.Exists(root))
        {
            throw new InvalidDataException($"Content root '{root}' does not exist.");
        }

        var files = Directory.GetFiles(root, "*", SearchOption.AllDirectories)
            .Select(fullPath => (RelativePath: ToRelativePosixPath(root, fullPath), FullPath: fullPath))
            .OrderBy(file => file.RelativePath, StringComparer.Ordinal)
            .ToList();

        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        var buffer = new byte[BufferSizeBytes];

        foreach (var file in files)
        {
            hash.AppendData(Encoding.UTF8.GetBytes(file.RelativePath));
            hash.AppendData(new[] { FieldSeparator });
            AppendContent(hash, file, buffer);
            hash.AppendData(new[] { FieldSeparator });
        }

        return Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant();
    }

    /// <summary>
    /// Feeds one file into the running hash in fixed-size chunks, refusing
    /// anything over <see cref="ContentLimits.MaxFileSizeBytes"/>.
    /// </summary>
    /// <remarks>
    /// Streaming, not <c>File.ReadAllBytes</c>: the digest covers every file
    /// under the content root, including ones no loader ever reads, so reading
    /// each one whole made the memory cost of hashing a property of the
    /// largest file anybody dropped into <c>content/</c>. The size ceiling is
    /// the loader's own (TDD §18) — a file too large to load is not one this
    /// version should quietly account for either, and refusing it here reports
    /// the problem in the same terms the loader would.
    /// </remarks>
    private static void AppendContent(
        IncrementalHash hash,
        (string RelativePath, string FullPath) file,
        byte[] buffer)
    {
        using var stream = new FileStream(
            file.FullPath,
            FileMode.Open,
            FileAccess.Read,
            FileShare.Read,
            BufferSizeBytes,
            FileOptions.SequentialScan);

        if (stream.Length > ContentLimits.MaxFileSizeBytes)
        {
            throw new InvalidDataException(
                $"File '{file.RelativePath}' is {stream.Length} bytes, over the "
                + $"{ContentLimits.MaxFileSizeBytes}-byte limit.");
        }

        int read;
        while ((read = stream.Read(buffer, 0, buffer.Length)) > 0)
        {
            hash.AppendData(buffer, 0, read);
        }
    }

    internal static string ToRelativePosixPath(string root, string fullPath) =>
        Path.GetRelativePath(root, fullPath).Replace(Path.DirectorySeparatorChar, '/').Replace('\\', '/');
}
