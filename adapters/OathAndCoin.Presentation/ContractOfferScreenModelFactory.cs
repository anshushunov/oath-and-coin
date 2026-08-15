using System.Collections.Generic;
using System.Collections.Immutable;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using OathAndCoin.Content;
using OathAndCoin.Content.Scenarios;
using OathAndCoin.Simulation.Decisions;
using OathAndCoin.Simulation.Ids;
using OathAndCoin.Simulation.State;

namespace OathAndCoin.Presentation;

/// <summary>
/// Builds a <see cref="ContractOfferScreenModel"/> from a scenario run, and
/// computes the hash a tool process and the running game compare to prove
/// they built the same screen — the same two-hash arrangement
/// <c>SpikeScreenModelFactory</c> established (see
/// <see cref="RenderedUiSnapshot"/> for the other half).
/// </summary>
public static class ContractOfferScreenModelFactory
{
    /// <summary>
    /// This screen's title. A localization key, not text — see the remarks on
    /// <see cref="ContractOfferScreenModel"/> and TDD §11.1: this assembly
    /// never resolves one. Public: the catalogue-completeness test asserts it
    /// is actually a key the locale carries, and — since Task 12 — both the
    /// game (<c>ContractOfferScreen</c>'s <see cref="ScreenState.Loading"/>
    /// model, which <see cref="FromOutcome(ScenarioOutcome)"/> never builds)
    /// and the runtime harness (its own independent copy of that same model)
    /// need the identical constant to agree on what that screen's title key
    /// is without either one inventing its own spelling of it.
    /// </summary>
    public const string TitleKey = "screen.contract_offer.title";

    /// <summary>
    /// How many reasons a response line shows at most (spec: an explanation a
    /// player can actually hold in mind, not the whole trace dumped
    /// verbatim). Applied after ranking, so the ones shown are always the
    /// strongest of the side they were allotted to — see <see cref="RankReasons"/>.
    /// </summary>
    private const int MaxReasons = 3;

    /// <summary>
    /// How many of <see cref="MaxReasons"/> belong to reasons that supported
    /// the answer the hero actually gave, whenever that many exist. The
    /// remainder is what a counter-argument may take.
    /// </summary>
    /// <remarks>
    /// External review finding (blocker). Ranking every factor together by
    /// magnitude and taking the top three is a defensible rule for "the
    /// biggest things that happened", and the wrong rule for "why this hero
    /// answered this way": on entirely legal data a hero accepts at +3 while
    /// risk (−30), insult (−29) and a dislike (−28) are the three largest
    /// magnitudes in the trace, so the screen showed three reasons to refuse
    /// beneath the word "accepted" and hid the payment, the convictions and
    /// the trust that actually carried it. A majority of the slots therefore
    /// goes to the side that won, which gives two properties this screen
    /// needs and the old rule did not have: a supporting reason is always
    /// visible when one exists at all, and a win carried by several smaller
    /// motives against fewer larger ones cannot vanish behind the ones it
    /// beat. One slot is deliberately left for the strongest opposing motive
    /// — "took it anyway, despite the risk" is the sentence this screen is
    /// for, and an explanation that only ever agreed with the outcome would
    /// be a different kind of lie.
    /// </remarks>
    private const int MinSupportingReasons = 2;

    /// <summary>
    /// The screen shown before there is a <see cref="ScenarioOutcome"/> to
    /// build one from — the one state <see cref="FromOutcome(ScenarioOutcome)"/>
    /// never produces (see the remarks on <see cref="ScreenState.Loading"/>).
    /// </summary>
    /// <remarks>
    /// Stated once, here, rather than hand-written by each side that needs it.
    /// It used to be written out twice — in <c>game/app/Main.cs</c> and again
    /// in the runtime harness's own expectation — and two hand-written copies
    /// of one value is the shape of drift this repository has already paid
    /// for once, with the terminal event's writer (ADR-008). The harness stays
    /// independent of the running game in the way that matters: it never asks
    /// the game what screen it built, it builds the model itself from this
    /// assembly, exactly as it already does for every other state through
    /// <see cref="FromOutcome(ScenarioOutcome)"/>.
    /// </remarks>
    public static ContractOfferScreenModel Loading { get; } = new()
    {
        State = ScreenState.Loading,
        TitleKey = TitleKey,
        Contract = null,
        Roster = ImmutableArray<HeroCard>.Empty,
        Responses = ImmutableArray<ResponseLine>.Empty,
        ErrorCode = null,
        ErrorDetail = null,
    };

    private static readonly JsonWriterOptions WriterOptions = new()
    {
        Indented = false,
        SkipValidation = false,
    };

    /// <summary>
    /// Builds the screen from a completed scenario run.
    /// </summary>
    /// <remarks>
    /// This factory represents one contract's offer at a time. Which contract
    /// is chosen from <see cref="OathAndCoin.Simulation.State.GameState.Contracts"/>:
    /// the one referenced by the outcome's first step when there is one; with
    /// no steps at all (nobody has been offered anything yet, but the content
    /// set still has contracts), the lexicographically-first one, since that
    /// dictionary is already sorted for exactly this kind of deterministic
    /// fallback. <see cref="ContractOfferScreenModel.Responses"/> is then
    /// filtered to steps that answered <em>that</em> contract specifically —
    /// a run that offered a second contract to other heroes must not leak
    /// their answers onto this screen, and completeness
    /// (<see cref="ScreenState.Incomplete"/> vs. <see cref="ScreenState.Normal"/>)
    /// is read from <see cref="ContractState.RespondedBy"/> — the engine's own
    /// deduplicated count of who has answered this contract — rather than
    /// from how many response lines this filter happened to keep, which would
    /// double-count a hero who somehow appears in more than one step.
    /// </remarks>
    public static ContractOfferScreenModel FromOutcome(ScenarioOutcome outcome)
    {
        ArgumentNullException.ThrowIfNull(outcome);

        var state = outcome.FinalState;

        // Both halves of the spec's own rule for this state: nothing to
        // offer, or nobody to offer it to. Only the first was implemented,
        // so a campaign with contracts and an empty roster fell through to
        // the path below, where `RespondedBy.Count >= roster.Length` reads
        // 0 >= 0 and reported Normal — a screen telling the player everyone
        // had answered, above an empty table.
        if (state.Contracts.IsEmpty || state.Heroes.IsEmpty)
        {
            return new ContractOfferScreenModel
            {
                State = ScreenState.Empty,
                TitleKey = TitleKey,
                Contract = null,
                Roster = ImmutableArray<HeroCard>.Empty,
                Responses = ImmutableArray<ResponseLine>.Empty,
                ErrorCode = null,
                ErrorDetail = null,
            };
        }

        var contract = ResolveContract(outcome, state);
        var contractLine = ToContractLine(contract);

        var roster = state.Heroes.Values.Select(hero => ToHeroCard(hero, state.TraitRules)).ToImmutableArray();

        // Review finding (Critical): a response line carries no display key
        // of its own — HeroState has one (HeroState.DisplayNameKey), a
        // StepOutcome does not — so it is joined here, by the hero's own
        // Definition, against the same roster this factory already built.
        // Built from state.Heroes directly rather than from roster (an
        // equivalent join key either way): resolving before ToHeroCard would
        // have meant threading the map through that method's own signature
        // for no benefit.
        var heroDisplayNameKeys = state.Heroes.Values.ToImmutableDictionary(
            hero => hero.Definition.Value, hero => hero.DisplayNameKey);

        var responses = outcome.Steps
            .Where(step => step.Decision is not null && step.Command.Contract == contract.Id)
            .Select(step => ToResponseLine(step, heroDisplayNameKeys))
            .ToImmutableArray();

        var screenState = contract.RespondedBy.Count >= roster.Length ? ScreenState.Normal : ScreenState.Incomplete;

        return new ContractOfferScreenModel
        {
            State = screenState,
            TitleKey = TitleKey,
            Contract = contractLine,
            Roster = roster,
            Responses = responses,
            ErrorCode = null,
            ErrorDetail = null,
        };
    }

    /// <summary>
    /// Builds the screen for a run that never reached a contract to offer at
    /// all — content failed to load, a scenario file was malformed, or
    /// similar (the same cases the old gate 0 spike's <c>FromError</c>
    /// covered). There is no <see cref="ScenarioOutcome"/> to build from in
    /// this case — the failure happens before one can exist — so this is an
    /// overload of <see cref="FromOutcome(ScenarioOutcome)"/> on the input
    /// this screen was actually built from, rather than a differently-named
    /// method: both answer the same question, "what happened when we tried
    /// to build this screen".
    /// </summary>
    /// <param name="failure">The stable error code, and the human-readable detail for a person reading the screen.</param>
    public static ContractOfferScreenModel FromOutcome((string ErrorCode, string ErrorDetail) failure)
    {
        ArgumentException.ThrowIfNullOrEmpty(failure.ErrorCode);
        ArgumentException.ThrowIfNullOrEmpty(failure.ErrorDetail);

        return new ContractOfferScreenModel
        {
            State = ScreenState.Error,
            TitleKey = TitleKey,
            Contract = null,
            Roster = ImmutableArray<HeroCard>.Empty,
            Responses = ImmutableArray<ResponseLine>.Empty,
            ErrorCode = failure.ErrorCode,
            ErrorDetail = failure.ErrorDetail,
        };
    }

    /// <summary>
    /// SHA-256 of the model's canonical JSON — every field a player can see
    /// except <see cref="ContractOfferScreenModel.ErrorDetail"/> (see its
    /// remarks) — including <see cref="ContractOfferScreenModel.State"/>
    /// itself: two models that differ only in which of the five states they
    /// are (e.g. <c>Incomplete</c> vs. <c>Normal</c> with the same roster)
    /// must never hash equal, or a screen that has not finished asking
    /// everyone would be indistinguishable from one that has.
    /// </summary>
    public static string ReadModelHash(ContractOfferScreenModel model)
    {
        ArgumentNullException.ThrowIfNull(model);

        var root = new JsonObject
        {
            ["state"] = model.State.ToString(),
            ["title_key"] = model.TitleKey,
            ["error_code"] = model.ErrorCode,
            ["contract"] = model.Contract is null ? null : DescribeContract(model.Contract),
            ["roster"] = new JsonArray(model.Roster.Select(DescribeHero).ToArray<JsonNode?>()),
            ["responses"] = new JsonArray(model.Responses.Select(DescribeResponse).ToArray<JsonNode?>()),
        };

        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream, WriterOptions))
        {
            CanonicalJson.Write(root, writer);
        }

        return Convert.ToHexString(SHA256.HashData(stream.ToArray())).ToLowerInvariant();
    }

    private static ContractState ResolveContract(ScenarioOutcome outcome, GameState state)
    {
        var contractId = outcome.Steps.Length > 0
            ? outcome.Steps[0].Command.Contract
            : state.Contracts.Keys.First();

        return state.Contracts[contractId];
    }

    /// <summary>
    /// Content follows a fixed <c>"contract.{namespace}.{name}.name"</c>
    /// convention for every shipped contract's own authored
    /// <c>display_name_key</c> (see <c>content/contracts/*.json</c>), but
    /// <see cref="ContractState"/> — unlike <see cref="HeroState"/>, which
    /// carries its own <see cref="HeroState.DisplayNameKey"/> — never copied
    /// that key from content into state, so there is nothing on the state
    /// this factory reads to carry it faithfully. This rebuilds it from the
    /// convention instead of leaving the field unset; see this task's report
    /// for why the real fix (carrying the key on <see cref="ContractState"/>
    /// itself) is left open. Internal, not private: the convention is
    /// otherwise invisible to any test — <c>EveryTagReasonAndGradeKeyExistsInTheCatalogue</c>
    /// asserts this reconstruction agrees with every shipped contract's own
    /// authored key, so an author spelling a key differently than this
    /// convention assumes fails loudly instead of shipping a screen that
    /// shows a key nobody translated.
    /// </summary>
    internal static string ContractDisplayNameKey(ContentId id) => $"contract.{id.Namespace}.{id.Name}.name";

    /// <summary>
    /// The same convention as <see cref="ContractDisplayNameKey"/>, for a
    /// trait. <see cref="HeldTrait"/> — the only shape of a trait this
    /// factory ever sees (ADR-002: the core, and therefore
    /// <see cref="OathAndCoin.Simulation.State.GameState.TraitRules"/>, never
    /// carries a content-side <c>TraitDefinition</c>) — has an <c>Id</c> but
    /// no authored display key, exactly like <see cref="ContractState"/>.
    /// </summary>
    internal static string TraitDisplayNameKey(ContentId id) => $"trait.{id.Namespace}.{id.Name}.name";

    private static ContractLine ToContractLine(ContractState contract) => new(
        contract.Id.Value,
        ContractDisplayNameKey(contract.Id),
        contract.Payment,
        QualitativeScale.ForValue(contract.Risk),
        contract.Tags.Select(TagKeys.For).ToImmutableArray(),
        contract.RequiredCrew,
        contract.AcceptedBy.Count);

    private static HeroCard ToHeroCard(HeroState hero, ImmutableSortedDictionary<ContentId, HeldTrait> traitRules) => new(
        hero.Definition.Value,
        hero.DisplayNameKey,
        QualitativeScale.ForValue(hero.Greed),
        QualitativeScale.ForValue(hero.Caution),
        QualitativeScale.ForValue(hero.Pride),
        TraitKeys(hero, traitRules, principle: true),
        TraitKeys(hero, traitRules, principle: false));

    /// <summary>
    /// A hero's own principle or inclination keys, named from each trait's
    /// own identifier (<see cref="TraitDisplayNameKey"/>) — not its tag: the
    /// tag is what a <em>contract</em> latches onto (HERO_DECISION_SPEC §1.1), and reusing
    /// it here would name a hero's principle after the category it reacts
    /// to (e.g. "Temple") rather than the principle itself (e.g. "will not
    /// strike a temple") — a different piece of content with a different
    /// authored name.
    /// </summary>
    private static ImmutableArray<string> TraitKeys(
        HeroState hero, ImmutableSortedDictionary<ContentId, HeldTrait> traitRules, bool principle) =>
        hero.Traits
            .Select(id => ResolveTrait(hero, id, traitRules))
            .Where(trait => trait.IsPrinciple == principle)
            .OrderBy(trait => trait.Id)
            .Select(trait => TraitDisplayNameKey(trait.Id))
            .ToImmutableArray();

    /// <summary>
    /// A bare indexer here would surface a missing id as a bare
    /// <see cref="KeyNotFoundException"/> with no clue which id, which hero,
    /// or where the rulebook is even filled — the same failure mode
    /// <see cref="OathAndCoin.Simulation.SimulationEngine.Apply(OathAndCoin.Simulation.State.GameState,OathAndCoin.Simulation.Commands.ProposeContractToHero)"/>
    /// already guards against for the identical lookup. A hero naming a
    /// trait id absent from <c>TraitRules</c> is a content-loading bug, not
    /// a hero with no opinion, so this fails loudly, with enough to find the
    /// cause.
    /// </summary>
    private static HeldTrait ResolveTrait(
        HeroState hero, ContentId traitId, ImmutableSortedDictionary<ContentId, HeldTrait> traitRules) =>
        traitRules.TryGetValue(traitId, out var trait)
            ? trait
            : throw new InvalidOperationException(
                $"Hero '{hero.Definition}' carries trait id '{traitId}', but GameState.TraitRules has no "
                + "entry for it — a content-loading bug, not a hero with no opinion.");

    private static ResponseLine ToResponseLine(
        StepOutcome step, IReadOnlyDictionary<string, string> heroDisplayNameKeys)
    {
        var decision = step.Decision!;
        var hero = step.HeroDefinition
            ?? throw new InvalidOperationException(
                $"Step {step.Command.CommandId} produced a decision without a resolved hero — "
                + "ScenarioRunner should never return that combination.");

        // A bare indexer here would surface a hero missing from the roster
        // as a bare KeyNotFoundException with no clue which hero or which
        // step — the same "should never happen, but name it when it does"
        // stance ResolveTrait already takes for the identical shape of
        // lookup. A step naming a hero absent from state.Heroes is a
        // ScenarioRunner bug (it resolved HeroDefinition from that same
        // dictionary), not a hero this screen has no name for.
        var heroDisplayNameKey = heroDisplayNameKeys.TryGetValue(hero.Value, out var key)
            ? key
            : throw new InvalidOperationException(
                $"Step {step.Command.CommandId} answered for hero '{hero.Value}', but the roster this "
                + "factory built has no display-name key for it — a content-loading or roster-building bug, "
                + "not a hero with no name.");

        if (!decision.Trace.BlockedBy.IsEmpty)
        {
            // A red line closes the decision before any score or mood exists
            // (HERO_DECISION_SPEC §2.2): no reasons to rank, and Wavered is false without
            // computing anything, never a guess. The block's own SourceEntity
            // is always a principle's trait id (ContractDecisionRule.Decide's
            // gate: BlockedBy is only ever built from trait.Id), so its
            // display name resolves the same way a trait-sourced
            // ReasonLine's does — see ReasonLine.SourceDisplayNameKey's
            // remarks and HERO_DECISION_SPEC §3 on why a block names an entity at all.
            var block = decision.Trace.BlockedBy[0];
            return new ResponseLine(
                hero.Value, heroDisplayNameKey, decision.SelectedAction.Value, ImmutableArray<ReasonLine>.Empty,
                block.SourceEntity.Value, TraitDisplayNameKey(block.SourceEntity), Wavered: false);
        }

        return new ResponseLine(
            hero.Value,
            heroDisplayNameKey,
            decision.SelectedAction.Value,
            RankReasons(decision.Trace, decision.SelectedAction, heroDisplayNameKeys),
            BlockedByEntity: null,
            BlockedByDisplayNameKey: null,
            Wavered: ComputeWavered(decision));
    }

    /// <summary>
    /// Reason codes whose <see cref="TraceFactor.SourceEntity"/> is always a
    /// trait id (<see cref="ContractDecisionRule.Decide"/>'s own inclination
    /// walk: <c>trait.Id</c>, never anything else) — see
    /// <see cref="ResolveSourceDisplayNameKey"/>.
    /// </summary>
    private static readonly ImmutableHashSet<string> TraitSourcedReasonCodes = ImmutableHashSet.Create(
        StringComparer.Ordinal, ReasonCodes.PersonalConviction, ReasonCodes.PersonalAversion);

    /// <summary>
    /// Reason codes whose source is always a comrade — a different hero,
    /// never the one answering (<see cref="ContractDecisionRule.Decide"/>'s
    /// own bonds walk: <c>comrade</c>, resolved through <c>Crew</c>, which
    /// that method itself never lets hold anyone absent from the roster).
    /// </summary>
    private static readonly ImmutableHashSet<string> ComradeSourcedReasonCodes = ImmutableHashSet.Create(
        StringComparer.Ordinal, ReasonCodes.StandsWithComrade, ReasonCodes.WillNotWorkWith);

    /// <summary>
    /// The reasons this answer shows, in the order a player reads them: the
    /// motives that supported the chosen action first, strongest first, then
    /// the strongest that argued against it.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Which side a factor is on is decided here, once, from the action the
    /// hero actually chose — <see cref="CausalTrace.PositiveFactors"/> pull
    /// toward <see cref="Actions.Accept"/> and
    /// <see cref="CausalTrace.NegativeFactors"/> toward
    /// <see cref="Actions.Decline"/> (HERO_DECISION_SPEC §2.3), so on a
    /// refusal it is the negative list that supported the answer. The screen
    /// never repeats this reasoning: it reads
    /// <see cref="ReasonLine.Direction"/>.
    /// </para>
    /// <para>
    /// How many of each side are shown is <see cref="MinSupportingReasons"/>'s
    /// business (see its remarks for the finding that produced the split).
    /// Slots one side cannot fill go to the other, so a trace with nothing
    /// against still shows three supporting reasons rather than two and a
    /// gap.
    /// </para>
    /// <para>
    /// Inside each side the order is the full one the read-model hash needs:
    /// strongest first, ties broken ordinally by reason code, and — because
    /// two factors can share both a magnitude and a reason code (e.g. two
    /// different comrades each pulling <see cref="ReasonCodes.StandsWithComrade"/>
    /// by the same weight) — ties on both of those broken ordinally by source
    /// entity. Without every tie-break stated, two identical runs could rank
    /// a tied pair in either order and disagree with themselves, which is
    /// exactly what a hash comparison between two independently built models
    /// cannot tolerate. Each side is capped only after sorting, so the ones
    /// shown are always that side's strongest, never whichever the trace
    /// happened to compute first.
    /// </para>
    /// </remarks>
    private static ImmutableArray<ReasonLine> RankReasons(
        CausalTrace trace, ContentId selectedAction, IReadOnlyDictionary<string, string> heroDisplayNameKeys)
    {
        var accepted = selectedAction == Actions.Accept;
        var supporting = Ranked(accepted ? trace.PositiveFactors : trace.NegativeFactors);
        var opposing = Ranked(accepted ? trace.NegativeFactors : trace.PositiveFactors);

        // Read in this order: the counter-argument may take what is left over
        // once the supporting side has had its share, and then the supporting
        // side takes back anything the counter-argument could not fill — and
        // vice versa. Both directions are needed: either list can be shorter
        // than its allowance.
        var opposingShown = Math.Min(opposing.Length, MaxReasons - MinSupportingReasons);
        var supportingShown = Math.Min(supporting.Length, MaxReasons - opposingShown);
        opposingShown = Math.Min(opposing.Length, MaxReasons - supportingShown);

        return supporting.Take(supportingShown)
            .Select(factor => ToReasonLine(factor, ReasonDirection.Supported, heroDisplayNameKeys))
            .Concat(opposing.Take(opposingShown)
                .Select(factor => ToReasonLine(factor, ReasonDirection.Opposed, heroDisplayNameKeys)))
            .ToImmutableArray();
    }

    private static ImmutableArray<TraceFactor> Ranked(ImmutableArray<TraceFactor> factors) =>
        factors
            .OrderByDescending(factor => factor.Magnitude)
            .ThenBy(factor => factor.ReasonCode, StringComparer.Ordinal)
            .ThenBy(factor => factor.SourceEntity)
            .ToImmutableArray();

    private static ReasonLine ToReasonLine(
        TraceFactor factor, ReasonDirection direction, IReadOnlyDictionary<string, string> heroDisplayNameKeys) =>
        new(
            factor.ReasonCode,
            factor.SourceEntity.Value,
            QualitativeScale.ForMagnitude(factor.Magnitude),
            ResolveSourceDisplayNameKey(factor, heroDisplayNameKeys),
            direction);

    /// <summary>
    /// The fact <see cref="ReasonLine.SourceDisplayNameKey"/>'s own remarks
    /// promise is a model fact, not a screen branch: whether a reason's
    /// source is worth naming depends only on which kind of thing
    /// <see cref="TraceFactor.SourceEntity"/> names, and this is the one
    /// place that classification lives, closed over
    /// <see cref="ContractDecisionRule.Decide"/>'s own five source shapes
    /// (contract, the responding hero itself, a trait, a comrade — the
    /// fifth, a blocking principle, never reaches here at all; see
    /// <see cref="ToResponseLine"/>). Contract- and self-sourced reasons
    /// resolve to <c>null</c>: both are already named elsewhere on the same
    /// screen (<see cref="ContractLine.DisplayNameKey"/>,
    /// <see cref="ResponseLine.HeroDisplayNameKey"/>), so repeating either
    /// here would not explain anything a player does not already see.
    /// </summary>
    /// <exception cref="InvalidOperationException">
    /// The reason names a comrade absent from <paramref name="heroDisplayNameKeys"/> —
    /// a content-loading or roster-building bug (see
    /// <see cref="ContractDecisionRule.Decide"/>'s own, identical guarantee
    /// for <c>Crew</c>), not a comrade with no name.
    /// </exception>
    private static string? ResolveSourceDisplayNameKey(
        TraceFactor factor, IReadOnlyDictionary<string, string> heroDisplayNameKeys)
    {
        if (TraitSourcedReasonCodes.Contains(factor.ReasonCode))
        {
            return TraitDisplayNameKey(factor.SourceEntity);
        }

        if (ComradeSourcedReasonCodes.Contains(factor.ReasonCode))
        {
            return heroDisplayNameKeys.TryGetValue(factor.SourceEntity.Value, out var key)
                ? key
                : throw new InvalidOperationException(
                    $"Reason '{factor.ReasonCode}' names comrade '{factor.SourceEntity.Value}' as its source, "
                    + "but the roster this factory built has no display-name key for it — a content-loading "
                    + "or roster-building bug, not a comrade with no name.");
        }

        // PaymentAttractive/RiskTooHigh/PaymentInsulting name the contract;
        // TrustsTheGuild/UnpredictableMood name the responding hero itself.
        // Both are already on screen under their own key.
        return null;
    }

    /// <summary>
    /// Whether this hero's mood flipped the answer the rest of the factors
    /// alone would have given (HERO_DECISION_SPEC §2.4). Mood already sits in the trace as
    /// an ordinary factor, and every factor in the trace sums to
    /// <see cref="DecisionResult.SelectedScore"/> (HERO_DECISION_SPEC §2.3) — so the score
    /// <em>before</em> mood is exactly <c>final − mood</c>, computable from
    /// data that already went into the decision, never re-derived or
    /// guessed. "Wavered" is then just: did crossing zero change between
    /// that reconstructed score and the final one.
    /// </summary>
    private static bool ComputeWavered(DecisionResult decision)
    {
        var finalScore = decision.SelectedScore
            ?? throw new InvalidOperationException(
                "ComputeWavered must not be called for a blocked decision — the caller already returns "
                + "before reaching here for that case.");

        var moodPositive = decision.Trace.PositiveFactors
            .FirstOrDefault(factor => factor.ReasonCode == ReasonCodes.UnpredictableMood);
        var moodNegative = decision.Trace.NegativeFactors
            .FirstOrDefault(factor => factor.ReasonCode == ReasonCodes.UnpredictableMood);

        var mood = moodPositive is not null
            ? moodPositive.Magnitude
            : moodNegative is not null ? -moodNegative.Magnitude : 0;

        var scoreBeforeMood = finalScore - mood;

        return (scoreBeforeMood >= 0) != (finalScore >= 0);
    }

    private static JsonObject DescribeContract(ContractLine contract) => new()
    {
        ["definition"] = contract.Definition,
        ["display_name_key"] = contract.DisplayNameKey,
        ["payment"] = contract.Payment,
        ["risk"] = contract.Risk.ToString(),
        ["tag_keys"] = new JsonArray(contract.TagKeys.Select(key => (JsonNode?)key).ToArray()),
        ["required_crew"] = contract.RequiredCrew,
        ["accepted_count"] = contract.AcceptedCount,
    };

    private static JsonObject DescribeHero(HeroCard hero) => new()
    {
        ["definition"] = hero.Definition,
        ["display_name_key"] = hero.DisplayNameKey,
        ["greed"] = hero.Greed.ToString(),
        ["caution"] = hero.Caution.ToString(),
        ["pride"] = hero.Pride.ToString(),
        ["principle_keys"] = new JsonArray(hero.PrincipleKeys.Select(key => (JsonNode?)key).ToArray()),
        ["inclination_keys"] = new JsonArray(hero.InclinationKeys.Select(key => (JsonNode?)key).ToArray()),
    };

    private static JsonObject DescribeResponse(ResponseLine response) => new()
    {
        ["hero_definition"] = response.HeroDefinition,
        ["hero_display_name_key"] = response.HeroDisplayNameKey,
        ["action"] = response.Action,
        ["reasons"] = new JsonArray(response.Reasons.Select(DescribeReason).ToArray<JsonNode?>()),
        ["blocked_by_entity"] = response.BlockedByEntity,
        ["blocked_by_display_name_key"] = response.BlockedByDisplayNameKey,
        ["wavered"] = response.Wavered,
    };

    private static JsonObject DescribeReason(ReasonLine reason) => new()
    {
        ["reason_code"] = reason.ReasonCode,
        ["source_entity"] = reason.SourceEntity,
        ["strength"] = reason.Strength.ToString(),
        ["source_display_name_key"] = reason.SourceDisplayNameKey,
        ["direction"] = reason.Direction.ToString(),
    };
}
