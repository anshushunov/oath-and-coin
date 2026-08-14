using System.Collections.Immutable;
using OathAndCoin.GameProtocol;

namespace OathAndCoin.GameProtocol.Tests;

/// <summary>
/// <see cref="CaptureProtocol.Run"/> owns the one thing an engine-side
/// implementation of <see cref="ICaptureSurface"/> must not be free to get
/// wrong: the order Bind → AwaitProcessFrame → AwaitPostDraw → Capture →
/// Emit → Quit happens in. The fake surface below is a plain call recorder —
/// it proves order and gating, not anything about Godot, which this
/// assembly never references.
/// </summary>
public class CaptureProtocolTests
{
    /// <summary>
    /// Records every call it receives, in order, instead of doing anything —
    /// the point of the test is the sequence <see cref="CaptureProtocol.Run"/>
    /// drives the surface through, not any particular surface behaviour.
    /// </summary>
    private sealed class RecordingSurface : ICaptureSurface
    {
        public List<string> Calls { get; } = new();

        public CaptureResult CaptureResult { get; set; } = CaptureResult.Success("frame-sha256", 1280, 720, 12);

        public void Bind() => Calls.Add("Bind");

        public void AwaitProcessFrame() => Calls.Add("AwaitProcessFrame");

        public void AwaitPostDraw() => Calls.Add("AwaitPostDraw");

        public CaptureResult Capture()
        {
            Calls.Add("Capture");
            return CaptureResult;
        }

        public void Emit(string terminalLine)
        {
            Calls.Add($"Emit:{terminalLine}");
        }

        public void Quit(int code)
        {
            Calls.Add($"Quit:{code}");
        }
    }

    [Fact]
    public void Run_FollowsBindProcessPostDrawCaptureEmitOrder()
    {
        var surface = new RecordingSurface();

        CaptureProtocol.Run(surface, _ => "terminal-line");

        Assert.Equal(
            new[] { "Bind", "AwaitProcessFrame", "AwaitPostDraw", "Capture", "Emit:terminal-line", "Quit:0" },
            surface.Calls);
    }

    /// <summary>
    /// The load-bearing test for this whole task: a mutant that drops the
    /// <c>AwaitPostDraw</c> call from <see cref="CaptureProtocol.Run"/> must
    /// turn this test red (M-CAPTURE-1). Asserting on the exact call
    /// sequence, not merely "AwaitPostDraw was called", is what makes that
    /// true — a mutant that removes the wait still calls Capture, so only
    /// checking presence would stay green.
    /// </summary>
    [Fact]
    public void Run_DoesNotCaptureBeforePostDraw()
    {
        var surface = new RecordingSurface();

        CaptureProtocol.Run(surface, _ => "terminal-line");

        var postDrawIndex = surface.Calls.IndexOf("AwaitPostDraw");
        var captureIndex = surface.Calls.IndexOf("Capture");

        Assert.True(postDrawIndex >= 0, "AwaitPostDraw must be called.");
        Assert.True(captureIndex >= 0, "Capture must be called.");
        Assert.True(
            postDrawIndex < captureIndex,
            $"AwaitPostDraw (index {postDrawIndex}) must precede Capture (index {captureIndex}).");
    }

    [Fact]
    public void Run_DoesNotEmitWhenCaptureFails()
    {
        var surface = new RecordingSurface { CaptureResult = CaptureResult.Failure("SAVE_FAILED") };

        var outcome = CaptureProtocol.Run(surface, _ => "should-not-be-called");

        Assert.DoesNotContain(surface.Calls, call => call.StartsWith("Emit:", StringComparison.Ordinal));
        Assert.NotEqual(0, outcome.ExitCode);
        Assert.Equal("SAVE_FAILED", outcome.FailureReason);
    }

    [Fact]
    public void Run_QuitsWithZeroOnlyAfterEmit()
    {
        var surface = new RecordingSurface();

        var outcome = CaptureProtocol.Run(surface, _ => "terminal-line");

        var emitIndex = surface.Calls.FindIndex(call => call.StartsWith("Emit:", StringComparison.Ordinal));
        var quitIndex = surface.Calls.FindIndex(call => call.StartsWith("Quit:", StringComparison.Ordinal));

        Assert.True(emitIndex >= 0, "Emit must be called.");
        Assert.True(quitIndex >= 0, "Quit must be called.");
        Assert.True(emitIndex < quitIndex, $"Emit (index {emitIndex}) must precede Quit (index {quitIndex}).");
        Assert.Equal("Quit:0", surface.Calls[quitIndex]);
        Assert.Equal(0, outcome.ExitCode);
    }
}
