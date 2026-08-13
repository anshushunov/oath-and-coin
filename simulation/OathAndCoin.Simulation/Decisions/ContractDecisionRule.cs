using System.Collections.Immutable;
using OathAndCoin.Simulation.Ids;
using OathAndCoin.Simulation.Random;
using OathAndCoin.Simulation.State;

namespace OathAndCoin.Simulation.Decisions;

/// <summary>
/// A decision together with what it cost the campaign's randomness.
/// </summary>
/// <param name="Result">The choice and its explanation.</param>
/// <param name="OrdinalsConsumed">
/// How many RNG ordinals the decision burned on
/// <see cref="RngStream.HeroDecision"/> — the number to hand to
/// <see cref="GameState.WithEvent"/>'s <c>drawsConsumed</c>.
/// </param>
/// <remarks>
/// The plan sketched <c>Decide</c> as returning a bare
/// <see cref="DecisionResult"/>, which would leave the caller with no source
/// for <c>drawsConsumed</c> other than typing <c>1</c> and hoping. Rejection
/// sampling can burn more than one ordinal
/// (<see cref="DeterministicRng.DrawInt32"/>), and an under-reported count
/// leaves <see cref="GameMetadata.NextDecisionOrdinal"/> pointing at an
/// ordinal that was already drawn <em>and accepted</em> — so the next decision
/// silently reproduces this one's mood, and nothing in a replay disagrees,
/// because every run repeats the same mistake identically. This is the same
/// argument that produced <see cref="Int32Draw"/> one layer down; the count
/// has to keep travelling with the value that cost it.
/// </remarks>
public sealed record HeroDecision(DecisionResult Result, ulong OrdinalsConsumed);

/// <summary>
/// How a hero answers a contract offer (TDD §8). Deliberately the smallest
/// rule that produces two different, explainable answers from two different
/// heroes: whether hero AI ends up a utility model or a rule model is BQ-004,
/// still open for Milestone 1, and nothing here should make that choice
/// harder to change.
/// </summary>
/// <remarks>
/// <para>
/// <c>score = payment*greed/100 − risk*caution/100 + trust/10 + mood</c>,
/// accepted at <c>score &gt;= 0</c>. Every term is integer arithmetic (TDD
/// §7.4): the core has no floating point at all, and the boundary guard fails
/// the build if any appears.
/// </para>
/// <para>
/// Every term that contributed also appears in the trace, with the same
/// magnitude the score used. The explanation is not reconstructed after the
/// fact from the outcome — it is the arithmetic itself, written down (DEC-004,
/// DEC-006).
/// </para>
/// </remarks>
public static class ContractDecisionRule
{
    /// <summary>
    /// Mood is what keeps two runs of the same campaign from being the same
    /// story, and it is bounded on purpose: at ±5 against Bram's +14 and
    /// Zara's −28, it colours a decision without ever overturning one. A hero
    /// whose refusal flips to acceptance because of the weather is not a
    /// character the player can learn (DEC-006).
    /// </summary>
    public const int MoodMin = -5;

    public const int MoodMax = 5;

    private static readonly ImmutableArray<ContentId> Considered =
        ImmutableArray.Create(Actions.Accept, Actions.Decline);

    /// <summary>
    /// Decides whether <paramref name="hero"/> takes
    /// <paramref name="contract"/>.
    /// </summary>
    /// <param name="campaignSeed">From <see cref="GameMetadata.CampaignSeed"/>.</param>
    /// <param name="decisionOrdinal">
    /// From <see cref="GameMetadata.NextDecisionOrdinal"/> — never a counter
    /// this type keeps. Randomness is a pure function of
    /// (seed, stream, ordinal), which is what makes the same state and the
    /// same command reproduce the same decision without anything having to
    /// remember anything.
    /// </param>
    /// <param name="traceId">
    /// From <see cref="GameMetadata.NextTraceId"/>: the id the explanation
    /// will be stored under, so the event that carries the decision can point
    /// at it.
    /// </param>
    public static HeroDecision Decide(
        HeroState hero,
        ContractState contract,
        ulong campaignSeed,
        ulong decisionOrdinal,
        long traceId)
    {
        ArgumentNullException.ThrowIfNull(hero);
        ArgumentNullException.ThrowIfNull(contract);

        var paymentPull = contract.Payment * hero.Greed / 100;
        var riskAversion = contract.Risk * hero.Caution / 100;
        var guildTrust = hero.TrustInGuild / 10;
        var mood = DrawMood(campaignSeed, decisionOrdinal);

        var score = paymentPull - riskAversion + guildTrust + mood.Value;

        var positive = ImmutableArray.CreateBuilder<TraceFactor>();
        var negative = ImmutableArray.CreateBuilder<TraceFactor>();

        // The contract is the source of the money and of the danger; the hero
        // is the source of their own trust and their own mood. A factor points
        // at the thing a player could go and look at to understand it.
        if (paymentPull > 0)
        {
            positive.Add(new TraceFactor(ReasonCodes.PaymentAttractive, contract.Id, paymentPull));
        }

        if (riskAversion > 0)
        {
            negative.Add(new TraceFactor(ReasonCodes.RiskTooHigh, contract.Id, riskAversion));
        }

        if (guildTrust > 0)
        {
            positive.Add(new TraceFactor(ReasonCodes.TrustsTheGuild, hero.Definition, guildTrust));
        }

        // Magnitudes are stated as strengths, never as signed contributions:
        // which list a factor is in already says which way it pulled, and a
        // negative magnitude inside NegativeFactors would mean the opposite of
        // itself.
        if (mood.Value > 0)
        {
            positive.Add(new TraceFactor(ReasonCodes.UnpredictableMood, hero.Definition, mood.Value));
        }
        else if (mood.Value < 0)
        {
            negative.Add(new TraceFactor(ReasonCodes.UnpredictableMood, hero.Definition, -mood.Value));
        }

        var result = new DecisionResult
        {
            SelectedAction = score >= 0 ? Actions.Accept : Actions.Decline,
            ConsideredActions = Considered,
            SelectedScore = score,
            Trace = new CausalTrace
            {
                TraceId = traceId,
                PositiveFactors = positive.ToImmutable(),
                NegativeFactors = negative.ToImmutable(),
                BlockedBy = ImmutableArray<string>.Empty,
            },
        };

        return new HeroDecision(result, mood.OrdinalsConsumed);
    }

    /// <summary>
    /// The mood draw, in one place. Internal rather than inlined at the single
    /// call site so a test can ask what mood a given (seed, ordinal) produces
    /// without restating the range — a test that restated it would keep
    /// passing after the range changed underneath it.
    /// </summary>
    internal static Int32Draw DrawMood(ulong campaignSeed, ulong ordinal) =>
        DeterministicRng.DrawInt32(campaignSeed, RngStream.HeroDecision, ordinal, MoodMin, MoodMax + 1);
}
