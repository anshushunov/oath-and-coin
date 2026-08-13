using System.Text.Json;
using System.Text.Json.Serialization;

namespace OathAndCoin.Content;

/// <summary>
/// The one reader every data file in this assembly goes through, and the one
/// place its strictness is configured. Content and scenarios are both external
/// data: they can be hand-edited, modded or corrupted, and a reader that is
/// lenient in one place and strict in another teaches authors a rule that is
/// only sometimes true.
/// </summary>
internal static class StrictJson
{
    /// <summary>
    /// Size and depth ceilings on loaded structures (TDD §18). Without them a
    /// malformed file becomes an out-of-memory kill instead of a diagnosable
    /// error, and the diagnosis is the whole value of a loader.
    /// </summary>
    public const long MaxFileSizeBytes = 256 * 1024;

    public const int MaxDepth = 32;

    public static readonly JsonSerializerOptions Options = new()
    {
        // snake_case comes from a policy, not from per-property attributes:
        // with a policy there is no second hand-written spelling of a field
        // name to disagree with the schema.
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,

        // Every one of these is a rejection, not a convenience. A reader that
        // accepts `Greed` for `greed`, tolerates a trailing comma, ignores a
        // misspelled property or reads comments turns an author's mistake into
        // a value silently defaulted to zero.
        PropertyNameCaseInsensitive = false,
        AllowTrailingCommas = false,
        ReadCommentHandling = JsonCommentHandling.Disallow,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        NumberHandling = JsonNumberHandling.Strict,
        MaxDepth = MaxDepth,
    };

    /// <summary>
    /// Reads one file, reporting failures as <see cref="InvalidDataException"/>
    /// naming the file and the JSON path inside it — the two things an author
    /// needs and a bare deserializer exception does not give on its own.
    /// </summary>
    /// <param name="displayPath">
    /// How the file should be named in diagnostics: a repository-relative path
    /// where there is one, so an error message does not leak an absolute path
    /// from the machine that produced it (TDD §18).
    /// </param>
    public static T ReadFile<T>(string displayPath, string fullPath)
    {
        var length = new FileInfo(fullPath).Length;
        if (length > MaxFileSizeBytes)
        {
            throw new InvalidDataException(
                $"File '{displayPath}' is {length} bytes, over the {MaxFileSizeBytes}-byte limit.");
        }

        try
        {
            return JsonSerializer.Deserialize<T>(File.ReadAllBytes(fullPath), Options)
                ?? throw new InvalidDataException(
                    $"File '{displayPath}' holds JSON null where an object was expected.");
        }
        catch (JsonException exception)
        {
            throw new InvalidDataException(
                $"File '{displayPath}' is not valid at JSON path '{exception.Path ?? "$"}': {exception.Message}",
                exception);
        }
    }
}
