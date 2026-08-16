using System.Collections.Generic;

namespace OathAndCoin.Game.Ui;

/// <summary>
/// Resolves a localization key to its player-facing text, against one loaded
/// locale catalogue (<see cref="OathAndCoin.Content.LocaleCatalogue"/>). This
/// is the only place in the running game that turns a key into text a player
/// reads — <see cref="ContractOfferScreen"/> never looks a key up in a
/// catalogue itself, and the read model
/// (<see cref="OathAndCoin.Presentation.ContractOfferScreenModel"/>) stays on
/// keys all the way through (see its factory's remarks), so a missing
/// translation has exactly one place to be noticed: here.
/// </summary>
/// <remarks>
/// Plain C# with no Godot dependency, even though it lives beside the screen
/// it serves: resolving a key against a dictionary is not an engine concern,
/// and keeping it that way is what would let a future tool-side caller reuse
/// this exact type if it ever needed to (today it does not — see the remarks
/// on <c>RenderedUiSnapshot.Expected</c> for why the tool side deliberately
/// implements its own, independent resolution instead).
/// </remarks>
public sealed class TextSource
{
    private readonly IReadOnlyDictionary<string, string> _catalogue;

    public TextSource(IReadOnlyDictionary<string, string> catalogue)
    {
        _catalogue = catalogue ?? throw new ArgumentNullException(nameof(catalogue));
    }

    /// <summary>
    /// The text <paramref name="key"/> resolves to.
    /// </summary>
    /// <exception cref="InvalidOperationException">
    /// The catalogue has no entry for <paramref name="key"/>. Throwing here —
    /// rather than falling back to <paramref name="key"/> itself — matters
    /// because a fallback would let a missing translation reach the frame
    /// looking like a deliberate design choice instead of the gap it is; see
    /// the type's own remarks for why the catalogue-completeness test
    /// (Task 10) is expected to catch this long before a throw here ever
    /// would in practice.
    /// </exception>
    public string Resolve(string key)
    {
        ArgumentException.ThrowIfNullOrEmpty(key);

        return _catalogue.TryGetValue(key, out var text)
            ? text
            : throw new InvalidOperationException(
                $"Locale catalogue has no entry for key '{key}'. A missing translation must fail loudly, not "
                + "show the key itself as if that were the design.");
    }
}
