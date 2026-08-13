using System.Text.Json;
using System.Text.Json.Nodes;

namespace OathAndCoin.Content;

/// <summary>
/// A pure structural transform over <see cref="JsonNode"/>/<see cref="Utf8JsonWriter"/>:
/// write a node with object keys in ordinal order, leaving array order and
/// every value untouched. Shared by every hash in this codebase that needs
/// "the same data always serializes to the same bytes" — currently
/// <see cref="Scenarios.DeterminismArtifact"/> (the Gate 0 replay evidence
/// CI compares) and <c>OathAndCoin.Presentation.SpikeScreenModelFactory</c>
/// (the read-model hash a tool process and the running game compare).
/// </summary>
/// <remarks>
/// Deliberately has no stream, file, or path parameter — only
/// <see cref="JsonNode"/> in and <see cref="Utf8JsonWriter"/> out. That is
/// what lets <c>OathAndCoin.Presentation</c> call it without pulling any
/// <c>System.IO</c> type into its own compiled assembly
/// (<c>PresentationBoundaryTests</c> guards that boundary): the caller owns
/// the stream, this type never sees one.
///
/// Extracted rather than kept as two copies: the algorithm has no dependency
/// on either caller's field list — it is the same "sort object keys, keep
/// array order, hash the bytes" transform regardless of what the JSON
/// describes — so a fix to it (say, to the ordinal key comparer) belongs in
/// one place, not two that would need to be remembered together.
/// </remarks>
public static class CanonicalJson
{
    /// <summary>
    /// Writes <paramref name="node"/> with object keys in ordinal order.
    /// Array order is preserved — it is content (e.g. the order commands
    /// ran in, or the order decisions happened), not presentation.
    /// </summary>
    public static void Write(JsonNode? node, Utf8JsonWriter writer)
    {
        switch (node)
        {
            case null:
                writer.WriteNullValue();
                break;

            case JsonObject jsonObject:
                writer.WriteStartObject();
                foreach (var property in jsonObject.OrderBy(property => property.Key, StringComparer.Ordinal))
                {
                    writer.WritePropertyName(property.Key);
                    Write(property.Value, writer);
                }

                writer.WriteEndObject();
                break;

            case JsonArray jsonArray:
                writer.WriteStartArray();
                foreach (var element in jsonArray)
                {
                    Write(element, writer);
                }

                writer.WriteEndArray();
                break;

            default:
                node.WriteTo(writer);
                break;
        }
    }
}
