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
/// hang that has to be killed, a hang that has spawned its own child, and a
/// stream that closes early while the other keeps writing.
/// </summary>
/// <remarks>
/// The fixture constants below (<c>BothStreamsLineCount</c>, the hang lines,
/// the child-PID prefix, the half-closed lines) mirror
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

    // Real timeouts, not aspirational ones: HangTimeout is the brief's own 2
    // seconds, and the guard bounds below exist so a genuine regression
    // (a deadlock, a descendant that survives Kill) fails this test on its
    // own schedule instead of however long the CI job's outer timeout is.
    private static readonly TimeSpan HangTimeout = TimeSpan.FromSeconds(2);
    private static readonly TimeSpan AmpleTimeout = TimeSpan.FromSeconds(30);
    private static readonly TimeSpan DeadlockGuardBound = TimeSpan.FromSeconds(15);
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

        // Bounded explicitly, on a background thread, rather than trusting
        // the test runner's own timeout: a real deadlock here (reading one
        // stream synchronously to completion before draining the other)
        // should fail this test loudly and quickly, not just eventually
        // wedge the whole CI job.
        var runTask = Task.Run(() => runner.Run(FakeGamePath, new[] { "both-streams" }, AmpleTimeout));
        var completed = await Task.WhenAny(runTask, Task.Delay(DeadlockGuardBound)) == runTask;

        Assert.True(
            completed,
            $"ProcessRunner.Run did not return within {DeadlockGuardBound} — possible deadlock on large output.");
        var outcome = await runTask;
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
    public void Run_MarksTimedOutRun()
    {
        var runner = new ProcessRunner();

        var outcome = runner.Run(FakeGamePath, new[] { "hang" }, HangTimeout);

        Assert.True(outcome.TimedOut);
    }

    [Fact]
    public void Run_KillsDescendantsOnTimeout()
    {
        var runner = new ProcessRunner();

        var outcome = runner.Run(FakeGamePath, new[] { "child" }, HangTimeout);

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

    [Fact]
    public void Run_DrainsBothStreamsToEofAfterTimeout()
    {
        var runner = new ProcessRunner();

        var outcome = runner.Run(FakeGamePath, new[] { "hang" }, HangTimeout);

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
