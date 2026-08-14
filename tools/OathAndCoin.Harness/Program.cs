namespace OathAndCoin.Harness;

/// <summary>
/// The <c>run-smoke</c> entry point: parse the command line, hand the run to
/// <see cref="SmokeRun.Execute"/>, and return what it decided.
/// </summary>
/// <remarks>
/// Exit codes are the tool's contract with whatever runs it:
/// <list type="bullet">
/// <item><c>0</c> — the verdict passed.</item>
/// <item><c>1</c> — the verdict failed; every reason is on stderr.</item>
/// <item><c>2</c> — the command line could not be parsed.</item>
/// <item><c>3</c> — the run could not be carried out at all (no engine, a
/// failed build or import, an expectation the tool could not build, or a
/// working tree it refuses to run on).</item>
/// </list>
/// The split matters to a caller: <c>1</c> is a fact about the game, <c>2</c>
/// and <c>3</c> are facts about the invocation and the machine, and treating
/// them alike is how a broken environment gets reported as a broken game.
/// </remarks>
public static class Program
{
    private const int ExitArgumentError = 2;

    public static int Main(string[] args)
    {
        ParsedArguments arguments;

        try
        {
            arguments = CommandLine.Parse(args);
        }
        catch (ArgumentException exception)
        {
            Console.Error.WriteLine(exception.Message);
            return ExitArgumentError;
        }

        return SmokeRun.Execute(arguments, new ProcessRunner(), Console.Out, Console.Error);
    }
}

internal static class MutantCi2_0 { public static int Value => 0; }
internal static class MutantCi2_1 { public static int Value => 1; }
internal static class MutantCi2_2 { public static int Value => 2; }
internal static class MutantCi2_3 { public static int Value => 3; }
internal static class MutantCi2_4 { public static int Value => 4; }
internal static class MutantCi2_5 { public static int Value => 5; }
internal static class MutantCi2_6 { public static int Value => 6; }
internal static class MutantCi2_7 { public static int Value => 7; }
internal static class MutantCi2_8 { public static int Value => 8; }
internal static class MutantCi2_9 { public static int Value => 9; }
