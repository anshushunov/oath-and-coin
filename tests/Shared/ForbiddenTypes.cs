namespace OathAndCoin.Tests.Shared;

/// <summary>
/// The filesystem types no assembly on the headless side of the boundary may
/// reference — the simulation core (ADR-002) and the presentation read model
/// alike.
/// </summary>
/// <remarks>
/// <para>
/// One list, linked into both boundary test projects, because two lists is
/// how they drifted: the presentation guard named five types while the core
/// guard named eight, so <c>Path</c>, <c>FileInfo</c> and <c>DirectoryInfo</c>
/// could appear in <c>OathAndCoin.Presentation</c> with nothing red. The two
/// assemblies make the same promise — buildable by a tool process that never
/// touches disk — and a promise stated twice is stated once too many.
/// </para>
/// <para>
/// In-memory <c>System.IO</c> types (<c>MemoryStream</c>, <c>StringWriter</c>,
/// <c>BinaryWriter</c>) are deliberately absent: they are deterministic and
/// touch no disk, and the save-system work will need them. What is banned here
/// is reaching the filesystem, not the namespace.
/// </para>
/// <para>
/// This is a floor, not a proof, for every reason
/// <c>CoreBoundaryTests</c>'s own doc comment lists — reflection by name,
/// <c>dynamic</c> and P/Invoke leave no TypeReference to find.
/// </para>
/// </remarks>
internal static class ForbiddenTypes
{
    public static readonly (string Namespace, string Name)[] Filesystem =
    {
        ("System.IO", "File"),
        ("System.IO", "Directory"),
        ("System.IO", "Path"),
        ("System.IO", "FileStream"),
        ("System.IO", "FileInfo"),
        ("System.IO", "DirectoryInfo"),
        ("System.IO", "StreamReader"),
        ("System.IO", "StreamWriter"),
    };
}
