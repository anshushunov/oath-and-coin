namespace OathAndCoin.Content.Tests;

/// <summary>
/// Guards the property <c>.gitattributes</c> only pins at checkout time:
/// every JSON file under <c>content/</c>, <c>scenarios/</c> and
/// <c>schemas/</c> is LF in the working tree right now, not merely LF in the
/// git index.
/// </summary>
/// <remarks>
/// <see cref="ContentDigest.Compute"/> hashes files by their raw bytes off
/// disk, and the byte-for-byte comparisons in
/// <c>ScenarioCoverageTests.EveryScenarioReplaysToItsCanonicalArtifact</c>
/// read the same way. Both read the working tree, not the git object
/// database. <c>.gitattributes</c>' <c>text eol=lf</c> only normalizes line
/// endings at the moments git itself writes a file to the working tree
/// (checkout, merge, ...); it has no opinion about a file some other tool
/// overwrote in place afterwards. A file rewritten with CRLF and never
/// re-checked-out then sits in the working tree with CRLF while the index —
/// and every other clone of the same commit — still holds LF. From that
/// point on, "the same commit" hashes differently depending on whose working
/// tree computed it: LF on a fresh checkout, CRLF on the machine that had the
/// file rewritten. A canonical artifact regenerated on the CRLF machine then
/// bakes in a <c>content_version</c> that no other machine's replay of the
/// same commit can reproduce.
///
/// This is not hypothetical: it is exactly what happened to
/// <c>content/locale/ru.json</c>. Some tool wrote it back to disk with CRLF;
/// the git index kept LF (<c>git ls-files --eol</c> reported
/// <c>i/lf w/crlf</c>); <c>content_version</c> computed locally
/// (<c>53bea1df...</c>) then disagreed with the Linux CI runner's checkout
/// (<c>5d03734f...</c>); and the canonical scenario artifacts regenerated
/// locally carried the wrong, machine-local hash into the repository. Nothing
/// caught this before CI did, because the only enforcement in place —
/// <c>.gitattributes</c> — protects the checkout, not a file written over
/// afterward. This test reads the working tree directly so the same bug
/// fails locally, immediately, instead of only in CI.
/// </remarks>
public class LineEndingTests
{
    [Fact]
    public void NoJsonFileUnderContentScenariosOrSchemasContainsACarriageReturn()
    {
        var roots = new[] { "content", "scenarios", "schemas" }
            .Select(name => Path.Combine(RepositoryFixtures.RepositoryRoot, name))
            .ToList();

        var jsonFiles = roots
            .SelectMany(root => Directory.GetFiles(root, "*.json", SearchOption.AllDirectories))
            .OrderBy(path => path, StringComparer.Ordinal)
            .ToList();

        // Positive control (AGENTS.md §8): a check that silently found no
        // files to look at would pass forever whether or not it works. These
        // three directories ship well over a hundred JSON files today.
        Assert.True(
            jsonFiles.Count > 100,
            $"Expected well over 100 JSON files under content/, scenarios/ and schemas/, "
            + $"found {jsonFiles.Count}. Did the roots move?");

        var offenders = jsonFiles
            .Where(path => Array.IndexOf(File.ReadAllBytes(path), (byte)'\r') >= 0)
            .Select(path => Path.GetRelativePath(RepositoryFixtures.RepositoryRoot, path))
            .ToList();

        Assert.True(
            offenders.Count == 0,
            "These files carry .gitattributes' 'text eol=lf' but contain a carriage return on disk "
            + "right now, which means the working tree has drifted from what git checked out. That "
            + "drift is exactly what forks content_version between machines (see this test's own "
            + "remarks). Restore LF endings (e.g. `git checkout -- <path>` after removing any local "
            + "override) and regenerate any canonical artifact whose content_version depended on the "
            + "affected file:"
            + Environment.NewLine
            + string.Join(Environment.NewLine, offenders.Select(path => $"  {path}")));
    }
}
