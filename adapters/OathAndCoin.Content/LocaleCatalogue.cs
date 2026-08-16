using System.Collections.Immutable;
using System.Text.Json;

namespace OathAndCoin.Content;

/// <summary>
/// A flat "key → text" catalogue for one locale. Every player-facing string
/// content is allowed to name is a localization key (TDD §11.1), and until
/// this type existed there was nowhere those keys resolved — Gate 0's screen
/// printed the keys themselves, which is why it was documented as
/// "diagnostic, not a product screen" and slated for replacement the moment a
/// real one needed to show a hero's name.
/// </summary>
/// <remarks>
/// Resolving a key to its text is deliberately not this type's job, and does
/// not happen anywhere in this task: the game (a later task) reads a key back
/// against a catalogue, but the read model the engine and the presentation
/// layer agree on stays keys all the way through. A read model that carried
/// resolved text would make <c>read_model_hash</c> a function of the
/// player's language, and Milestone 1's whole "does the screen match the
/// simulation" story depends on that hash being a property of game state
/// alone.
/// </remarks>
public static class LocaleCatalogue
{
    /// <summary>
    /// Which version of the locale file format this build reads, the same
    /// arrangement as <see cref="ContentSet.SupportedContentSchemaVersion"/>:
    /// a file authored for a later version is refused, not read under this
    /// version's assumptions.
    /// </summary>
    public const int SupportedSchemaVersion = 2;

    /// <summary>
    /// Reads one locale file through the same <see cref="StrictJson"/>
    /// ceilings every content file goes through. A locale catalogue is
    /// external data exactly like a hero or a contract file — hand-edited,
    /// translator-supplied, and just as capable of being malformed — and a
    /// reader lenient here while strict everywhere else would teach an author
    /// a rule that only sometimes holds.
    /// </summary>
    /// <exception cref="InvalidDataException">
    /// The file does not exist, is not valid JSON, declares an unsupported
    /// <c>schema_version</c>, has no string <c>locale</c>, has no object
    /// <c>entries</c>, repeats a key inside <c>entries</c>, or gives a key an
    /// empty value.
    /// </exception>
    public static ImmutableSortedDictionary<string, string> Load(string path)
    {
        ArgumentException.ThrowIfNullOrEmpty(path);

        var fullPath = Path.GetFullPath(path);
        if (!File.Exists(fullPath))
        {
            throw new InvalidDataException($"Locale file '{fullPath}' does not exist.");
        }

        var displayPath = Path.GetFileName(fullPath);
        using var document = StrictJson.ParseDocument(displayPath, fullPath);
        var root = document.RootElement;

        RequireSupportedSchemaVersion(RequireIntProperty(root, "schema_version", displayPath), displayPath);
        RequireNonEmptyStringProperty(root, "locale", displayPath);

        if (!root.TryGetProperty("entries", out var entries) || entries.ValueKind != JsonValueKind.Object)
        {
            throw new InvalidDataException($"Locale file '{displayPath}' has no object 'entries' property.");
        }

        // JsonDocument, not JsonNode: JsonObject silently keeps only the last
        // of two properties that share a name, and this loader promises to
        // reject that instead. EnumerateObject over a JsonDocument yields
        // every property exactly as written, duplicates included, so the
        // duplicate check below actually has something to check.
        var builder = ImmutableSortedDictionary.CreateBuilder<string, string>(StringComparer.Ordinal);
        foreach (var entry in entries.EnumerateObject())
        {
            if (entry.Value.ValueKind != JsonValueKind.String)
            {
                throw new InvalidDataException(
                    $"Locale file '{displayPath}' has a non-string value for key '{entry.Name}'.");
            }

            var text = entry.Value.GetString();
            if (string.IsNullOrEmpty(text))
            {
                throw new InvalidDataException(
                    $"Locale file '{displayPath}' has an empty value for key '{entry.Name}'.");
            }

            if (!builder.TryAdd(entry.Name, text))
            {
                throw new InvalidDataException(
                    $"Locale file '{displayPath}' repeats key '{entry.Name}'.");
            }
        }

        return builder.ToImmutable();
    }

    private static void RequireSupportedSchemaVersion(int schemaVersion, string displayPath)
    {
        if (schemaVersion != SupportedSchemaVersion)
        {
            throw new InvalidDataException(
                $"Locale file '{displayPath}' declares schema_version {schemaVersion}, but this build "
                + $"reads version {SupportedSchemaVersion}. Migrate the file, or run a build that "
                + "understands its version — reading it under the wrong version would be a guess.");
        }
    }

    private static int RequireIntProperty(JsonElement root, string propertyName, string displayPath)
    {
        if (!root.TryGetProperty(propertyName, out var value) || value.ValueKind != JsonValueKind.Number
            || !value.TryGetInt32(out var result))
        {
            throw new InvalidDataException(
                $"Locale file '{displayPath}' has no integer '{propertyName}' property.");
        }

        return result;
    }

    private static void RequireNonEmptyStringProperty(JsonElement root, string propertyName, string displayPath)
    {
        if (!root.TryGetProperty(propertyName, out var value) || value.ValueKind != JsonValueKind.String
            || string.IsNullOrEmpty(value.GetString()))
        {
            throw new InvalidDataException(
                $"Locale file '{displayPath}' has no non-empty string '{propertyName}' property.");
        }
    }
}
