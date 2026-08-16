using OathAndCoin.Simulation.Ids;

namespace OathAndCoin.Presentation;

/// <summary>
/// Builds the localization key for a content tag (e.g. <c>target:cult</c> →
/// <c>tag.target.cult</c>). A tag is a category, not a named entity — nothing
/// in content authors a display name for one (see
/// <see cref="OathAndCoin.Content.ContractDefinition.Tags"/>) — so, unlike a
/// hero or a contract, there is no authored key to carry along; the key is
/// built from the id by a fixed, one-line convention instead.
/// </summary>
public static class TagKeys
{
    public static string For(ContentId tag) => $"tag.{tag.Namespace}.{tag.Name}";
}
