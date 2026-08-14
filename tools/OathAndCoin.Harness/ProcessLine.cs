using System.Collections.Immutable;

namespace OathAndCoin.Harness;

/// <summary>Which stream a captured line of process output came from.</summary>
public enum ProcessStream
{
    StandardOutput,
    StandardError,
}

/// <summary>
/// One line of a child process's captured output.
/// </summary>
/// <param name="Stream">Which stream the line was read from.</param>
/// <param name="SequenceInStream">
/// This line's zero-based position among every line read from
/// <paramref name="Stream"/> alone — contiguous within a stream, and nothing
/// more. The OS gives no ordering guarantee between stdout and stderr, so a
/// combined sequence number would promise an interleaving
/// <see cref="ProcessRunner"/> cannot actually observe; see its remarks.
/// </param>
/// <param name="Text">The line's text, without its terminating newline.</param>
public sealed record ProcessLine(ProcessStream Stream, int SequenceInStream, string Text);

/// <summary>
/// Everything a <see cref="ProcessRunner"/> run produced: every captured
/// line, how the process actually ended, and how long the run took.
/// </summary>
/// <param name="Lines">
/// Every line captured from both streams, drained to EOF whether the process
/// exited on its own or was killed on <see cref="TimedOut"/>. The order
/// between the two streams is not meaningful — group or filter by
/// <see cref="ProcessLine.Stream"/> before relying on any order.
/// </param>
/// <param name="ExitCode">
/// The process's own exit code. Meaningless when <see cref="TimedOut"/> is
/// <c>true</c>: the value reflects however the OS reports a forced
/// termination, not anything the process itself chose to report.
/// </param>
/// <param name="TimedOut">Whether the run had to be killed after its timeout elapsed.</param>
/// <param name="Duration">Wall-clock time from process start until both streams reached EOF.</param>
public sealed record ProcessOutcome(ImmutableArray<ProcessLine> Lines, int ExitCode, bool TimedOut, TimeSpan Duration);
