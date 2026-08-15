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

        var referenced = Content.Heroes.Values.Select(h => h.DisplayNameKey)
            .Concat(Content.Contracts.Values.Select(c => c.DisplayNameKey))
            .Concat(Content.Traits.Values.Select(t => t.DisplayNameKey));

        foreach (var key in referenced)
        {
            Assert.True(catalogue.ContainsKey(key), $"Locale 'ru' has no entry for '{key}'.");
        }
    }
}
