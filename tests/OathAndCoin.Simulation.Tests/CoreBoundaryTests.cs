using System.Collections.Immutable;
using System.Reflection;
using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Reflection.PortableExecutable;

namespace OathAndCoin.Simulation.Tests;

/// <summary>
/// Mechanizes ADR-002 (core boundary): the simulation assembly (and, as of
/// fix round 3, every assembly compiled from a project under simulation/)
/// must be usable headless, without Godot, and without non-deterministic or
/// non-integer system APIs.
///
/// Fix round 2 replaced three source/project-text scans with a single method
/// of proof: reading the *compiled* assembly through System.Reflection.Metadata
/// instead of the source that produced it. Fix round 3 found that claim was
/// overstated (a declared-but-unused engine reference showed up in the build
/// output/deps.json while every IL-level check stayed green — see
/// docs/.../task-1-report.md, "Fix round 2's false guarantee") and widened
/// scope in five ways:
///   1. A dedicated check now reads each project's build output directory
///      and .deps.json, not just IL — an unused reference is inert to IL but
///      not to what actually ships.
///   2. Every check now runs over every assembly compiled from a project
///      under simulation/, discovered by scanning for *.csproj files, not
///      just the one assembly reachable from a specific known type.
///   3. Each check has a positive control: it asserts the assembly it read
///      is actually named what the project is named, and that its type/
///      method tables aren't trivially empty — so silently reading the wrong
///      (or a stale/renamed) assembly fails loudly instead of passing green.
///   4. The float/double check now also decodes MemberReference signatures
///      (catches Math.Sqrt(double), double.Parse(string), a field reference
///      like Math.PI — calls/field-refs into another assembly), the
///      TypeSpecification a MemberReference's Parent points at (catches
///      `new List&lt;double&gt;()` — the type argument lives on the parent,
///      not the referenced .ctor's own signature), and — because
///      MetadataReader has no bulk accessor for the MethodSpecification or
///      TypeSpecification tables, and calli's StandaloneSignature has no
///      back-reference from anywhere else — a minimal IL operand-token walk
///      (IlTokenScanner) over every method body to find MethodSpecification
///      (catches a generic method instantiated with float/double, e.g.
///      Id&lt;double&gt;(x)), calli-kind StandaloneSignature, and any
///      TypeSpecification reached directly by an instruction (box, newarr,
///      castclass, sizeof, ldtoken, ...).
///   5. The banned-type list grew: System.Half (float16 — .NET's Half
///      arithmetic is implemented via float, so left alone it would be a
///      complete bypass of the float ban) and the System.Numerics
///      floating-point vector/matrix/quaternion/complex types, which are
///      structs from another assembly whose internal fields this check
///      cannot see into — they are banned by name instead.
///      System.Decimal is deliberately NOT banned: its representation and
///      arithmetic are fully specified and identical across platforms,
///      unlike float/double, so it is a legitimate deterministic
///      fixed/floating-decimal type — this is a decision, not an oversight.
///
/// Known limits — read before trusting a green run:
///   - This is static symbol analysis. It cannot see through reflection by
///     name (`Type.GetType("System.Random")` + `Activator.CreateInstance`),
///     `dynamic` dispatch, or P/Invoke — none of those leave the
///     TypeReference/MemberReference shape this check looks for.
///   - A float/double value that never appears in a *signature* is
///     invisible to the float check: `object o = Math.PI;` boxes a constant
///     that was folded at compile time and leaves no local, field, or
///     parameter of type float/double anywhere — there is no signature to
///     decode. (A non-const field or call that resolves to Math.PI is still
///     caught — see round 3's MemberReference check.)
///   - Implicit culture-dependence with no banned symbol at all — e.g.
///     `x.ToString("N2")` on an int — is invisible: there is no
///     "CultureInfo" symbol in that call for this check to find.
///   - IlTokenScanner (used by the float check) is a deliberately minimal IL
///     decoder: it knows the operand size of every documented ECMA-335
///     opcode well enough to skip what it doesn't care about, but if it ever
///     meets one it has no size for, it stops scanning *that method body*
///     rather than guess — a wrong guess would desynchronize the rest of the
///     walk. That stop is silent from the assertion's point of view: it
///     shows up as "no violation found in this method", not as a build
///     failure or a warning. It also does not decode `switch` targets'
///     *meaning*, only their length (so it can keep walking past them), and
///     it does not track which local/argument holds which value — it only
///     ever inspects instruction operands, never data flow.
///   - Most fundamentally: this guard proves properties of the compiled
///     *form* of the code (what types/members/primitives are referenced).
///     It does not and cannot prove the simulation's *execution* is
///     deterministic. A canonical-run comparison (same seed/commands/rules
///     version producing byte-identical output) is the actual determinism
///     gate and belongs to a later plan, not this task.
/// </summary>
public class CoreBoundaryTests
{
    private const string EngineNeedle = "Godot";

    // Whole types banned outright: any reference to the type at all is a
    // violation, regardless of which member is used.
    private static readonly (string Namespace, string Name)[] BannedTypes =
    {
        // Non-deterministic / wall-clock by construction.
        ("System", "Random"),
        ("System.Diagnostics", "Stopwatch"),

        // Filesystem types would break running the simulation headless and
        // deterministically. System.IO.MemoryStream, StringWriter,
        // BinaryWriter, etc. are deliberately NOT here — they are
        // deterministic in-memory types the save-system work will need.
        ("System.IO", "File"),
        ("System.IO", "Directory"),
        ("System.IO", "Path"),
        ("System.IO", "FileStream"),
        ("System.IO", "FileInfo"),
        ("System.IO", "DirectoryInfo"),
        ("System.IO", "StreamReader"),
        ("System.IO", "StreamWriter"),

        // Half is float16; .NET's Half arithmetic is implemented in terms of
        // float under the hood, so leaving it unbanned would be a complete,
        // trivially-discoverable bypass of the float/double ban.
        ("System", "Half"),

        // System.Numerics floating-point structs: their fields are inside
        // another assembly's metadata, which the signature-decoding float
        // check below cannot see into (it only decodes signatures emitted by
        // *this* assembly). Banning the type by name is the only way to
        // catch them. Non-floating-point System.Numerics types (BigInteger)
        // are deliberately not here.
        ("System.Numerics", "Vector2"),
        ("System.Numerics", "Vector3"),
        ("System.Numerics", "Vector4"),
        ("System.Numerics", "Matrix3x2"),
        ("System.Numerics", "Matrix4x4"),
        ("System.Numerics", "Quaternion"),
        ("System.Numerics", "Plane"),
        ("System.Numerics", "Complex"),

        // System.Decimal is a DECISION, not an omission: its bit layout and
        // arithmetic are fully specified and produce identical results
        // cross-platform, unlike float/double. It is deliberately allowed
        // and must stay off this list.
    };

    // Individual members banned on types that are otherwise legitimate to
    // use (e.g. DateTime itself, or CultureInfo.InvariantCulture, are fine —
    // only the non-deterministic/culture-dependent members are not). Static
    // property getters compile to a MemberReference named "get_<Property>".
    private static readonly (string Namespace, string TypeName, string MemberName)[] BannedMembers =
    {
        ("System", "DateTime", "get_Now"),
        ("System", "DateTime", "get_UtcNow"),
        ("System", "DateTime", "get_Today"),
        ("System", "DateTimeOffset", "get_Now"),
        ("System", "DateTimeOffset", "get_UtcNow"),
        ("System", "Guid", "NewGuid"),
        ("System", "Environment", "get_TickCount"),
        ("System", "Environment", "get_TickCount64"),
        ("System.Globalization", "CultureInfo", "get_CurrentCulture"),
        ("System.Globalization", "CultureInfo", "get_CurrentUICulture"),
    };

    [Fact]
    public void SimulationAssemblies_ArePositivelyIdentifiedCompiledOutputs()
    {
        var context = GetTestBuildContext();
        var projects = DiscoverSimulationProjects();
        Assert.NotEmpty(projects);

        foreach (var project in projects)
        {
            var assemblyPath = GetProjectAssemblyPath(project, context);
            Assert.True(
                File.Exists(assemblyPath),
                $"Expected compiled assembly '{assemblyPath}' for project '{project.Name}' " +
                "was not found — build the solution first.");

            using var peReader = OpenAssembly(assemblyPath);
            var reader = peReader.GetMetadataReader();

            Assert.True(reader.IsAssembly, $"'{assemblyPath}' has no AssemblyDefinition.");

            // Positive control: prove the assembly we read is the one we
            // think it is, by its own declared name — not just by trusting a
            // file path. This is what would have caught round 2's
            // vulnerability: if the type used to *locate* the assembly ever
            // moves to a different project, a location derived from that
            // type silently starts pointing at the wrong DLL.
            var actualName = reader.GetString(reader.GetAssemblyDefinition().Name);
            Assert.Equal(project.Name, actualName);

            // Positive control: prove this isn't an empty/stub assembly. All
            // assemblies have at least the <Module> pseudo-type, so the bar
            // is "more than just <Module>". A method-count check was
            // considered too, but is deliberately NOT required here: a type
            // can legitimately have zero methods (e.g. AssemblyMarker itself
            // — an empty static class with no members compiles to a type
            // with no MethodDefinition rows at all), so requiring at least
            // one method would fail on a perfectly valid state instead of
            // catching a stub.
            Assert.True(
                reader.TypeDefinitions.Count > 1,
                $"'{project.Name}' has no type definitions beyond <Module> — " +
                "is this actually compiled from real source?");
        }

        // Project-specific tripwire, independent of everything above: this
        // task itself created AssemblyMarker inside OathAndCoin.Simulation
        // (Task 1, step 4) as an anchor type. If it is ever moved to another
        // project, this fails loudly on its own — and, unlike round 2,
        // nothing in this file depends on AssemblyMarker's location to find
        // *which* assembly to scan (discovery below is filesystem-based), so
        // moving it can no longer also cause the wrong assembly to be read.
        var simulationProject = projects.Single(p => p.Name == "OathAndCoin.Simulation");
        using var simulationPeReader = OpenAssembly(GetProjectAssemblyPath(simulationProject, context));
        var simulationReader = simulationPeReader.GetMetadataReader();
        Assert.Contains(
            simulationReader.TypeDefinitions,
            handle => simulationReader.GetString(simulationReader.GetTypeDefinition(handle).Name) == "AssemblyMarker");
    }

    [Fact]
    public void SimulationProjectOutputs_ContainNoEngineArtifacts()
    {
        var context = GetTestBuildContext();
        var projects = DiscoverSimulationProjects();
        Assert.NotEmpty(projects);

        foreach (var project in projects)
        {
            var outputDirectory = GetProjectOutputDirectory(project, context);
            Assert.True(
                Directory.Exists(outputDirectory),
                $"Expected build output directory '{outputDirectory}' for project '{project.Name}' " +
                "was not found — build the solution first.");

            foreach (var file in Directory.GetFiles(outputDirectory))
            {
                var fileName = Path.GetFileName(file);
                Assert.False(
                    fileName.Contains(EngineNeedle, StringComparison.OrdinalIgnoreCase),
                    $"Build output '{file}' (project '{project.Name}') has an engine-related file name — " +
                    "a declared-but-unused reference still ships even though it is inert to IL.");

                if (fileName.EndsWith(".deps.json", StringComparison.OrdinalIgnoreCase))
                {
                    var depsContent = File.ReadAllText(file);
                    Assert.False(
                        depsContent.Contains(EngineNeedle, StringComparison.OrdinalIgnoreCase),
                        $"'{file}' (project '{project.Name}') mentions '{EngineNeedle}' in its dependency closure.");
                }
            }
        }
    }

    [Fact]
    public void SimulationAssemblies_ReferenceNoEngineAssemblyOrType()
    {
        ForEachSimulationAssembly((project, reader, _) =>
        {
            foreach (var handle in reader.AssemblyReferences)
            {
                var assemblyReference = reader.GetAssemblyReference(handle);
                var name = reader.GetString(assemblyReference.Name);
                Assert.False(
                    name.Contains(EngineNeedle, StringComparison.OrdinalIgnoreCase),
                    $"[{project.Name}] AssemblyReference '{name}' contains '{EngineNeedle}'.");
            }

            foreach (var handle in reader.TypeReferences)
            {
                var typeReference = reader.GetTypeReference(handle);
                var ns = reader.GetString(typeReference.Namespace);
                var name = reader.GetString(typeReference.Name);
                Assert.False(
                    ns.Contains(EngineNeedle, StringComparison.OrdinalIgnoreCase) ||
                    name.Contains(EngineNeedle, StringComparison.OrdinalIgnoreCase),
                    $"[{project.Name}] TypeReference '{ns}.{name}' contains '{EngineNeedle}'.");
            }
        });
    }

    [Fact]
    public void SimulationAssemblies_ReferenceNoBannedApiSymbol()
    {
        ForEachSimulationAssembly((project, reader, _) =>
        {
            foreach (var handle in reader.TypeReferences)
            {
                var typeReference = reader.GetTypeReference(handle);
                var ns = reader.GetString(typeReference.Namespace);
                var name = reader.GetString(typeReference.Name);

                foreach (var banned in BannedTypes)
                {
                    Assert.False(
                        ns == banned.Namespace && name == banned.Name,
                        $"[{project.Name}] TypeReference '{ns}.{name}' is a banned type.");
                }
            }

            foreach (var handle in reader.MemberReferences)
            {
                var memberReference = reader.GetMemberReference(handle);
                if (memberReference.Parent.Kind != HandleKind.TypeReference)
                {
                    continue;
                }

                var declaringType = reader.GetTypeReference((TypeReferenceHandle)memberReference.Parent);
                var ns = reader.GetString(declaringType.Namespace);
                var typeName = reader.GetString(declaringType.Name);
                var memberName = reader.GetString(memberReference.Name);

                foreach (var banned in BannedMembers)
                {
                    Assert.False(
                        ns == banned.Namespace && typeName == banned.TypeName && memberName == banned.MemberName,
                        $"[{project.Name}] MemberReference '{ns}.{banned.TypeName}.{memberName}' is a banned API.");
                }
            }
        });
    }

    [Fact]
    public void SimulationAssemblies_UseNoSingleOrDoublePrecisionFloat()
    {
        var provider = new FloatDetectingSignatureProvider();

        ForEachSimulationAssembly((project, reader, peReader) =>
        {
            var decoder = new SignatureDecoder<bool, object?>(provider, reader, genericContext: null);

            foreach (var handle in reader.FieldDefinitions)
            {
                var field = reader.GetFieldDefinition(handle);
                var blob = reader.GetBlobReader(field.Signature);
                Assert.False(
                    decoder.DecodeFieldSignature(ref blob),
                    $"[{project.Name}] Field '{DescribeField(reader, field)}' uses float/double in its signature.");
            }

            foreach (var handle in reader.MethodDefinitions)
            {
                var method = reader.GetMethodDefinition(handle);
                var methodBlob = reader.GetBlobReader(method.Signature);
                var signature = decoder.DecodeMethodSignature(ref methodBlob);
                Assert.False(
                    signature.ReturnType || signature.ParameterTypes.Any(usesFloat => usesFloat),
                    $"[{project.Name}] Method '{DescribeMethod(reader, method)}' " +
                    "uses float/double in its parameters or return type.");

                if (method.RelativeVirtualAddress == 0)
                {
                    continue;
                }

                var body = peReader.GetMethodBody(method.RelativeVirtualAddress);
                if (body.LocalSignature.IsNil)
                {
                    continue;
                }

                var standaloneSignature = reader.GetStandaloneSignature(body.LocalSignature);
                var localTypes = standaloneSignature.DecodeLocalSignature(provider, genericContext: null);
                Assert.False(
                    localTypes.Any(usesFloat => usesFloat),
                    $"[{project.Name}] Method '{DescribeMethod(reader, method)}' " +
                    "declares a float/double local variable.");
            }

            // MemberReference: catches calls into *other* assemblies whose
            // own signature carries float/double — e.g. Math.Sqrt(double),
            // double.Parse(string), or a field reference such as Math.PI (a
            // const double field). None of these appear as a
            // FieldDefinition/MethodDefinition in *this* assembly's own
            // tables, only as a reference to one declared elsewhere.
            foreach (var handle in reader.MemberReferences)
            {
                var member = reader.GetMemberReference(handle);
                var memberBlob = reader.GetBlobReader(member.Signature);

                bool usesFloat;
                if (member.GetKind() == MemberReferenceKind.Method)
                {
                    var methodSignature = decoder.DecodeMethodSignature(ref memberBlob);
                    usesFloat = methodSignature.ReturnType || methodSignature.ParameterTypes.Any(t => t);
                }
                else
                {
                    usesFloat = decoder.DecodeFieldSignature(ref memberBlob);
                }

                Assert.False(
                    usesFloat,
                    $"[{project.Name}] MemberReference '{DescribeMemberReference(reader, member)}' " +
                    "uses float/double in its signature.");

                // A member accessed on a *constructed generic type from
                // another assembly* (e.g. `new List<double>()`,
                // `list.Add(x)`) records the type argument in the
                // MemberReference's Parent TypeSpecification, not in the
                // member's own signature — `.ctor()`/`Add(T)` decode to
                // nothing float-shaped on their own. This is why
                // TypeSpecification also needs checking here, not just via
                // the IL walk below (which only reaches TypeSpecifications
                // that are the *direct* operand of an instruction, e.g.
                // `box`/`newarr`/`sizeof`, not ones reachable only through a
                // member reference's Parent field).
                if (member.Parent.Kind == HandleKind.TypeSpecification)
                {
                    var parentTypeSpec = reader.GetTypeSpecification((TypeSpecificationHandle)member.Parent);
                    var parentBlob = reader.GetBlobReader(parentTypeSpec.Signature);
                    Assert.False(
                        decoder.DecodeType(ref parentBlob),
                        $"[{project.Name}] MemberReference '{DescribeMemberReference(reader, member)}' " +
                        "is declared on a constructed generic type that uses float/double as a type argument.");
                }
            }

            // MethodSpecification and calli-kind StandaloneSignature have no
            // back-reference from any other table — a generic method
            // instantiation like `Id<double>(1.5)` or a `calli` call site is
            // only discoverable by walking the IL of whatever method body
            // contains the call. IlTokenScanner does the minimum necessary
            // walk (see its doc comment for exactly what it does and does
            // not decode) to find those operand tokens.
            foreach (var handle in reader.MethodDefinitions)
            {
                var method = reader.GetMethodDefinition(handle);
                if (method.RelativeVirtualAddress == 0)
                {
                    continue;
                }

                var body = peReader.GetMethodBody(method.RelativeVirtualAddress);
                foreach (var tokenHandle in IlTokenScanner.EnumerateTokenOperands(body.GetILBytes()!))
                {
                    switch (tokenHandle.Kind)
                    {
                        case HandleKind.MethodSpecification:
                        {
                            var methodSpec = reader.GetMethodSpecification((MethodSpecificationHandle)tokenHandle);
                            var specBlob = reader.GetBlobReader(methodSpec.Signature);
                            var typeArguments = decoder.DecodeMethodSpecificationSignature(ref specBlob);
                            Assert.False(
                                typeArguments.Any(t => t),
                                $"[{project.Name}] Method '{DescribeMethod(reader, method)}' calls a generic " +
                                "method instantiated with float/double as a type argument.");
                            break;
                        }

                        case HandleKind.StandaloneSignature:
                        {
                            var standalone = reader.GetStandaloneSignature((StandaloneSignatureHandle)tokenHandle);
                            var specBlob = reader.GetBlobReader(standalone.Signature);
                            var callSiteSignature = decoder.DecodeMethodSignature(ref specBlob);
                            Assert.False(
                                callSiteSignature.ReturnType || callSiteSignature.ParameterTypes.Any(t => t),
                                $"[{project.Name}] Method '{DescribeMethod(reader, method)}' has a calli call " +
                                "site whose signature uses float/double.");
                            break;
                        }

                        case HandleKind.TypeSpecification:
                        {
                            var typeSpec = reader.GetTypeSpecification((TypeSpecificationHandle)tokenHandle);
                            var specBlob = reader.GetBlobReader(typeSpec.Signature);
                            Assert.False(
                                decoder.DecodeType(ref specBlob),
                                $"[{project.Name}] Method '{DescribeMethod(reader, method)}' directly operates " +
                                "on a constructed generic type that uses float/double as a type argument.");
                            break;
                        }

                        default:
                            // TypeRef/TypeDef/FieldDef/MethodDef/MemberRef
                            // tokens are already covered by the table scans
                            // above and elsewhere in this file.
                            break;
                    }
                }
            }
        });
    }

    private readonly record struct SimulationProject(string Name, string ProjectDirectory);

    private readonly record struct BuildContext(string Configuration, string TargetFramework);

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

    // Filesystem-based discovery, deliberately independent of any specific
    // type (like AssemblyMarker) living in any specific project: this is
    // exactly what makes the "AssemblyMarker moved to another project" round
    // 2 vulnerability structurally impossible now, rather than something a
    // positive control merely detects after the fact.
    private static List<SimulationProject> DiscoverSimulationProjects()
    {
        var simulationRoot = GetSimulationSourceRoot();
        return Directory.GetFiles(simulationRoot, "*.csproj", SearchOption.AllDirectories)
            .Select(csproj => new SimulationProject(
                Path.GetFileNameWithoutExtension(csproj),
                Path.GetDirectoryName(csproj)!))
            .OrderBy(p => p.Name, StringComparer.Ordinal)
            .ToList();
    }

    // The test assembly's own output path is
    // .../bin/<Configuration>/<TargetFramework>/OathAndCoin.Simulation.Tests.dll.
    // Every project in this solution targets net8.0 and is built together
    // (same -c flag) via `dotnet build/test OathAndCoin.sln` or a
    // project-scoped `dotnet test` that pulls in its references, so reading
    // Configuration/TargetFramework off the test assembly's own location is
    // a reliable, non-hardcoded way to find sibling projects' own output
    // folders without assuming Debug or Release.
    private static BuildContext GetTestBuildContext()
    {
        var testAssemblyLocation = typeof(CoreBoundaryTests).Assembly.Location;
        var targetFrameworkDir = Path.GetDirectoryName(testAssemblyLocation)!;
        var configurationDir = Path.GetDirectoryName(targetFrameworkDir)!;
        return new BuildContext(Path.GetFileName(configurationDir), Path.GetFileName(targetFrameworkDir));
    }

    private static string GetProjectOutputDirectory(SimulationProject project, BuildContext context) =>
        Path.Combine(project.ProjectDirectory, "bin", context.Configuration, context.TargetFramework);

    private static string GetProjectAssemblyPath(SimulationProject project, BuildContext context) =>
        Path.Combine(GetProjectOutputDirectory(project, context), project.Name + ".dll");

    private static PEReader OpenAssembly(string path)
    {
        var bytes = ImmutableArray.Create(File.ReadAllBytes(path));
        return new PEReader(bytes);
    }

    private static void ForEachSimulationAssembly(Action<SimulationProject, MetadataReader, PEReader> check)
    {
        var context = GetTestBuildContext();
        var projects = DiscoverSimulationProjects();
        Assert.NotEmpty(projects);

        foreach (var project in projects)
        {
            using var peReader = OpenAssembly(GetProjectAssemblyPath(project, context));
            var reader = peReader.GetMetadataReader();
            check(project, reader, peReader);
        }
    }

    private static string DescribeField(MetadataReader reader, FieldDefinition field)
    {
        var declaringType = reader.GetTypeDefinition(field.GetDeclaringType());
        return $"{reader.GetString(declaringType.Name)}.{reader.GetString(field.Name)}";
    }

    private static string DescribeMethod(MetadataReader reader, MethodDefinition method)
    {
        var declaringType = reader.GetTypeDefinition(method.GetDeclaringType());
        return $"{reader.GetString(declaringType.Name)}.{reader.GetString(method.Name)}";
    }

    private static string DescribeMemberReference(MetadataReader reader, MemberReference member)
    {
        var name = reader.GetString(member.Name);
        if (member.Parent.Kind != HandleKind.TypeReference)
        {
            return name;
        }

        var typeReference = reader.GetTypeReference((TypeReferenceHandle)member.Parent);
        var ns = reader.GetString(typeReference.Namespace);
        var typeName = reader.GetString(typeReference.Name);
        return string.IsNullOrEmpty(ns) ? $"{typeName}.{name}" : $"{ns}.{typeName}.{name}";
    }

    /// <summary>
    /// Decodes a signature and returns whether PrimitiveTypeCode.Single
    /// (float32) or PrimitiveTypeCode.Double (float64) occurs anywhere in
    /// it — including inside arrays, generic instantiations, pointers,
    /// by-ref parameters, and modified types. Type definitions/references/
    /// specifications themselves cannot recurse further here (that would
    /// require resolving into other assemblies' metadata) and are not what
    /// this check is for, so they report "no float found" — that gap is
    /// exactly why System.Numerics.Vector2 and friends are banned by name in
    /// BannedTypes instead of relied upon to be caught here.
    /// </summary>
    private sealed class FloatDetectingSignatureProvider : ISignatureTypeProvider<bool, object?>
    {
        public bool GetArrayType(bool elementType, ArrayShape shape) => elementType;

        public bool GetByReferenceType(bool elementType) => elementType;

        public bool GetFunctionPointerType(MethodSignature<bool> signature) =>
            signature.ReturnType || signature.ParameterTypes.Any(p => p);

        public bool GetGenericInstantiation(bool genericType, ImmutableArray<bool> typeArguments) =>
            genericType || typeArguments.Any(t => t);

        public bool GetGenericMethodParameter(object? genericContext, int index) => false;

        public bool GetGenericTypeParameter(object? genericContext, int index) => false;

        public bool GetModifiedType(bool modifier, bool unmodifiedType, bool isRequired) =>
            modifier || unmodifiedType;

        public bool GetPinnedType(bool elementType) => elementType;

        public bool GetPointerType(bool elementType) => elementType;

        public bool GetPrimitiveType(PrimitiveTypeCode typeCode) =>
            typeCode is PrimitiveTypeCode.Single or PrimitiveTypeCode.Double;

        public bool GetSZArrayType(bool elementType) => elementType;

        public bool GetTypeFromDefinition(MetadataReader reader, TypeDefinitionHandle handle, byte rawTypeKind) =>
            false;

        public bool GetTypeFromReference(MetadataReader reader, TypeReferenceHandle handle, byte rawTypeKind) =>
            false;

        public bool GetTypeFromSpecification(
            MetadataReader reader, object? genericContext, TypeSpecificationHandle handle, byte rawTypeKind) =>
            false;
    }

    /// <summary>
    /// Walks a method body's raw IL byte stream to find the metadata-token
    /// operand of every instruction that carries one. This exists because
    /// System.Reflection.Metadata's MetadataReader has no bulk accessor for
    /// the MethodSpecification, TypeSpecification, or StandaloneSignature
    /// tables (unlike TypeReferences/MemberReferences/FieldDefinitions/
    /// MethodDefinitions, which are all exposed directly) — a generic method
    /// instantiation such as `Id&lt;double&gt;(1.5)` produces a
    /// MethodSpecification row with no back-reference from any other table;
    /// the only way to find it is to look at the operand of the `call`
    /// instruction that names it.
    ///
    /// This is a minimal, deliberately narrow IL decoder: it knows the exact
    /// operand size of every documented ECMA-335 opcode well enough to skip
    /// operands it doesn't care about without losing its place in the byte
    /// stream, and inspects the 4-byte operand of instructions whose operand
    /// is a metadata token (call, callvirt, newobj, box, newarr, castclass,
    /// isinst, ldtoken, sizeof, calli, ...). It does not build a control-flow
    /// graph, does not track the evaluation stack, and does not attempt to
    /// interpret what the token is used *for* — callers decide what to do
    /// with each yielded handle by its Kind.
    ///
    /// If it encounters an opcode it does not have an operand size for
    /// (should not happen for standard ECMA-335 CIL; this table is meant to
    /// be exhaustive for it), it stops scanning that method body rather than
    /// guess — a silently wrong operand size would desynchronize the rest of
    /// the walk and could either miss real tokens or misread arbitrary bytes
    /// as a token. That stop is a known limit (see the class doc comment),
    /// not a silent success.
    /// </summary>
    private static class IlTokenScanner
    {
        private static readonly Dictionary<ILOpCode, int> OperandSizes = BuildOperandSizes();

        private static readonly HashSet<ILOpCode> TokenOperandOpCodes = new()
        {
            ILOpCode.Jmp, ILOpCode.Call, ILOpCode.Calli, ILOpCode.Newobj, ILOpCode.Castclass, ILOpCode.Isinst,
            ILOpCode.Ldfld, ILOpCode.Ldflda, ILOpCode.Stfld, ILOpCode.Ldsfld, ILOpCode.Ldsflda, ILOpCode.Stsfld,
            ILOpCode.Cpobj, ILOpCode.Ldobj, ILOpCode.Stobj,
            ILOpCode.Box, ILOpCode.Newarr, ILOpCode.Ldelema, ILOpCode.Unbox, ILOpCode.Unbox_any,
            ILOpCode.Refanyval, ILOpCode.Mkrefany, ILOpCode.Ldtoken, ILOpCode.Callvirt,
            ILOpCode.Ldftn, ILOpCode.Ldvirtftn, ILOpCode.Sizeof, ILOpCode.Constrained,
        };

        public static IEnumerable<EntityHandle> EnumerateTokenOperands(byte[] il)
        {
            var offset = 0;
            while (offset < il.Length)
            {
                ILOpCode opCode;
                if (il[offset] == 0xFE && offset + 1 < il.Length)
                {
                    opCode = (ILOpCode)(0xFE00 | il[offset + 1]);
                    offset += 2;
                }
                else
                {
                    opCode = (ILOpCode)il[offset];
                    offset += 1;
                }

                if (opCode == ILOpCode.Switch)
                {
                    if (offset + 4 > il.Length)
                    {
                        yield break;
                    }

                    var targetCount = BitConverter.ToInt32(il, offset);
                    offset += 4 + (targetCount * 4);
                    continue;
                }

                if (!OperandSizes.TryGetValue(opCode, out var operandSize))
                {
                    // Unrecognized opcode: cannot safely continue walking
                    // this method's IL. Stop rather than guess.
                    yield break;
                }

                if (TokenOperandOpCodes.Contains(opCode))
                {
                    if (offset + 4 > il.Length)
                    {
                        yield break;
                    }

                    var token = BitConverter.ToInt32(il, offset);
                    EntityHandle handle;
                    try
                    {
                        handle = MetadataTokens.EntityHandle(token);
                    }
                    catch (BadImageFormatException)
                    {
                        handle = default;
                    }

                    if (!handle.IsNil)
                    {
                        yield return handle;
                    }
                }

                offset += operandSize;
            }
        }

        private static Dictionary<ILOpCode, int> BuildOperandSizes()
        {
            var sizes = new Dictionary<ILOpCode, int>();

            void Add(int size, params ILOpCode[] opCodes)
            {
                foreach (var opCode in opCodes)
                {
                    sizes[opCode] = size;
                }
            }

            Add(
                0,
                ILOpCode.Nop, ILOpCode.Break,
                ILOpCode.Ldarg_0, ILOpCode.Ldarg_1, ILOpCode.Ldarg_2, ILOpCode.Ldarg_3,
                ILOpCode.Ldloc_0, ILOpCode.Ldloc_1, ILOpCode.Ldloc_2, ILOpCode.Ldloc_3,
                ILOpCode.Stloc_0, ILOpCode.Stloc_1, ILOpCode.Stloc_2, ILOpCode.Stloc_3,
                ILOpCode.Ldnull,
                ILOpCode.Ldc_i4_m1, ILOpCode.Ldc_i4_0, ILOpCode.Ldc_i4_1, ILOpCode.Ldc_i4_2, ILOpCode.Ldc_i4_3,
                ILOpCode.Ldc_i4_4, ILOpCode.Ldc_i4_5, ILOpCode.Ldc_i4_6, ILOpCode.Ldc_i4_7, ILOpCode.Ldc_i4_8,
                ILOpCode.Dup, ILOpCode.Pop, ILOpCode.Ret,
                ILOpCode.Ldind_i1, ILOpCode.Ldind_u1, ILOpCode.Ldind_i2, ILOpCode.Ldind_u2,
                ILOpCode.Ldind_i4, ILOpCode.Ldind_u4, ILOpCode.Ldind_i8, ILOpCode.Ldind_i,
                ILOpCode.Ldind_r4, ILOpCode.Ldind_r8, ILOpCode.Ldind_ref,
                ILOpCode.Stind_ref, ILOpCode.Stind_i1, ILOpCode.Stind_i2, ILOpCode.Stind_i4,
                ILOpCode.Stind_i8, ILOpCode.Stind_r4, ILOpCode.Stind_r8, ILOpCode.Stind_i,
                ILOpCode.Add, ILOpCode.Sub, ILOpCode.Mul, ILOpCode.Div, ILOpCode.Div_un,
                ILOpCode.Rem, ILOpCode.Rem_un, ILOpCode.And, ILOpCode.Or, ILOpCode.Xor,
                ILOpCode.Shl, ILOpCode.Shr, ILOpCode.Shr_un, ILOpCode.Neg, ILOpCode.Not,
                ILOpCode.Conv_i1, ILOpCode.Conv_i2, ILOpCode.Conv_i4, ILOpCode.Conv_i8,
                ILOpCode.Conv_r4, ILOpCode.Conv_r8, ILOpCode.Conv_u4, ILOpCode.Conv_u8, ILOpCode.Conv_r_un,
                ILOpCode.Throw, ILOpCode.Ldlen,
                ILOpCode.Ldelem_i1, ILOpCode.Ldelem_u1, ILOpCode.Ldelem_i2, ILOpCode.Ldelem_u2,
                ILOpCode.Ldelem_i4, ILOpCode.Ldelem_u4, ILOpCode.Ldelem_i8, ILOpCode.Ldelem_i,
                ILOpCode.Ldelem_r4, ILOpCode.Ldelem_r8, ILOpCode.Ldelem_ref,
                ILOpCode.Stelem_i, ILOpCode.Stelem_i1, ILOpCode.Stelem_i2, ILOpCode.Stelem_i4,
                ILOpCode.Stelem_i8, ILOpCode.Stelem_r4, ILOpCode.Stelem_r8, ILOpCode.Stelem_ref,
                ILOpCode.Ldelem, ILOpCode.Stelem,
                ILOpCode.Conv_ovf_i1_un, ILOpCode.Conv_ovf_i2_un, ILOpCode.Conv_ovf_i4_un, ILOpCode.Conv_ovf_i8_un,
                ILOpCode.Conv_ovf_u1_un, ILOpCode.Conv_ovf_u2_un, ILOpCode.Conv_ovf_u4_un, ILOpCode.Conv_ovf_u8_un,
                ILOpCode.Conv_ovf_i_un, ILOpCode.Conv_ovf_u_un,
                ILOpCode.Conv_ovf_i1, ILOpCode.Conv_ovf_u1, ILOpCode.Conv_ovf_i2, ILOpCode.Conv_ovf_u2,
                ILOpCode.Conv_ovf_i4, ILOpCode.Conv_ovf_u4, ILOpCode.Conv_ovf_i8, ILOpCode.Conv_ovf_u8,
                ILOpCode.Ckfinite,
                ILOpCode.Conv_u2, ILOpCode.Conv_u1, ILOpCode.Conv_i, ILOpCode.Conv_ovf_i, ILOpCode.Conv_ovf_u,
                ILOpCode.Add_ovf, ILOpCode.Add_ovf_un, ILOpCode.Mul_ovf, ILOpCode.Mul_ovf_un,
                ILOpCode.Sub_ovf, ILOpCode.Sub_ovf_un,
                ILOpCode.Endfinally, ILOpCode.Conv_u,
                ILOpCode.Arglist, ILOpCode.Ceq, ILOpCode.Cgt, ILOpCode.Cgt_un, ILOpCode.Clt, ILOpCode.Clt_un,
                ILOpCode.Localloc, ILOpCode.Endfilter, ILOpCode.Cpblk, ILOpCode.Initblk,
                ILOpCode.Rethrow, ILOpCode.Refanytype,
                ILOpCode.Readonly, ILOpCode.Volatile, ILOpCode.Tail);

            Add(
                1,
                ILOpCode.Ldarg_s, ILOpCode.Ldarga_s, ILOpCode.Starg_s,
                ILOpCode.Ldloc_s, ILOpCode.Ldloca_s, ILOpCode.Stloc_s, ILOpCode.Ldc_i4_s,
                ILOpCode.Br_s, ILOpCode.Brfalse_s, ILOpCode.Brtrue_s,
                ILOpCode.Beq_s, ILOpCode.Bge_s, ILOpCode.Bgt_s, ILOpCode.Ble_s, ILOpCode.Blt_s,
                ILOpCode.Bne_un_s, ILOpCode.Bge_un_s, ILOpCode.Bgt_un_s, ILOpCode.Ble_un_s, ILOpCode.Blt_un_s,
                ILOpCode.Leave_s, ILOpCode.Unaligned);

            Add(2, ILOpCode.Ldarg, ILOpCode.Ldarga, ILOpCode.Starg, ILOpCode.Ldloc, ILOpCode.Ldloca, ILOpCode.Stloc);

            Add(
                4,
                ILOpCode.Ldc_i4, ILOpCode.Ldc_r4,
                ILOpCode.Br, ILOpCode.Brfalse, ILOpCode.Brtrue,
                ILOpCode.Beq, ILOpCode.Bge, ILOpCode.Bgt, ILOpCode.Ble, ILOpCode.Blt,
                ILOpCode.Bne_un, ILOpCode.Bge_un, ILOpCode.Bgt_un, ILOpCode.Ble_un, ILOpCode.Blt_un,
                ILOpCode.Leave,
                ILOpCode.Ldstr, // #US heap token — 4 bytes, deliberately not treated as an EntityHandle.
                ILOpCode.Jmp, ILOpCode.Call, ILOpCode.Calli, ILOpCode.Newobj, ILOpCode.Castclass, ILOpCode.Isinst,
                ILOpCode.Ldfld, ILOpCode.Ldflda, ILOpCode.Stfld, ILOpCode.Ldsfld, ILOpCode.Ldsflda, ILOpCode.Stsfld,
                ILOpCode.Cpobj, ILOpCode.Ldobj, ILOpCode.Stobj,
                ILOpCode.Box, ILOpCode.Newarr, ILOpCode.Ldelema, ILOpCode.Unbox, ILOpCode.Unbox_any,
                ILOpCode.Refanyval, ILOpCode.Mkrefany, ILOpCode.Ldtoken, ILOpCode.Callvirt,
                ILOpCode.Ldftn, ILOpCode.Ldvirtftn, ILOpCode.Sizeof, ILOpCode.Constrained);

            Add(8, ILOpCode.Ldc_i8, ILOpCode.Ldc_r8);

            return sizes;
        }
    }
}
