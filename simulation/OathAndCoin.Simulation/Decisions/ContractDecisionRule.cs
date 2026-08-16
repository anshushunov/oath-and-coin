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
/// heroes. Which model hero AI uses is no longer an open question — BQ-004 is
/// closed by DEC-010, and this is that decision implemented (see
/// HERO_DECISION_SPEC §2); the rule is kept small because the milestone
/// wants it legible, not because the choice might still be reversed.
/// </summary>
/// <remarks>
/// <para>
/// <c>score = payment*greed/TraitScale − risk*caution/TraitScale − insult +
/// inclinations + trust/10 + bonds + mood</c>; refused below zero, taken
/// above it, and at exactly zero settled by an explicit tie-break (see
/// <see cref="Decide"/>). <c>insult</c> is
/// <c>(risk − payment)*pride/TraitScale</c> when payment is below risk,
/// otherwise absent entirely — not a zero term. The divisor is written as
/// <see cref="TraitScale"/>'s name rather than as the number it happens to
/// hold: that range is stated exactly twice, as that constant and as a
/// literal in the schema, and a third hand-copied statement of it in a
/// comment is a claim nothing checks and the first thing to become
/// confidently-written falsehood when the scale moves. <c>inclinations</c> and <c>bonds</c> are
/// each a sum of signed per-source contributions (a hero's own traits;
/// comrades already committed to the same contract). Every term divides on
/// its own, before being added into the sum — dividing the sum instead would
/// round differently under integer division (HERO_DECISION_SPEC §2.3). Every term is
/// integer arithmetic (TDD §7.4): the core has no floating point at all, and
/// the boundary guard fails the build if any appears.
/// </para>
/// <para>
/// Every term that contributed also appears in the trace, with the same
/// magnitude the score used — never negative: which list (Positive/Negative)
/// a factor lives in already says which way it pulled. The explanation is
/// not reconstructed after the fact from the outcome — it is the arithmetic
/// itself, written down (DEC-004, DEC-006).
/// </para>
/// </remarks>
public static class ContractDecisionRule
{
    /// <summary>
    /// Mood is what keeps two runs of the same campaign from being the same
    /// story, and its range is bounded by exactly what it can and cannot
    /// overturn.
    /// </summary>
    /// <remarks>
    /// <para>
    /// A decision whose sum of motives (payment, risk, insult, inclinations,
    /// trust, bonds — everything <see cref="Decide"/> computes before drawing
    /// mood) falls outside <c>[MoodMin, -MoodMin]</c> (i.e. <c>|sum| &gt; 5</c>)
    /// cannot change sign no matter what mood draws, because mood can add at
    /// most <see cref="MoodMax"/> or subtract at most <c>-MoodMin</c>. That is
    /// arithmetic, not a promise about specific numbers — Bram's and Zara's
    /// actual sums happen to sit outside the band today, but nothing here
    /// assumes they always will.
    /// </para>
    /// <para>
    /// Inside the band, mood genuinely can decide — that is not a case this
    /// rule tries to close, it is a hero whose motives are already close to
    /// indifferent reading as having wavered from one day to the next (the
    /// colouring a later task adds on top of this one). A hero whose motives
    /// sit decisively for or against never flips because of the weather;
    /// that would not be a character the player could learn (DEC-006).
    /// </para>
    /// </remarks>
    public const int MoodMin = -5;

    public const int MoodMax = 5;

    /// <summary>
    /// The span a hero's greed, caution and pride are expressed on, and
    /// therefore the divisor every trait-weighted term below uses: a trait at
    /// the top of its range contributes the whole of what it weighs, one at
    /// the bottom contributes none of it.
    /// </summary>
    /// <remarks>
    /// Declared here, in the layer that divides by it, and derived from here
    /// by <c>OathAndCoin.Content.ContentBounds.TraitMax</c> — not the other
    /// way round, because the content layer already depends on this one and
    /// not the reverse. The rule this closes is <c>ContentBounds</c>'s own,
    /// word for word: a range may be stated exactly twice, as a constant and
    /// as a literal in the schema, and "what must not exist is a third,
    /// hand-copied statement of the same range inside a scoring function".
    /// Three such copies existed — <c>/ 100</c> in the payment, risk and
    /// insult terms — so raising the authored ceiling would have been
    /// accepted by the loader and the schema while every one of those terms
    /// silently weakened.
    /// </remarks>
    public const int TraitScale = 100;

    private static readonly ImmutableArray<ContentId> Considered =
        ImmutableArray.Create(Actions.Accept, Actions.Decline);

    /// <summary>
    /// Decides whether the hero in <paramref name="context"/> takes its
    /// contract.
    /// </summary>
    /// <remarks>
    /// The gate runs first, before any arithmetic: a violated principle
    /// (<see cref="ReasonCodes.PrincipleForbids"/>) closes the decision on the
    /// spot, with no score and no mood draw. Nothing after the gate can
    /// overturn it, because nothing after the gate runs at all — a red line
    /// is not a very large negative contribution that money could outweigh,
    /// it is the absence of a sum to outweigh (HERO_DECISION_SPEC §2.2).
    /// </remarks>
    public static HeroDecision Decide(DecisionContext context)
    {
        ArgumentNullException.ThrowIfNull(context);

        AssertTraitsAreSortedById(context.Traits);

        var blocks = ImmutableArray.CreateBuilder<TraceBlock>();
        foreach (var trait in context.Traits)
        {
            if (trait.IsPrinciple && context.Contract.Tags.Contains(trait.Tag))
            {
                blocks.Add(new TraceBlock(ReasonCodes.PrincipleForbids, trait.Id));
            }
        }

        if (blocks.Count > 0)
        {
            var blockedResult = new DecisionResult
            {
                SelectedAction = Actions.Decline,
                ConsideredActions = Considered,
                SelectedScore = null,
                Trace = new CausalTrace
                {
                    TraceId = context.TraceId,
                    PositiveFactors = ImmutableArray<TraceFactor>.Empty,
                    NegativeFactors = ImmutableArray<TraceFactor>.Empty,
                    BlockedBy = blocks.ToImmutable(),
                },
            };

            // No mood draw happened on this path: a decision the gate closes
            // must not spend randomness it never needed (HERO_DECISION_SPEC §2.2).
            return new HeroDecision(blockedResult, 0);
        }

        var hero = context.Hero;
        var contract = context.Contract;
        var campaignSeed = context.CampaignSeed;
        var decisionOrdinal = context.DecisionOrdinal;
        var traceId = context.TraceId;

        var positive = ImmutableArray.CreateBuilder<TraceFactor>();
        var negative = ImmutableArray.CreateBuilder<TraceFactor>();

        // Order below is the HERO_DECISION_SPEC §2.3 table, verbatim: payment, risk, insult,
        // inclinations (by trait Id, already the order Traits is sorted in),
        // trust, bonds (by HeroId). That order is not cosmetic — it is what
        // ends up in the trace, and the trace is a canonical artifact.

        // Выгода: what the contract pays, pulled toward acceptance by greed.
        // The contract is the source of the money; a factor points at the
        // thing a player could go and look at to understand it.
        var paymentPull = contract.Payment * hero.Greed / TraitScale;
        if (paymentPull > 0)
        {
            positive.Add(new TraceFactor(ReasonCodes.PaymentAttractive, contract.Id, paymentPull));
        }

        // Риск: what the contract risks, pushed toward refusal by caution.
        var riskAversion = contract.Risk * hero.Caution / TraitScale;
        if (riskAversion > 0)
        {
            negative.Add(new TraceFactor(ReasonCodes.RiskTooHigh, contract.Id, riskAversion));
        }

        // Обида: only when the payment does not even cover the risk being
        // asked — paid fairly or better, there is no insult at all, not a
        // zero-magnitude one.
        var insult = contract.Payment < contract.Risk
            ? (contract.Risk - contract.Payment) * hero.Pride / TraitScale
            : 0;
        if (insult > 0)
        {
            negative.Add(new TraceFactor(ReasonCodes.PaymentInsulting, contract.Id, insult));
        }

        // Склонности: every non-principle trait whose tag the contract
        // carries, walked in the hero's own Traits order (Id-sorted, asserted
        // above) — principles were already consumed by the gate above and
        // never reach here.
        var inclinationSum = 0;
        foreach (var trait in context.Traits)
        {
            if (trait.IsPrinciple || !contract.Tags.Contains(trait.Tag))
            {
                continue;
            }

            inclinationSum += trait.Weight;

            if (trait.Weight > 0)
            {
                positive.Add(new TraceFactor(ReasonCodes.PersonalConviction, trait.Id, trait.Weight));
            }
            else if (trait.Weight < 0)
            {
                negative.Add(new TraceFactor(ReasonCodes.PersonalAversion, trait.Id, -trait.Weight));
            }
        }

        // Доверие: the hero's own trust in the guild.
        var guildTrust = hero.TrustInGuild / 10;
        if (guildTrust > 0)
        {
            positive.Add(new TraceFactor(ReasonCodes.TrustsTheGuild, hero.Definition, guildTrust));
        }

        // Связи: only heroes who have already accepted this same contract,
        // walked in AcceptedBy's own HeroId order. A hero listed in
        // AcceptedBy with no matching Crew entry is a context-assembly bug —
        // the engine forgot to carry that hero along — not an absent
        // relationship, so it fails loudly instead of reading as "no
        // opinion".
        var bondSum = 0;
        foreach (var heroId in contract.AcceptedBy)
        {
            if (!context.Crew.TryGetValue(heroId, out var comrade))
            {
                throw new InvalidOperationException(
                    $"Contract '{contract.Id}' lists hero {heroId} in AcceptedBy, but "
                    + $"DecisionContext.Crew has no entry for hero {heroId} — an accepted hero "
                    + "missing from Crew is a context-assembly bug, not an absent relationship.");
            }

            if (!hero.Relationships.TryGetValue(comrade, out var weight))
            {
                continue;
            }

            bondSum += weight;

            if (weight > 0)
            {
                positive.Add(new TraceFactor(ReasonCodes.StandsWithComrade, comrade, weight));
            }
            else if (weight < 0)
            {
                negative.Add(new TraceFactor(ReasonCodes.WillNotWorkWith, comrade, -weight));
            }
        }

        var mood = DrawMood(campaignSeed, decisionOrdinal);

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

        var score = paymentPull - riskAversion - insult + inclinationSum + guildTrust + bondSum + mood.Value;

        // Exactly zero is a tie, not an acceptance with a very small margin:
        // nothing weighed either way, so taking the contract and refusing it
        // scored the same. The rule still resolves it toward accepting — a
        // hero with no reason to refuse goes along with the guild — but it
        // now says so, with a stable code the screen shows. Review finding:
        // `score >= 0` used to settle this silently while TieBreak stayed
        // null, so a hero with zero scales, no trust, no matching trait, no
        // bond and a mood of zero accepted with both factor lists empty and
        // no block: an autonomous decision with not one reason to it, and an
        // optimistic default read as character.
        var tieBreak = score == 0 ? ReasonCodes.NoReasonToRefuse : null;

        var result = new DecisionResult
        {
            SelectedAction = score < 0 ? Actions.Decline : Actions.Accept,
            ConsideredActions = Considered,
            SelectedScore = score,
            Trace = new CausalTrace
            {
                TraceId = traceId,
                PositiveFactors = positive.ToImmutable(),
                NegativeFactors = negative.ToImmutable(),
                BlockedBy = ImmutableArray<TraceBlock>.Empty,
                TieBreak = tieBreak,
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

    /// <summary>
    /// The order principles are checked in is the order blocks appear in the
    /// trace, and that order is a canonical artifact — so it is checked here,
    /// not assumed, on every call. A plain
    /// <see cref="System.Diagnostics.Debug.Assert(bool)"/> would compile away
    /// entirely under a Release build, which is exactly the configuration the
    /// canonical artifact is produced under.
    /// </summary>
    private static void AssertTraitsAreSortedById(ImmutableArray<HeldTrait> traits)
    {
        for (var i = 1; i < traits.Length; i++)
        {
            if (traits[i].Id.CompareTo(traits[i - 1].Id) <= 0)
            {
                throw new ArgumentException(
                    $"DecisionContext.Traits must be strictly sorted by Id; "
                    + $"'{traits[i - 1].Id}' is not before '{traits[i].Id}'.",
                    nameof(traits));
            }
        }
    }
}
