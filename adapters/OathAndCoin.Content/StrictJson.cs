using System.Text.Json;
using System.Text.Json.Nodes;
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
    // The numbers themselves live in ContentLimits, which is public: they are
    // part of what an author is promised, not an implementation detail of this
    // reader. This class is where they are enforced.

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
        MaxDepth = ContentLimits.MaxJsonDepth,
    };

    /// <summary>
    /// The same ceilings as <see cref="Options"/>, for the paths that walk a
    /// document instead of deserializing it (schema validation). Kept beside
    /// the serializer options rather than restated at the call site: a second
    /// reading path with its own, laxer limits is the same as having no
    /// limits, because external data only has to arrive through the laxest
    /// one.
    /// </summary>
    public static readonly JsonDocumentOptions DocumentOptions = new()
    {
        MaxDepth = ContentLimits.MaxJsonDepth,
        AllowTrailingCommas = false,
        CommentHandling = JsonCommentHandling.Disallow,
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
        var bytes = ReadBounded(displayPath, fullPath);

        try
        {
            return JsonSerializer.Deserialize<T>(bytes, Options)
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

    /// <summary>
    /// Reads one file as a <see cref="JsonNode"/> under the same size and
    /// depth ceilings as <see cref="ReadFile{T}"/>.
    /// </summary>
    public static JsonNode ParseNode(string displayPath, string fullPath)
    {
        var bytes = ReadBounded(displayPath, fullPath);

        try
        {
            return JsonNode.Parse(bytes, nodeOptions: null, DocumentOptions)
                ?? throw new InvalidDataException(
                    $"File '{displayPath}' holds JSON null where a document was expected.");
        }
        catch (JsonException exception)
        {
            throw new InvalidDataException(
                $"File '{displayPath}' is not valid at JSON path '{exception.Path ?? "$"}': {exception.Message}",
                exception);
        }
    }

    /// <summary>
    /// Reads one file as a <see cref="JsonDocument"/> under the same size and
    /// depth ceilings as <see cref="ReadFile{T}"/>. Unlike <see cref="ParseNode"/>,
    /// this keeps every property a JSON object declares, including a repeated
    /// key: <see cref="JsonNode"/>'s own parser collapses a duplicate key to
    /// its last value silently, which is exactly the mistake a reader that
    /// promises to reject duplicates must not paper over. Callers that need to
    /// detect a duplicate key walk <see cref="JsonElement.EnumerateObject"/>
    /// themselves.
    /// </summary>
    public static JsonDocument ParseDocument(string displayPath, string fullPath)
    {
        var bytes = ReadBounded(displayPath, fullPath);

        try
        {
            return JsonDocument.Parse(bytes, DocumentOptions);
        }
        catch (JsonException exception)
        {
            throw new InvalidDataException(
                $"File '{displayPath}' is not valid at JSON path '{exception.Path ?? "$"}': {exception.Message}",
                exception);
        }
    }

    /// <summary>
    /// Reads a file's bytes, refusing anything over
    /// <see cref="ContentLimits.MaxFileSizeBytes"/> before allocating for it.
    /// </summary>
    /// <remarks>
    /// The size is checked against the file's own length rather than after
    /// reading it, so an oversized file costs a stat call instead of its own
    /// size in memory.
    /// </remarks>
    public static byte[] ReadBounded(string displayPath, string fullPath)
    {
        var length = new FileInfo(fullPath).Length;
        if (length > ContentLimits.MaxFileSizeBytes)
        {
            throw new InvalidDataException(
                $"File '{displayPath}' is {length} bytes, over the {ContentLimits.MaxFileSizeBytes}-byte limit.");
        }

        return File.ReadAllBytes(fullPath);
    }
}
