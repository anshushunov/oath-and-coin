using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using OathAndCoin.Content;
using OathAndCoin.Content.Scenarios;

namespace OathAndCoin.MigrationOracle;

/// <summary>
/// Where this build's canonical JSON and RFC 8785 agree, and where they do
/// not — stated per input, with both sets of bytes.
/// </summary>
/// <remarks>
/// The migration cannot silently re-hash the artifacts already committed under
/// the current serializer. Either an input canonicalizes identically under
/// both rules, in which case an old hash keeps its meaning, or it does not, in
/// which case the difference is named here and costs exactly one deliberate
/// artifact-version bump when the port adopts JCS. What must never happen is
/// the third option: regenerating old evidence to whatever the new code says
/// and calling the result a match.
/// </remarks>
internal static class JcsVectors
{
    private static readonly JsonWriterOptions WriterOptions = new()
    {
        Indented = false,
        SkipValidation = false,
    };

    internal static JsonObject Build() => new()
    {
        ["artifact_schema_version"] = OracleEnvelope.ArtifactSchemaVersion,
        ["determinism_artifact_version"] = DeterminismArtifact.ArtifactVersion,
        ["ruleset_version"] = ScenarioRunner.RulesetVersion,
        ["current_serializer"] = "OathAndCoin.Content.CanonicalJson over System.Text.Json Utf8JsonWriter",
        ["target_serializer"] = "RFC 8785 JSON Canonicalization Scheme",
        ["covered_number_domain"] =
            $"integers within ±{JcsReference.SafeInteger} (every number a canonical determinism artifact holds)",
        ["out_of_scope"] =
            "Fractional numbers, exponent forms and integers beyond the IEEE 754 safe range are not covered "
            + "by these vectors: RFC 8785 defers those to ECMAScript Number::toString, and an approximate "
            + "target would look authoritative and be wrong. Cover them in the TypeScript port against the "
            + "official RFC 8785 conformance vectors.",
        ["vectors"] = new JsonArray(Vectors().ToArray<JsonNode?>()),
    };

    private static IEnumerable<JsonObject> Vectors()
    {
        yield return Vector(
            "object_key_ordering",
            """{"b":1,"A":2,"a":3,"":4,"aa":5}""",
            "Both rules sort object keys by UTF-16 code units and leave array order alone.");

        yield return Vector(
            "nested_structure",
            """{"outer":{"z":[3,2,1],"a":{"k":[]}},"list":[{"b":1,"a":2}]}""",
            "Nesting changes nothing: sorting is per object, array order is content.");

        yield return Vector(
            "scalars",
            """{"t":true,"f":false,"n":null,"zero":0,"neg":-42}""",
            "Literals and small integers are written identically by both rules.");

        yield return Vector(
            "safe_integer_bounds",
            """{"max":9007199254740991,"min":-9007199254740991}""",
            "The widest integers a JSON reader can carry without losing bits.");

        yield return Vector(
            "artifact_shaped_fragment",
            """{"artifact_version":3,"final_state":{"metadata":{"campaign_seed":7,"logical_time":2}},"steps":[{"applied":true,"rejection_code":null}]}""",
            "A fragment shaped like the canonical determinism artifact the corpus actually carries.");

        yield return Vector(
            "non_ascii_text",
            """{"ru":"Оплата","key":"метка"}""",
            "The current writer escapes every non-ASCII character to \\uXXXX; RFC 8785 emits it literally as UTF-8.");

        yield return Vector(
            "html_sensitive_text",
            """{"s":"a<b>c&d'e+f"}""",
            "The current writer's default encoder escapes HTML-sensitive ASCII; RFC 8785 does not.");

        yield return Vector(
            "negative_zero",
            """{"z":-0}""",
            "RFC 8785 folds -0 to 0 (ECMAScript Number::toString); the current writer keeps the authored token.");

        yield return Vector(
            "control_characters",
            "{\"s\":\"\\u0000\\b\\t\\n\\f\\r\\u001f\"}",
            "RFC 8785 uses the five short escapes where they exist and \\u00xx otherwise.");

        yield return Vector(
            "astral_plane_text",
            "{\"s\":\"\\ud83d\\ude00\"}",
            "A surrogate pair: RFC 8785 emits the code point as UTF-8, the current writer escapes both units.");
    }

    private static JsonObject Vector(string name, string inputJson, string note)
    {
        var input = JsonNode.Parse(inputJson)
            ?? throw new InvalidDataException($"JCS vector '{name}' has an input that parses to JSON null.");

        var current = CurrentBytes(input);
        var target = JcsReference.Serialize(input);
        var same = current.AsSpan().SequenceEqual(target);

        return new JsonObject
        {
            ["name"] = name,
            ["note"] = note,
            ["input"] = JsonNode.Parse(input.ToJsonString()),
            ["current"] = new JsonObject
            {
                ["canonical_base64"] = Convert.ToBase64String(current),
                ["sha256"] = Sha256Hex(current),
            },
            ["rfc8785"] = new JsonObject
            {
                ["canonical_base64"] = Convert.ToBase64String(target),
                ["sha256"] = Sha256Hex(target),
            },
            ["same_artifact_version"] = same,
            ["difference"] = same ? null : note,
        };
    }

    /// <summary>
    /// The bytes this build produces — through the production
    /// <see cref="CanonicalJson"/>, never a copy of it, so a change to the
    /// repository's canonicalization shows up in these vectors instead of
    /// being described by a stale second implementation.
    /// </summary>
    private static byte[] CurrentBytes(JsonNode input)
    {
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream, WriterOptions))
        {
            CanonicalJson.Write(input, writer);
        }

        return stream.ToArray();
    }

    private static string Sha256Hex(byte[] bytes) =>
        Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
}
