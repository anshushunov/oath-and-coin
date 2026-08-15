using System.Collections.Immutable;

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

    /// <summary>The offered payment is low enough to be a personal insult.</summary>
    public const string PaymentInsulting = "hero.decision.payment_insulting";

    /// <summary>A personal conviction speaks for taking the contract.</summary>
    public const string PersonalConviction = "hero.decision.personal_conviction";

    /// <summary>A personal aversion speaks against taking the contract.</summary>
    public const string PersonalAversion = "hero.decision.personal_aversion";

    /// <summary>The hero stands with a comrade already committed to this contract.</summary>
    public const string StandsWithComrade = "hero.decision.stands_with_comrade";

    /// <summary>The hero refuses to work alongside someone specific on this contract.</summary>
    public const string WillNotWorkWith = "hero.decision.will_not_work_with";

    /// <summary>A red line — a principle that forbids this action outright, independent of score.</summary>
    public const string PrincipleForbids = "hero.decision.principle_forbids";

    /// <summary>
    /// Every code above, in declaration order. A screen that needs to check
    /// every reason code against a localization catalogue (e.g. Task 11's
    /// read model) would otherwise have to enumerate them by hand, and a
    /// hand-written list drifts from this one the moment a code is added or
    /// renamed here without anyone updating the copy.
    /// </summary>
    public static readonly ImmutableArray<string> All = ImmutableArray.Create(
        PaymentAttractive,
        RiskTooHigh,
        TrustsTheGuild,
        UnpredictableMood,
        PaymentInsulting,
        PersonalConviction,
        PersonalAversion,
        StandsWithComrade,
        WillNotWorkWith,
        PrincipleForbids);
}
