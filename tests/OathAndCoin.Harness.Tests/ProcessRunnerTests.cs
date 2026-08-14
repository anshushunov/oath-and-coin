using System.Diagnostics;
using System.Globalization;
using System.Reflection;
using OathAndCoin.Harness;

namespace OathAndCoin.Harness.Tests;

/// <summary>
/// <see cref="ProcessRunner.Run"/> drives <c>OathAndCoin.Harness.FakeGame</c>
/// — a real console app, referenced with <c>ReferenceOutputAssembly="false"</c>
/// so these tests exercise its built <c>.exe</c>, not its types — through
/// every shape a real Godot child process can take: a clean exit, output
/// large enough to fill an OS pipe buffer on both streams, a nonzero exit, a
/// hang that has to be killed, a hang that has spawned its own child, a
/// launcher that exits normally leaving a descendant holding both pipes, and
/// a stream that closes early while the other keeps writing.
/// </summary>
/// <remarks>
/// The fixture constants below (<c>BothStreamsLineCount</c>, the hang lines,
/// the child-PID prefix, the orphan line, the half-closed lines) mirror
/// <c>OathAndCoin.Harness.FakeGame.Program</c>'s own constants exactly.
/// <c>ReferenceOutputAssembly="false"</c> means there is no compile-time seam
/// to share them through — see that project's csproj and its <c>Program</c>
/// remarks.
/// </remarks>
public class ProcessRunnerTests
{
    private const int BothStreamsLineCount = 5000;
    private const string HangStdoutLine = "about-to-hang";
    private const string HangStderrLine = "stderr-before-hang";
    private const string ChildPidPrefix = "child-pid=";
    private const string OrphanStdoutLine = "parent-exiting";

    // Real timeouts, not aspirational ones: HangTimeout is the brief's own 2
    // seconds, and the guard bounds below exist so a genuine regression
    // (a deadlock, a descendant that survives Kill, ProcessRunner's own
    // post-kill drain wait never unblocking) fails the test that would
    // catch it on its own schedule, instead of wedging the whole run —
    // exactly what happened running M-PROCESS-1 by hand before this guard
    // existed (see the fix report for that observation).
    private static readonly TimeSpan HangTimeout = TimeSpan.FromSeconds(2);
    private static readonly TimeSpan AmpleTimeout = TimeSpan.FromSeconds(30);

    // Comfortably above the worst case this process is documented to take:
    // HangTimeout (2s) to notice the hang, plus ProcessRunner's own
    // DrainAfterKillBound (5s) if a descendant outlives the kill, plus
    // margin for process start/teardown overhead.
    private static readonly TimeSpan RunGuardBound = TimeSpan.FromSeconds(15);

    private static readonly TimeSpan DescendantPollBound = TimeSpan.FromSeconds(5);

    private static readonly string FakeGamePath = ResolveFakeGamePath();

    [Fact]
    public void Run_CapturesEveryLineOfBothStreams()
    {
        var runner = new ProcessRunner();

        var outcome = runner.Run(FakeGamePath, new[] { "both-streams" }, AmpleTimeout);

        var stdout = outcome.Lines.Where(line => line.Stream == ProcessStream.StandardOutput).ToList();
        var stderr = outcome.Lines.Where(line => line.Stream == ProcessStream.StandardError).ToList();

        Assert.False(outcome.TimedOut);
        Assert.Equal(0, outcome.ExitCode);
        Assert.Equal(BothStreamsLineCount, stdout.Count);
        Assert.Equal(BothStreamsLineCount, stderr.Count);

        // Nothing lost and nothing reordered: the exact text at each
        // position, not just the count, and the sequence number is
        // contiguous from zero within each stream.
        Assert.Equal(
            Enumerable.Range(0, BothStreamsLineCount).Select(index => $"stdout-{index}"),
            stdout.Select(line => line.Text));
        Assert.Equal(
            Enumerable.Range(0, BothStreamsLineCount).Select(index => $"stderr-{index}"),
            stderr.Select(line => line.Text));
        Assert.Equal(Enumerable.Range(0, BothStreamsLineCount), stdout.Select(line => line.SequenceInStream));
        Assert.Equal(Enumerable.Range(0, BothStreamsLineCount), stderr.Select(line => line.SequenceInStream));
    }

    [Fact]
    public async Task Run_DoesNotDeadlockOnLargeOutput()
    {
        var runner = new ProcessRunner();

        // Bounded explicitly rather than trusting the test runner's own
        // timeout: a real deadlock here (reading one stream synchronously to
        // completion before draining the other) should fail this test
        // loudly and quickly, not just eventually wedge the whole CI job.
        var outcome = await RunGuardedAsync(runner, "both-streams", AmpleTimeout);

        Assert.False(outcome.TimedOut);
        Assert.Equal(0, outcome.ExitCode);
    }

    [Fact]
    public void Run_ReturnsProcessExitCode()
    {
        var runner = new ProcessRunner();

        var outcome = runner.Run(FakeGamePath, new[] { "nonzero" }, AmpleTimeout);

        Assert.Equal(1, outcome.ExitCode);
        Assert.False(outcome.TimedOut);
    }

    [Fact]
    public async Task Run_MarksTimedOutRun()
    {
        var runner = new ProcessRunner();

        // Guarded like Run_DoesNotDeadlockOnLargeOutput: the very regression
        // this test exists to catch (Run never noticing the process is
        // stuck) is a hang, so an unguarded call would wedge the test run
        // instead of failing this test.
        var outcome = await RunGuardedAsync(runner, "hang", HangTimeout);

        Assert.True(outcome.TimedOut);
    }

    [Fact]
    public async Task Run_KillsDescendantsOnTimeout()
    {
        var runner = new ProcessRunner();

        // Guarded for the same reason as Run_MarksTimedOutRun — and here
        // doubly so: M-PROCESS-1 (Kill() instead of Kill(entireProcessTree:
        // true)) makes Run itself hang forever, not merely fail an
        // assertion, because the surviving descendant keeps a redirected
        // pipe open. Without this guard, that regression wedges the whole
        // test run instead of failing this one test.
        var outcome = await RunGuardedAsync(runner, "child", HangTimeout);

        Assert.True(outcome.TimedOut);

        var pidLine = outcome.Lines.Single(line =>
            line.Stream == ProcessStream.StandardOutput
            && line.Text.StartsWith(ChildPidPrefix, StringComparison.Ordinal));
        var descendantProcessId = int.Parse(
            pidLine.Text[ChildPidPrefix.Length..], NumberStyles.None, CultureInfo.InvariantCulture);

        // WaitForExit on the harness's own process only proves the fake
        // game's top-level process is gone; the descendant it spawned needs
        // its own, independent check.
        var descendantExited = WaitUntilProcessExits(descendantProcessId, DescendantPollBound);

        Assert.True(
            descendantExited,
            $"Descendant process {descendantProcessId} was still running {DescendantPollBound} after the "
            + "timeout — Kill(entireProcessTree: true) should have ended it.");
    }

    /// <summary>
    /// The case the <c>hang</c> and <c>child</c> fixtures cannot produce: the
    /// launched process exits **on its own, inside the timeout**, having
    /// spawned a descendant that inherited its stdout and stderr. Neither pipe
    /// reaches EOF, but nothing ever times out either, so a drain bounded only
    /// after a kill is never bounded at all and <see cref="ProcessRunner.Run"/>
    /// waits for a writer it no longer controls — one normally terminating
    /// launcher hanging the harness and CI indefinitely (M-PROCESS-2).
    /// </summary>
    /// <remarks>
    /// Guarded like every other timing test here, and for the sharper reason:
    /// the regression is a hang, so without the guard this test would wedge
    /// the run instead of failing. <c>linger</c> outlives
    /// <see cref="RunGuardBound"/> deliberately — a descendant that died on
    /// its own before the guard expired would let an unbounded drain pass.
    /// </remarks>
    [Fact]
    public async Task Run_ReturnsWhenAnExitedParentLeavesADescendantHoldingTheStreams()
    {
        var runner = new ProcessRunner();

        var outcome = await RunGuardedAsync(runner, "orphan", HangTimeout);

        // The parent exited normally and well inside the timeout: this is not
        // the timeout path wearing a different fixture.
        Assert.False(outcome.TimedOut);
        Assert.Equal(0, outcome.ExitCode);

        // And nothing the parent actually wrote was lost to the bound.
        Assert.Contains(
            outcome.Lines, line => line.Stream == ProcessStream.StandardOutput && line.Text == OrphanStdoutLine);
    }

    [Fact]
    public async Task Run_DrainsBothStreamsToEofAfterTimeout()
    {
        var runner = new ProcessRunner();

        var outcome = await RunGuardedAsync(runner, "hang", HangTimeout);

        Assert.True(outcome.TimedOut);
        Assert.Contains(
            outcome.Lines, line => line.Stream == ProcessStream.StandardOutput && line.Text == HangStdoutLine);
        Assert.Contains(
            outcome.Lines, line => line.Stream == ProcessStream.StandardError && line.Text == HangStderrLine);
    }

    [Fact]
    public void Run_SurvivesHalfClosedStream()
    {
        var runner = new ProcessRunner();

        ProcessOutcome? outcome = null;
        var exception = Record.Exception(
            () => { outcome = runner.Run(FakeGamePath, new[] { "half-closed" }, AmpleTimeout); });

        Assert.Null(exception);
        Assert.NotNull(outcome);
        Assert.False(outcome!.TimedOut);
        Assert.Equal(0, outcome.ExitCode);

        var stderrLines = outcome.Lines
            .Where(line => line.Stream == ProcessStream.StandardError)
            .Select(line => line.Text);
        Assert.Equal(new[] { "after-close-0", "after-close-1", "after-close-2" }, stderrLines);
    }

    /// <summary>
    /// Calls <see cref="ProcessRunner.Run"/> on a background task and fails
    /// the test — rather than hanging it — if it does not return within
    /// <see cref="RunGuardBound"/>. Every test that drives a timeout or a
    /// kill uses this: the regression each one exists to catch (a missed
    /// timeout, a descendant that survives a kill) is itself a hang, so an
    /// unguarded call would turn a red test into a wedged CI job instead.
    /// </summary>
    private static async Task<ProcessOutcome> RunGuardedAsync(ProcessRunner runner, string mode, TimeSpan timeout)
    {
        var runTask = Task.Run(() => runner.Run(FakeGamePath, new[] { mode }, timeout));
        var completed = await Task.WhenAny(runTask, Task.Delay(RunGuardBound)) == runTask;

        Assert.True(
            completed,
            $"ProcessRunner.Run did not return within {RunGuardBound} while running the '{mode}' fixture.");

        return await runTask;
    }

    private static bool WaitUntilProcessExits(int processId, TimeSpan bound)
    {
        var deadline = DateTime.UtcNow + bound;
        while (DateTime.UtcNow < deadline)
        {
            try
            {
                using var process = Process.GetProcessById(processId);
                if (process.HasExited)
                {
                    return true;
                }
            }
            catch (ArgumentException)
            {
                // No process with this id exists anymore — the OS has
                // already reclaimed it, the strongest evidence of death.
                return true;
            }

            Thread.Sleep(50);
        }

        return false;
    }

    private static string ResolveFakeGamePath()
    {
        var metadata = typeof(ProcessRunnerTests).Assembly
            .GetCustomAttributes<AssemblyMetadataAttribute>()
            .FirstOrDefault(attribute => attribute.Key == "FakeGamePath");

        if (metadata is null || string.IsNullOrEmpty(metadata.Value))
        {
            throw new InvalidOperationException(
                "AssemblyMetadataAttribute 'FakeGamePath' was not found on the test assembly.");
        }

        return Path.GetFullPath(metadata.Value);
    }
}
