using System.Collections.Immutable;

namespace OathAndCoin.Presentation;

/// <summary>
/// The localization key naming each field the screen shows, so a value that
/// is a bare number or a bare qualitative grade says what it is a number or
/// a grade <em>of</em>.
/// </summary>
/// <remarks>
/// <para>
/// External review finding (blocker): on the captured frame the texts
/// <c>40</c>, <c>4</c>, <c>3</c> and a run of "Умеренно / Слабо / Умеренно"
/// stood one under another with nothing to say which was the payment, which
/// the crew, and which of greed, caution and pride each grade belonged to.
/// Both hashes were green throughout, and correctly so: they compare the
/// texts the model produced, and every one of those texts was the right text
/// for its field — the frame was unreadable because the field had no name,
/// which is not a fact either hash is about.
/// </para>
/// <para>
/// A caption is its own label beside the value, never <c>caption + ": " +
/// value</c> composed in code: a player-facing string assembled at a call
/// site is exactly what TDD §11.1 forbids, and the punctuation and word
/// order between a caption and its value differ by language. The colon (or
/// its absence) therefore lives in the catalogue, with the words.
/// </para>
/// </remarks>
public static class FieldKeys
{
    public const string ContractPayment = "field.contract.payment";
    public const string ContractRisk = "field.contract.risk";
    public const string ContractRequiredCrew = "field.contract.required_crew";
    public const string ContractAcceptedCount = "field.contract.accepted_count";
    public const string ContractTags = "field.contract.tags";

    public const string HeroGreed = "field.hero.greed";
    public const string HeroCaution = "field.hero.caution";
    public const string HeroPride = "field.hero.pride";
    public const string HeroPrinciples = "field.hero.principles";
    public const string HeroInclinations = "field.hero.inclinations";

    public const string ReasonStrength = "field.reason.strength";
    public const string ResponseBlockedBy = "field.response.blocked_by";

    /// <summary>
    /// Every key above, for the catalogue-completeness test. Hand-written,
    /// unlike <see cref="QualitativeScale.AllKeys"/> or
    /// <see cref="ReasonDirectionKeys.AllKeys"/>: these are not the members
    /// of a closed enum this class could enumerate, so there is nothing to
    /// derive it from — and a caption missing from this list is caught by the
    /// snapshot comparison the moment the screen tries to resolve it, which
    /// is the failure this list would otherwise only make earlier.
    /// </summary>
    public static readonly ImmutableArray<string> AllKeys = ImmutableArray.Create(
        ContractPayment,
        ContractRisk,
        ContractRequiredCrew,
        ContractAcceptedCount,
        ContractTags,
        HeroGreed,
        HeroCaution,
        HeroPride,
        HeroPrinciples,
        HeroInclinations,
        ReasonStrength,
        ResponseBlockedBy);
}
