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
/// (spec §10). Assembly metadata is resolved by MSBuild at build time, so it
/// is right by construction in every checkout layout.
/// </remarks>
internal static class RepositoryFixtures
{
    public static string ContentRoot => Resolve("ContentRoot");

    public static string SchemaRoot => Resolve("SchemaRoot");

    /// <summary>Directory holding scenario command files and their manifests.</summary>
    public static string ScenarioRoot => Resolve("ScenarioRoot");

    /// <summary>The Gate 0 scenario the spike is reproduced from.</summary>
    public static string ScenarioPath => Path.Combine(ScenarioRoot, "gate0.commands.json");

    /// <summary>Path to the named locale's catalogue under <c>content/locale/</c>.</summary>
    public static string LocaleFile(string locale) => Path.Combine(ContentRoot, "locale", $"{locale}.json");

    /// <summary>
    /// Loads the repository's content and the named scenario's commands, then
    /// runs them with <paramref name="seed"/> through
    /// <see cref="ScenarioRunner.Run"/> — the two steps every scenario-backed
    /// test needs, in the order <see cref="ScenarioRunner.Run"/> actually
    /// requires them (a <see cref="ContentSet"/> and a command list, never a
    /// path or a scenario name). Reloads both from disk on every call rather
    /// than caching them: this helper is for one-shot tests, and a test that
    /// needs the same content across many runs (a seed search, say) should
    /// cache it itself, the way <c>ReplayDeterminismTests</c> already does.
    /// </summary>
    public static ScenarioOutcome RunScenario(string name, ulong seed)
    {
        var content = ContentSet.Load(ContentRoot);
        var commands = ScenarioCommands.Load(Path.Combine(ScenarioRoot, $"{name}.commands.json"));
        return ScenarioRunner.Run(content, commands, seed);
    }

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
