namespace OathAndCoin.Content.Tests;

/// <summary>
/// <see cref="LocaleCatalogue.Load"/>'s own contract, exercised directly:
/// production <c>content/locale/ru.json</c> is well-formed by construction, so
/// nothing that loads it can ever hit the rejection paths this type promises
/// in its own doc comment. Without this file, "duplicate key", "empty value",
/// "unsupported schema_version" and "missing required field" are statements
/// that exist only in code and in a report, never in anything a test run can
/// disprove.
/// </summary>
public class LocaleCatalogueTests
{
    [Fact]
    public void Load_ReadsEntries()
    {
        using var temp = TempLocaleFile.Write("""
            {
              "schema_version": 2,
              "locale": "ru",
              "entries": {
                "hero.core.bram.name": "Брам",
                "hero.core.zara.name": "Зара"
              }
            }
            """);

        var catalogue = LocaleCatalogue.Load(temp.FullPath);

        Assert.Equal(2, catalogue.Count);
        Assert.Equal("Брам", catalogue["hero.core.bram.name"]);
        Assert.Equal("Зара", catalogue["hero.core.zara.name"]);
    }

    /// <summary>
    /// The rejection <see cref="LocaleCatalogue.Load"/>'s own remarks call out
    /// by name: a plain <see cref="System.Text.Json.JsonSerializer"/> or
    /// <see cref="System.Text.Json.Nodes.JsonNode"/> read silently keeps only
    /// the last of two properties sharing a name, so a loader built on either
    /// one would read this file as a single entry rather than reject it. This
    /// is exactly the case a mutant swap to that simpler reading exercises —
    /// see the report for the red run recorded against it.
    /// </summary>
    [Fact]
    public void Load_RejectsDuplicateKey()
    {
        using var temp = TempLocaleFile.Write("""
            {
              "schema_version": 2,
              "locale": "ru",
              "entries": {
                "hero.core.bram.name": "Брам",
                "hero.core.bram.name": "Брам-второй"
              }
            }
            """);

        var error = Assert.Throws<InvalidDataException>(() => LocaleCatalogue.Load(temp.FullPath));

        Assert.Contains("hero.core.bram.name", error.Message, StringComparison.Ordinal);
        Assert.Contains("repeats", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Load_RejectsEmptyValue()
    {
        using var temp = TempLocaleFile.Write("""
            {
              "schema_version": 2,
              "locale": "ru",
              "entries": {
                "hero.core.bram.name": ""
              }
            }
            """);

        var error = Assert.Throws<InvalidDataException>(() => LocaleCatalogue.Load(temp.FullPath));

        Assert.Contains("hero.core.bram.name", error.Message, StringComparison.Ordinal);
        Assert.Contains("empty", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Load_RejectsNonStringValue()
    {
        using var temp = TempLocaleFile.Write("""
            {
              "schema_version": 2,
              "locale": "ru",
              "entries": {
                "hero.core.bram.name": 5
              }
            }
            """);

        var error = Assert.Throws<InvalidDataException>(() => LocaleCatalogue.Load(temp.FullPath));

        Assert.Contains("hero.core.bram.name", error.Message, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(1)]
    [InlineData(3)]
    public void Load_RejectsUnsupportedSchemaVersion(int schemaVersion)
    {
        using var temp = TempLocaleFile.Write($$"""
            {
              "schema_version": {{schemaVersion}},
              "locale": "ru",
              "entries": {
                "hero.core.bram.name": "Брам"
              }
            }
            """);

        var error = Assert.Throws<InvalidDataException>(() => LocaleCatalogue.Load(temp.FullPath));

        Assert.Contains($"schema_version {schemaVersion}", error.Message, StringComparison.Ordinal);
        Assert.Contains($"version {LocaleCatalogue.SupportedSchemaVersion}", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Load_RejectsMissingSchemaVersion()
    {
        using var temp = TempLocaleFile.Write("""
            {
              "locale": "ru",
              "entries": {
                "hero.core.bram.name": "Брам"
              }
            }
            """);

        var error = Assert.Throws<InvalidDataException>(() => LocaleCatalogue.Load(temp.FullPath));

        Assert.Contains("schema_version", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Load_RejectsMissingLocale()
    {
        using var temp = TempLocaleFile.Write("""
            {
              "schema_version": 2,
              "entries": {
                "hero.core.bram.name": "Брам"
              }
            }
            """);

        var error = Assert.Throws<InvalidDataException>(() => LocaleCatalogue.Load(temp.FullPath));

        Assert.Contains("locale", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Load_RejectsEmptyLocale()
    {
        using var temp = TempLocaleFile.Write("""
            {
              "schema_version": 2,
              "locale": "",
              "entries": {
                "hero.core.bram.name": "Брам"
              }
            }
            """);

        var error = Assert.Throws<InvalidDataException>(() => LocaleCatalogue.Load(temp.FullPath));

        Assert.Contains("locale", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Load_RejectsMissingEntries()
    {
        using var temp = TempLocaleFile.Write("""
            {
              "schema_version": 2,
              "locale": "ru"
            }
            """);

        var error = Assert.Throws<InvalidDataException>(() => LocaleCatalogue.Load(temp.FullPath));

        Assert.Contains("entries", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Load_RejectsEntriesThatIsNotAnObject()
    {
        using var temp = TempLocaleFile.Write("""
            {
              "schema_version": 2,
              "locale": "ru",
              "entries": []
            }
            """);

        var error = Assert.Throws<InvalidDataException>(() => LocaleCatalogue.Load(temp.FullPath));

        Assert.Contains("entries", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Load_RejectsMissingFile()
    {
        var missing = Path.Combine(Path.GetTempPath(), "oath-and-coin-tests", Guid.NewGuid().ToString("n") + ".json");

        var error = Assert.Throws<InvalidDataException>(() => LocaleCatalogue.Load(missing));

        Assert.Contains("does not exist", error.Message, StringComparison.Ordinal);
    }

    /// <summary>
    /// A single throwaway locale file. Mirrors <c>ScenarioManifestTests.TempManifest</c>
    /// at file scope: a negative-path test writes one bad value without
    /// touching production <c>content/locale/</c>.
    /// </summary>
    private sealed class TempLocaleFile : IDisposable
    {
        private readonly string _directory;

        private TempLocaleFile(string directory, string fullPath)
        {
            _directory = directory;
            FullPath = fullPath;
        }

        public string FullPath { get; }

        public static TempLocaleFile Write(string json)
        {
            var directory = Path.Combine(Path.GetTempPath(), "oath-and-coin-tests", Guid.NewGuid().ToString("n"));
            Directory.CreateDirectory(directory);

            var fullPath = Path.Combine(directory, "locale.json");
            File.WriteAllText(fullPath, json);
            return new TempLocaleFile(directory, fullPath);
        }

        public void Dispose()
        {
            try
            {
                if (Directory.Exists(_directory))
                {
                    Directory.Delete(_directory, recursive: true);
                }
            }
            catch (IOException)
            {
                // A leaked temp directory is not worth failing a green test over.
            }
        }
    }
}
