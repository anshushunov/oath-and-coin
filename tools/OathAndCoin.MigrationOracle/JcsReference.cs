using System.Globalization;
using System.Text;
using System.Text.Json.Nodes;

namespace OathAndCoin.MigrationOracle;

/// <summary>
/// A reference RFC 8785 (JSON Canonicalization Scheme) serializer, used only
/// to state what this repository's current canonical output would have to
/// become — never to produce any corpus bytes.
/// </summary>
/// <remarks>
/// <para>
/// It exists because the migration's target canonicalization is JCS while the
/// bytes every committed artifact was hashed under were produced by
/// <see cref="Content.CanonicalJson"/> over <c>System.Text.Json</c>. Those two
/// agree on key ordering and array ordering and disagree elsewhere. Guessing
/// which is which is exactly what the TypeScript port must not have to do, so
/// each difference is computed here and recorded per vector.
/// </para>
/// <para>
/// <strong>Number scope.</strong> Only integers inside the IEEE 754 safe range
/// are accepted. JCS defers number formatting to ECMAScript
/// <c>Number::toString</c>, whose shortest-round-trip and exponent rules do
/// not match any .NET format string, and an approximate implementation would
/// produce target bytes that look authoritative and are wrong. The domain is
/// not a limitation in practice: every number in a canonical determinism
/// artifact is a small integer. Anything outside the range fails loudly here
/// rather than being written into evidence, and fractional/large-magnitude
/// canonicalization is covered in the TypeScript port against the official
/// RFC 8785 conformance vectors.
/// </para>
/// </remarks>
internal static class JcsReference
{
    /// <summary>The largest magnitude an integer may have and still be exact as an IEEE 754 double.</summary>
    internal const long SafeInteger = 9007199254740991L;

    /// <summary>
    /// UTF-8 that throws instead of substituting.
    /// </summary>
    /// <remarks>
    /// External review finding. The default encoder's replacement fallback
    /// turns a lone surrogate into U+FFFD, so an input RFC 8785 requires a
    /// serializer to <em>reject</em> would instead have produced plausible
    /// target bytes for a different string — evidence that looks authoritative
    /// and describes data nobody supplied. No vector reaches this today; the
    /// point is that the next one must not be able to.
    /// </remarks>
    private static readonly UTF8Encoding StrictUtf8 = new(
        encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true);

    internal static byte[] Serialize(JsonNode? node)
    {
        var builder = new StringBuilder();
        Write(node, builder);
        var text = builder.ToString();

        // Checked before encoding rather than relying on the encoder alone, so
        // the message names the problem instead of surfacing as
        // "Unable to translate Unicode character".
        for (var index = 0; index < text.Length; index++)
        {
            if (!char.IsSurrogate(text[index]))
            {
                continue;
            }

            var paired = char.IsHighSurrogate(text[index])
                && index + 1 < text.Length
                && char.IsLowSurrogate(text[index + 1]);

            if (!paired)
            {
                throw new InvalidDataException(
                    $"JCS reference serialization refuses a lone surrogate at index {index}: RFC 8785 "
                    + "requires failing on invalid Unicode rather than substituting a replacement "
                    + "character.");
            }

            index++;
        }

        return StrictUtf8.GetBytes(text);
    }

    private static void Write(JsonNode? node, StringBuilder builder)
    {
        switch (node)
        {
            case null:
                builder.Append("null");
                break;

            case JsonObject jsonObject:
                builder.Append('{');
                var first = true;

                // RFC 8785 §3.2.3: sort by UTF-16 code units. .NET's ordinal
                // comparison is a char-by-char comparison, and a char is a
                // UTF-16 code unit, so this is that rule rather than an
                // approximation of it — and it is the same comparer
                // OathAndCoin.Content.CanonicalJson already uses.
                foreach (var property in jsonObject.OrderBy(property => property.Key, StringComparer.Ordinal))
                {
                    if (!first)
                    {
                        builder.Append(',');
                    }

                    first = false;
                    WriteString(property.Key, builder);
                    builder.Append(':');
                    Write(property.Value, builder);
                }

                builder.Append('}');
                break;

            case JsonArray jsonArray:
                builder.Append('[');
                for (var index = 0; index < jsonArray.Count; index++)
                {
                    if (index > 0)
                    {
                        builder.Append(',');
                    }

                    Write(jsonArray[index], builder);
                }

                builder.Append(']');
                break;

            default:
                WriteScalar(node, builder);
                break;
        }
    }

    private static void WriteScalar(JsonNode node, StringBuilder builder)
    {
        var raw = node.ToJsonString();

        if (raw is "true" or "false" or "null")
        {
            builder.Append(raw);
            return;
        }

        if (raw.Length > 0 && raw[0] == '"')
        {
            WriteString(node.GetValue<string>(), builder);
            return;
        }

        if (!long.TryParse(raw, NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out var integer)
            || Math.Abs(integer) > SafeInteger)
        {
            throw new InvalidDataException(
                $"JCS reference serialization refuses the number '{raw}': only integers within "
                + $"±{SafeInteger} are covered (see this type's remarks). Extend the implementation "
                + "deliberately rather than writing a target this code cannot compute correctly.");
        }

        // `long.Parse` already folds "-0" to 0, which is what RFC 8785 asks
        // for and what the current serializer does not do — that difference is
        // one of the recorded vectors rather than a silent normalization.
        builder.Append(integer.ToString(CultureInfo.InvariantCulture));
    }

    /// <summary>
    /// RFC 8785 §3.2.2.2: escape only what JSON requires — the quote, the
    /// backslash and the C0 controls, with the five short forms where they
    /// exist — and emit every other character literally, including non-ASCII.
    /// </summary>
    private static void WriteString(string value, StringBuilder builder)
    {
        builder.Append('"');

        foreach (var character in value)
        {
            switch (character)
            {
                case '"':
                    builder.Append("\\\"");
                    break;
                case '\\':
                    builder.Append("\\\\");
                    break;
                case '\b':
                    builder.Append("\\b");
                    break;
                case '\f':
                    builder.Append("\\f");
                    break;
                case '\n':
                    builder.Append("\\n");
                    break;
                case '\r':
                    builder.Append("\\r");
                    break;
                case '\t':
                    builder.Append("\\t");
                    break;
                default:
                    if (character < 0x20)
                    {
                        builder.Append(CultureInfo.InvariantCulture, $"\\u{(int)character:x4}");
                    }
                    else
                    {
                        builder.Append(character);
                    }

                    break;
            }
        }

        builder.Append('"');
    }
}
