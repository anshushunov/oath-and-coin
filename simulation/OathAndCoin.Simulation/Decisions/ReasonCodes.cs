namespace OathAndCoin.Simulation.Decisions;

/// <summary>
/// Stable, namespaced reason codes usable as <see cref="TraceFactor.ReasonCode"/>
/// values (TDD §8: "Каждый фактор использует стабильный reason code"). Kept
/// as named constants — not built inline from string interpolation — so a
/// factor's meaning cannot silently drift inside a scoring function, and a
/// rename shows up as a visible source change rather than a data typo.
/// </summary>
public static class ReasonCodes
{
    public const string PaymentAttractive = "hero.decision.payment_attractive";
    public const string RiskTooHigh = "hero.decision.risk_too_high";
    public const string TrustsTheGuild = "hero.decision.trusts_the_guild";
    public const string UnpredictableMood = "hero.decision.unpredictable_mood";
}
