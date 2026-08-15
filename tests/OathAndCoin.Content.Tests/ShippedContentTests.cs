namespace OathAndCoin.Content.Tests;

/// <summary>
/// Not a test of the loader — Task 2 already covers that — but of the
/// content Milestone 1 actually ships: six heroes with traits a contract can
/// trip, and every name the content refers to resolvable in the locale
/// catalogue. A trait no contract can trip, or a hero with zero or three
/// principles, would pass every loader check in <c>ContentSetTests</c> and
/// still fail what this milestone is supposed to measure.
/// </summary>
public class ShippedContentTests
{
    private static readonly ContentSet Content = ContentSet.Load(RepositoryFixtures.ContentRoot);

    [Fact]
    public void EveryHeroCarriesOneOrTwoPrinciples()
    {
        foreach (var hero in Content.Heroes.Values)
        {
            var principles = hero.Traits.Count(id => Content.Traits[id].Kind == TraitKind.Principle);

            Assert.InRange(principles, 1, 2);
        }
    }

    [Fact]
    public void EveryTraitTagIsCarriedByAtLeastOneContract()
    {
        var tags = Content.Contracts.Values.SelectMany(c => c.Tags).ToHashSet();

        foreach (var trait in Content.Traits.Values)
        {
            Assert.True(
                tags.Contains(trait.Tag),
                $"Trait '{trait.Id}' hangs on tag '{trait.Tag}', which no contract carries: "
                + "a trait no contract can trip is not observable by a playtester.");
        }
    }

    [Fact]
    public void SixHeroesAreShipped()
    {
        Assert.Equal(6, Content.Heroes.Count);
    }

    [Fact]
    public void EveryNameTheContentReferencesExistsInTheCatalogue()
    {
        var catalogue = LocaleCatalogue.Load(RepositoryFixtures.LocaleFile("ru"));

        foreach (var key in ReferencedNameKeys(Content))
        {
            Assert.True(catalogue.ContainsKey(key), $"Locale 'ru' has no entry for '{key}'.");
        }
    }

    /// <summary>
    /// The same completeness check, for the fixture content roots under
    /// <c>scenarios/fixtures/</c>.
    /// </summary>
    /// <remarks>
    /// Review finding (branch-level): thirteen fixture name keys existed in no
    /// catalogue at all. Harmless only for as long as nothing renders a
    /// fixture set — and the game resolves its catalogue from the repository's
    /// own <c>content/locale/</c> whatever <c>--content</c> points at (see
    /// <c>Main.ResolveLocaleFile</c>), so a <c>run-smoke</c> over one of these
    /// roots would have thrown on the first missing key rather than shown a
    /// screen. The roots are discovered by walking the directory, so a fixture
    /// added tomorrow is covered by the same rule.
    /// </remarks>
    [Fact]
    public void EveryNameTheScenarioFixturesReferenceExistsInTheCatalogue()
    {
        var catalogue = LocaleCatalogue.Load(RepositoryFixtures.LocaleFile("ru"));
        var roots = Directory.GetDirectories(Path.Combine(RepositoryFixtures.ScenarioRoot, "fixtures"))
            .OrderBy(path => path, StringComparer.Ordinal)
            .ToList();

        Assert.NotEmpty(roots);

        foreach (var root in roots)
        {
            foreach (var key in ReferencedNameKeys(ContentSet.Load(root)))
            {
                Assert.True(
                    catalogue.ContainsKey(key),
                    $"Locale 'ru' has no entry for '{key}', referenced by fixture root "
                    + $"'{Path.GetFileName(root)}'.");
            }
        }
    }

    private static IEnumerable<string> ReferencedNameKeys(ContentSet content) =>
        content.Heroes.Values.Select(hero => hero.DisplayNameKey)
            .Concat(content.Contracts.Values.Select(contract => contract.DisplayNameKey))
            .Concat(content.Traits.Values.Select(trait => trait.DisplayNameKey));
}
