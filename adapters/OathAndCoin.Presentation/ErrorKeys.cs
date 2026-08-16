using System.Collections.Immutable;
using System.Linq;

namespace OathAndCoin.Presentation;

/// <summary>
/// Builds the localization key for a stable error code (e.g.
/// <c>CONTENT_ROOT_NOT_FOUND</c> → <c>error.content_root_not_found</c>).
/// Added alongside <see cref="ActionKeys"/>, <see cref="WaveredKeys"/> and
/// <see cref="ScreenStateKeys"/> so the screen never shows an error code
/// literally — a stable code is exactly as much a raw identifier as a
/// content id, and TDD §11.1 makes no exception for it.
/// </summary>
public static class ErrorKeys
{
    /// <summary>Every key <see cref="For"/> can produce, for the catalogue-completeness test.</summary>
    public static readonly ImmutableArray<string> AllKeys = ErrorCodes.All.Select(For).ToImmutableArray();

    public static string For(string errorCode) => "error." + errorCode.ToLowerInvariant();
}
