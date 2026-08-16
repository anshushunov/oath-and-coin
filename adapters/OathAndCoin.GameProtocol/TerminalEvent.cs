using System.Collections.Immutable;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace OathAndCoin.GameProtocol;

/// <summary>
/// What the running game printed to stdout when a scenario reached its
/// checkpoint: the outcome, the two hashes <c>OathAndCoin.Presentation</c>
/// defines (read model and rendered UI), and enough about the screenshot
/// frame to compare against what the tool captured. This is the other half
/// of the protocol from <see cref="GameArguments"/> — the tool builds the
/// launch request, the game reports back in this shape — which is why it
/// lives in the same protocol-only assembly rather than in
/// <c>OathAndCoin.Presentation</c>, which neither side of a process boundary
/// should have to depend on just to read a terminal line.
/// </summary>
/// <param name="SchemaVersion">
/// The version of this wire format the line was written under. Required,
/// not defaulted: the protocol is expected to grow, and an old tool reading
/// a newer event should refuse it outright (see <see cref="Parse"/>) rather
/// than parse it under assumptions that no longer hold.
/// </param>
/// <param name="Event">The event's own name, e.g. <c>"terminal"</c>.</param>
/// <param name="OutcomeKind">
/// <c>"success"</c> or <c>"error"</c>, mirroring
/// <c>OathAndCoin.Content.Scenarios.ScenarioOutcomeKind</c> — kept as a plain
/// string rather than that enum because this assembly does not reference
/// <c>OathAndCoin.Content</c> (it consumes nothing; see the plan brief).
/// </param>
/// <param name="Scenario">The scenario id the run was driven from.</param>
/// <param name="Seed">The simulation seed the run used.</param>
/// <param name="Checkpoint">The checkpoint name the run reports reaching.</param>
/// <param name="ErrorCode">
/// The formalized error identifier when <paramref name="OutcomeKind"/> is
/// <c>"error"</c>; <c>null</c> on success. Together with
/// <paramref name="OutcomeKind"/> this is what makes an error a stated
/// outcome rather than an absence of the success fields below.
/// </param>
/// <param name="ContentVersion">
/// The loaded content's version, or <c>null</c> when the run errored before
/// content finished loading — an error that early never computes one.
/// </param>
/// <param name="CanonicalHash">
/// The canonical content hash, <c>null</c> for the same reason as
/// <paramref name="ContentVersion"/>.
/// </param>
/// <param name="ReadModelHash">
/// <c>OathAndCoin.Presentation.ContractOfferScreenModelFactory.ReadModelHash</c> of
/// the screen the game built — present even on an error outcome, because an
/// error still renders a screen (with its own error code and no lines) that
/// can be hashed like any other.
/// </param>
/// <param name="RenderedUiHash">The rendered-UI-snapshot hash of the same screen.</param>
/// <param name="ScreenState">
/// The screen's own <c>OathAndCoin.Presentation.ScreenState</c>, lowercased
/// (e.g. <c>"normal"</c>, <c>"loading"</c>) — coarser fields already exist
/// (<paramref name="OutcomeKind"/> collapses <c>Incomplete</c> and
/// <c>Normal</c> into one <c>"success"</c>), and a scenario's manifest can
/// name exactly this one to check that a run showed the screen state its own
/// name promises, not merely an outcome of the same broad kind.
/// </param>
/// <param name="FrameSha256">SHA-256 of the screenshot frame the game wrote.</param>
/// <param name="FrameWidth">The captured frame's width in pixels.</param>
/// <param name="FrameHeight">The captured frame's height in pixels.</param>
/// <param name="FrameDistinctColors">Distinct colors observed in the captured frame.</param>
/// <param name="LayoutContentWidth">
/// How wide the screen's whole content actually is, in pixels, at its natural
/// size — measured from the control tree after it was laid out, never
/// clipped to the window. See <paramref name="LayoutReachableHeight"/> for
/// what this pair is for.
/// </param>
/// <param name="LayoutContentHeight">The same measurement, vertically.</param>
/// <param name="LayoutReachableWidth">
/// How much of that content a person at this window could actually get to:
/// the window's own width plus however far the content can be scrolled
/// sideways. Equal to the window width exactly when nothing scrolls.
/// </param>
/// <param name="LayoutReachableHeight">
/// The same, vertically — and the half that matters today. External review
/// finding (blocker): the roster ran off the bottom of a 1280x720 frame at
/// the fourth of six heroes, with no scrolling and nothing anywhere that
/// could notice. Neither hash can: <c>rendered_ui_hash</c> walks every
/// <c>Label</c> in the tree and compares the texts, knowing nothing about
/// where — or whether — any of them landed on screen, and it should not be
/// taught to (a layout change would then have to move a hash that is about
/// the model reaching the controls). So the game reports what it measured and
/// the tool decides, exactly as it already does for
/// <paramref name="FrameDistinctColors"/>: content wider or taller than what
/// is reachable is a screen with something on it nobody can read.
/// </param>
public sealed record TerminalEvent(
    int SchemaVersion,
    string Event,
    string OutcomeKind,
    string Scenario,
    ulong Seed,
    string Checkpoint,
    string? ErrorCode,
    string? ContentVersion,
    string? CanonicalHash,
    string ReadModelHash,
    string RenderedUiHash,
    string ScreenState,
    string FrameSha256,
    int FrameWidth,
    int FrameHeight,
    int FrameDistinctColors,
    int LayoutContentWidth,
    int LayoutContentHeight,
    int LayoutReachableWidth,
    int LayoutReachableHeight)
{
    /// <summary>
    /// The wire format version this build understands. Mirrors
    /// <c>OathAndCoin.Content.Scenarios.ScenarioManifest.SupportedManifestSchemaVersion</c>:
    /// a line declaring any other version is refused rather than read under
    /// the wrong version's assumptions.
    /// </summary>
    /// <remarks>
    /// Raised to 2 by the four <c>layout_*</c> fields. A bump, not a
    /// tolerated absence: an older game build's line carries no layout at
    /// all, and a tool that quietly read it as "nothing overflowed" would
    /// turn a version skew into a green run — the same argument
    /// <see cref="Parse"/> already makes for refusing an unknown version
    /// outright.
    /// </remarks>
    public const int SupportedSchemaVersion = 2;

    /// <summary>
    /// The bound every size and depth ceiling below is set to. A terminal
    /// event is a small, flat object; there is no legitimate reason for one
    /// to nest sixteen levels deep, and a reader that allows it anyway is a
    /// reader an adversarial or merely buggy game build can use to burn CPU
    /// on stdout it fully controls.
    /// </summary>
    private const int MaxJsonDepth = 16;

    /// <summary>
    /// The strict reading policy every line in <see cref="Parse"/> goes
    /// through, and the writing policy <see cref="ToLine"/> emits under, so
    /// the two halves of the wire format cannot disagree about naming.
    /// Restated here — rather than shared with
    /// <c>OathAndCoin.Content.StrictJson</c>, which enforces the same kind of
    /// policy for on-disk content — because this assembly deliberately
    /// references nothing (it belongs to both the tool and the game, and a
    /// dependency on the tool's content-reading assembly would break that).
    /// A terminal event is external data exactly like a content file — it
    /// arrives on stdout, a channel the running game does not fully control
    /// either (engine banners, driver warnings) — so it earns the same
    /// strictness for the same reason: an unmapped property or a trailing
    /// comma is a version skew or a bug, not something to paper over. The
    /// ceilings are the one deliberate difference: an event is a flat object
    /// arriving one line at a time, so the depth bound is 16 rather than
    /// <c>ContentLimits.MaxJsonDepth</c>'s 32, and there is no size bound at
    /// all — a line's length is already bounded by the reader that split it.
    /// </summary>
    private static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        PropertyNameCaseInsensitive = false,
        AllowTrailingCommas = false,
        ReadCommentHandling = JsonCommentHandling.Disallow,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        NumberHandling = JsonNumberHandling.Strict,
        MaxDepth = MaxJsonDepth,
    };

    /// <summary>
    /// Reads every line of the game's stdout, picking out terminal events.
    /// </summary>
    /// <remarks>
    /// Never throws. A line is only treated as an attempted event if, once
    /// trimmed, it starts with <c>{</c> — the engine prints plenty of plain
    /// text noise on stdout (its own banner, renderer info, shader compiler
    /// chatter), and none of that should count as a broken event just
    /// because it also failed to parse as JSON. A line that does look like
    /// an attempted event but is not valid JSON, declares a
    /// <see cref="SchemaVersion"/> this build does not understand, or is
    /// missing a required field is recorded in
    /// <see cref="TerminalParseResult.Errors"/> instead — a caller driving a
    /// scenario needs to see that failure, not have the run silently report
    /// nothing.
    /// </remarks>
    public static TerminalParseResult Parse(IReadOnlyList<string> outputLines)
    {
        ArgumentNullException.ThrowIfNull(outputLines);

        var events = ImmutableArray.CreateBuilder<TerminalEvent>();
        var errors = ImmutableArray.CreateBuilder<string>();

        foreach (var line in outputLines)
        {
            if (!line.TrimStart().StartsWith('{'))
            {
                // Not an attempted event at all: engine noise, ignored.
                continue;
            }

            EventLine? parsed;
            try
            {
                parsed = JsonSerializer.Deserialize<EventLine>(line, Options);
            }
            catch (JsonException exception)
            {
                errors.Add($"Line '{line}' is not a valid terminal event: {exception.Message}");
                continue;
            }

            if (parsed is null)
            {
                errors.Add($"Line '{line}' is JSON null where a terminal event object was expected.");
                continue;
            }

            if (parsed.SchemaVersion != SupportedSchemaVersion)
            {
                errors.Add(
                    $"Line '{line}' declares schema_version {parsed.SchemaVersion}, but this build reads "
                    + $"version {SupportedSchemaVersion}.");
                continue;
            }

            events.Add(new TerminalEvent(
                parsed.SchemaVersion,
                parsed.Event,
                parsed.OutcomeKind,
                parsed.Scenario,
                parsed.Seed,
                parsed.Checkpoint,
                parsed.ErrorCode,
                parsed.ContentVersion,
                parsed.CanonicalHash,
                parsed.ReadModelHash,
                parsed.RenderedUiHash,
                parsed.ScreenState,
                parsed.FrameSha256,
                parsed.FrameWidth,
                parsed.FrameHeight,
                parsed.FrameDistinctColors,
                parsed.LayoutContentWidth,
                parsed.LayoutContentHeight,
                parsed.LayoutReachableWidth,
                parsed.LayoutReachableHeight));
        }

        return new TerminalParseResult(events.ToImmutable(), errors.ToImmutable());
    }

    /// <summary>
    /// Renders this event as the single stdout line <see cref="Parse"/> reads
    /// back. Lives here rather than in the game because the game has no test
    /// project: hand-written JSON there would drift from
    /// <see cref="EventLine"/>'s required field set silently, and the only
    /// thing that would notice is a person launching the engine by hand.
    /// With both halves in one type, <c>ToLine_RoundTripsThroughParse</c>
    /// fails the moment a field is added on one side alone.
    /// </summary>
    public string ToLine() => JsonSerializer.Serialize(
        new EventLine
        {
            SchemaVersion = SchemaVersion,
            Event = Event,
            OutcomeKind = OutcomeKind,
            Scenario = Scenario,
            Seed = Seed,
            Checkpoint = Checkpoint,
            ErrorCode = ErrorCode,
            ContentVersion = ContentVersion,
            CanonicalHash = CanonicalHash,
            ReadModelHash = ReadModelHash,
            RenderedUiHash = RenderedUiHash,
            ScreenState = ScreenState,
            FrameSha256 = FrameSha256,
            FrameWidth = FrameWidth,
            FrameHeight = FrameHeight,
            FrameDistinctColors = FrameDistinctColors,
            LayoutContentWidth = LayoutContentWidth,
            LayoutContentHeight = LayoutContentHeight,
            LayoutReachableWidth = LayoutReachableWidth,
            LayoutReachableHeight = LayoutReachableHeight,
        },
        Options);

    /// <summary>
    /// The wire shape <see cref="Parse"/> deserializes into before it is
    /// known to be a version this build understands, and the shape
    /// <see cref="ToLine"/> serializes from. Kept separate from
    /// <see cref="TerminalEvent"/> itself so the public record's shape is
    /// never at the mercy of what <see cref="JsonSerializer"/> needs from a
    /// deserialization target (e.g. a settable init accessor for every
    /// member) — the two happen to match field-for-field today, but nothing
    /// here depends on them staying textually identical. A field absent on
    /// either side is a compiler error in <see cref="ToLine"/> when
    /// <c>required</c>, and a round-trip failure otherwise.
    /// </summary>
    private sealed record EventLine
    {
        public required int SchemaVersion { get; init; }

        public required string Event { get; init; }

        public required string OutcomeKind { get; init; }

        public required string Scenario { get; init; }

        public required ulong Seed { get; init; }

        public required string Checkpoint { get; init; }

        public string? ErrorCode { get; init; }

        public string? ContentVersion { get; init; }

        public string? CanonicalHash { get; init; }

        public required string ReadModelHash { get; init; }

        public required string RenderedUiHash { get; init; }

        public required string ScreenState { get; init; }

        public required string FrameSha256 { get; init; }

        public required int FrameWidth { get; init; }

        public required int FrameHeight { get; init; }

        public required int FrameDistinctColors { get; init; }

        public required int LayoutContentWidth { get; init; }

        public required int LayoutContentHeight { get; init; }

        public required int LayoutReachableWidth { get; init; }

        public required int LayoutReachableHeight { get; init; }
    }
}

/// <summary>
/// The result of reading a whole stdout stream: every event that parsed
/// cleanly, in the order it was printed, and every line that looked like an
/// attempted event but was not one this build could accept.
/// </summary>
public sealed record TerminalParseResult(ImmutableArray<TerminalEvent> Events, ImmutableArray<string> Errors);
