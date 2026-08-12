using System.Collections.Immutable;
using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Reflection.PortableExecutable;
using OathAndCoin.Simulation;

namespace OathAndCoin.Simulation.Tests;

/// <summary>
/// Mechanizes ADR-002 (core boundary): the simulation assembly must be usable
/// headless, without Godot, and without non-deterministic system APIs.
///
/// Fix round 2 replaced the original three checks (csproj/props/targets scan,
/// source-text substring scan, Assembly.GetReferencedAssemblies()) with a
/// single method of proof: reading the *compiled* OathAndCoin.Simulation.dll
/// through System.Reflection.Metadata. Round 1's checks were a text
/// heuristic over what the source *says*; this reads what the compiler
/// actually *emitted*, which is the thing the boundary is meant to protect.
/// That closes every escape the text heuristic had by construction, not by
/// enumerating more patterns:
///   - a reference declared anywhere MSBuild can silently import from
///     (Directory.Packages.props, a transitive &lt;Import&gt;, ...) is
///     irrelevant unless the compiler actually resolves and uses it — and if
///     it does, that shows up as metadata, regardless of which project file
///     declared it;
///   - an API called through an implicit using, a `using` alias, a fully
///     qualified name, or any other spelling all lower to the exact same
///     TypeReference/MemberReference token — there is no "unqualified"
///     dodge at the metadata level;
///   - `float`/`double` as C# keywords are gone entirely; the check reads
///     the actual PrimitiveTypeCode.Single/Double element type from decoded
///     signatures (fields, method parameters/return types, and local
///     variables), so no keyword or field-name substring
///     (`_doubleBuffer`, `1.5`, `1f`) can evade or falsely trigger it.
/// </summary>
public class CoreBoundaryTests
{
    private const string EngineNeedle = "Godot";

    // Whole types banned outright: any reference to the type at all is a
    // violation, regardless of which member is used. System.Random and
    // System.Diagnostics.Stopwatch are non-deterministic/wall-clock by
    // construction; the filesystem types would break running the simulation
    // headless/deterministically. Note System.IO.MemoryStream, StringWriter,
    // BinaryWriter, etc. are deliberately NOT here — they are deterministic
    // in-memory types the save-system work will need.
    private static readonly (string Namespace, string Name)[] BannedTypes =
    {
        ("System", "Random"),
        ("System.Diagnostics", "Stopwatch"),
        ("System.IO", "File"),
        ("System.IO", "Directory"),
        ("System.IO", "Path"),
        ("System.IO", "FileStream"),
        ("System.IO", "FileInfo"),
        ("System.IO", "DirectoryInfo"),
        ("System.IO", "StreamReader"),
        ("System.IO", "StreamWriter"),
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
    public void SimulationAssembly_ReferencesNoEngineAssemblyOrType()
    {
        using var peReader = OpenSimulationAssembly();
        var reader = peReader.GetMetadataReader();

        foreach (var handle in reader.AssemblyReferences)
        {
            var assemblyReference = reader.GetAssemblyReference(handle);
            var name = reader.GetString(assemblyReference.Name);
            Assert.False(
                name.Contains(EngineNeedle, StringComparison.OrdinalIgnoreCase),
                $"AssemblyReference '{name}' contains '{EngineNeedle}'.");
        }

        foreach (var handle in reader.TypeReferences)
        {
            var typeReference = reader.GetTypeReference(handle);
            var ns = reader.GetString(typeReference.Namespace);
            var name = reader.GetString(typeReference.Name);
            Assert.False(
                ns.Contains(EngineNeedle, StringComparison.OrdinalIgnoreCase) ||
                name.Contains(EngineNeedle, StringComparison.OrdinalIgnoreCase),
                $"TypeReference '{ns}.{name}' contains '{EngineNeedle}'.");
        }
    }

    [Fact]
    public void SimulationAssembly_ReferencesNoBannedApiSymbol()
    {
        using var peReader = OpenSimulationAssembly();
        var reader = peReader.GetMetadataReader();

        foreach (var handle in reader.TypeReferences)
        {
            var typeReference = reader.GetTypeReference(handle);
            var ns = reader.GetString(typeReference.Namespace);
            var name = reader.GetString(typeReference.Name);

            foreach (var banned in BannedTypes)
            {
                Assert.False(
                    ns == banned.Namespace && name == banned.Name,
                    $"TypeReference '{ns}.{name}' is a banned type.");
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
                    $"MemberReference '{ns}.{banned.TypeName}.{memberName}' is a banned API.");
            }
        }
    }

    [Fact]
    public void SimulationAssembly_UsesNoSingleOrDoublePrecisionFloat()
    {
        using var peReader = OpenSimulationAssembly();
        var reader = peReader.GetMetadataReader();
        var provider = new FloatDetectingSignatureProvider();
        var decoder = new SignatureDecoder<bool, object?>(provider, reader, genericContext: null);

        foreach (var handle in reader.FieldDefinitions)
        {
            var field = reader.GetFieldDefinition(handle);
            var blob = reader.GetBlobReader(field.Signature);
            var usesFloat = decoder.DecodeFieldSignature(ref blob);

            Assert.False(
                usesFloat,
                $"Field '{DescribeField(reader, field)}' uses float/double in its signature.");
        }

        foreach (var handle in reader.MethodDefinitions)
        {
            var method = reader.GetMethodDefinition(handle);
            var blob = reader.GetBlobReader(method.Signature);
            var signature = decoder.DecodeMethodSignature(ref blob);

            Assert.False(
                signature.ReturnType || signature.ParameterTypes.Any(usesFloat => usesFloat),
                $"Method '{DescribeMethod(reader, method)}' uses float/double in its parameters or return type.");

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
                $"Method '{DescribeMethod(reader, method)}' declares a float/double local variable.");
        }
    }

    private static PEReader OpenSimulationAssembly()
    {
        var path = typeof(AssemblyMarker).Assembly.Location;
        var bytes = ImmutableArray.Create(File.ReadAllBytes(path));
        return new PEReader(bytes);
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

    /// <summary>
    /// Decodes a signature and returns whether PrimitiveTypeCode.Single
    /// (float32) or PrimitiveTypeCode.Double (float64) occurs anywhere in
    /// it — including inside arrays, generic instantiations, pointers,
    /// by-ref parameters, and modified types. Type definitions/references/
    /// specifications themselves cannot recurse further here (that would
    /// require resolving into other assemblies' metadata) and are not what
    /// this check is for, so they report "no float found".
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
}
