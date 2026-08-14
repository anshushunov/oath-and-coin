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
/// </remarks>
public sealed class ProcessRunner : IProcessRunner
{
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
        var stopwatch = Stopwatch.StartNew();
        process.Start();

        // Reading starts immediately, before WaitForExit: a process that
        // writes more than a pipe's OS buffer holds would otherwise block on
        // its own stdout/stderr write with nothing on this end draining it.
        var stdoutTask = ReadLinesAsync(process.StandardOutput, ProcessStream.StandardOutput);
        var stderrTask = ReadLinesAsync(process.StandardError, ProcessStream.StandardError);

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

        // Awaited unconditionally, not only after a timeout: an exited
        // process can still have unread bytes sitting in its pipes, and
        // WaitForExit returning true is not proof both readers have caught
        // up to EOF yet.
        Task.WaitAll(stdoutTask, stderrTask);
        stopwatch.Stop();

        var lines = stdoutTask.Result.Concat(stderrTask.Result).ToImmutableArray();

        return new ProcessOutcome(lines, process.ExitCode, timedOut, stopwatch.Elapsed);
    }

    private static async Task<List<ProcessLine>> ReadLinesAsync(StreamReader reader, ProcessStream stream)
    {
        var lines = new List<ProcessLine>();

        string? line;
        while ((line = await reader.ReadLineAsync().ConfigureAwait(false)) is not null)
        {
            lines.Add(new ProcessLine(stream, lines.Count, line));
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
