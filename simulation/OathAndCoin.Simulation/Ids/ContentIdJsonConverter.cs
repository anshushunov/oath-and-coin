using System.Text.Json;
using System.Text.Json.Serialization;

namespace OathAndCoin.Simulation.Ids;

/// <summary>
/// Serializes a <see cref="ContentId"/> as its plain <c>namespace:name</c>
/// string and reads it back through <see cref="ContentId.Parse"/>.
/// </summary>
/// <remarks>
/// <para>
/// Shipped with the type (via <c>[JsonConverter]</c> on
/// <see cref="ContentId"/>) rather than left for each caller to register,
/// because the guarantee <see cref="ContentId"/> exists to make — "an invalid
/// identifier does not exist in this system" — is otherwise only a
/// surface-level C# guarantee that JSON walks straight past.
/// <see cref="System.Text.Json"/>'s default handling of a struct with
/// public read-only properties writes
/// <c>{"Namespace":"core","Name":"bram","Value":"core:bram"}</c> and reads it
/// back as <c>default(ContentId)</c> — silently, with no exception, because
/// there is nothing to set. A hero loaded from JSON then looks valid, goes
/// into a dictionary as a key, and throws somewhere else entirely.
/// </para>
/// <para>
/// The dictionary-key overrides matter for the same reason: content and
/// state both key collections by <see cref="ContentId"/>
/// (<see cref="State.GameState.Contracts"/>), and property names go through
/// a separate path in <see cref="System.Text.Json"/> that ignores
/// <see cref="Read"/>/<see cref="Write"/> entirely.
/// </para>
/// </remarks>
public sealed class ContentIdJsonConverter : JsonConverter<ContentId>
{
    public override ContentId Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType != JsonTokenType.String)
        {
            throw new JsonException(
                $"Expected a JSON string holding a ContentId ('namespace:name'), but found {reader.TokenType}.");
        }

        return ParseOrThrow(reader.GetString());
    }

    public override void Write(Utf8JsonWriter writer, ContentId value, JsonSerializerOptions options)
    {
        ArgumentNullException.ThrowIfNull(writer);
        writer.WriteStringValue(value.Value);
    }

    public override ContentId ReadAsPropertyName(
        ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) =>
        ParseOrThrow(reader.GetString());

    public override void WriteAsPropertyName(
        Utf8JsonWriter writer, ContentId value, JsonSerializerOptions options)
    {
        ArgumentNullException.ThrowIfNull(writer);
        writer.WritePropertyName(value.Value);
    }

    /// <summary>
    /// Rejects malformed input as a <see cref="JsonException"/> — the type
    /// <see cref="System.Text.Json"/> decorates with the path to the offending
    /// property — while keeping <see cref="ContentId.Parse"/>'s own message,
    /// which names the value and the expected shape, as the inner exception
    /// and inside the message text.
    /// </summary>
    private static ContentId ParseOrThrow(string? text)
    {
        try
        {
            return ContentId.Parse(text);
        }
        catch (FormatException exception)
        {
            throw new JsonException(exception.Message, exception);
        }
    }
}
