using System.Collections.Immutable;
using System.Linq;

namespace OathAndCoin.Presentation;

/// <summary>
/// The localization key naming which of the five <see cref="ScreenState"/>
/// shapes the screen is in right now — shown right after the title, on
/// every state, so two states that otherwise carry no other content
/// (<see cref="ScreenState.Loading"/> and <see cref="ScreenState.Empty"/>,
/// both title-only) are not byte-identical frames with nothing but a hidden
/// field in the model telling them apart. Reading this off
/// <see cref="ContractOfferScreenModel.State"/> is a branch on state, not on
/// data — the one branch the screen is allowed (see its own remarks).
/// </summary>
public static class ScreenStateKeys
{
    /// <summary>
    /// Every key <see cref="For"/> can produce, for the catalogue-completeness
    /// test. Built from <see cref="Enum.GetValues{TEnum}"/> rather than from a
    /// second, hand-written list of the five states — see the same remark on
    /// <see cref="QualitativeScale.AllKeys"/>.
    /// </summary>
    public static readonly ImmutableArray<string> AllKeys =
        Enum.GetValues<ScreenState>().Select(For).ToImmutableArray();

    public static string For(ScreenState state) => "screen.contract_offer.state." + state switch
    {
        ScreenState.Loading => "loading",
        ScreenState.Empty => "empty",
        ScreenState.Error => "error",
        ScreenState.Incomplete => "incomplete",
        ScreenState.Normal => "normal",
        _ => throw new ArgumentOutOfRangeException(nameof(state), state, "Unknown screen state."),
    };
}
