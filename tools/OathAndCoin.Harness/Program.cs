namespace OathAndCoin.Harness;

/// <summary>
/// Entry point placeholder. This task builds the tool's decision-making
/// core — argument parsing, PNG inspection, and the run verdict — as pure,
/// testable pieces. Wiring them into an actual run (launching Godot, driving
/// a scenario to a checkpoint, writing a report) is process orchestration:
/// a later runtime-harness task's job. <see cref="Main"/> exists only so
/// this project builds as an executable; it commits to no interface a later
/// task would have to work around.
/// </summary>
public static class Program
{
    private const int ExitArgumentError = 2;
    private const int ExitNotImplemented = 3;

    public static int Main(string[] args)
    {
        try
        {
            CommandLine.Parse(args);
        }
        catch (ArgumentException exception)
        {
            Console.Error.WriteLine(exception.Message);
            return ExitArgumentError;
        }

        Console.Error.WriteLine(
            "run-smoke: arguments parsed successfully; process orchestration is not implemented yet.");
        return ExitNotImplemented;
    }
}
