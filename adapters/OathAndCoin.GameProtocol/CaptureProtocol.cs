namespace OathAndCoin.GameProtocol;

/// <summary>
/// The engine-side steps a checkpoint capture goes through, in the order
/// <see cref="CaptureProtocol.Run"/> — not the implementation of this
/// interface — decides. Godot's implementation arrives in a later task; this
/// assembly deliberately references nothing engine-specific, so the shape
/// here is pure protocol: what has to happen, not how.
/// </summary>
public interface ICaptureSurface
{
    /// <summary>Attaches to whatever the surface needs before a frame can be driven at all.</summary>
    void Bind();

    /// <summary>Advances the engine by one process frame, so a scenario step queued this tick actually runs.</summary>
    void AwaitProcessFrame();

    /// <summary>
    /// Waits for the engine's own signal that drawing this frame is done.
    /// This is the step a mutant would remove to make a capture race the
    /// renderer — see the caveat on <see cref="CaptureProtocol"/> for what
    /// this step does and does not prove.
    /// </summary>
    void AwaitPostDraw();

    /// <summary>Saves the frame and reports whether the save succeeded.</summary>
    CaptureResult Capture();

    /// <summary>Writes a terminal line — the wire-format event a tool reads back — to stdout.</summary>
    void Emit(string terminalLine);

    /// <summary>Exits the process with the given code.</summary>
    void Quit(int code);
}

/// <summary>
/// The outcome of <see cref="ICaptureSurface.Capture"/>: either the frame
/// facts a terminal line needs, or a reason the save did not succeed. A
/// record rather than an exception — a failed save is an expected, named
/// outcome of driving a checkpoint (a disk full, a missing directory), not a
/// bug in the capture step, and <see cref="CaptureProtocol.Run"/> has to
/// branch on it without a try/catch making that branch look exceptional.
/// </summary>
public sealed record CaptureResult
{
    private CaptureResult(bool succeeded, string? frameSha256, int frameWidth, int frameHeight, int frameDistinctColors, string? failureReason)
    {
        Succeeded = succeeded;
        FrameSha256 = frameSha256;
        FrameWidth = frameWidth;
        FrameHeight = frameHeight;
        FrameDistinctColors = frameDistinctColors;
        FailureReason = failureReason;
    }

    /// <summary>Whether the frame was saved. Everything else on this type is only meaningful when this is <c>true</c>.</summary>
    public bool Succeeded { get; }

    /// <summary>SHA-256 of the saved frame; <c>null</c> when <see cref="Succeeded"/> is <c>false</c>.</summary>
    public string? FrameSha256 { get; }

    /// <summary>The saved frame's width in pixels.</summary>
    public int FrameWidth { get; }

    /// <summary>The saved frame's height in pixels.</summary>
    public int FrameHeight { get; }

    /// <summary>Distinct colors observed in the saved frame.</summary>
    public int FrameDistinctColors { get; }

    /// <summary>Why the save did not succeed; <c>null</c> when <see cref="Succeeded"/> is <c>true</c>.</summary>
    public string? FailureReason { get; }

    /// <summary>Builds a successful result carrying the facts a terminal line needs about the saved frame.</summary>
    public static CaptureResult Success(string frameSha256, int frameWidth, int frameHeight, int frameDistinctColors)
    {
        ArgumentException.ThrowIfNullOrEmpty(frameSha256);
        return new CaptureResult(true, frameSha256, frameWidth, frameHeight, frameDistinctColors, null);
    }

    /// <summary>Builds a failed result carrying why the save did not succeed.</summary>
    public static CaptureResult Failure(string reason)
    {
        ArgumentException.ThrowIfNullOrEmpty(reason);
        return new CaptureResult(false, null, 0, 0, 0, reason);
    }
}

/// <summary>
/// What <see cref="CaptureProtocol.Run"/> returns: the process exit code the
/// caller's <c>Main</c> should propagate, and — only on failure — why. Kept
/// to exactly those two things because everything else a caller might want
/// (the frame hashes, the terminal line) already went out through
/// <see cref="ICaptureSurface.Emit"/> before <see cref="ExitCode"/> is ever
/// read; duplicating it here would be a second copy of data with no second
/// use.
/// </summary>
public sealed record CaptureOutcome(int ExitCode, string? FailureReason);

/// <summary>
/// Drives one checkpoint capture through a fixed step order and reports the
/// result. This exists because the order is the whole point: a mutant that
/// drops the wait for the engine's post-draw signal can still pass a live
/// run, because the game hashes the same file the tool later reads, and a
/// stale frame hashes consistently with itself. Pulling the order out of the
/// engine and into <see cref="Run"/> — where <see cref="ICaptureSurface"/>
/// only supplies the steps, never chooses their sequence — is what makes
/// that mutant observable in a fast, engine-free test instead of only in a
/// live run nobody watches closely enough to catch it.
/// </summary>
/// <remarks>
/// This proves the order of calls in our own code, and nothing more. It does
/// not prove the engine has actually finished drawing by the time
/// <see cref="ICaptureSurface.AwaitPostDraw"/> returns — that <c>frame_post_draw</c>
/// fired on time, for the right frame, with the compositor caught up — which
/// is a claim about Godot's own behaviour this assembly cannot make, because
/// it references no engine at all. Whether the screenshot actually shows the
/// finished frame stays a manual observation on a live run; it is
/// deliberately outside what any test here can check.
/// </remarks>
public static class CaptureProtocol
{
    /// <summary>
    /// Drives <paramref name="surface"/> through Bind, AwaitProcessFrame,
    /// AwaitPostDraw, Capture, and — only if the capture succeeded — Emit
    /// and Quit(0). On a failed capture, Emit is skipped and Quit is called
    /// with a non-zero code instead: a terminal line describing a frame that
    /// was never saved would be worse than no line at all.
    /// </summary>
    /// <param name="surface">The engine-side steps to drive, in the order this method — not the caller — decides.</param>
    /// <param name="buildTerminalLine">
    /// Turns a successful <see cref="CaptureResult"/> into the line passed to
    /// <see cref="ICaptureSurface.Emit"/>. A delegate rather than a call
    /// built in here: <see cref="TerminalEvent"/> already owns the wire
    /// format, and this method's job is ordering, not serialization.
    /// </param>
    /// <returns>The exit code to propagate and, on failure, why.</returns>
    public static CaptureOutcome Run(ICaptureSurface surface, Func<CaptureResult, string> buildTerminalLine)
    {
        ArgumentNullException.ThrowIfNull(surface);
        ArgumentNullException.ThrowIfNull(buildTerminalLine);

        surface.Bind();
        surface.AwaitProcessFrame();
        surface.AwaitPostDraw();
        var result = surface.Capture();

        if (!result.Succeeded)
        {
            var failureReason = result.FailureReason ?? "unknown";
            surface.Quit(1);
            return new CaptureOutcome(1, failureReason);
        }

        var terminalLine = buildTerminalLine(result);
        surface.Emit(terminalLine);
        surface.Quit(0);
        return new CaptureOutcome(0, null);
    }
}
