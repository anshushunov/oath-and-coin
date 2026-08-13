using System.Text;
using OathAndCoin.Content;
using OathAndCoin.Content.Scenarios;

namespace OathAndCoin.SimulationRunner;

/// <summary>
/// The headless entry point: one command, one run, two artifacts. This is the
/// reproducibility check MVP_PLAN §4.3 asks for — running it twice with the
/// same seed and comparing the canonical files is the whole verification.
/// </summary>
/// <remarks>
/// Exit codes are part of the interface, because this is meant to run
/// unattended: <c>0</c> the run completed, <c>1</c> the data was wrong (bad
/// content, bad scenario, failed schema validation), <c>2</c> the arguments
/// were wrong. A pipeline that cannot tell "your content is broken" from "your
/// invocation is broken" reports the wrong problem to the wrong person.
/// </remarks>
public static class Program
{
    private const int ExitSuccess = 0;
    private const int ExitDataError = 1;
    private const int ExitArgumentError = 2;

    private static readonly UTF8Encoding Utf8NoBom = new(encoderShouldEmitUTF8Identifier: false);

    public static int Main(string[] args)
    {
        ParsedArguments parsed;
        try
        {
            parsed = CommandLine.Parse(args);
        }
        catch (ArgumentException exception)
        {
            Console.Error.WriteLine(exception.Message);
            return ExitArgumentError;
        }

        try
        {
            // Validation stage 1 (TDD §11.2) runs before the loader, so a
            // content error is reported as every problem in the tree at once
            // rather than one exception per run.
            ContentSchemas.Load(parsed.SchemaRoot).ValidateOrThrow(parsed.ContentRoot);

            var outcome = ScenarioRunner.Run(
                ContentSet.Load(parsed.ContentRoot),
                ScenarioCommands.Load(parsed.CommandsPath),
                parsed.Seed);

            var artifact = DeterminismArtifact.Serialize(outcome);
            var report = SpikeReport.Render(outcome);

            if (parsed.ArtifactPath is not null)
            {
                Write(parsed.ArtifactPath, artifact);
            }

            if (parsed.ReportPath is not null)
            {
                Write(parsed.ReportPath, report);
            }

            Console.Out.Write(report);
            Console.Out.Write($"canonical hash: {DeterminismArtifact.Hash(outcome)}\n");

            return ExitSuccess;
        }
        catch (InvalidDataException exception)
        {
            Console.Error.WriteLine(exception.Message);
            return ExitDataError;
        }
    }

    private static void Write(string path, string content)
    {
        var fullPath = Path.GetFullPath(path);
        var directory = Path.GetDirectoryName(fullPath);
        if (!string.IsNullOrEmpty(directory))
        {
            Directory.CreateDirectory(directory);
        }

        // No BOM, explicitly: two runs are compared byte for byte, and a
        // byte-order mark is three bytes of difference that say nothing about
        // the simulation.
        File.WriteAllText(fullPath, content, Utf8NoBom);
    }
}
