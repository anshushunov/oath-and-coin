namespace OathAndCoin.Content;

/// <summary>
/// The ceilings every path that reads external data is held to (TDD §18:
/// "ограничивать размер и глубину загружаемых структур").
/// </summary>
/// <remarks>
/// Public, and stated once: content is data the player, a mod or a corrupted
/// download can author, and the limits show up in the diagnostics an author
/// reads, so they are part of this assembly's contract rather than an internal
/// detail. A second reading path with its own, laxer numbers would be the same
/// as having no limits at all — external data only has to arrive through the
/// laxest one — so every reader goes through <c>StrictJson</c>, which is the
/// only place these are applied.
/// </remarks>
public static class ContentLimits
{
    /// <summary>
    /// Largest file any reader will accept. Checked against the file's own
    /// length before anything is allocated for it, so an oversized file costs
    /// a stat call rather than its own size in memory.
    /// </summary>
    public const long MaxFileSizeBytes = 256 * 1024;

    /// <summary>
    /// Deepest JSON nesting any reader will accept. Guards the parser's own
    /// recursion, which a size limit alone does not: a small file can nest
    /// thousands of levels deep.
    /// </summary>
    public const int MaxJsonDepth = 32;

    /// <summary>Most traits a single hero file may list.</summary>
    public const int MaxTraitsPerHero = 4;

    /// <summary>Most relationships a single hero file may list.</summary>
    public const int MaxRelationshipsPerHero = 5;

    /// <summary>Most tags a single contract file may list.</summary>
    public const int MaxTagsPerContract = 6;
}
