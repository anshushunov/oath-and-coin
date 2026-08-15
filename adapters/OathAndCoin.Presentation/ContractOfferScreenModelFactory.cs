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
    /// never resolves one.
    /// </summary>
    private const string TitleKey = "screen.contract_offer.title";

    /// <summary>
    /// How many reasons a response line shows at most (spec: an explanation a
    /// player can actually hold in mind, not the whole trace dumped
    /// verbatim). Applied after ranking, so the three shown are always the
    /// three strongest.
    /// </summary>
    private const int MaxReasons = 3;

    private static readonly JsonWriterOptions WriterOptions = new()
    {
        Indented = false,
        SkipValidation = false,
    };

    /// <summary>
    /// Builds the screen from a completed scenario run.
    /// </summary>
    /// <remarks>
    /// This factory represents one contract's offer at a time — the one
    /// referenced by the outcome's own steps (all of which are expected to
    /// offer the same contract; a scenario that proposes more than one
    /// contract to a single roster is not a shape this screen has to
    /// represent yet). When there are steps to read the contract from, the
    /// first one's <see cref="ScenarioCommand.Contract"/> wins; with none at
    /// all (nobody has been offered anything yet, but the content set still
    /// has contracts), the lexicographically-first one is shown, since
    /// <see cref="OathAndCoin.Simulation.State.GameState.Contracts"/> is
    /// already sorted for exactly this kind of deterministic fallback.
    /// </remarks>
    public static ContractOfferScreenModel FromOutcome(ScenarioOutcome outcome)
    {
        ArgumentNullException.ThrowIfNull(outcome);

        var state = outcome.FinalState;

        if (state.Contracts.IsEmpty)
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

        var responses = outcome.Steps
            .Where(step => step.Decision is not null)
            .Select(ToResponseLine)
            .ToImmutableArray();

        var screenState = responses.Length >= roster.Length ? ScreenState.Normal : ScreenState.Incomplete;

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
    /// for why that is flagged as open rather than settled.
    /// </summary>
    private static string ContractDisplayNameKey(ContentId id) => $"contract.{id.Namespace}.{id.Name}.name";

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
        TraitKeys(hero.Traits, traitRules, principle: true),
        TraitKeys(hero.Traits, traitRules, principle: false));

    private static ImmutableArray<string> TraitKeys(
        ImmutableArray<ContentId> traits, ImmutableSortedDictionary<ContentId, HeldTrait> traitRules, bool principle) =>
        traits
            .Select(id => traitRules[id])
            .Where(trait => trait.IsPrinciple == principle)
            .OrderBy(trait => trait.Tag)
            .Select(trait => TagKeys.For(trait.Tag))
            .ToImmutableArray();

    private static ResponseLine ToResponseLine(StepOutcome step)
    {
        var decision = step.Decision!;
        var hero = step.HeroDefinition
            ?? throw new InvalidOperationException(
                $"Step {step.Command.CommandId} produced a decision without a resolved hero — "
                + "ScenarioRunner should never return that combination.");

        if (!decision.Trace.BlockedBy.IsEmpty)
        {
            // A red line closes the decision before any score or mood exists
            // (spec §3.2): no reasons to rank, and Wavered is false without
            // computing anything, never a guess.
            var block = decision.Trace.BlockedBy[0];
            return new ResponseLine(
                hero.Value, decision.SelectedAction.Value, ImmutableArray<ReasonLine>.Empty,
                block.SourceEntity.Value, Wavered: false);
        }

        return new ResponseLine(
            hero.Value,
            decision.SelectedAction.Value,
            RankReasons(decision.Trace),
            BlockedByEntity: null,
            Wavered: ComputeWavered(decision));
    }

    /// <summary>
    /// Reasons in the order a player reads them: strongest factor first,
    /// ties broken ordinally by reason code, and — because two factors can
    /// share both a magnitude and a reason code (e.g. two different comrades
    /// each pulling <see cref="ReasonCodes.StandsWithComrade"/> by the same
    /// weight) — ties on both of those broken ordinally by source entity.
    /// Without every tie-break stated, two identical runs could rank a tied
    /// pair in either order and disagree with themselves, which is exactly
    /// what a hash comparison between two independently built models cannot
    /// tolerate. Capped at <see cref="MaxReasons"/> only after sorting, so
    /// the reasons shown are always the strongest, never whichever three the
    /// trace happened to compute first.
    /// </summary>
    private static ImmutableArray<ReasonLine> RankReasons(CausalTrace trace) =>
        trace.PositiveFactors
            .Concat(trace.NegativeFactors)
            .OrderByDescending(factor => factor.Magnitude)
            .ThenBy(factor => factor.ReasonCode, StringComparer.Ordinal)
            .ThenBy(factor => factor.SourceEntity)
            .Take(MaxReasons)
            .Select(factor => new ReasonLine(factor.ReasonCode, factor.SourceEntity.Value, QualitativeScale.ForMagnitude(factor.Magnitude)))
            .ToImmutableArray();

    /// <summary>
    /// Whether this hero's mood flipped the answer the rest of the factors
    /// alone would have given (spec §3.4). Mood already sits in the trace as
    /// an ordinary factor, and every factor in the trace sums to
    /// <see cref="DecisionResult.SelectedScore"/> (spec §3.3) — so the score
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
        ["action"] = response.Action,
        ["reasons"] = new JsonArray(response.Reasons.Select(DescribeReason).ToArray<JsonNode?>()),
        ["blocked_by_entity"] = response.BlockedByEntity,
        ["wavered"] = response.Wavered,
    };

    private static JsonObject DescribeReason(ReasonLine reason) => new()
    {
        ["reason_code"] = reason.ReasonCode,
        ["source_entity"] = reason.SourceEntity,
        ["strength"] = reason.Strength.ToString(),
    };
}
