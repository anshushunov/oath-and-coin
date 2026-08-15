using System.Collections.Immutable;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using OathAndCoin.Simulation.Ids;

namespace OathAndCoin.Content.Scenarios;

/// <summary>
/// The file format a contrast states about itself: one named input, two
/// values for it, the hero and contract the question is asked against, and
/// the direction the answer is expected to flip. A manifest describes one
/// run; this describes two and the difference between them — cramming that
/// into the manifest format would leave half of it unrelated to the run it
/// actually describes.
/// </summary>
/// <remarks>
/// <para>
/// <see cref="Input"/> is drawn from a closed list — <see cref="AllowedInputs"/>
/// — deliberately narrower than every field <see cref="ContentModel.ContractDefinition"/>
/// carries: these four are exactly the conditions a player can perceive
/// changing (payment, risk, a contract's tags, who has already signed on).
/// Nothing else is a legal <see cref="Input"/>, so a contrast can never claim
/// to isolate a variable nobody at the table could actually notice.
/// </para>
/// <para>
/// <see cref="From"/> and <see cref="To"/> are kept as raw <see cref="JsonNode"/>
/// values rather than typed per input, because the shape differs by input —
/// an integer for <c>contract.payment</c>/<c>contract.risk</c>, an array of
/// content ids for <c>contract.tags</c>/<c>contract.accepted_by</c> — and a
/// single closed format has to be able to hold either without a second,
/// input-specific record shape. <see cref="AsInt"/> and <see cref="AsContentIds"/>
/// are the one place either shape is actually read back out, used by this
/// type's own validation and by <c>ContrastRunner</c> alike.
/// </para>
/// </remarks>
public sealed record ContrastDefinition(
    int SchemaVersion,
    string Name,
    string ContentRoot,
    ulong Seed,
    ContentId Hero,
    ContentId Contract,
    string Input,
    JsonNode From,
    JsonNode To,
    string Expect)
{
    /// <summary>
    /// The contrast format this build reads. Mirrors
    /// <see cref="ContentSet.SupportedContentSchemaVersion"/> and
    /// <see cref="ScenarioManifest.SupportedManifestSchemaVersion"/>: a
    /// contrast authored for a later format is refused rather than read
    /// under this version's assumptions.
    /// </summary>
    public const int SupportedContrastSchemaVersion = 1;

    /// <summary>
    /// The only inputs a contrast may vary — exactly the conditions a player
    /// can perceive (see the remarks on this type). Order here is the order
    /// they appear in every error message that lists them; it carries no
    /// other meaning.
    /// </summary>
    public static readonly ImmutableArray<string> AllowedInputs = ImmutableArray.Create(
        "contract.payment", "contract.risk", "contract.tags", "contract.accepted_by");

    /// <summary>The two directions a contrast may declare.</summary>
    public static readonly ImmutableArray<string> AllowedExpectations = ImmutableArray.Create(
        "decline_to_accept", "accept_to_decline");

    /// <summary>
    /// Reads and validates a contrast file, then resolves its
    /// <see cref="ContentRoot"/> against the repository root derived from
    /// this file's own location (<c>&lt;repo&gt;/scenarios/contrasts/&lt;name&gt;.json</c>,
    /// so the repository root is three directories up). Unlike
    /// <see cref="ScenarioManifest.ContentRoot"/> — left repository-relative
    /// for each of its several callers to resolve against a root they
    /// already know — a contrast has exactly one caller (<c>ContrastRunner</c>),
    /// whose own <c>Run</c> takes no separate root argument, so this is the
    /// one place resolution can happen at all.
    /// </summary>
    /// <exception cref="InvalidDataException">
    /// The file is missing, malformed, has an unknown property, declares an
    /// unsupported schema version, names a contrast other than the one its
    /// own file name names, or fails any check <see cref="Parse"/> applies.
    /// </exception>
    public static ContrastDefinition Load(string path)
    {
        ArgumentException.ThrowIfNullOrEmpty(path);

        var fullPath = Path.GetFullPath(path);
        if (!File.Exists(fullPath))
        {
            throw new InvalidDataException($"Contrast file '{fullPath}' does not exist.");
        }

        var displayPath = Path.GetFileName(fullPath);
        var file = StrictJson.ReadFile<ContrastFile>(displayPath, fullPath);
        var definition = Build(file);

        // Every caller addresses a contrast by file name (RepositoryFixtures.Contrast),
        // the same convention ScenarioManifest.Load enforces for scenarios and
        // for the same reason: two spellings of the same identifier mean one
        // of them is never actually read.
        var namedContrast = ContrastIdIn(displayPath);
        if (!string.Equals(definition.Name, namedContrast, StringComparison.Ordinal))
        {
            throw new InvalidDataException(
                $"Contrast file '{displayPath}' declares contrast '{definition.Name}', but its file name "
                + $"names '{namedContrast}'.");
        }

        var contrastsDir = Path.GetDirectoryName(fullPath)
            ?? throw new InvalidOperationException($"Could not determine the directory containing '{fullPath}'.");
        var scenariosDir = Path.GetDirectoryName(contrastsDir)
            ?? throw new InvalidOperationException($"Could not determine the directory containing '{contrastsDir}'.");
        var repositoryRoot = Path.GetDirectoryName(scenariosDir)
            ?? throw new InvalidOperationException($"Could not determine the directory containing '{scenariosDir}'.");

        var resolvedContentRoot = Path.GetFullPath(Path.Combine(repositoryRoot, definition.ContentRoot));

        return definition with { ContentRoot = resolvedContentRoot };
    }

    /// <summary>
    /// Parses and validates a contrast from a JSON string, without resolving
    /// <see cref="ContentRoot"/> against any repository layout — there is no
    /// file here to derive one from. Exists for tests that check this
    /// format's own rules (a closed input list, <c>from != to</c>, a known
    /// <c>expect</c>) without needing a file on disk; a definition built this
    /// way is not meant to be run.
    /// </summary>
    /// <exception cref="InvalidDataException">
    /// The JSON is oversized, malformed, has an unknown property, declares an
    /// unsupported schema version, names an input outside
    /// <see cref="AllowedInputs"/>, declares <c>from</c> equal to <c>to</c>,
    /// declares an <c>expect</c> outside <see cref="AllowedExpectations"/>, or
    /// gives <c>from</c>/<c>to</c> a shape or range the named input does not
    /// accept.
    /// </exception>
    public static ContrastDefinition Parse(string json)
    {
        ArgumentException.ThrowIfNullOrEmpty(json);

        if (Encoding.UTF8.GetByteCount(json) > ContentLimits.MaxFileSizeBytes)
        {
            throw new InvalidDataException(
                $"Contrast JSON is over the {ContentLimits.MaxFileSizeBytes}-byte limit.");
        }

        ContrastFile file;
        try
        {
            file = JsonSerializer.Deserialize<ContrastFile>(json, StrictJson.Options)
                ?? throw new InvalidDataException("Contrast JSON holds JSON null where an object was expected.");
        }
        catch (JsonException exception)
        {
            throw new InvalidDataException(
                $"Contrast JSON is not valid at JSON path '{exception.Path ?? "$"}': {exception.Message}",
                exception);
        }

        return Build(file);
    }

    /// <summary>
    /// Reads <paramref name="node"/> as the integer <c>contract.payment</c>
    /// or <c>contract.risk</c> expects. Shared by this type's own validation
    /// and by <c>ContrastRunner</c>, so there is exactly one place either
    /// reads a number back out of the shape <see cref="From"/>/<see cref="To"/>
    /// hold it in.
    /// </summary>
    /// <exception cref="InvalidDataException"><paramref name="node"/> is not a JSON integer.</exception>
    internal static int AsInt(JsonNode node) =>
        node is JsonValue value && value.TryGetValue<int>(out var number)
            ? number
            : throw new InvalidDataException($"Expected a JSON integer, found '{node.ToJsonString()}'.");

    /// <summary>
    /// Reads <paramref name="node"/> as the content id list
    /// <c>contract.tags</c> or <c>contract.accepted_by</c> expects. See the
    /// remarks on <see cref="AsInt"/>.
    /// </summary>
    /// <exception cref="InvalidDataException">
    /// <paramref name="node"/> is not a JSON array, or one of its entries is
    /// not a string holding a valid <see cref="ContentId"/>.
    /// </exception>
    internal static ImmutableArray<ContentId> AsContentIds(JsonNode node)
    {
        if (node is not JsonArray array)
        {
            throw new InvalidDataException($"Expected a JSON array of content ids, found '{node.ToJsonString()}'.");
        }

        var ids = ImmutableArray.CreateBuilder<ContentId>(array.Count);
        foreach (var item in array)
        {
            if (item is not JsonValue itemValue
                || !itemValue.TryGetValue<string>(out var text)
                || !ContentId.TryParse(text, out var id))
            {
                throw new InvalidDataException(
                    $"Expected a JSON array of content ids, but found entry "
                    + $"'{item?.ToJsonString() ?? "null"}'.");
            }

            ids.Add(id);
        }

        return ids.ToImmutable();
    }

    /// <summary>
    /// The shared core of <see cref="Load"/> and <see cref="Parse"/>: every
    /// check that does not need a file path to state.
    /// </summary>
    private static ContrastDefinition Build(ContrastFile file)
    {
        if (file.SchemaVersion != SupportedContrastSchemaVersion)
        {
            throw new InvalidDataException(
                $"Contrast '{file.Contrast}' declares schema_version {file.SchemaVersion}, but this build "
                + $"reads version {SupportedContrastSchemaVersion}.");
        }

        if (string.IsNullOrWhiteSpace(file.Contrast))
        {
            throw new InvalidDataException("A contrast must declare a non-empty 'contrast' name.");
        }

        if (string.IsNullOrWhiteSpace(file.ContentRoot))
        {
            throw new InvalidDataException($"Contrast '{file.Contrast}' must declare a non-empty 'content_root'.");
        }

        if (!AllowedInputs.Contains(file.Vary.Input, StringComparer.Ordinal))
        {
            throw new InvalidDataException(
                $"Contrast '{file.Contrast}' names vary.input '{file.Vary.Input}', but only these inputs are "
                + $"supported: {string.Join(", ", AllowedInputs)}.");
        }

        if (file.Vary.From is null || file.Vary.To is null)
        {
            throw new InvalidDataException($"Contrast '{file.Contrast}' must declare both vary.from and vary.to.");
        }

        if (JsonNode.DeepEquals(file.Vary.From, file.Vary.To))
        {
            throw new InvalidDataException(
                $"Contrast '{file.Contrast}' declares vary.from and vary.to as the same value "
                + $"('{file.Vary.From.ToJsonString()}') — a contrast with no actual difference between its "
                + "two runs would prove nothing.");
        }

        if (!AllowedExpectations.Contains(file.Expect, StringComparer.Ordinal))
        {
            throw new InvalidDataException(
                $"Contrast '{file.Contrast}' declares expect '{file.Expect}'; expected one of: "
                + $"{string.Join(", ", AllowedExpectations)}.");
        }

        ValidateVaryValue(file.Vary.Input, file.Vary.From, "from", file.Contrast);
        ValidateVaryValue(file.Vary.Input, file.Vary.To, "to", file.Contrast);

        return new ContrastDefinition(
            file.SchemaVersion,
            file.Contrast,
            file.ContentRoot,
            file.Seed,
            file.Hero,
            file.Contract,
            file.Vary.Input,
            file.Vary.From,
            file.Vary.To,
            file.Expect);
    }

    /// <summary>
    /// Checks that <paramref name="value"/> has the shape and range its own
    /// <paramref name="input"/> requires — the same ranges
    /// <see cref="ContentSet.Load"/> enforces on authored content, so a
    /// contrast can never vary a field to a value a real contract could never
    /// hold.
    /// </summary>
    private static void ValidateVaryValue(string input, JsonNode value, string side, string contrastName)
    {
        switch (input)
        {
            case "contract.payment":
                RequireIntInRange(
                    value, ContentBounds.PaymentMin, ContentBounds.PaymentMax, "payment", side, contrastName);
                break;
            case "contract.risk":
                RequireIntInRange(
                    value, ContentBounds.RiskMin, ContentBounds.RiskMax, "risk", side, contrastName);
                break;
            case "contract.tags":
                RequireContentIdArray(value, ContentLimits.MaxTagsPerContract, "tags", side, contrastName);
                break;
            case "contract.accepted_by":
                RequireContentIdArray(value, ContentBounds.RequiredCrewMax, "accepted_by", side, contrastName);
                break;
        }
    }

    private static void RequireIntInRange(
        JsonNode value, int min, int max, string fieldName, string side, string contrastName)
    {
        int number;
        try
        {
            number = AsInt(value);
        }
        catch (InvalidDataException exception)
        {
            throw new InvalidDataException(
                $"Contrast '{contrastName}' vary.{side} for '{fieldName}' must be a JSON integer: "
                + exception.Message);
        }

        if (number < min || number > max)
        {
            throw new InvalidDataException(
                $"Contrast '{contrastName}' vary.{side} = {number} is outside the allowed '{fieldName}' "
                + $"range {min}..{max}.");
        }
    }

    private static void RequireContentIdArray(
        JsonNode value, int maxItems, string fieldName, string side, string contrastName)
    {
        ImmutableArray<ContentId> ids;
        try
        {
            ids = AsContentIds(value);
        }
        catch (InvalidDataException exception)
        {
            throw new InvalidDataException(
                $"Contrast '{contrastName}' vary.{side} for '{fieldName}' must be a JSON array of content "
                + $"ids: {exception.Message}");
        }

        if (ids.Length > maxItems)
        {
            throw new InvalidDataException(
                $"Contrast '{contrastName}' vary.{side} lists {ids.Length} '{fieldName}' entries, over the "
                + $"{maxItems} limit.");
        }

        var seen = new HashSet<ContentId>();
        foreach (var id in ids)
        {
            if (!seen.Add(id))
            {
                throw new InvalidDataException(
                    $"Contrast '{contrastName}' vary.{side} lists '{id}' more than once for '{fieldName}'.");
            }
        }
    }

    /// <summary>
    /// The contrast a file name names: everything before its first dot, so
    /// <c>payment_raised.json</c> names <c>payment_raised</c>. Mirrors
    /// <c>ScenarioManifest.ScenarioIdIn</c>.
    /// </summary>
    private static string ContrastIdIn(string fileName)
    {
        var dot = fileName.IndexOf('.');
        return dot < 0 ? fileName : fileName[..dot];
    }

    private sealed record ContrastFile
    {
        public required int SchemaVersion { get; init; }

        public required string Contrast { get; init; }

        public required string ContentRoot { get; init; }

        public required ulong Seed { get; init; }

        public required ContentId Hero { get; init; }

        public required ContentId Contract { get; init; }

        public required VaryFile Vary { get; init; }

        public required string Expect { get; init; }
    }

    private sealed record VaryFile
    {
        public required string Input { get; init; }

        public JsonNode? From { get; init; }

        public JsonNode? To { get; init; }
    }
}
