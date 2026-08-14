namespace OathAndCoin.Harness;

/// <summary>
/// The working tree a run was taken from: where it is, which commit it was
/// on, and whether anything was uncommitted at that moment.
/// </summary>
/// <remarks>
/// This is what decides whether a run is evidence at all (see
/// <see cref="RunReport.Reproducible"/>): a dirty tree means the code that
/// ran is not the code the commit names, and nobody — including the person
/// who ran it — can get back to it later.
/// </remarks>
/// <param name="Root">The repository's top level, as git reports it.</param>
/// <param name="Commit">The commit <c>HEAD</c> pointed at.</param>
/// <param name="Dirty">Whether the tree had uncommitted changes.</param>
public sealed record RepositoryState(string Root, string Commit, bool Dirty)
{
    /// <summary>
    /// Generous, because a cold git process on Windows can take a moment;
    /// short enough that a hung one is not mistaken for a slow run.
    /// </summary>
    private static readonly TimeSpan GitTimeout = TimeSpan.FromSeconds(30);

    /// <summary>
    /// Asks git itself, from <paramref name="startDirectory"/>.
    /// </summary>
    /// <remarks>
    /// The repository root is discovered rather than assumed: this tool is
    /// launched through <c>dotnet run</c>, whose working directory is the
    /// shell's, not the repository's, and a root guessed from a relative path
    /// would silently point a run at the wrong content tree. Passing
    /// <c>AppContext.BaseDirectory</c> as the start makes the answer depend
    /// on where this binary lives, which is inside the checkout that built it.
    /// </remarks>
    /// <exception cref="InvalidOperationException">
    /// <paramref name="startDirectory"/> is not inside a git repository, or
    /// git is not installed, or it did not answer in time.
    /// </exception>
    public static RepositoryState Read(IProcessRunner runner, string startDirectory)
    {
        ArgumentNullException.ThrowIfNull(runner);
        ArgumentException.ThrowIfNullOrEmpty(startDirectory);

        var root = Git(runner, startDirectory, "rev-parse", "--show-toplevel").Single();
        var commit = Git(runner, startDirectory, "rev-parse", "HEAD").Single();

        // --porcelain lists staged, unstaged and untracked paths alike, and
        // says nothing when the tree is clean. Anything at all here means the
        // commit above does not describe what is about to run.
        var dirty = Git(runner, startDirectory, "status", "--porcelain").Count > 0;

        return new RepositoryState(Path.GetFullPath(root), commit, dirty);
    }

    private static List<string> Git(IProcessRunner runner, string directory, params string[] arguments)
    {
        // -C rather than a working directory on the process: IProcessRunner
        // deliberately has no working-directory knob (a child process that
        // needs one is a child launched with an ambiguous path), and git's
        // own flag says the same thing without adding one.
        var argv = new List<string> { "-C", directory };
        argv.AddRange(arguments);

        var outcome = runner.Run("git", argv, GitTimeout);

        if (outcome.TimedOut || outcome.ExitCode != 0)
        {
            throw new InvalidOperationException(
                $"'git {string.Join(' ', arguments)}' failed in '{directory}' with exit code "
                + $"{outcome.ExitCode}. A run has to state the commit it was taken from, so this is not "
                + "something to carry on without.");
        }

        return outcome.Lines
            .Where(line => line.Stream == ProcessStream.StandardOutput && line.Text.Length > 0)
            .Select(line => line.Text.Trim())
            .ToList();
    }
}
