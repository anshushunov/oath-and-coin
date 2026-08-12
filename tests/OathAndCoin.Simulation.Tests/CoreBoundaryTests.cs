using System.Reflection;
using OathAndCoin.Simulation;

namespace OathAndCoin.Simulation.Tests;

/// <summary>
/// Mechanizes ADR-002 (core boundary): the simulation assembly must be usable
/// headless, without Godot, and without non-deterministic system APIs.
/// Three independent checks exist because any single one can pass while the
/// boundary is actually broken (see spec §5):
///   1. Project files can declare an engine reference that source never uses.
///   2. Source files can call a banned API through an assembly that itself
///      declares no engine reference.
///   3. A declared-but-unused reference may not even surface in
///      Assembly.GetReferencedAssemblies() metadata.
/// </summary>
public class CoreBoundaryTests
{
    // "Godot" is included alongside the banned API substrings because the
    // brief defines this check as scanning for substrings from the *global
    // constraints list* as a whole (spec: "список глобальных ограничений"),
    // which is the union of the no-engine-reference constraint and the
    // banned-API constraint — not the banned-API list in isolation. This
    // also gives the boundary a source-level detector for engine usage that
    // does not depend on how the reference was declared or whether it
    // surfaces in assembly metadata.
    private static readonly string[] BannedApiSubstrings =
    {
        "Godot",
        "System.Random",
        "DateTime.Now",
        "DateTime.UtcNow",
        "DateTimeOffset.Now",
        "Guid.NewGuid",
        "Environment.TickCount",
        "System.IO",
        "CultureInfo.CurrentCulture",
        "float",
        "double",
    };

    // Build output (bin/obj) is excluded: it contains SDK-generated files
    // (e.g. ImplicitUsings' GlobalUsings.g.cs, which itself emits
    // "global using global::System.IO;") that are not project source and
    // would make this check fail on every clean build regardless of intent.
    private static readonly string[] ExcludedDirectorySegments = { "bin", "obj" };

    [Fact]
    public void SimulationProjects_DeclareNoEngineReference()
    {
        var root = GetSimulationSourceRoot();
        var csprojFiles = EnumerateSourceFiles(root, "*.csproj");

        Assert.NotEmpty(csprojFiles);

        foreach (var csproj in csprojFiles)
        {
            var content = File.ReadAllText(csproj);
            Assert.False(
                content.Contains("Godot", StringComparison.OrdinalIgnoreCase),
                $"{csproj} declares a reference containing 'Godot'.");
        }
    }

    [Fact]
    public void SimulationSources_UseNoBannedApi()
    {
        var root = GetSimulationSourceRoot();
        var csFiles = EnumerateSourceFiles(root, "*.cs");

        Assert.NotEmpty(csFiles);

        foreach (var file in csFiles)
        {
            var lines = File.ReadAllLines(file);
            for (var lineNumber = 0; lineNumber < lines.Length; lineNumber++)
            {
                var line = lines[lineNumber];
                if (line.TrimStart().StartsWith("//", StringComparison.Ordinal))
                {
                    continue;
                }

                foreach (var banned in BannedApiSubstrings)
                {
                    Assert.False(
                        line.Contains(banned, StringComparison.Ordinal),
                        $"{file}:{lineNumber + 1} uses banned API '{banned}'.");
                }
            }
        }
    }

    [Fact]
    public void SimulationAssembly_ReferencesNoEngineAssembly()
    {
        var assembly = typeof(AssemblyMarker).Assembly;
        var referencedAssemblies = assembly.GetReferencedAssemblies();

        Assert.False(
            referencedAssemblies.Any(name =>
                name.Name is not null && name.Name.Contains("Godot", StringComparison.OrdinalIgnoreCase)),
            "OathAndCoin.Simulation references an assembly containing 'Godot'.");
    }

    private static string GetSimulationSourceRoot()
    {
        var assembly = typeof(CoreBoundaryTests).Assembly;
        var metadata = assembly.GetCustomAttributes<AssemblyMetadataAttribute>()
            .FirstOrDefault(attribute => attribute.Key == "SimulationSourceRoot");

        if (metadata is null || string.IsNullOrEmpty(metadata.Value))
        {
            throw new InvalidOperationException(
                "AssemblyMetadataAttribute 'SimulationSourceRoot' was not found on the test assembly.");
        }

        return Path.GetFullPath(metadata.Value);
    }

    private static List<string> EnumerateSourceFiles(string root, string searchPattern)
    {
        return Directory.GetFiles(root, searchPattern, SearchOption.AllDirectories)
            .Where(path => !path.Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
                .Any(segment => ExcludedDirectorySegments.Contains(segment)))
            .ToList();
    }
}
