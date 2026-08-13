using System.Reflection;

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

    /// <summary>The Gate 0 scenario the spike is reproduced from.</summary>
    public static string ScenarioPath => Path.Combine(Resolve("ScenarioRoot"), "gate0.commands.json");

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
