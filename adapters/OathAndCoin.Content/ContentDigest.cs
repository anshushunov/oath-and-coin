using System.Security.Cryptography;
using System.Text;

namespace OathAndCoin.Content;

/// <summary>
/// The content version, computed from the content itself (spec §8.7) rather
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

        foreach (var file in files)
        {
            hash.AppendData(Encoding.UTF8.GetBytes(file.RelativePath));
            hash.AppendData(new[] { FieldSeparator });
            hash.AppendData(File.ReadAllBytes(file.FullPath));
            hash.AppendData(new[] { FieldSeparator });
        }

        return Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant();
    }

    internal static string ToRelativePosixPath(string root, string fullPath) =>
        Path.GetRelativePath(root, fullPath).Replace(Path.DirectorySeparatorChar, '/').Replace('\\', '/');
}
