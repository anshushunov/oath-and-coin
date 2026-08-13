namespace OathAndCoin.Simulation.Decisions;

/// <summary>
/// Stable, namespaced reason codes usable as <see cref="TraceFactor.ReasonCode"/>
/// values (TDD §8: "Каждый фактор использует стабильный reason code"). Kept
/// as named constants — not built inline from string interpolation — so a
/// factor's meaning cannot silently drift inside a scoring function, and a
/// rename shows up as a visible source change rather than a data typo.
/// </summary>
/// <remarks>
/// These stay plain <see cref="string"/>s while
/// <see cref="TraceFactor.SourceEntity"/> and <see cref="Actions"/> are
/// <see cref="Ids.ContentId"/>, and the line between the two conventions is:
/// a reason code is a closed engine vocabulary that becomes a localization
/// key — it is never authored in content and never addressed from content,
/// so there is nothing for a content-addressable identifier to resolve
/// against. Anything content can author or point at gets a
/// <see cref="Ids.ContentId"/>; the engine's own dictionary gets targeted
/// strings.
/// </remarks>
public static class ReasonCodes
{
    public const string PaymentAttractive = "hero.decision.payment_attractive";
    public const string RiskTooHigh = "hero.decision.risk_too_high";
    public const string TrustsTheGuild = "hero.decision.trusts_the_guild";
    public const string UnpredictableMood = "hero.decision.unpredictable_mood";
}
