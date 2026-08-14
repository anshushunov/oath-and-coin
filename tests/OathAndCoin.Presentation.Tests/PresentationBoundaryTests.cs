using System.Collections.Immutable;
using System.Reflection.Metadata;
using System.Reflection.PortableExecutable;

namespace OathAndCoin.Presentation.Tests;

/// <summary>
/// The narrow analogue of
/// tests\OathAndCoin.Simulation.Tests\CoreBoundaryTests.cs (see that file's
/// doc comment for the full rationale and the known limits, which apply here
/// unchanged): OathAndCoin.Presentation references OathAndCoin.Content only
/// for <see cref="OathAndCoin.Content.Scenarios.ScenarioOutcome"/>'s shape,
/// and nothing in the compiled assembly may reference the file system or
/// Godot. This is what makes the read model buildable by a tool process that
/// never launches the engine and never touches disk — a "clean" build could
/// otherwise start reading files on its own without anything else here
/// noticing.
/// </summary>
/// <remarks>
/// Deliberately much smaller than CoreBoundaryTests: this project has one
/// known project reference (guaranteed by the test project's own
/// ProjectReference to sit next to this test assembly's own build output, so
/// no filesystem discovery is needed), one fixed banned-type list, one
/// "Godot" needle — no float ban (this is a UI read model, not the
/// deterministic core), no build-output/.deps.json scan, no IL opcode walk.
/// This is a floor, not a proof, for the same reasons CoreBoundaryTests'
/// doc comment lists: reflection by name, `dynamic`, and P/Invoke leave no
/// TypeReference/AssemblyReference for this check to find.
/// </remarks>
public class PresentationBoundaryTests
{
    private const string EngineNeedle = "Godot";

    private static readonly (string Namespace, string Name)[] BannedTypes =
    {
        ("System.IO", "File"),
        ("System.IO", "Directory"),
        ("System.IO", "FileStream"),
        ("System.IO", "StreamReader"),
        ("System.IO", "StreamWriter"),
    };

    [Fact]
    public void CompiledAssembly_ReferencesNoFilesystemOrEngineType()
    {
        var assemblyPath = GetPresentationAssemblyPath();
        Assert.True(
            File.Exists(assemblyPath),
            $"Expected compiled assembly '{assemblyPath}' was not found — build the solution first.");

        using var peReader = new PEReader(ImmutableArray.Create(File.ReadAllBytes(assemblyPath)));
        var reader = peReader.GetMetadataReader();

        // Positive control: prove this is really OathAndCoin.Presentation.dll
        // and not an empty or stale file — the same false-green
        // CoreBoundaryTests documents for its own "unused reference"
        // incident (see that file's remarks, fix round 3).
        Assert.True(reader.IsAssembly, $"'{assemblyPath}' has no AssemblyDefinition.");
        Assert.Equal("OathAndCoin.Presentation", reader.GetString(reader.GetAssemblyDefinition().Name));
        Assert.True(
            reader.TypeDefinitions.Count > 1,
            "OathAndCoin.Presentation.dll has no type definitions beyond <Module> — "
            + "is this actually compiled from real source?");

        foreach (var handle in reader.TypeReferences)
        {
            var typeReference = reader.GetTypeReference(handle);
            var ns = reader.GetString(typeReference.Namespace);
            var name = reader.GetString(typeReference.Name);

            Assert.False(
                ns.Contains(EngineNeedle, StringComparison.OrdinalIgnoreCase)
                || name.Contains(EngineNeedle, StringComparison.OrdinalIgnoreCase),
                $"TypeReference '{ns}.{name}' contains '{EngineNeedle}'.");

            foreach (var banned in BannedTypes)
            {
                Assert.False(
                    ns == banned.Namespace && name == banned.Name,
                    $"TypeReference '{ns}.{name}' is a banned filesystem type — "
                    + "the read model must stay buildable without touching disk.");
            }
        }

        foreach (var handle in reader.AssemblyReferences)
        {
            var assemblyReference = reader.GetAssemblyReference(handle);
            var name = reader.GetString(assemblyReference.Name);
            Assert.False(
                name.Contains(EngineNeedle, StringComparison.OrdinalIgnoreCase),
                $"AssemblyReference '{name}' contains '{EngineNeedle}'.");
        }
    }

    // A relative filesystem walk to the source tree, unlike CoreBoundaryTests,
    // would be overkill for one known assembly: this test project's own
    // ProjectReference to OathAndCoin.Presentation.csproj already guarantees
    // the build copies OathAndCoin.Presentation.dll next to this test
    // assembly's own output.
    private static string GetPresentationAssemblyPath()
    {
        var testAssemblyLocation = typeof(PresentationBoundaryTests).Assembly.Location;
        var directory = Path.GetDirectoryName(testAssemblyLocation)!;
        return Path.Combine(directory, "OathAndCoin.Presentation.dll");
    }
}
