using System.Collections.Immutable;
using OathAndCoin.Content.Scenarios;
using OathAndCoin.GameProtocol;

namespace OathAndCoin.Harness;

/// <summary>
/// Everything <see cref="SmokeVerdict.Evaluate"/> needs to decide whether a
/// <c>run-smoke</c> invocation proved anything, gathered into one immutable
/// snapshot so the decision itself never touches a file or a process. Groups
/// mirror where each value came from: what the operator asked for, what the
/// scenario's manifest promises, what the tool computed on its own before
/// the game ran, what the game's own run produced, and the screenshot frame
/// that run is supposed to have written.
/// </summary>
/// <param name="Scenario">The scenario id the run was asked to drive.</param>
/// <param name="Checkpoint">The checkpoint the run was asked to stop at.</param>
/// <param name="Seed">The simulation seed the run was asked to use.</param>
/// <param name="RequestedWidth">
/// The window width this run launched the game with
/// (<see cref="GameArguments.Width"/>). Held separately from what the game
/// reported so at least one frame condition is anchored outside the game's
/// own claims: every other size check compares the event against the file
/// the same event describes.
/// </param>
/// <param name="RequestedHeight">The window height this run launched the game with.</param>
/// <param name="ExpectedOutcome">
/// What the scenario's manifest (<see cref="ScenarioManifest.ExpectedOutcome"/>) says this run should produce.
/// </param>
/// <param name="ExpectedErrorCode">
/// The manifest's <see cref="ScenarioManifest.ExpectedErrorCode"/> when
/// <paramref name="ExpectedOutcome"/> is <see cref="ScenarioOutcomeKind.Error"/>; <c>null</c> otherwise.
/// </param>
/// <param name="ExpectedCanonicalHash">
/// The canonical content/state hash the tool computed independently of the
/// running game, or <c>null</c> when the expected outcome is an error that
/// never reaches a hashed state.
/// </param>
/// <param name="ExpectedReadModelHash">
/// <c>OathAndCoin.Presentation.SpikeScreenModelFactory.ReadModelHash</c> the
/// tool computed for the screen this run should show.
/// </param>
/// <param name="ExpectedRenderedUiHash">
/// <c>OathAndCoin.Presentation.RenderedUiSnapshot.Hash</c> of the same
/// screen — proves the model reached the control tree, not just that the
/// model itself matched (see the remarks on <c>RenderedUiSnapshot</c>).
/// </param>
/// <param name="Terminal">Every terminal event and parse error the game's stdout produced.</param>
/// <param name="ExitCode">The game process's own exit code.</param>
/// <param name="TimedOut">Whether the process had to be killed after <see cref="ParsedArguments.TimeoutSeconds"/>.</param>
/// <param name="DiagnosticLines">
/// Every line of the game's captured output — nothing filtered on the way in.
/// Scanned twice and for different purposes: for the narrow set of markers
/// that fail a run on their own (<c>SmokeVerdict</c>'s fatal prefixes), and
/// for every marker the engine uses at all, which <c>report.json</c> repeats
/// whatever the verdict decided. The scan is independent of whether a
/// terminal event also parsed, because a run can print a valid event and
/// still have crashed logging on its way out.
/// </param>
/// <param name="Frame">What <see cref="FrameFile.Inspect"/> found when it looked at the screenshot on disk.</param>
/// <param name="FramePath">Where that screenshot was expected to be written, for reporting only.</param>
public sealed record RunObservation(
    string Scenario,
    string Checkpoint,
    ulong Seed,
    int RequestedWidth,
    int RequestedHeight,
    ScenarioOutcomeKind ExpectedOutcome,
    string? ExpectedErrorCode,
    string? ExpectedCanonicalHash,
    string ExpectedReadModelHash,
    string ExpectedRenderedUiHash,
    TerminalParseResult Terminal,
    int ExitCode,
    bool TimedOut,
    ImmutableArray<string> DiagnosticLines,
    FrameInspection Frame,
    string FramePath);

/// <summary>
/// Whether a <c>run-smoke</c> invocation proved what it set out to prove,
/// and every reason it did not.
/// </summary>
/// <param name="Passed"><c>true</c> exactly when <see cref="Reasons"/> is empty.</param>
/// <param name="Reasons">
/// Every failed condition, not just the first — see
/// <c>SmokeVerdictTests.Verdict_ReportsEveryFailedConditionAtOnce</c>.
/// </param>
public sealed record Verdict(bool Passed, ImmutableArray<string> Reasons);

/// <summary>
/// Turns a <see cref="RunObservation"/> into a <see cref="Verdict"/>. A pure
/// function on purpose: every row of the brief's verdict table is a plain
/// data test, with no process or filesystem involved in the decision itself.
/// </summary>
public static class SmokeVerdict
{
    /// <summary>
    /// The engine markers that fail a run on their own. Two entries, each
    /// here for a stated reason rather than for looking serious:
    /// <list type="bullet">
    /// <item>
    /// <c>SCRIPT ERROR:</c> — the engine's script channel
    /// (<c>ERR_HANDLER_SCRIPT</c>, one of the five error types the pinned
    /// 4.7.1 binary spells alongside <c>WARNING</c>, <c>ERROR</c>,
    /// <c>SHADER ERROR</c> and <c>UNKNOWN ERROR</c>), and the prefix the game
    /// itself prints when its capture worker throws — see the
    /// <c>SCRIPT ERROR: autopilot capture failed</c> line in
    /// <c>game/app/Main.cs</c>. That is a run reporting a defect in this
    /// repository's own code, which is what this harness exists to catch, and
    /// no probe of the machine produces one.
    /// </item>
    /// <item>
    /// <c>FATAL:</c> — the engine's crash macros (<c>FATAL: Condition "…" is
    /// true.</c>), which print and then trap. It can only appear on a run that
    /// died, so it costs no false failure; it buys the operator a named cause
    /// instead of a bare negative exit code.
    /// </item>
    /// </list>
    /// <c>ERROR:</c> is deliberately absent: it is the engine's general
    /// diagnostic channel, carrying certificate stores and absent optional
    /// devices as readily as real faults, so failing on its presence made the
    /// same commit pass on one machine and fail on another (owner's
    /// reproduction, 2026-08-14 — see <c>SmokeVerdictTests</c>). Every line
    /// still reaches <c>run.log</c> and <c>report.json</c> unchanged.
    /// </summary>
    private static readonly ImmutableArray<string> FatalPrefixes =
        ImmutableArray.Create("SCRIPT ERROR:", "FATAL:");

    /// <summary>
    /// Every marker the engine puts in front of a diagnostic line, fatal here
    /// or not. Reported, never failed on by itself: <see cref="IsDiagnostic"/>
    /// is what <c>report.json</c> selects with, so a reader of the report
    /// alone still sees the lines the verdict decided to tolerate.
    /// </summary>
    private static readonly ImmutableArray<string> DiagnosticPrefixes = ImmutableArray.Create(
        "ERROR:", "WARNING:", "SCRIPT ERROR:", "SHADER ERROR:", "UNKNOWN ERROR:", "FATAL:");

    /// <summary>
    /// Whether this line of the game's output carries one of the engine's own
    /// diagnostic markers. A multi-line diagnostic's continuation lines (a
    /// stack frame, an <c>at:</c> location) carry no marker and are not
    /// selected — <c>run.log</c> holds the output complete and verbatim.
    /// </summary>
    public static bool IsDiagnostic(string line) => StartsWithAny(line, DiagnosticPrefixes);

    public static Verdict Evaluate(RunObservation observation)
    {
        ArgumentNullException.ThrowIfNull(observation);

        var reasons = ImmutableArray.CreateBuilder<string>();

        if (observation.TimedOut)
        {
            reasons.Add(
                $"The run timed out before the game reported a terminal event for checkpoint "
                + $"'{observation.Checkpoint}'.");
        }

        if (observation.ExitCode != 0)
        {
            reasons.Add($"The game process exited with code {observation.ExitCode}, not 0.");
        }

        foreach (var parseError in observation.Terminal.Errors)
        {
            reasons.Add($"Malformed terminal line: {parseError}");
        }

        foreach (var line in observation.DiagnosticLines.Where(line => StartsWithAny(line, FatalPrefixes)))
        {
            reasons.Add($"Fatal engine diagnostic on the game's output: {line}");
        }

        if (observation.Terminal.Events.Length == 0)
        {
            reasons.Add(
                "No terminal event was reported — a run that proves nothing is not a pass, even when the "
                + "process exited cleanly (silent success).");
        }
        else if (observation.Terminal.Events.Length > 1)
        {
            reasons.Add(
                $"Expected exactly one terminal event, but the run reported "
                + $"{observation.Terminal.Events.Length}.");
        }
        else
        {
            AddEventReasons(observation, observation.Terminal.Events[0], reasons);
        }

        if (!observation.Frame.HasValidPngHeader)
        {
            reasons.Add($"Frame '{observation.FramePath}' does not have a valid PNG header.");
        }

        // Against what the run asked for, not against what the event says the
        // run produced. The event's own width and height are compared to the
        // file further down, but that pair proves only that the game
        // described the file it wrote; a game that captured the wrong surface
        // would describe that one just as consistently.
        if (observation.Frame.Width != observation.RequestedWidth
            || observation.Frame.Height != observation.RequestedHeight)
        {
            reasons.Add(
                $"Frame '{observation.FramePath}' is {observation.Frame.Width}x{observation.Frame.Height}, but the "
                + $"run requested {observation.RequestedWidth}x{observation.RequestedHeight}.");
        }

        return new Verdict(reasons.Count == 0, reasons.ToImmutable());
    }

    // Leading whitespace is trimmed because the engine indents some of its
    // own output; nothing else about the line is normalized, and the reason
    // (or the report) quotes it exactly as the game printed it.
    private static bool StartsWithAny(string line, ImmutableArray<string> prefixes) =>
        prefixes.Any(prefix => line.TrimStart().StartsWith(prefix, StringComparison.Ordinal));

    private static void AddEventReasons(
        RunObservation observation,
        TerminalEvent terminalEvent,
        ImmutableArray<string>.Builder reasons)
    {
        if (!string.Equals(terminalEvent.Scenario, observation.Scenario, StringComparison.Ordinal))
        {
            reasons.Add(
                $"Terminal event reports scenario '{terminalEvent.Scenario}', expected "
                + $"'{observation.Scenario}'.");
        }

        if (terminalEvent.Seed != observation.Seed)
        {
            reasons.Add($"Terminal event reports seed {terminalEvent.Seed}, expected {observation.Seed}.");
        }

        if (!string.Equals(terminalEvent.Checkpoint, observation.Checkpoint, StringComparison.Ordinal))
        {
            reasons.Add(
                $"Terminal event reports checkpoint '{terminalEvent.Checkpoint}', expected "
                + $"'{observation.Checkpoint}'.");
        }

        var expectedOutcomeKind = OutcomeKindText(observation.ExpectedOutcome);
        if (!string.Equals(terminalEvent.OutcomeKind, expectedOutcomeKind, StringComparison.Ordinal))
        {
            reasons.Add(
                $"Terminal event reports outcome '{terminalEvent.OutcomeKind}', expected "
                + $"'{expectedOutcomeKind}'.");
        }
        else if (observation.ExpectedOutcome == ScenarioOutcomeKind.Error
            && !string.Equals(terminalEvent.ErrorCode, observation.ExpectedErrorCode, StringComparison.Ordinal))
        {
            reasons.Add(
                $"Terminal event reports error code '{terminalEvent.ErrorCode}', expected "
                + $"'{observation.ExpectedErrorCode}'.");
        }

        if (!string.Equals(terminalEvent.CanonicalHash, observation.ExpectedCanonicalHash, StringComparison.Ordinal))
        {
            reasons.Add(
                "Terminal event's canonical_hash does not match the hash the tool computed independently.");
        }

        if (!string.Equals(terminalEvent.ReadModelHash, observation.ExpectedReadModelHash, StringComparison.Ordinal))
        {
            reasons.Add(
                "Terminal event's read_model_hash does not match the hash the tool computed independently.");
        }

        if (!string.Equals(
            terminalEvent.RenderedUiHash, observation.ExpectedRenderedUiHash, StringComparison.Ordinal))
        {
            reasons.Add(
                "Terminal event's rendered_ui_hash does not match the hash the tool computed independently.");
        }

        if (!string.Equals(terminalEvent.FrameSha256, observation.Frame.Sha256, StringComparison.Ordinal))
        {
            reasons.Add(
                $"Frame '{observation.FramePath}' was not written by this run: its SHA-256 does not match "
                + "the terminal event's frame_sha256.");
        }

        if (terminalEvent.FrameWidth != observation.Frame.Width
            || terminalEvent.FrameHeight != observation.Frame.Height)
        {
            reasons.Add(
                $"Frame '{observation.FramePath}' is {observation.Frame.Width}x{observation.Frame.Height}, but "
                + $"the terminal event reports {terminalEvent.FrameWidth}x{terminalEvent.FrameHeight}.");
        }

        // The one condition that says anything about the pixels. A window
        // that rendered nothing — a compositor failure, a hidden root, a
        // stretch policy pushing the content off-screen — still writes a
        // valid PNG of the requested size whose SHA-256 the game declares
        // correctly, so every other frame condition stays green on it.
        // Counted by the game (GodotCaptureSurface.CountDistinctColors), so
        // this is not independent evidence; it is the cheapest check that
        // fails on a blank frame at all.
        if (terminalEvent.FrameDistinctColors <= 1)
        {
            reasons.Add(
                $"Frame '{observation.FramePath}' holds {terminalEvent.FrameDistinctColors} distinct colour(s): "
                + "nothing was rendered, whatever the control tree contained.");
        }
    }

    // TerminalEvent.OutcomeKind is a plain string (see its remarks: the
    // protocol assembly does not reference OathAndCoin.Content), so the
    // manifest's enum has to be spelled out as the same wire text before it
    // can be compared against what the game actually reported.
    private static string OutcomeKindText(ScenarioOutcomeKind outcome) => outcome switch
    {
        ScenarioOutcomeKind.Success => "success",
        ScenarioOutcomeKind.Error => "error",
        _ => throw new ArgumentOutOfRangeException(nameof(outcome), outcome, "Unknown scenario outcome kind."),
    };
}
