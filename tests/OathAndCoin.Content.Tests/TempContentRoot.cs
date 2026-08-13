namespace OathAndCoin.Content.Tests;

/// <summary>
/// A throwaway content directory a test can author freely — malformed files,
/// duplicate ids, out-of-range values — without touching the production
/// content the game actually ships (TDD §11.1: "тестовые fixtures хранятся
/// отдельно от production content").
/// </summary>
internal sealed class TempContentRoot : IDisposable
{
    private TempContentRoot(string root)
    {
        Root = root;
    }

    public string Root { get; }

    public static TempContentRoot CreateEmpty()
    {
        var root = Path.Combine(
            Path.GetTempPath(),
            "oath-and-coin-tests",
            Guid.NewGuid().ToString("n"));

        Directory.CreateDirectory(Path.Combine(root, "heroes"));
        Directory.CreateDirectory(Path.Combine(root, "contracts"));
        return new TempContentRoot(root);
    }

    /// <summary>
    /// A byte-for-byte copy of the production content tree, relative paths
    /// included — so a digest taken over the copy is expected to equal the
    /// digest taken over the original.
    /// </summary>
    public static TempContentRoot CopyOfProductionContent()
    {
        var copy = CreateEmpty();
        var source = RepositoryFixtures.ContentRoot;

        foreach (var file in Directory.GetFiles(source, "*", SearchOption.AllDirectories))
        {
            var relativePath = Path.GetRelativePath(source, file);
            var destination = Path.Combine(copy.Root, relativePath);
            Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
            File.Copy(file, destination, overwrite: true);
        }

        return copy;
    }

    public void WriteHero(string fileName, string json) => Write("heroes", fileName, json);

    public void WriteContract(string fileName, string json) => Write("contracts", fileName, json);

    public string ReadHero(string fileName) => File.ReadAllText(Path.Combine(Root, "heroes", fileName));

    public void Dispose()
    {
        try
        {
            if (Directory.Exists(Root))
            {
                Directory.Delete(Root, recursive: true);
            }
        }
        catch (IOException)
        {
            // A leaked temp directory is not worth failing a green test over.
        }
    }

    private void Write(string subdirectory, string fileName, string json)
    {
        var directory = Path.Combine(Root, subdirectory);
        Directory.CreateDirectory(directory);
        File.WriteAllText(Path.Combine(directory, fileName), json);
    }
}
