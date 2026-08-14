using System.Diagnostics;
using System.Globalization;
using System.Text.Json.Nodes;

namespace OathAndCoin.Harness.FakeGame;

/// <summary>
/// Stands in for the real Godot game across <c>ProcessRunnerTests</c>: a
/// real console app, built and launched as its own process, not a fake
/// object in the test's own process. <see cref="ProcessRunner"/> has to
/// prove it can capture output and kill a process tree, and neither of
/// those is something an in-process double can exercise honestly.
/// </summary>
/// <remarks>
/// The test project takes this project's built executable path (via
/// <c>AssemblyMetadataAttribute</c>), not a compiled reference to it — see
/// <c>OathAndCoin.Harness.Tests.csproj</c>'s <c>ReferenceOutputAssembly="false"</c>.
/// That means none of the constants below can be shared with
/// <c>ProcessRunnerTests</c> through code; where a test needs to know one of
/// these exact values, it is duplicated there with a comment pointing back
/// here.
/// </remarks>
public static class Program
{
    /// <summary>Lines <c>both-streams</c> writes to each of stdout and stderr — enough to fill an OS pipe buffer many times over.</summary>
    public const int BothStreamsLineCount = 5000;

    /// <summary>What <c>hang</c> and <c>child</c> print to stdout right before they block forever.</summary>
    public const string HangStdoutLine = "about-to-hang";

    /// <summary>What <c>hang</c> and <c>child</c> print to stderr right before they block forever.</summary>
    public const string HangStderrLine = "stderr-before-hang";

    /// <summary>Prefix <c>child</c> puts in front of its descendant's PID on stdout.</summary>
    public const string ChildPidPrefix = "child-pid=";

    private const int UnknownModeExitCode = 2;

    public static int Main(string[] args)
    {
        if (args.Length != 1)
        {
            Console.Error.WriteLine("usage: OathAndCoin.Harness.FakeGame <mode>");
            return UnknownModeExitCode;
        }

        // An unknown mode throws rather than falling through to a silent
        // zero exit: a typo'd mode that quietly "succeeds" would make every
        // test that asked for it pass for the wrong reason.
        return args[0] switch
        {
            "clean" => RunClean(),
            "both-streams" => RunBothStreams(),
            "nonzero" => RunNonzero(),
            "crash-after-event" => RunCrashAfterEvent(),
            "duplicate-event" => RunDuplicateEvent(),
            "hang" => RunHang(),
            "child" => RunChild(),
            "half-closed" => RunHalfClosed(),
            _ => throw new ArgumentException($"Unknown fake-game mode '{args[0]}'."),
        };
    }

    private static int RunClean()
    {
        Console.WriteLine(BuildTerminalEventLine());
        return 0;
    }

    private static int RunBothStreams()
    {
        for (var index = 0; index < BothStreamsLineCount; index++)
        {
            Console.Out.WriteLine(string.Create(CultureInfo.InvariantCulture, $"stdout-{index}"));
            Console.Error.WriteLine(string.Create(CultureInfo.InvariantCulture, $"stderr-{index}"));
        }

        return 0;
    }

    private static int RunNonzero()
    {
        Console.WriteLine("about to exit with a nonzero code");
        return 1;
    }

    private static int RunCrashAfterEvent()
    {
        // A run that reports success and then dies logging on its way out —
        // the case SmokeVerdict's diagnostic-line scan exists for, not just
        // its terminal-event check.
        Console.WriteLine(BuildTerminalEventLine());
        Console.Error.WriteLine("SCRIPT ERROR: simulated crash right after reporting the terminal event");
        return 1;
    }

    private static int RunDuplicateEvent()
    {
        Console.WriteLine(BuildTerminalEventLine());
        Console.WriteLine(BuildTerminalEventLine());
        return 0;
    }

    private static int RunHang()
    {
        Console.WriteLine(HangStdoutLine);
        Console.Error.WriteLine(HangStderrLine);
        Console.Out.Flush();
        Console.Error.Flush();

        Thread.Sleep(Timeout.Infinite);
        return 0; // Unreachable: this mode only ever ends by being killed.
    }

    private static int RunChild()
    {
        var executable = Environment.ProcessPath
            ?? throw new InvalidOperationException("Could not determine this process's own executable path.");

        var startInfo = new ProcessStartInfo(executable) { UseShellExecute = false };
        startInfo.ArgumentList.Add("hang");

        using var child = Process.Start(startInfo)
            ?? throw new InvalidOperationException("Failed to start the descendant process.");

        Console.WriteLine(ChildPidPrefix + child.Id.ToString(CultureInfo.InvariantCulture));
        Console.Out.Flush();

        // Hangs itself too: if this process exited on its own, the harness
        // would never hit its timeout and never call Kill(entireProcessTree:
        // true) — and the descendant above would leak for the lifetime of
        // the test run instead of proving anything about tree-kill.
        Thread.Sleep(Timeout.Infinite);
        return 0; // Unreachable: this mode only ever ends by being killed.
    }

    private static int RunHalfClosed()
    {
        // Closes stdout while stderr keeps flowing, so the harness has to
        // cope with one stream reaching EOF well before the other rather
        // than assuming both end together.
        Console.WriteLine("before-close");
        Console.Out.Flush();
        Console.Out.Close();

        for (var index = 0; index < 3; index++)
        {
            Console.Error.WriteLine(string.Create(CultureInfo.InvariantCulture, $"after-close-{index}"));
        }

        return 0;
    }

    // Field values are arbitrary fixture data — this mode's job is only to
    // produce a line TerminalEvent.Parse accepts, not to model a specific
    // scenario run.
    private static string BuildTerminalEventLine()
    {
        var json = new JsonObject
        {
            ["schema_version"] = 1,
            ["event"] = "terminal",
            ["outcome_kind"] = "success",
            ["scenario"] = "fake-game",
            ["seed"] = 424242,
            ["checkpoint"] = "fake-checkpoint",
            ["error_code"] = null,
            ["content_version"] = "fake-content-version",
            ["canonical_hash"] = "fake-canonical-hash",
            ["read_model_hash"] = "fake-read-model-hash",
            ["rendered_ui_hash"] = "fake-rendered-ui-hash",
            ["frame_sha256"] = "fake-frame-sha256",
            ["frame_width"] = 1280,
            ["frame_height"] = 720,
            ["frame_distinct_colors"] = 4,
        };

        return json.ToJsonString();
    }
}
