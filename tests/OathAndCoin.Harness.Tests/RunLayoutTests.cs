namespace OathAndCoin.Harness.Tests;

/// <summary>
/// Run directories are immutable. The first version of this tool moved a
/// temporary directory onto one stable path, so the second run collided with
/// the first and a failed run was lost the moment anything ran after it.
/// These tests pin the three properties that replaced that: every run gets
/// its own directory, that directory appears whole rather than file by file,
/// and the two <c>latest-*</c> pointers move under different rules.
/// </summary>
public class RunLayoutTests : IDisposable
{
    private const string Scenario = "gate0";
    private const string Checkpoint = "decisions_complete";
    private const string RunId = "20260814T101530Z-0f1e2d3c";

    private readonly string _outputRoot = Path.Combine(
        Path.GetTempPath(),
        "oath-and-coin-tests",
        Guid.NewGuid().ToString("n"));

    [Fact]
    public void Layout_CreatesUniqueRunDirectory()
    {
        var first = RunLayout.Begin(_outputRoot, Scenario, Checkpoint, RunId);
        var second = RunLayout.Begin(_outputRoot, Scenario, Checkpoint, RunId);

        // Same run id on purpose: uniqueness has to survive two runs landing
        // inside the clock's own resolution, not merely two different
        // timestamps.
        Assert.NotEqual(first.RunDirectory, second.RunDirectory);
        Assert.NotEqual(first.StagingDirectory, second.StagingDirectory);
    }

    [Fact]
    public void Layout_PublishesRunDirectoryOnceAfterClose()
    {
        var layout = RunLayout.Begin(_outputRoot, Scenario, Checkpoint, RunId);
        File.WriteAllText(layout.Staged(RunLayout.FrameFileName), "frame");
        File.WriteAllText(layout.Staged(RunLayout.RunLogFileName), "log");

        // Halfway through the run two of the three files already exist, and
        // the published directory must still not: a reader that finds
        // runs/<id>/ finds a complete run, never one in progress.
        Assert.False(Directory.Exists(layout.RunDirectory));

        layout.Publish("{}", passed: true);

        Assert.True(File.Exists(layout.Published(RunLayout.FrameFileName)));
        Assert.True(File.Exists(layout.Published(RunLayout.RunLogFileName)));
        Assert.True(File.Exists(layout.Published(RunLayout.ReportFileName)));
        Assert.False(Directory.Exists(layout.StagingDirectory));
    }

    [Fact]
    public void Layout_UpdatesLatestAttemptOnFailure()
    {
        var passing = RunLayout.Begin(_outputRoot, Scenario, Checkpoint, RunId);
        passing.Publish("{\"run\":\"passing\"}", passed: true);

        var failing = RunLayout.Begin(_outputRoot, Scenario, Checkpoint, RunId);
        failing.Publish("{\"run\":\"failing\"}", passed: false);

        Assert.Equal("{\"run\":\"failing\"}", File.ReadAllText(LatestAttemptPath()));
        Assert.Equal("{\"run\":\"passing\"}", File.ReadAllText(LatestSuccessPath()));

        // Neither run's own directory is touched by the other: the evidence
        // of a failure survives every run that follows it.
        Assert.True(File.Exists(passing.Published(RunLayout.ReportFileName)));
        Assert.True(File.Exists(failing.Published(RunLayout.ReportFileName)));
    }

    [Fact]
    public void Layout_UpdatesLatestSuccessOnlyOnPass()
    {
        var failing = RunLayout.Begin(_outputRoot, Scenario, Checkpoint, RunId);
        failing.Publish("{\"run\":\"failing\"}", passed: false);

        Assert.True(File.Exists(LatestAttemptPath()));
        Assert.False(File.Exists(LatestSuccessPath()));

        var passing = RunLayout.Begin(_outputRoot, Scenario, Checkpoint, RunId);
        passing.Publish("{\"run\":\"passing\"}", passed: true);

        Assert.Equal("{\"run\":\"passing\"}", File.ReadAllText(LatestAttemptPath()));
        Assert.Equal("{\"run\":\"passing\"}", File.ReadAllText(LatestSuccessPath()));
    }

    [Fact]
    public void Layout_BuildsRunIdFromTimestampAndArgumentHash()
    {
        var moment = new DateTimeOffset(2026, 8, 14, 10, 15, 30, TimeSpan.Zero);

        var first = RunLayout.CreateRunId(moment, new[] { "--scenario", "gate0" });
        var second = RunLayout.CreateRunId(moment, new[] { "--scenario", "content_error" });

        Assert.StartsWith("20260814T101530Z-", first, StringComparison.Ordinal);
        Assert.NotEqual(first, second);
        Assert.Equal(first, RunLayout.CreateRunId(moment, new[] { "--scenario", "gate0" }));
    }

    public void Dispose()
    {
        GC.SuppressFinalize(this);

        try
        {
            if (Directory.Exists(_outputRoot))
            {
                Directory.Delete(_outputRoot, recursive: true);
            }
        }
        catch (IOException)
        {
            // A leaked temp directory is not worth failing a green test over.
        }
    }

    private string LatestAttemptPath() =>
        Path.Combine(_outputRoot, Scenario, Checkpoint, "latest-attempt.json");

    private string LatestSuccessPath() =>
        Path.Combine(_outputRoot, Scenario, Checkpoint, "latest-success.json");
}
