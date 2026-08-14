namespace OathAndCoin.Harness;

/// <summary>
/// Launches a child process, drives it to exit or to a timeout, and returns
/// everything it produced. The seam between "what to launch" — a later
/// task's job, building the argv for Godot — and "how a process is actually
/// run and its output captured without losing a line or leaking a
/// descendant", which is what <see cref="ProcessRunner"/> exists to answer.
/// </summary>
public interface IProcessRunner
{
    /// <summary>
    /// Starts <paramref name="fileName"/> with <paramref name="arguments"/>
    /// and waits for it to exit, or kills its whole process tree once
    /// <paramref name="timeout"/> elapses.
    /// </summary>
    ProcessOutcome Run(string fileName, IReadOnlyList<string> arguments, TimeSpan timeout);
}
