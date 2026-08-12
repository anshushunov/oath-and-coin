using OathAndCoin.Simulation.Ids;

namespace OathAndCoin.Simulation.State;

/// <summary>
/// A hero's decision-relevant state (TDD §8). Three traits are a deliberate
/// spike minimum: MVP_PLAN §5.2 sketches 6-8, and the choice between a
/// utility model and a rule model is BQ-004, left open for Milestone 1.
/// </summary>
public sealed record HeroState
{
    public required HeroId Id { get; init; }

    /// <summary>The content definition this hero instance was created from.</summary>
    public required ContentId Definition { get; init; }

    /// <summary>
    /// Localization key for the hero's display name (TDD §11.1: gameplay
    /// values are kept separate from localization keys) — never a literal,
    /// player-facing string.
    /// </summary>
    public required string DisplayNameKey { get; init; }

    public required int Greed { get; init; }

    public required int Caution { get; init; }

    public required int TrustInGuild { get; init; }
}
