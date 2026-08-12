using System.Text.RegularExpressions;

namespace OathAndCoin.Simulation.Ids;

/// <summary>
/// A stable, namespaced content identifier (ADR-005) in the form
/// <c>namespace:name</c>, where both segments match
/// <c>^[a-z][a-z0-9_]*$</c>.
/// </summary>
/// <remarks>
/// The only way to obtain a valid instance is <see cref="Parse"/> or
/// <see cref="TryParse"/> — the constructor is private, so an
/// out-of-band-invalid value cannot exist in the system. The type's own
/// <c>default</c> is the one exception C# forces on every struct; it is
/// treated as "uninitialized" rather than a silently empty id, so touching
/// <see cref="Namespace"/>, <see cref="Name"/>, or <see cref="Value"/> on a
/// <c>default(ContentId)</c> throws instead of returning <c>null</c> or
/// empty text. Ordering and hashing are ordinal only: this type never
/// consults the host machine's locale (TDD §7.3).
/// </remarks>
public readonly struct ContentId : IEquatable<ContentId>, IComparable<ContentId>
{
    private const string SegmentPatternText = "^[a-z][a-z0-9_]*$";

    private static readonly Regex SegmentPattern = new(
        SegmentPatternText,
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    // null only for default(ContentId); every instance built through Parse
    // or TryParse has all three fields populated together.
    private readonly string? _namespace;
    private readonly string? _name;
    private readonly string? _value;

    private ContentId(string @namespace, string name, string value)
    {
        _namespace = @namespace;
        _name = name;
        _value = value;
    }

    /// <summary>The namespace segment, e.g. <c>"core"</c> in <c>"core:bram"</c>.</summary>
    public string Namespace => _namespace ?? throw CreateUninitializedException();

    /// <summary>The name segment, e.g. <c>"bram"</c> in <c>"core:bram"</c>.</summary>
    public string Name => _name ?? throw CreateUninitializedException();

    /// <summary>The full <c>namespace:name</c> text.</summary>
    public string Value => _value ?? throw CreateUninitializedException();

    /// <summary>
    /// Parses <paramref name="text"/> as a <see cref="ContentId"/>.
    /// </summary>
    /// <exception cref="FormatException">
    /// <paramref name="text"/> is not a valid <c>namespace:name</c> id.
    /// </exception>
    public static ContentId Parse(string? text)
    {
        if (TryParse(text, out var id))
        {
            return id;
        }

        throw new FormatException(
            $"Invalid ContentId '{text ?? "null"}'. Expected format 'namespace:name', "
            + $"where each segment matches '{SegmentPatternText}'.");
    }

    /// <summary>
    /// Attempts to parse <paramref name="text"/> as a <see cref="ContentId"/>,
    /// without throwing on malformed input.
    /// </summary>
    public static bool TryParse(string? text, out ContentId result)
    {
        result = default;

        if (string.IsNullOrEmpty(text))
        {
            return false;
        }

        var separatorIndex = text.IndexOf(':');
        if (separatorIndex < 0 || text.IndexOf(':', separatorIndex + 1) >= 0)
        {
            return false;
        }

        var namespaceSegment = text[..separatorIndex];
        var nameSegment = text[(separatorIndex + 1)..];

        if (!SegmentPattern.IsMatch(namespaceSegment) || !SegmentPattern.IsMatch(nameSegment))
        {
            return false;
        }

        result = new ContentId(namespaceSegment, nameSegment, text);
        return true;
    }

    /// <summary>
    /// Ordinal comparison of <see cref="Value"/>, never locale-dependent.
    /// </summary>
    public int CompareTo(ContentId other) => string.CompareOrdinal(_value, other._value);

    public bool Equals(ContentId other) => string.Equals(_value, other._value, StringComparison.Ordinal);

    public override bool Equals(object? obj) => obj is ContentId other && Equals(other);

    public override int GetHashCode() => _value is null ? 0 : string.GetHashCode(_value, StringComparison.Ordinal);

    public override string ToString() => Value;

    public static bool operator ==(ContentId left, ContentId right) => left.Equals(right);

    public static bool operator !=(ContentId left, ContentId right) => !left.Equals(right);

    public static bool operator <(ContentId left, ContentId right) => left.CompareTo(right) < 0;

    public static bool operator <=(ContentId left, ContentId right) => left.CompareTo(right) <= 0;

    public static bool operator >(ContentId left, ContentId right) => left.CompareTo(right) > 0;

    public static bool operator >=(ContentId left, ContentId right) => left.CompareTo(right) >= 0;

    private static InvalidOperationException CreateUninitializedException() =>
        new("ContentId is uninitialized (default(ContentId)). Obtain a value via "
            + "ContentId.Parse or ContentId.TryParse before reading it.");
}
