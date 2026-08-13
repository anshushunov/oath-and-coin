using System.Collections.Immutable;
using System.Text.Json;
using System.Text.Json.Nodes;
using Json.Schema;

namespace OathAndCoin.Content;

/// <summary>
/// One thing that failed schema validation: which file, where inside it, and
/// why. Kept as data rather than as an exception message so a caller can
/// report every problem in a content tree at once — an author fixing files one
/// exception per run is the slowest possible way to learn what is wrong.
/// </summary>
public readonly record struct ContentSchemaViolation(
    string RelativePath,
    string InstanceLocation,
    string Message);

/// <summary>
/// Validation stage 1 from TDD §11.2 — schema/type validation — over a whole
/// content tree. Which schema applies is decided by the top-level directory a
/// file sits in: <c>heroes/</c> is validated against <c>hero.schema.json</c>,
/// <c>contracts/</c> against <c>contract.schema.json</c>.
/// </summary>
/// <remarks>
/// This is deliberately separate from <see cref="ContentSet.Load"/> rather
/// than folded into it. The loader must enforce its own invariants
/// unconditionally — nothing forces a caller to validate first — while
/// validation must be able to report every violation in a tree without
/// stopping at the first one. Merging the two would cost one of those two
/// properties. The pair is kept honest by <c>SchemaAgreementTests</c>, which
/// asserts the schema's ranges and <see cref="ContentBounds"/> state the same
/// numbers.
/// </remarks>
public sealed class ContentSchemas
{
    private static readonly EvaluationOptions Options = new()
    {
        OutputFormat = OutputFormat.List,
    };

    private readonly ImmutableDictionary<string, JsonSchema> _byDirectory;

    private ContentSchemas(ImmutableDictionary<string, JsonSchema> byDirectory)
    {
        _byDirectory = byDirectory;
    }

    /// <summary>Reads the schemas from <paramref name="schemaRoot"/>.</summary>
    /// <exception cref="InvalidDataException">A schema file is missing or unreadable.</exception>
    public static ContentSchemas Load(string schemaRoot)
    {
        ArgumentException.ThrowIfNullOrEmpty(schemaRoot);

        var root = Path.GetFullPath(schemaRoot);
        if (!Directory.Exists(root))
        {
            throw new InvalidDataException($"Schema root '{root}' does not exist.");
        }

        return new ContentSchemas(ImmutableDictionary.CreateRange(
            StringComparer.Ordinal,
            new[]
            {
                KeyValuePair.Create("heroes", ReadSchema(root, "hero.schema.json")),
                KeyValuePair.Create("contracts", ReadSchema(root, "contract.schema.json")),
            }));
    }

    /// <summary>
    /// Validates every <c>*.json</c> file under <paramref name="contentRoot"/>,
    /// returning all violations in ordinal path order. An empty result means
    /// every file was matched to a schema and satisfied it.
    /// </summary>
    /// <remarks>
    /// A file in a directory no schema is registered for is itself a
    /// violation, not a file to skip: silently ignoring unknown content is how
    /// a validation stage reports success over data it never looked at.
    /// </remarks>
    public ImmutableArray<ContentSchemaViolation> Validate(string contentRoot)
    {
        ArgumentException.ThrowIfNullOrEmpty(contentRoot);

        var root = Path.GetFullPath(contentRoot);
        if (!Directory.Exists(root))
        {
            throw new InvalidDataException($"Content root '{root}' does not exist.");
        }

        var violations = ImmutableArray.CreateBuilder<ContentSchemaViolation>();

        var files = Directory.GetFiles(root, "*.json", SearchOption.AllDirectories)
            .Select(fullPath => (
                RelativePath: ContentDigest.ToRelativePosixPath(root, fullPath),
                FullPath: fullPath))
            .OrderBy(file => file.RelativePath, StringComparer.Ordinal);

        foreach (var (relativePath, fullPath) in files)
        {
            var directory = relativePath.Split('/')[0];
            if (!_byDirectory.TryGetValue(directory, out var schema))
            {
                violations.Add(new ContentSchemaViolation(
                    relativePath,
                    "$",
                    $"No schema is registered for content directory '{directory}'."));
                continue;
            }

            JsonNode instance;
            try
            {
                // Through StrictJson, so validation reads external data under
                // the same size and depth ceilings the loader does (TDD §18).
                // Reading it here with a bare File.ReadAllText left the laxest
                // path into the program unbounded, which is the only path an
                // oversized or deeply nested file needs.
                instance = StrictJson.ParseNode(relativePath, fullPath);
            }
            catch (InvalidDataException exception)
            {
                violations.Add(new ContentSchemaViolation(
                    relativePath,
                    "$",
                    exception.Message));
                continue;
            }

            var results = schema.Evaluate(instance, Options);
            if (results.IsValid)
            {
                continue;
            }

            var before = violations.Count;
            foreach (var detail in Flatten(results))
            {
                if (detail.Errors is not { Count: > 0 })
                {
                    continue;
                }

                foreach (var (keyword, message) in detail.Errors)
                {
                    violations.Add(new ContentSchemaViolation(
                        relativePath,
                        detail.InstanceLocation.ToString(),
                        $"{keyword}: {message}"));
                }
            }

            // A result can be invalid without carrying a single error message
            // — reporting nothing for it would turn "invalid" into "valid" for
            // every caller that only counts violations.
            if (violations.Count == before)
            {
                violations.Add(new ContentSchemaViolation(
                    relativePath,
                    results.InstanceLocation.ToString(),
                    "File does not satisfy its schema."));
            }
        }

        return violations.ToImmutable();
    }

    /// <summary>
    /// Throws on the first violation, for callers that want a hard stop rather
    /// than a report — the CLI runner's data-error exit path.
    /// </summary>
    /// <exception cref="InvalidDataException">Any file violates its schema.</exception>
    public void ValidateOrThrow(string contentRoot)
    {
        var violations = Validate(contentRoot);
        if (violations.IsEmpty)
        {
            return;
        }

        throw new InvalidDataException(
            "Content does not satisfy its schema:" + Environment.NewLine
            + string.Join(
                Environment.NewLine,
                violations.Select(v => $"  {v.RelativePath} {v.InstanceLocation}: {v.Message}")));
    }

    private static JsonSchema ReadSchema(string schemaRoot, string fileName)
    {
        var path = Path.Combine(schemaRoot, fileName);
        if (!File.Exists(path))
        {
            throw new InvalidDataException($"Schema file '{path}' does not exist.");
        }

        try
        {
            return JsonSchema.FromText(File.ReadAllText(path));
        }
        catch (JsonException exception)
        {
            throw new InvalidDataException($"Schema file '{path}' is not valid JSON: {exception.Message}", exception);
        }
    }

    private static IEnumerable<EvaluationResults> Flatten(EvaluationResults results)
    {
        yield return results;

        foreach (var detail in results.Details)
        {
            foreach (var nested in Flatten(detail))
            {
                yield return nested;
            }
        }
    }
}
