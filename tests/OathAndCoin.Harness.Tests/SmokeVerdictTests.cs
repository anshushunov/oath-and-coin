using System.Collections.Immutable;
using OathAndCoin.Content.Scenarios;
using OathAndCoin.GameProtocol;
using OathAndCoin.Harness;

namespace OathAndCoin.Harness.Tests;

/// <summary>
/// <see cref="SmokeVerdict.Evaluate"/> is a pure function of a
/// <see cref="RunObservation"/>: every test here builds one directly rather
/// than running anything. <see cref="CleanRun"/> assembles an observation
/// that should pass; every test but the "accepts" and "reports everything"
/// ones corrupts exactly one aspect of it and checks that the verdict
/// notices — see <see cref="Verdict_ReportsEveryFailedConditionAtOnce"/> for
/// why "exactly one reason per failure" matters enough to test on its own.
/// </summary>
public class SmokeVerdictTests
{
    private const string Scenario = "gate0";
    private const string Checkpoint = "decisions_complete";
    private const ulong Seed = 424242UL;
    private const string CanonicalHash = "canonical-abc123";
    private const string ReadModelHash = "read-model-hash";
    private const string RenderedUiHash = "rendered-ui-hash";
    private const string FrameSha256 = "frame-sha256";
    private const int FrameWidth = 1280;
    private const int FrameHeight = 720;
    private const string FramePath = @"C:\repo\artifacts\smoke\run\frame.png";

    private const string ErrorScenario = "screen_error";
    private const string ErrorCheckpoint = "screen_error";
    private const string ErrorCode = "CONTENT_ROOT_NOT_FOUND";

    private const string LoadingScenario = "screen_loading";
    private const string LoadingCheckpoint = "screen_loading";

    [Fact]
    public void Verdict_AcceptsCleanSuccessRun()
    {
        var verdict = SmokeVerdict.Evaluate(CleanRun());

        Assert.True(verdict.Passed);
        Assert.Empty(verdict.Reasons);
    }

    [Fact]
    public void Verdict_AcceptsCleanErrorRun()
    {
        var verdict = SmokeVerdict.Evaluate(CleanRun(errorOutcome: true));

        Assert.True(verdict.Passed);
        Assert.Empty(verdict.Reasons);
    }

    /// <summary>
    /// <see cref="ScenarioOutcomeKind.Loading"/> is the outcome
    /// <c>OathAndCoin.Content.Scenarios.ScenarioManifest</c> reserves for the
    /// fifth <c>ContractOfferScreenModel.ScreenState</c> — the one the model
    /// factory never builds, shown before any content is read at all. This
    /// pins <see cref="SmokeVerdict.Evaluate"/>'s outcome-kind comparison
    /// (<c>"loading"</c> on both sides) the same way the success and error
    /// cases above already do.
    /// </summary>
    [Fact]
    public void Verdict_AcceptsCleanLoadingRun()
    {
        var verdict = SmokeVerdict.Evaluate(CleanRun(loadingOutcome: true));

        Assert.True(verdict.Passed);
        Assert.Empty(verdict.Reasons);
    }

    [Fact]
    public void Verdict_RejectsSuccessWhenManifestExpectsLoading()
    {
        var observation = CleanRun(
            loadingOutcome: true,
            eventOverride: CleanEvent(loadingOutcome: true) with { OutcomeKind = "success" });

        var verdict = SmokeVerdict.Evaluate(observation);

        Assert.False(verdict.Passed);
        Assert.Contains(verdict.Reasons, reason => reason.Contains("outcome", StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>
    /// Review finding (Important 2): <c>outcome_kind</c> alone cannot tell
    /// <c>Incomplete</c> from <c>Normal</c> — both report <c>"success"</c> —
    /// so a manifest that names an <c>expected_screen_state</c> has to be
    /// checked against that finer field, not just the coarse one every
    /// scenario already carries.
    /// </summary>
    [Fact]
    public void Verdict_AcceptsMatchingScreenState()
    {
        var verdict = SmokeVerdict.Evaluate(CleanRun(expectedScreenState: "normal"));

        Assert.True(verdict.Passed);
        Assert.Empty(verdict.Reasons);
    }

    [Fact]
    public void Verdict_RejectsMismatchedScreenState()
    {
        var observation = CleanRun(
            expectedScreenState: "normal",
            eventOverride: CleanEvent() with { ScreenState = "incomplete" });

        var verdict = SmokeVerdict.Evaluate(observation);

        Assert.False(verdict.Passed);
        Assert.Contains(verdict.Reasons, reason => reason.Contains("screen_state", StringComparison.Ordinal));
    }

    /// <summary>
    /// A manifest that states nothing about <c>expected_screen_state</c>
    /// (every manifest predating Task 12's review) must not suddenly fail a
    /// run whose actual screen state happens to differ from this fixture's
    /// own default ("normal") — the check only applies when a manifest
    /// actually opts into it.
    /// </summary>
    [Fact]
    public void Verdict_SkipsScreenStateCheckWhenManifestStatesNone()
    {
        var observation = CleanRun(eventOverride: CleanEvent() with { ScreenState = "incomplete" });

        var verdict = SmokeVerdict.Evaluate(observation);

        Assert.True(verdict.Passed);
        Assert.Empty(verdict.Reasons);
    }

    [Fact]
    public void Verdict_RejectsErrorCodeOtherThanExpected()
    {
        var observation = CleanRun(
            errorOutcome: true,
            eventOverride: CleanEvent(errorOutcome: true) with { ErrorCode = "SOME_OTHER_ERROR" });

        var verdict = SmokeVerdict.Evaluate(observation);

        Assert.False(verdict.Passed);
        Assert.Contains(verdict.Reasons, reason => reason.Contains("error code", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void Verdict_RejectsSuccessWhenManifestExpectsError()
    {
        var observation = CleanRun(
            errorOutcome: true,
            eventOverride: CleanEvent(errorOutcome: true) with { OutcomeKind = "success" });

        var verdict = SmokeVerdict.Evaluate(observation);

        Assert.False(verdict.Passed);
        Assert.Contains(verdict.Reasons, reason => reason.Contains("outcome", StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>
    /// The reproduction that retired <c>Verdict_RejectsEngineErrorLine</c>
    /// (owner, 2026-08-14): a run with exit 0, one terminal event, all three
    /// hashes matching and a valid 1280x720 frame was judged failed for one
    /// line the engine prints about the machine it is running on. Both lines
    /// below are verbatim from that run's <c>run.log</c>. An
    /// <c>ERROR:</c>-prefixed line is the engine's general-purpose diagnostic
    /// channel — the same prefix carries certificate stores, audio devices and
    /// missing optional drivers — so failing on its mere presence makes the
    /// same commit pass on one machine and fail on another, which is the one
    /// thing a proof run may not do.
    /// </summary>
    [Fact]
    public void Verdict_AcceptsRunWhoseOnlyErrorLineIsAboutTheEnvironment()
    {
        var observation = CleanRun(diagnosticLines: ImmutableArray.Create(
            "ERROR: Failed to read the root certificate store.",
            "   at: get_system_ca_certificates (platform/windows/os_windows.cpp:2582)"));

        var verdict = SmokeVerdict.Evaluate(observation);

        Assert.True(verdict.Passed);
        Assert.Empty(verdict.Reasons);
    }

    /// <summary>
    /// Fatal, unlike <c>ERROR:</c>, because the game itself emits this exact
    /// prefix from <c>Main._Ready</c>'s capture worker (see the
    /// <c>SCRIPT ERROR: autopilot capture failed</c> line there) and the engine
    /// reserves it for the script layer. No environment probe produces one.
    /// </summary>
    [Fact]
    public void Verdict_RejectsScriptErrorLine()
    {
        var observation = CleanRun(
            diagnosticLines: ImmutableArray.Create("SCRIPT ERROR: Invalid get index 'foo'"));

        var verdict = SmokeVerdict.Evaluate(observation);

        Assert.False(verdict.Passed);
        Assert.Contains(verdict.Reasons, reason => reason.Contains("SCRIPT ERROR:", StringComparison.Ordinal));
    }

    /// <summary>
    /// The engine's crash macros print <c>FATAL:</c> and then abort the
    /// process, so this can only ever fire on a run that also died — it costs
    /// no false failures and buys a named reason instead of a bare exit code.
    /// </summary>
    [Fact]
    public void Verdict_RejectsFatalEngineLine()
    {
        var observation = CleanRun(
            diagnosticLines: ImmutableArray.Create("FATAL: Condition \"!data\" is true."));

        var verdict = SmokeVerdict.Evaluate(observation);

        Assert.False(verdict.Passed);
        Assert.Contains(verdict.Reasons, reason => reason.Contains("FATAL:", StringComparison.Ordinal));
    }

    [Fact]
    public void Verdict_RejectsFatalDiagnosticAfterTerminalEvent()
    {
        // Diagnostic lines are scanned regardless of when they were printed
        // relative to the terminal event line: a crash on the way out after
        // an otherwise clean event is still a run that proved nothing.
        var observation = CleanRun(
            diagnosticLines: ImmutableArray.Create(
                "Godot Engine v4.2.1.stable.official",
                "{\"event\":\"terminal\", ... }",
                "SCRIPT ERROR: Condition \"!ok\" is true. Aborting.",
                "at: some_engine_function (core/os/os.cpp:123)"));

        var verdict = SmokeVerdict.Evaluate(observation);

        Assert.False(verdict.Passed);
        Assert.Contains(verdict.Reasons, reason => reason.Contains("SCRIPT ERROR:", StringComparison.Ordinal));
    }

    [Fact]
    public void Verdict_RejectsSilentSuccess()
    {
        var observation = CleanRun(eventsOverride: ImmutableArray<TerminalEvent>.Empty);

        var verdict = SmokeVerdict.Evaluate(observation);

        Assert.False(verdict.Passed);
        Assert.Contains(verdict.Reasons, reason => reason.Contains("no terminal event", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void Verdict_RejectsDuplicateTerminalEvent()
    {
        var terminalEvent = CleanEvent();
        var observation = CleanRun(eventsOverride: ImmutableArray.Create(terminalEvent, terminalEvent));

        var verdict = SmokeVerdict.Evaluate(observation);

        Assert.False(verdict.Passed);
        Assert.Contains(verdict.Reasons, reason => reason.Contains("exactly one", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void Verdict_RejectsMalformedTerminalLine()
    {
        var observation = CleanRun(
            parseErrorsOverride: ImmutableArray.Create("Line '{\"schema_version\": 1' is not a valid terminal event: unexpected end of JSON."));

        var verdict = SmokeVerdict.Evaluate(observation);

        Assert.False(verdict.Passed);
        Assert.Contains(verdict.Reasons, reason => reason.Contains("malformed", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void Verdict_RejectsEventForAnotherScenario()
    {
        var observation = CleanRun(eventOverride: CleanEvent() with { Scenario = "some_other_scenario" });

        var verdict = SmokeVerdict.Evaluate(observation);

        Assert.False(verdict.Passed);
        Assert.Contains(verdict.Reasons, reason => reason.Contains("scenario", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void Verdict_RejectsEventForAnotherSeed()
    {
        var observation = CleanRun(eventOverride: CleanEvent() with { Seed = Seed + 1 });

        var verdict = SmokeVerdict.Evaluate(observation);

        Assert.False(verdict.Passed);
        Assert.Contains(verdict.Reasons, reason => reason.Contains("seed", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void Verdict_RejectsEventForAnotherCheckpoint()
    {
        var observation = CleanRun(eventOverride: CleanEvent() with { Checkpoint = "some_other_checkpoint" });

        var verdict = SmokeVerdict.Evaluate(observation);

        Assert.False(verdict.Passed);
        Assert.Contains(verdict.Reasons, reason => reason.Contains("checkpoint", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void Verdict_RejectsNonZeroGameExit()
    {
        var observation = CleanRun(exitCode: 1);

        var verdict = SmokeVerdict.Evaluate(observation);

        Assert.False(verdict.Passed);
        Assert.Contains(verdict.Reasons, reason => reason.Contains("exit", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void Verdict_RejectsTimeout()
    {
        var observation = CleanRun(timedOut: true);

        var verdict = SmokeVerdict.Evaluate(observation);

        Assert.False(verdict.Passed);
        Assert.Contains(verdict.Reasons, reason => reason.Contains("timed out", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void Verdict_RejectsMismatchedCanonicalHash()
    {
        var observation = CleanRun(eventOverride: CleanEvent() with { CanonicalHash = "some-other-hash" });

        var verdict = SmokeVerdict.Evaluate(observation);

        Assert.False(verdict.Passed);
        Assert.Contains(verdict.Reasons, reason => reason.Contains("canonical_hash", StringComparison.Ordinal));
    }

    [Fact]
    public void Verdict_RejectsMismatchedReadModelHash()
    {
        var observation = CleanRun(eventOverride: CleanEvent() with { ReadModelHash = "some-other-hash" });

        var verdict = SmokeVerdict.Evaluate(observation);

        Assert.False(verdict.Passed);
        Assert.Contains(verdict.Reasons, reason => reason.Contains("read_model_hash", StringComparison.Ordinal));
    }

    [Fact]
    public void Verdict_RejectsMismatchedRenderedUiHash()
    {
        var observation = CleanRun(eventOverride: CleanEvent() with { RenderedUiHash = "some-other-hash" });

        var verdict = SmokeVerdict.Evaluate(observation);

        Assert.False(verdict.Passed);
        Assert.Contains(verdict.Reasons, reason => reason.Contains("rendered_ui_hash", StringComparison.Ordinal));
    }

    [Fact]
    public void Verdict_RejectsFrameNotWrittenByThisRun()
    {
        var observation = CleanRun(frameOverride: CleanFrame() with { Sha256 = "some-other-sha256" });

        var verdict = SmokeVerdict.Evaluate(observation);

        Assert.False(verdict.Passed);
        Assert.Contains(verdict.Reasons, reason => reason.Contains("not written by this run", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void Verdict_RejectsInvalidPngHeader()
    {
        var observation = CleanRun(frameOverride: CleanFrame() with { HasValidPngHeader = false });

        var verdict = SmokeVerdict.Evaluate(observation);

        Assert.False(verdict.Passed);
        Assert.Contains(verdict.Reasons, reason => reason.Contains("PNG header", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void Verdict_RejectsResizedFrame()
    {
        var observation = CleanRun(frameOverride: CleanFrame() with { Width = 640, Height = 480 });

        var verdict = SmokeVerdict.Evaluate(observation);

        Assert.False(verdict.Passed);
        Assert.Contains(verdict.Reasons, reason => reason.Contains("640", StringComparison.Ordinal));
    }

    [Fact]
    public void Verdict_RejectsSingleColourFrame()
    {
        // The failure this catches is invisible to every other condition: a
        // correctly built control tree whose window rendered nothing still
        // writes a valid PNG whose SHA-256 the game itself declared, so both
        // hashes and the frame-provenance check stay green on a blank frame.
        var observation = CleanRun(eventOverride: CleanEvent() with { FrameDistinctColors = 1 });

        var verdict = SmokeVerdict.Evaluate(observation);

        Assert.False(verdict.Passed);
        Assert.Contains(
            verdict.Reasons, reason => reason.Contains("distinct colour", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void Verdict_RejectsFrameThatIsNotTheRequestedResolution()
    {
        // Two values move together here because they are one fact — the size
        // the game says it captured and the size on disk agree, and only the
        // resolution the run asked for disagrees. Corrupting either alone
        // would trip the event-versus-frame comparison instead, which is the
        // self-referential check this one exists to backstop.
        var observation = CleanRun(
            eventOverride: CleanEvent() with { FrameWidth = 640, FrameHeight = 480 },
            frameOverride: CleanFrame() with { Width = 640, Height = 480 });

        var verdict = SmokeVerdict.Evaluate(observation);

        Assert.False(verdict.Passed);
        Assert.Contains(verdict.Reasons, reason => reason.Contains("requested", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void Verdict_RejectsMissingFrame()
    {
        var observation = CleanRun(
            frameOverride: new FrameInspection(HasValidPngHeader: false, Width: 0, Height: 0, ByteLength: 0, Sha256: string.Empty));

        var verdict = SmokeVerdict.Evaluate(observation);

        Assert.False(verdict.Passed);
        Assert.Contains(verdict.Reasons, reason => reason.Contains("PNG header", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void Verdict_ReportsEveryFailedConditionAtOnce()
    {
        // Three independent corruptions, chosen so none of them cascades
        // into another check: a nonzero exit code, a read-model hash
        // mismatch, and a frame that was not written by this run. A
        // debugging session that can only see one cause per run, fix it,
        // and re-run to find the next is the failure mode this test exists
        // to prevent.
        var observation = CleanRun(
            exitCode: 1,
            eventOverride: CleanEvent() with { ReadModelHash = "some-other-hash" },
            frameOverride: CleanFrame() with { Sha256 = "some-other-sha256" });

        var verdict = SmokeVerdict.Evaluate(observation);

        Assert.False(verdict.Passed);
        Assert.Equal(3, verdict.Reasons.Length);
        Assert.Contains(verdict.Reasons, reason => reason.Contains("exit", StringComparison.OrdinalIgnoreCase));
        Assert.Contains(verdict.Reasons, reason => reason.Contains("read_model_hash", StringComparison.Ordinal));
        Assert.Contains(verdict.Reasons, reason => reason.Contains("not written by this run", StringComparison.OrdinalIgnoreCase));
    }

    private static TerminalEvent CleanEvent(bool errorOutcome = false, bool loadingOutcome = false, string? screenState = null) => new(
        SchemaVersion: TerminalEvent.SupportedSchemaVersion,
        Event: "terminal",
        OutcomeKind: loadingOutcome ? "loading" : errorOutcome ? "error" : "success",
        Scenario: loadingOutcome ? LoadingScenario : errorOutcome ? ErrorScenario : Scenario,
        Seed: Seed,
        Checkpoint: loadingOutcome ? LoadingCheckpoint : errorOutcome ? ErrorCheckpoint : Checkpoint,
        ErrorCode: errorOutcome ? ErrorCode : null,
        ContentVersion: (errorOutcome || loadingOutcome) ? null : "content-abc123",
        CanonicalHash: (errorOutcome || loadingOutcome) ? null : CanonicalHash,
        ReadModelHash: ReadModelHash,
        RenderedUiHash: RenderedUiHash,
        ScreenState: screenState ?? (loadingOutcome ? "loading" : errorOutcome ? "error" : "normal"),
        FrameSha256: FrameSha256,
        FrameWidth: FrameWidth,
        FrameHeight: FrameHeight,
        FrameDistinctColors: 12);

    private static FrameInspection CleanFrame() => new(
        HasValidPngHeader: true,
        Width: FrameWidth,
        Height: FrameHeight,
        ByteLength: 123_456,
        Sha256: FrameSha256);

    /// <summary>
    /// Assembles a <see cref="RunObservation"/> that should pass, letting
    /// each caller override exactly the one field its test is corrupting.
    /// </summary>
    private static RunObservation CleanRun(
        bool errorOutcome = false,
        bool loadingOutcome = false,
        TerminalEvent? eventOverride = null,
        ImmutableArray<TerminalEvent>? eventsOverride = null,
        ImmutableArray<string>? parseErrorsOverride = null,
        int exitCode = 0,
        bool timedOut = false,
        ImmutableArray<string>? diagnosticLines = null,
        FrameInspection? frameOverride = null,
        string? expectedScreenState = null)
    {
        var terminalEvent = eventOverride ?? CleanEvent(errorOutcome, loadingOutcome);
        var events = eventsOverride ?? ImmutableArray.Create(terminalEvent);

        var expectedOutcome = loadingOutcome
            ? ScenarioOutcomeKind.Loading
            : errorOutcome ? ScenarioOutcomeKind.Error : ScenarioOutcomeKind.Success;

        return new RunObservation(
            Scenario: loadingOutcome ? LoadingScenario : errorOutcome ? ErrorScenario : Scenario,
            Checkpoint: loadingOutcome ? LoadingCheckpoint : errorOutcome ? ErrorCheckpoint : Checkpoint,
            Seed: Seed,
            RequestedWidth: FrameWidth,
            RequestedHeight: FrameHeight,
            ExpectedOutcome: expectedOutcome,
            ExpectedErrorCode: errorOutcome ? ErrorCode : null,
            ExpectedCanonicalHash: (errorOutcome || loadingOutcome) ? null : CanonicalHash,
            ExpectedReadModelHash: ReadModelHash,
            ExpectedRenderedUiHash: RenderedUiHash,
            Terminal: new TerminalParseResult(events, parseErrorsOverride ?? ImmutableArray<string>.Empty),
            ExitCode: exitCode,
            TimedOut: timedOut,
            DiagnosticLines: diagnosticLines ?? ImmutableArray<string>.Empty,
            Frame: frameOverride ?? CleanFrame(),
            FramePath: FramePath,
            ExpectedScreenState: expectedScreenState);
    }
}
