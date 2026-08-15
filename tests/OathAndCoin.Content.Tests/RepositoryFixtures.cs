using System.Reflection;
using OathAndCoin.Content;
using OathAndCoin.Content.Scenarios;

namespace OathAndCoin.Content.Tests;

/// <summary>
/// Locates the repository's production content and schema directories from
/// assembly metadata written by this project's <c>.csproj</c>.
/// </summary>
/// <remarks>
/// Deliberately not "walk up until a <c>.git</c> directory appears": in a git
/// worktree <c>.git</c> is a file, not a directory, so that heuristic breaks
/// precisely in the isolated workspaces this project's process recommends
/// (AGENTS.md §9). Assembly metadata is resolved by MSBuild at build time, so it
/// is right by construction in every checkout layout.
/// </remarks>
internal static class RepositoryFixtures
{
    public static string ContentRoot => Resolve("ContentRoot");

    public static string SchemaRoot => Resolve("SchemaRoot");

    /// <summary>Directory holding scenario command files and their manifests.</summary>
    public static string ScenarioRoot => Resolve("ScenarioRoot");

    /// <summary>
    /// Directory holding contrast files (Task 14). A subdirectory of
    /// <see cref="ScenarioRoot"/> rather than its own assembly metadata key:
    /// a contrast is, like a scenario, input data authored alongside the
    /// scenarios it sits next to, and it needs no root of its own that
    /// <see cref="ScenarioRoot"/> does not already name.
    /// </summary>
    public static string ContrastRoot => Path.Combine(ScenarioRoot, "contrasts");

    /// <summary>The Gate 0 scenario the spike is reproduced from.</summary>
    public static string ScenarioPath => Path.Combine(ScenarioRoot, "gate0.commands.json");

    /// <summary>
    /// The repository root, derived from <see cref="ScenarioRoot"/>'s parent —
    /// the same derivation <c>Main.ResolveLocaleFile</c> uses, and for the
    /// same reason: <see cref="ScenarioManifest.ContentRoot"/> is documented
    /// as "repository-relative", and nothing here is ever faulted or
    /// substituted, unlike <see cref="ContentRoot"/> itself.
    /// </summary>
    private static string RepositoryRoot =>
        Path.GetDirectoryName(ScenarioRoot)
        ?? throw new InvalidOperationException(
            $"Could not determine the repository root from scenario root '{ScenarioRoot}'.");

    /// <summary>Path to the named locale's catalogue under <c>content/locale/</c>.</summary>
    public static string LocaleFile(string locale) => Path.Combine(ContentRoot, "locale", $"{locale}.json");

    /// <summary>
    /// Loads the named scenario's manifest and commands, then runs them with
    /// <paramref name="seed"/> through <see cref="ScenarioRunner.Run"/>.
    /// </summary>
    /// <remarks>
    /// Content is read from <see cref="ScenarioManifest.ContentRoot"/> when the
    /// manifest declares one — resolved against <see cref="RepositoryRoot"/>,
    /// the same convention <c>SmokeRun.Expectation.Build</c> and
    /// <c>Main.LoadModel</c> already use for that field — and from the
    /// production <see cref="ContentRoot"/> otherwise. Every fixture-backed
    /// decision scenario (Task 13) needs its own roster and contracts to
    /// demonstrate a rule production content cannot reach (e.g. a hero with
    /// two violated principles at once), and until now nothing ever exercised
    /// this field for a scenario that also has commands to run — every prior
    /// <c>content_root</c> manifest (<c>screen_empty</c>) has none. Reloads
    /// content and commands from disk on every call rather than caching them:
    /// this helper is for one-shot tests, and a test that needs the same
    /// content across many runs (a seed search, say) should cache it itself,
    /// the way <c>ReplayDeterminismTests</c> already does.
    /// </remarks>
    public static ScenarioOutcome RunScenario(string name, ulong seed)
    {
        var manifest = ScenarioManifest.Load(Path.Combine(ScenarioRoot, $"{name}.manifest.json"));
        var contentRoot = manifest.ContentRoot is { } overrideRoot
            ? Path.GetFullPath(Path.Combine(RepositoryRoot, overrideRoot))
            : ContentRoot;

        var content = ContentSet.Load(contentRoot);
        var commands = ScenarioCommands.Load(Path.Combine(ScenarioRoot, $"{name}.commands.json"));
        return ScenarioRunner.Run(content, commands, seed);
    }

    /// <summary>
    /// Every scenario manifest under <see cref="ScenarioRoot"/> that
    /// <see cref="RunScenario"/> can actually run: a manifest with a sibling
    /// <c>&lt;scenario&gt;.commands.json</c> file. This excludes the harness-only
    /// fixtures that describe a broken or not-yet-loaded game
    /// (<c>screen_error</c>, <c>screen_empty</c>, <c>screen_loading</c>) — none of them has anything to replay, by
    /// design (<see cref="ScenarioOutcomeKind.Loading"/>'s own remarks; a
    /// <c>fault</c> scenario breaks content loading itself, before any
    /// command could apply) — rather than by name, so a future manifest is
    /// included or excluded by the same rule every one of today's is, not by
    /// a list someone has to remember to extend.
    /// </summary>
    public static IReadOnlyList<ScenarioManifest> ScenarioManifests() =>
        Directory.GetFiles(ScenarioRoot, "*.manifest.json")
            .OrderBy(path => path, StringComparer.Ordinal)
            .Select(ScenarioManifest.Load)
            .Where(manifest => File.Exists(Path.Combine(ScenarioRoot, $"{manifest.Scenario}.commands.json")))
            .ToList();

    /// <summary>
    /// The canonical determinism artifact a scenario's replay is compared
    /// against, byte for byte. Lives beside the scenario's own manifest and
    /// commands under <see cref="ScenarioRoot"/> — input data a scenario is
    /// authored with, checked into the repository — rather than under
    /// <c>artifacts/</c>: that directory is <c>.gitignore</c>d on purpose
    /// (a run's own evidence is a CI artifact, not a source file), so a
    /// golden file placed there would never survive a clone and every
    /// developer's first run would silently "regenerate" a fixture that was
    /// never actually checked in.
    /// </summary>
    public static string CanonicalArtifact(string name) => Path.Combine(ScenarioRoot, $"{name}.canonical.json");

    /// <summary>Path to the named contrast file under <see cref="ContrastRoot"/>.</summary>
    public static string Contrast(string name) => Path.Combine(ContrastRoot, $"{name}.json");

    /// <summary>Every contrast file shipped under <see cref="ContrastRoot"/>.</summary>
    public static IReadOnlyList<string> ContrastFiles() =>
        Directory.GetFiles(ContrastRoot, "*.json")
            .OrderBy(path => path, StringComparer.Ordinal)
            .ToList();

    private static string Resolve(string key)
    {
        var metadata = typeof(RepositoryFixtures).Assembly
            .GetCustomAttributes<AssemblyMetadataAttribute>()
            .FirstOrDefault(attribute => attribute.Key == key);

        if (metadata is null || string.IsNullOrEmpty(metadata.Value))
        {
            throw new InvalidOperationException(
                $"AssemblyMetadataAttribute '{key}' was not found on the test assembly.");
        }

        return Path.GetFullPath(metadata.Value);
    }
}
