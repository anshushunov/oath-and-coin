using System.Collections.Immutable;

namespace OathAndCoin.Presentation;

/// <summary>
/// Every stable error code <c>Main.LoadModel</c> and
/// <c>OathAndCoin.Harness.SmokeRun</c> can put on a
/// <see cref="ContractOfferScreenModel.ErrorCode"/> — named once so both
/// callers (and <see cref="ErrorKeys"/>, and the catalogue-completeness test)
/// read the same five spellings instead of each retyping them.
/// </summary>
public static class ErrorCodes
{
    /// <summary>The content directory itself is missing.</summary>
    public const string ContentRootNotFound = "CONTENT_ROOT_NOT_FOUND";

    /// <summary>A content file failed schema validation (stage 1, TDD §11.2).</summary>
    public const string SchemaInvalid = "SCHEMA_INVALID";

    /// <summary>A content file failed <c>ContentSet.Load</c> itself, past schema validation.</summary>
    public const string ContentInvalid = "CONTENT_INVALID";

    /// <summary>The scenario's own manifest or commands file could not be read.</summary>
    public const string ScenarioInvalid = "SCENARIO_INVALID";

    /// <summary><c>--checkpoint</c> did not resolve against an otherwise valid scenario.</summary>
    public const string CheckpointUnknown = "CHECKPOINT_UNKNOWN";

    /// <summary>Every code above, for <see cref="ErrorKeys.AllKeys"/> and the catalogue-completeness test.</summary>
    public static readonly ImmutableArray<string> All = ImmutableArray.Create(
        ContentRootNotFound, SchemaInvalid, ContentInvalid, ScenarioInvalid, CheckpointUnknown);
}
