using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace OathAndCoin.Harness;

/// <summary>
/// Where one run's artifacts go, and the rule that nothing ever overwrites
/// them:
/// <code>
/// artifacts/smoke/&lt;scenario&gt;/&lt;checkpoint&gt;/
///   runs/&lt;run-id&gt;/{frame.png, run.log, report.json}
///   latest-attempt.json     replaced atomically on every run
///   latest-success.json     replaced only on a passed verdict
/// </code>
/// </summary>
/// <remarks>
/// <para>
/// The first version of this tool wrote into a temporary directory and moved
/// it onto one stable path per scenario. That broke on the second run (the
/// destination already existed) and, worse, lost the failed run it had just
/// recorded. Here the destination is unique per run and is never a
/// destination twice — a failed run's evidence outlives every run that
/// follows it.
/// </para>
/// <para>
/// A run still writes through a staging directory, but only to make the
/// published one appear whole: <c>frame.png</c> is written by the game
/// process partway through, and a reader that finds <c>runs/&lt;id&gt;/</c>
/// should find a finished run, not one in progress. The staging directory is
/// an implementation detail of publishing — every path the report states is
/// where the file finally lives, not where it was written.
/// </para>
/// </remarks>
/// <param name="checkpointDirectory">Where the two <c>latest-*</c> pointers live.</param>
/// <param name="stagingDirectory">Where a run in progress writes.</param>
/// <param name="runDirectory">Where it ends up.</param>
/// <param name="runId">The id it was filed under.</param>
public sealed class RunLayout(
    string checkpointDirectory, string stagingDirectory, string runDirectory, string runId)
{
    public const string FrameFileName = "frame.png";

    public const string RunLogFileName = "run.log";

    public const string ReportFileName = "report.json";

    private const string LatestAttemptFileName = "latest-attempt.json";

    private const string LatestSuccessFileName = "latest-success.json";

    /// <summary>
    /// Suffix marking a run that has not been published yet. Ends in a
    /// character no run id contains, so a half-written run can never be
    /// mistaken for a finished one by anything listing <c>runs/</c>.
    /// </summary>
    private const string StagingSuffix = ".pending";

    /// <summary>
    /// Unit Separator, joining the arguments a run id is hashed from — the
    /// separator <see cref="OathAndCoin.Presentation.RenderedUiSnapshot"/>
    /// uses for the same reason: without it <c>["ab", "c"]</c> and
    /// <c>["a", "bc"]</c> would hash alike. Written as a numeric constant
    /// because no editor shows the raw control character.
    /// </summary>
    private const char ArgumentSeparator = (char)0x1F;

    /// <summary>The id this run was actually filed under — see <see cref="Begin"/> on collisions.</summary>
    public string RunId { get; } = runId;

    /// <summary>Where this run's artifacts end up, and where the report points readers.</summary>
    public string RunDirectory { get; } = runDirectory;

    /// <summary>Where they are written until <see cref="Publish"/> moves them.</summary>
    public string StagingDirectory { get; } = stagingDirectory;

    /// <summary>
    /// Opens a staging directory for a new run under
    /// <paramref name="outputRoot"/>.
    /// </summary>
    /// <remarks>
    /// A run id already taken is not reused and does not overwrite: the id
    /// gets a numeric suffix instead. Two runs inside the clock's own
    /// resolution are rare but not impossible, and "rare" is not a property
    /// an immutability rule can rest on.
    /// </remarks>
    public static RunLayout Begin(string outputRoot, string scenario, string checkpoint, string runId)
    {
        ArgumentException.ThrowIfNullOrEmpty(outputRoot);
        ArgumentException.ThrowIfNullOrEmpty(scenario);
        ArgumentException.ThrowIfNullOrEmpty(checkpoint);
        ArgumentException.ThrowIfNullOrEmpty(runId);

        var checkpointDirectory = Path.Combine(Path.GetFullPath(outputRoot), scenario, checkpoint);
        var runsDirectory = Path.Combine(checkpointDirectory, "runs");

        var uniqueId = runId;
        for (var attempt = 2; IsTaken(runsDirectory, uniqueId); attempt++)
        {
            uniqueId = string.Create(CultureInfo.InvariantCulture, $"{runId}-{attempt}");
        }

        var staging = Path.Combine(runsDirectory, uniqueId + StagingSuffix);
        Directory.CreateDirectory(staging);

        return new RunLayout(checkpointDirectory, staging, Path.Combine(runsDirectory, uniqueId), uniqueId);
    }

    /// <summary>
    /// A UTC timestamp plus a short hash of the run's own arguments: two runs
    /// back to back do not collide, and two runs of different arguments are
    /// told apart by name alone in a directory listing.
    /// </summary>
    public static string CreateRunId(DateTimeOffset utcNow, IReadOnlyList<string> arguments)
    {
        ArgumentNullException.ThrowIfNull(arguments);

        var stamp = utcNow.UtcDateTime.ToString("yyyyMMdd'T'HHmmss'Z'", CultureInfo.InvariantCulture);
        var joined = Encoding.UTF8.GetBytes(string.Join(ArgumentSeparator, arguments));
        var hash = Convert.ToHexString(SHA256.HashData(joined)).ToLowerInvariant()[..8];

        return $"{stamp}-{hash}";
    }

    /// <summary>Where <paramref name="fileName"/> is written while the run is still going.</summary>
    public string Staged(string fileName) => Path.Combine(StagingDirectory, fileName);

    /// <summary>Where <paramref name="fileName"/> lives once the run is published.</summary>
    public string Published(string fileName) => Path.Combine(RunDirectory, fileName);

    /// <summary>
    /// Writes the report into the staging directory, publishes the whole
    /// directory under one rename, and moves the <c>latest-*</c> pointers:
    /// <c>latest-attempt.json</c> always, <c>latest-success.json</c> only when
    /// <paramref name="passed"/>. Both are replaced through a temporary file
    /// so a reader never observes a half-written pointer.
    /// </summary>
    public void Publish(string reportJson, bool passed)
    {
        ArgumentNullException.ThrowIfNull(reportJson);

        File.WriteAllText(Staged(ReportFileName), reportJson);
        Directory.Move(StagingDirectory, RunDirectory);

        Replace(Path.Combine(checkpointDirectory, LatestAttemptFileName), reportJson);

        if (passed)
        {
            Replace(Path.Combine(checkpointDirectory, LatestSuccessFileName), reportJson);
        }
    }

    private static bool IsTaken(string runsDirectory, string runId) =>
        Directory.Exists(Path.Combine(runsDirectory, runId))
        || Directory.Exists(Path.Combine(runsDirectory, runId + StagingSuffix));

    private static void Replace(string path, string contents)
    {
        var temporary = path + ".tmp";
        File.WriteAllText(temporary, contents);
        File.Move(temporary, path, overwrite: true);
    }
}
