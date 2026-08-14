using System.Collections.Immutable;
using System.Diagnostics;

namespace OathAndCoin.Harness;

/// <summary>
/// Drives a child process with <see cref="Process"/>, capturing stdout and
/// stderr on their own background readers so neither pipe's OS buffer can
/// fill up and stall the child while the parent is only watching for exit.
/// </summary>
/// <remarks>
/// Two things this type deliberately does not promise:
/// <list type="bullet">
/// <item>
/// A combined ordering across stdout and stderr. <see cref="ProcessLine.SequenceInStream"/>
/// is contiguous per stream because that is genuinely knowable; a global
/// sequence would not be, since the OS delivers the two streams independently.
/// </item>
/// <item>
/// That killing the top-level process is enough. <see cref="Process.Kill(bool)"/>
/// is called with <c>entireProcessTree: true</c> specifically so a child
/// that has spawned its own descendants does not leave them running past the
/// run meant to bound their lifetime.
/// </item>
/// </list>
/// It also does not promise that <c>entireProcessTree: true</c> itself is
/// airtight: a descendant that spawns after the kill's own tree-walk
/// snapshot, or one a permission failure leaves alive, can still hold a
/// write end of these pipes open (M-PROCESS-1's mutant proved exactly this
/// window — with a plain <c>Kill()</c> the surviving grandchild kept a
/// redirected pipe open and this method never returned). Past the timeout
/// kill, the drain is therefore itself bounded by <see cref="DrainAfterKillBound"/>
/// — see <see cref="Run"/> — so that window costs a few extra seconds, never
/// an unbounded hang.
/// </remarks>
public sealed class ProcessRunner : IProcessRunner
{
    /// <summary>
    /// How long, after a timeout kill, this method keeps waiting for both
    /// readers to reach EOF on their own before forcing them closed. Only
    /// reachable once <see cref="Process.Kill(bool)"/> has already been
    /// called: a healthy kill reaches every descendant in well under a
    /// second, so this bound exists purely for the pathological case where
    /// something still holds a pipe open, not to shave time off a normal
    /// run — see the type's remarks.
    /// </summary>
    private static readonly TimeSpan DrainAfterKillBound = TimeSpan.FromSeconds(5);

    public ProcessOutcome Run(string fileName, IReadOnlyList<string> arguments, TimeSpan timeout)
    {
        ArgumentException.ThrowIfNullOrEmpty(fileName);
        ArgumentNullException.ThrowIfNull(arguments);

        var startInfo = new ProcessStartInfo(fileName)
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };

        foreach (var argument in arguments)
        {
            startInfo.ArgumentList.Add(argument);
        }

        using var process = new Process { StartInfo = startInfo };
        // Cancels the two readers' pending ReadLineAsync calls (not
        // disposed/closed streams — see ReadLinesAsync) if the post-kill
        // drain bound below expires. Never triggered on the happy path: it
        // is only ever cancelled from inside the `if (timedOut)` block.
        using var drainCts = new CancellationTokenSource();
        var stopwatch = Stopwatch.StartNew();
        process.Start();

        // Reading starts immediately, before WaitForExit: a process that
        // writes more than a pipe's OS buffer holds would otherwise block on
        // its own stdout/stderr write with nothing on this end draining it.
        var stdoutTask = ReadLinesAsync(process.StandardOutput, ProcessStream.StandardOutput, drainCts.Token);
        var stderrTask = ReadLinesAsync(process.StandardError, ProcessStream.StandardError, drainCts.Token);

        var exited = process.WaitForExit(ToWaitMilliseconds(timeout));
        var timedOut = !exited;

        if (timedOut)
        {
            // entireProcessTree: true is the whole point of this call — see
            // the type's remarks and M-PROCESS-1. Plain Kill() only ends
            // this process; anything it spawned keeps running.
            process.Kill(entireProcessTree: true);
            process.WaitForExit();

            // Bounded only here, in the post-kill case: the happy path below
            // (process exited on its own) still waits for true EOF with no
            // limit, so a slow-but-healthy drain is never truncated. This
            // wait exists because a kill is not a guarantee — see the type's
            // remarks — so if EOF still has not arrived on its own after a
            // generous margin, this cancels both reads rather than trust a
            // writer this process no longer controls.
            if (!Task.WaitAll(new Task[] { stdoutTask, stderrTask }, DrainAfterKillBound))
            {
                drainCts.Cancel();
            }
        }

        // Awaited unconditionally past this point: on the happy path this is
        // the first and only wait, with no bound and no cancellation ever
        // requested; on the timeout path it is either already satisfied or
        // is what the cancellation above just unblocked. WaitForExit
        // returning true is never treated as proof both readers reached
        // EOF — pipes can still hold unread bytes after the process that
        // wrote them has exited.
        Task.WaitAll(stdoutTask, stderrTask);
        stopwatch.Stop();

        var lines = stdoutTask.Result.Concat(stderrTask.Result).ToImmutableArray();

        return new ProcessOutcome(lines, process.ExitCode, timedOut, stopwatch.Elapsed);
    }

    private static async Task<List<ProcessLine>> ReadLinesAsync(
        StreamReader reader, ProcessStream stream, CancellationToken drainCancellation)
    {
        var lines = new List<ProcessLine>();

        try
        {
            string? line;
            while ((line = await reader.ReadLineAsync(drainCancellation).ConfigureAwait(false)) is not null)
            {
                lines.Add(new ProcessLine(stream, lines.Count, line));
            }
        }
        catch (OperationCanceledException)
        {
            // Only reachable when Run's post-kill drain bound gave up
            // waiting for this reader to reach EOF on its own — the one
            // case where this method does not, itself, run to EOF.
            // Everything captured before that stands as the outcome; Run
            // already knows to report TimedOut for this run regardless.
        }

        return lines;
    }

    // Process.WaitForExit(int) takes milliseconds as an int, and
    // TimeSpan.TotalMilliseconds is a double — not used here, per this
    // project's no-float/double rule. Ticks are integral throughout, so the
    // conversion never touches a floating-point type.
    private static int ToWaitMilliseconds(TimeSpan timeout)
    {
        var milliseconds = timeout.Ticks / TimeSpan.TicksPerMillisecond;
        return milliseconds > int.MaxValue ? int.MaxValue : (int)milliseconds;
    }
}
