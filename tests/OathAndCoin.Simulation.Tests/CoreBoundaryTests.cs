using System.Reflection;
using System.Xml.Linq;
using OathAndCoin.Simulation;

namespace OathAndCoin.Simulation.Tests;

/// <summary>
/// Mechanizes ADR-002 (core boundary): the simulation assembly must be usable
/// headless, without Godot, and without non-deterministic system APIs.
/// Three independent checks exist because any single one can pass while the
/// boundary is actually broken (see spec §5):
///   1. Project files (and files that MSBuild implicitly imports into them,
///      e.g. the repository-root Directory.Build.props) can declare an
///      engine reference that source never uses.
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

    private const string EngineReferenceNeedle = "Godot";

    [Fact]
    public void SimulationProjects_DeclareNoEngineReference()
    {
        var root = GetSimulationSourceRoot();
        var repositoryRoot = GetRepositoryRoot(root);
        var projectDirectories = GetProjectDirectories(root);

        var csprojFiles = Directory.GetFiles(root, "*.csproj", SearchOption.AllDirectories).ToList();
        Assert.NotEmpty(csprojFiles);

        // .props/.targets matter too: MSBuild auto-imports Directory.Build.props
        // and Directory.Build.targets into every project below them, and any
        // other *.props/*.targets present can be imported the same way. A scan
        // limited to *.csproj is blind to a reference smuggled in through one
        // of those files (Critical finding C1).
        var msbuildFiles = csprojFiles
            .Concat(EnumerateProjectFiles(root, "*.props", projectDirectories))
            .Concat(EnumerateProjectFiles(root, "*.targets", projectDirectories))
            .Concat(EnumerateRepositoryLevelImports(repositoryRoot))
            .ToList();

        foreach (var file in msbuildFiles)
        {
            Assert.False(
                DeclaresEngineReference(file),
                $"{file} declares a reference/import containing 'Godot'.");
        }
    }

    [Fact]
    public void SimulationSources_UseNoBannedApi()
    {
        var root = GetSimulationSourceRoot();
        var projectDirectories = GetProjectDirectories(root);
        var csFiles = EnumerateProjectFiles(root, "*.cs", projectDirectories);

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
                name.Name is not null && name.Name.Contains(EngineReferenceNeedle, StringComparison.OrdinalIgnoreCase)),
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

    // ASSUMPTION: the repository root is exactly one level above the
    // simulation source root ("<repoRoot>/simulation"), matching the fixed
    // layout this task itself created (global.json, Directory.Build.props,
    // OathAndCoin.sln, simulation/, tests/ as siblings). This is a plain path
    // computation from the already-known, non-searched SimulationSourceRoot —
    // it does not walk up looking for `.git`, so it stays valid in a git
    // worktree where `.git` is a file rather than a directory (spec §10).
    private static string GetRepositoryRoot(string simulationSourceRoot)
    {
        var parent = Directory.GetParent(simulationSourceRoot);
        if (parent is null)
        {
            throw new InvalidOperationException(
                $"Could not determine repository root from simulation source root '{simulationSourceRoot}'.");
        }

        return parent.FullName;
    }

    // MSBuild auto-imports the nearest Directory.Build.props (and,
    // independently, the nearest Directory.Build.targets) found by walking up
    // from each project's own directory. Nothing sits between the repository
    // root and simulation/<project>/ in this repo's layout, so the repo
    // root's own copies are exactly the ones silently applied to every
    // project under simulation/ — including the one this task created.
    private static IEnumerable<string> EnumerateRepositoryLevelImports(string repositoryRoot)
    {
        foreach (var fileName in new[] { "Directory.Build.props", "Directory.Build.targets" })
        {
            var path = Path.Combine(repositoryRoot, fileName);
            if (File.Exists(path))
            {
                yield return path;
            }
        }
    }

    private static List<string> GetProjectDirectories(string root)
    {
        return Directory.GetFiles(root, "*.csproj", SearchOption.AllDirectories)
            .Select(csproj => Path.GetDirectoryName(csproj)!)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    // Only a project's own top-level bin/ and obj/ are build output in
    // MSBuild's default globs (BaseOutputPath/BaseIntermediateOutputPath are
    // resolved relative to the project file, not matched recursively as
    // "**/bin/**"). A folder that merely happens to be *named* bin or obj
    // somewhere deeper in the tree is regular source and gets compiled like
    // anything else, so excluding it from the scan would create a real blind
    // spot (Critical finding C2) — only the project's own root is excluded.
    private static bool IsUnderProjectBuildOutput(string filePath, IReadOnlyCollection<string> projectDirectories)
    {
        foreach (var projectDirectory in projectDirectories)
        {
            var binRoot = Path.Combine(projectDirectory, "bin") + Path.DirectorySeparatorChar;
            var objRoot = Path.Combine(projectDirectory, "obj") + Path.DirectorySeparatorChar;
            if (filePath.StartsWith(binRoot, StringComparison.OrdinalIgnoreCase) ||
                filePath.StartsWith(objRoot, StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }

        return false;
    }

    private static List<string> EnumerateProjectFiles(
        string root, string searchPattern, IReadOnlyCollection<string> projectDirectories)
    {
        return Directory.GetFiles(root, searchPattern, SearchOption.AllDirectories)
            .Where(path => !IsUnderProjectBuildOutput(path, projectDirectories))
            .ToList();
    }

    // Parses the file as MSBuild XML and looks for "Godot" in every attribute
    // value and every leaf element's text — this covers PackageReference,
    // ProjectReference and Reference Include attributes, Reference/HintPath
    // text, an <Sdk Name="..."/> element or the root <Project Sdk="..."> Sdk
    // shorthand, Import/@Project and Import/@Sdk, and central-package-
    // management-style Update/Version attributes — without matching text
    // inside XML comments (I1: this is deliberately narrower than a raw
    // full-text scan of the file so a comment mentioning "Godot" cannot
    // trigger a false positive, while still catching every element shape the
    // mutants in this task's report exercise, including the plain <Reference>
    // form — which is not a PackageReference/ProjectReference and would be
    // missed by a check narrowed to only those two element names).
    private static bool DeclaresEngineReference(string xmlFilePath)
    {
        XDocument document;
        try
        {
            document = XDocument.Load(xmlFilePath);
        }
        catch (System.Xml.XmlException)
        {
            // Not well-formed MSBuild XML cannot declare a reference MSBuild
            // would actually honor; do not fail the guard on unrelated files.
            return false;
        }

        if (document.Root is null)
        {
            return false;
        }

        bool MatchesEngineNeedle(string value) =>
            value.Contains(EngineReferenceNeedle, StringComparison.OrdinalIgnoreCase);

        foreach (var element in document.Root.DescendantsAndSelf())
        {
            if (element.Attributes().Any(attribute => MatchesEngineNeedle(attribute.Value)))
            {
                return true;
            }

            if (!element.HasElements && MatchesEngineNeedle(element.Value))
            {
                return true;
            }
        }

        return false;
    }
}
