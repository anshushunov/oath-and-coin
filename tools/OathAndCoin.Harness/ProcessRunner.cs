using System.Collections.Immutable;
using System.ComponentModel;
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
/// snapshot, one a permission failure leaves alive, or one whose parent
/// exited first — orphans are reparented, so a tree walk from the process
/// this method launched no longer reaches them — can still hold a write end
/// of these pipes open. M-PROCESS-1's mutant proved that window with a plain
/// <c>Kill()</c>: the surviving grandchild kept a redirected pipe open and
/// this method never returned. Because a kill is therefore never a
/// guarantee, and because the process exiting on its own is not one either,
/// the drain is bounded on **every** path — see <see cref="Run"/> — so a
/// pipe-holding descendant costs a few extra seconds, never an unbounded
/// hang.
/// </remarks>
public sealed class ProcessRunner : IProcessRunner
{
    /// <summary>
    /// The least time this method ever gives both readers to reach EOF on
    /// their own before forcing them closed, and the whole allowance once the
    /// run's own budget is already spent.
    /// </summary>
    /// <remarks>
    /// A process that has exited has closed its own write ends, so every byte
    /// it wrote is already in the pipe and readable at memory speed: this
    /// grace is not there to let a healthy run finish writing, it is there to
    /// wait out a descendant that outlived it. Five seconds is generous for
    /// the former and arbitrary for the latter, which is the point — the
    /// alternative is waiting on a writer this process does not control, with
    /// no bound at all.
    /// </remarks>
    private static readonly TimeSpan DrainGrace = TimeSpan.FromSeconds(5);

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
        // disposed/closed streams — see ReadLinesAsync) once the drain bound
        // below expires, on whichever path got there.
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
        }

        // Bounded on every path, not only after a kill. WaitForExit returning
        // true is not proof both readers reached EOF: a descendant that
        // inherited these pipes holds their write ends open after the process
        // this method launched has exited normally, and waiting for an EOF
        // only that descendant can produce is an unbounded wait triggered by
        // an ordinary, successful run (M-PROCESS-2). What is left of the
        // run's own budget bounds it, and never less than DrainGrace so a
        // process that exits just short of its timeout is not truncated.
        var remaining = timeout - stopwatch.Elapsed;
        if (!Task.WaitAll(new Task[] { stdoutTask, stderrTask }, remaining > DrainGrace ? remaining : DrainGrace))
        {
            // Best effort, and only meaningful on the path that has not
            // killed anything yet: the tree walk starts from a process that
            // has already exited, which on Linux means the descendant was
            // reparented away and is no longer reachable from here at all.
            // The bound below is what actually guarantees the return.
            if (!timedOut)
            {
                TryKillTree(process);
            }

            drainCts.Cancel();
        }

        // Awaited unconditionally past this point: either both readers
        // reached EOF within the bound above, or the cancellation just
        // unblocked them and each returns the lines it had already read.
        Task.WaitAll(stdoutTask, stderrTask);
        stopwatch.Stop();

        var lines = stdoutTask.Result.Concat(stderrTask.Result).ToImmutableArray();

        return new ProcessOutcome(lines, process.ExitCode, timedOut, stopwatch.Elapsed);
    }

    /// <summary>
    /// Kills the process tree and swallows the two failures that mean there
    /// is nothing left to kill (the process is already gone) or that this
    /// process may not (a permission failure on a descendant). Neither is a
    /// reason to fail a run whose output has already been captured, and the
    /// caller's own bound does not depend on this succeeding.
    /// </summary>
    private static void TryKillTree(Process process)
    {
        try
        {
            process.Kill(entireProcessTree: true);
        }
        catch (Exception exception)
            when (exception is InvalidOperationException or Win32Exception or AggregateException)
        {
            // Nothing to do and nothing to report: see this method's summary.
        }
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
