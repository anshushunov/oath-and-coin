using System.Collections.Immutable;
using OathAndCoin.Content;
using OathAndCoin.Content.Scenarios;
using OathAndCoin.Content.Tests;
using OathAndCoin.Simulation.Decisions;
using OathAndCoin.Simulation.Events;
using OathAndCoin.Simulation.Ids;
using OathAndCoin.Simulation.State;
using Factory = OathAndCoin.Presentation.ContractOfferScreenModelFactory;

namespace OathAndCoin.Presentation.Tests;

/// <summary>
/// The engine-free read model for the contract-offer screen: the five
/// screen states, ranked reasons, the "wavered" flag derived from the same
/// trace that produced the decision, and the read-model hash a tool process
/// and the running game compare to prove they built the same screen.
/// </summary>
public class ContractOfferScreenModelTests
{
    [Theory]
    [InlineData(0, QualitativeGrade.Negligible)]
    [InlineData(9, QualitativeGrade.Negligible)]
    [InlineData(10, QualitativeGrade.Low)]
    [InlineData(34, QualitativeGrade.Low)]
    [InlineData(35, QualitativeGrade.Moderate)]
    [InlineData(64, QualitativeGrade.Moderate)]
    [InlineData(65, QualitativeGrade.High)]
    [InlineData(89, QualitativeGrade.High)]
    [InlineData(90, QualitativeGrade.Extreme)]
    [InlineData(100, QualitativeGrade.Extreme)]
    public void ForValue_MapsTheHeroScale(int value, QualitativeGrade expected) =>
        Assert.Equal(expected, QualitativeScale.ForValue(value));

    [Theory]
    [InlineData(1, QualitativeGrade.Negligible)]
    [InlineData(4, QualitativeGrade.Negligible)]
    [InlineData(5, QualitativeGrade.Low)]
    [InlineData(14, QualitativeGrade.Low)]
    [InlineData(15, QualitativeGrade.Moderate)]
    [InlineData(29, QualitativeGrade.Moderate)]
    [InlineData(30, QualitativeGrade.High)]
    [InlineData(59, QualitativeGrade.High)]
    [InlineData(60, QualitativeGrade.Extreme)]
    [InlineData(9999, QualitativeGrade.Extreme)]
    public void ForMagnitude_MapsReasonStrength(int magnitude, QualitativeGrade expected) =>
        Assert.Equal(expected, QualitativeScale.ForMagnitude(magnitude));

    [Fact]
    public void TagKeys_BuildsTheLocalizationKeyFromTheIdentifier() =>
        Assert.Equal("tag.target.cult", TagKeys.For(ContentId.Parse("target:cult")));

    [Fact]
    public void EveryTagReasonAndGradeKeyExistsInTheCatalogue()
    {
        var content = ContentSet.Load(RepositoryFixtures.ContentRoot);
        var catalogue = LocaleCatalogue.Load(RepositoryFixtures.LocaleFile("ru"));

        var keys = content.Contracts.Values.SelectMany(c => c.Tags).Select(TagKeys.For)
            .Concat(content.Traits.Values.Select(t => TagKeys.For(t.Tag)))
            .Concat(ReasonCodes.All)
            .Concat(QualitativeScale.AllKeys);

        foreach (var key in keys)
        {
            Assert.True(catalogue.ContainsKey(key), $"Locale 'ru' has no entry for '{key}'.");
        }
    }

    [Fact]
    public void FromOutcome_RanksReasonsByMagnitudeThenCodeThenSource()
    {
        var model = Factory.FromOutcome(Outcomes.MixedReasons());

        var line = model.Responses.Single(r => r.HeroDefinition == "core:bram");
        Assert.Equal(
            new[] { ReasonCodes.RiskTooHigh, ReasonCodes.PaymentAttractive, ReasonCodes.TrustsTheGuild },
            line.Reasons.Select(r => r.ReasonCode).ToArray());
    }

    /// <summary>
    /// Not part of the brief's own Step 2 list — added because the brief's own
    /// warning applies to <see cref="FromOutcome_RanksReasonsByMagnitudeThenCodeThenSource"/>
    /// word for word: its fixture (<c>Outcomes.MixedReasons</c>) uses three
    /// distinct magnitudes, so it passes just as well under
    /// "sort by magnitude alone" as under the full rule — deleting the
    /// <c>ThenBy</c> tie-breaks from
    /// <c>ContractOfferScreenModelFactory.RankReasons</c> leaves it green.
    /// This test's fixture ties magnitude deliberately, so the ordinal
    /// reason-code tie-break actually has something to prove.
    /// </summary>
    [Fact]
    public void FromOutcome_BreaksEqualMagnitudeTiesByReasonCodeOrdinal()
    {
        var line = Factory.FromOutcome(Outcomes.TiedByMagnitude()).Responses.Single();

        Assert.Equal(
            new[] { ReasonCodes.PaymentAttractive, ReasonCodes.UnpredictableMood },
            line.Reasons.Select(r => r.ReasonCode).ToArray());
    }

    /// <summary>
    /// The second half of the same warning: two factors can share both a
    /// magnitude and a reason code (two comrades each pulling
    /// <see cref="ReasonCodes.StandsWithComrade"/> by the same weight), and
    /// without the source-entity tie-break those two could still print in
    /// either order between runs.
    /// </summary>
    [Fact]
    public void FromOutcome_BreaksEqualMagnitudeAndCodeTiesBySourceEntityOrdinal()
    {
        var line = Factory.FromOutcome(Outcomes.TiedByMagnitudeAndCode()).Responses.Single();

        Assert.Equal(
            new[] { "core:doran", "core:zara" },
            line.Reasons.Select(r => r.SourceEntity).ToArray());
    }

    [Fact]
    public void FromOutcome_ShowsAtMostThreeReasons()
    {
        var line = Factory.FromOutcome(Outcomes.ManyReasons()).Responses.Single();

        Assert.True(line.Reasons.Length <= 3);
    }

    [Fact]
    public void FromOutcome_PutsAPrincipleInItsOwnFieldNotAmongReasons()
    {
        var line = Factory.FromOutcome(Outcomes.PrincipleBlocked()).Responses.Single();

        Assert.Empty(line.Reasons);
        Assert.Equal("core:will_not_strike_a_temple", line.BlockedByEntity);
        Assert.False(line.Wavered);
    }

    [Fact]
    public void FromOutcome_MarksWaveredWhenMoodFlippedTheAnswer()
    {
        // score = 2 before mood, mood = -5 → final = -3: the answer flipped.
        var line = Factory.FromOutcome(Outcomes.MoodFlipped()).Responses.Single();

        Assert.True(line.Wavered);
    }

    [Fact]
    public void FromOutcome_DoesNotMarkWaveredWhenMoodOnlyMovedTheNumber()
    {
        // score = 40 before mood, mood = -5 → final = 35: same answer.
        var line = Factory.FromOutcome(Outcomes.MoodIrrelevant()).Responses.Single();

        Assert.False(line.Wavered);
    }

    [Fact]
    public void FromOutcome_ReportsIncompleteUntilEveryOfferedHeroAnswered()
    {
        Assert.Equal(ScreenState.Incomplete, Factory.FromOutcome(Outcomes.OneOfFourAnswered()).State);
        Assert.Equal(ScreenState.Normal, Factory.FromOutcome(Outcomes.AllAnswered()).State);
    }

    [Fact]
    public void FromOutcome_ReportsEmptyWhenTheSetHasNoContracts()
    {
        Assert.Equal(ScreenState.Empty, Factory.FromOutcome(Outcomes.NoContracts()).State);
    }

    [Fact]
    public void ReadModelHash_IgnoresErrorDetailButNotErrorCode()
    {
        var a = Outcomes.Failed("CONTENT_ROOT_NOT_FOUND", "C:/one");
        var b = Outcomes.Failed("CONTENT_ROOT_NOT_FOUND", "C:/two");
        var c = Outcomes.Failed("CONTENT_UNREADABLE", "C:/one");

        Assert.Equal(Factory.ReadModelHash(Factory.FromOutcome(a)), Factory.ReadModelHash(Factory.FromOutcome(b)));
        Assert.NotEqual(Factory.ReadModelHash(Factory.FromOutcome(a)), Factory.ReadModelHash(Factory.FromOutcome(c)));
    }

    [Fact]
    public void ReadModelHash_CoversTheState()
    {
        var incomplete = Factory.FromOutcome(Outcomes.OneOfFourAnswered());
        var normal = Factory.FromOutcome(Outcomes.AllAnswered());

        Assert.NotEqual(Factory.ReadModelHash(incomplete), Factory.ReadModelHash(normal));
    }

    /// <summary>
    /// Hand-built <see cref="ScenarioOutcome"/>s for each Step 2 test, in the
    /// same spirit as
    /// <c>SpikeScreenModelTests.FromOutcome_BreaksEqualMagnitudeTiesByReasonCodeOrdinal</c>:
    /// built directly from the simulation's own types rather than run
    /// through <see cref="ScenarioRunner"/>, so each fixture states exactly
    /// the one shape its test needs and nothing <see cref="ContractDecisionRule"/>
    /// happens to produce today. <see cref="Failed"/> is the one exception —
    /// it returns the (code, detail) pair <see cref="Factory.FromOutcome(ValueTuple{string,string})"/>
    /// builds an <see cref="ScreenState.Error"/> model from directly, for a
    /// failure that happens before any <see cref="ScenarioOutcome"/> could
    /// exist (content never loaded) and so has no outcome shape to build one
    /// from at all.
    /// </summary>
    private static class Outcomes
    {
        private static readonly ContentId Contract = ContentId.Parse("core:escort_the_caravan");

        public static ScenarioOutcome MixedReasons()
        {
            var bram = ContentId.Parse("core:bram");

            var trace = new CausalTrace
            {
                TraceId = 0,
                PositiveFactors = ImmutableArray.Create(
                    new TraceFactor(ReasonCodes.PaymentAttractive, Contract, 20),
                    new TraceFactor(ReasonCodes.TrustsTheGuild, bram, 5)),
                NegativeFactors = ImmutableArray.Create(
                    new TraceFactor(ReasonCodes.RiskTooHigh, Contract, 30)),
                BlockedBy = ImmutableArray<TraceBlock>.Empty,
            };

            var decision = new DecisionResult
            {
                SelectedAction = Actions.Decline,
                ConsideredActions = ImmutableArray.Create(Actions.Accept, Actions.Decline),
                SelectedScore = -5,
                Trace = trace,
            };

            return Single(Hero(0, "bram"), decision);
        }

        public static ScenarioOutcome TiedByMagnitude()
        {
            var mira = ContentId.Parse("core:mira");

            // Inserted (mood, payment) — the opposite of what ordinal-by-code
            // demands, since "hero.decision.payment_attractive" sorts before
            // "hero.decision.unpredictable_mood".
            var trace = new CausalTrace
            {
                TraceId = 0,
                PositiveFactors = ImmutableArray.Create(
                    new TraceFactor(ReasonCodes.UnpredictableMood, mira, 5),
                    new TraceFactor(ReasonCodes.PaymentAttractive, Contract, 5)),
                NegativeFactors = ImmutableArray<TraceFactor>.Empty,
                BlockedBy = ImmutableArray<TraceBlock>.Empty,
            };

            var decision = new DecisionResult
            {
                SelectedAction = Actions.Accept,
                ConsideredActions = ImmutableArray.Create(Actions.Accept, Actions.Decline),
                SelectedScore = 10,
                Trace = trace,
            };

            return Single(Hero(0, "mira"), decision);
        }

        public static ScenarioOutcome TiedByMagnitudeAndCode()
        {
            var zara = ContentId.Parse("core:zara");
            var doran = ContentId.Parse("core:doran");

            // Both StandsWithComrade at the same weight, inserted (zara,
            // doran) — the opposite of "core:doran" sorting before
            // "core:zara" ordinally.
            var trace = new CausalTrace
            {
                TraceId = 0,
                PositiveFactors = ImmutableArray.Create(
                    new TraceFactor(ReasonCodes.StandsWithComrade, zara, 5),
                    new TraceFactor(ReasonCodes.StandsWithComrade, doran, 5)),
                NegativeFactors = ImmutableArray<TraceFactor>.Empty,
                BlockedBy = ImmutableArray<TraceBlock>.Empty,
            };

            var decision = new DecisionResult
            {
                SelectedAction = Actions.Accept,
                ConsideredActions = ImmutableArray.Create(Actions.Accept, Actions.Decline),
                SelectedScore = 10,
                Trace = trace,
            };

            return Single(Hero(0, "kestrel"), decision);
        }

        public static ScenarioOutcome ManyReasons()
        {
            var doran = ContentId.Parse("core:doran");
            var trait = ContentId.Parse("core:hungry_for_renown");

            var trace = new CausalTrace
            {
                TraceId = 0,
                PositiveFactors = ImmutableArray.Create(
                    new TraceFactor(ReasonCodes.PaymentAttractive, Contract, 50),
                    new TraceFactor(ReasonCodes.TrustsTheGuild, doran, 10),
                    new TraceFactor(ReasonCodes.PersonalConviction, trait, 3)),
                NegativeFactors = ImmutableArray.Create(
                    new TraceFactor(ReasonCodes.RiskTooHigh, Contract, 40),
                    new TraceFactor(ReasonCodes.PaymentInsulting, Contract, 8)),
                BlockedBy = ImmutableArray<TraceBlock>.Empty,
            };

            var decision = new DecisionResult
            {
                SelectedAction = Actions.Accept,
                ConsideredActions = ImmutableArray.Create(Actions.Accept, Actions.Decline),
                SelectedScore = 15,
                Trace = trace,
            };

            return Single(Hero(0, "doran"), decision);
        }

        public static ScenarioOutcome PrincipleBlocked()
        {
            var zara = ContentId.Parse("core:zara");
            var principle = ContentId.Parse("core:will_not_strike_a_temple");

            var decision = new DecisionResult
            {
                SelectedAction = Actions.Decline,
                ConsideredActions = ImmutableArray.Create(Actions.Accept, Actions.Decline),
                SelectedScore = null,
                Trace = new CausalTrace
                {
                    TraceId = 0,
                    PositiveFactors = ImmutableArray<TraceFactor>.Empty,
                    NegativeFactors = ImmutableArray<TraceFactor>.Empty,
                    BlockedBy = ImmutableArray.Create(new TraceBlock(ReasonCodes.PrincipleForbids, principle)),
                },
            };

            return Single(Hero(0, "zara"), decision);
        }

        public static ScenarioOutcome MoodFlipped()
        {
            var mira = ContentId.Parse("core:mira");

            var trace = new CausalTrace
            {
                TraceId = 0,
                PositiveFactors = ImmutableArray.Create(new TraceFactor(ReasonCodes.PaymentAttractive, Contract, 2)),
                NegativeFactors = ImmutableArray.Create(new TraceFactor(ReasonCodes.UnpredictableMood, mira, 5)),
                BlockedBy = ImmutableArray<TraceBlock>.Empty,
            };

            var decision = new DecisionResult
            {
                SelectedAction = Actions.Decline,
                ConsideredActions = ImmutableArray.Create(Actions.Accept, Actions.Decline),
                SelectedScore = -3,
                Trace = trace,
            };

            return Single(Hero(0, "mira"), decision);
        }

        public static ScenarioOutcome MoodIrrelevant()
        {
            var ilsa = ContentId.Parse("core:ilsa");

            var trace = new CausalTrace
            {
                TraceId = 0,
                PositiveFactors = ImmutableArray.Create(new TraceFactor(ReasonCodes.PaymentAttractive, Contract, 40)),
                NegativeFactors = ImmutableArray.Create(new TraceFactor(ReasonCodes.UnpredictableMood, ilsa, 5)),
                BlockedBy = ImmutableArray<TraceBlock>.Empty,
            };

            var decision = new DecisionResult
            {
                SelectedAction = Actions.Accept,
                ConsideredActions = ImmutableArray.Create(Actions.Accept, Actions.Decline),
                SelectedScore = 35,
                Trace = trace,
            };

            return Single(Hero(0, "ilsa"), decision);
        }

        public static ScenarioOutcome OneOfFourAnswered() => Roster(answered: 1);

        public static ScenarioOutcome AllAnswered() => Roster(answered: 4);

        public static ScenarioOutcome NoContracts()
        {
            var heroes = ImmutableSortedDictionary.CreateRange(new[]
            {
                new KeyValuePair<HeroId, HeroState>(new HeroId(0), Hero(0, "bram")),
            });

            var state = BuildState(heroes, ImmutableSortedDictionary<ContentId, ContractState>.Empty);

            return new ScenarioOutcome(state, ImmutableArray<StepOutcome>.Empty);
        }

        public static (string ErrorCode, string ErrorDetail) Failed(string errorCode, string errorDetail) =>
            (errorCode, errorDetail);

        /// <summary>Four heroes, one offered contract, and however many of the four have answered so far.</summary>
        private static ScenarioOutcome Roster(int answered)
        {
            var names = new[] { "bram", "zara", "kestrel", "ilsa" };

            var heroes = ImmutableSortedDictionary.CreateRange(
                names.Select((name, index) => new KeyValuePair<HeroId, HeroState>(new HeroId(index), Hero(index, name))));

            var contracts = ImmutableSortedDictionary.CreateRange(new[]
            {
                new KeyValuePair<ContentId, ContractState>(Contract, BuildContract()),
            });

            var state = BuildState(heroes, contracts);

            var steps = names
                .Take(answered)
                .Select((name, index) => Step(index, index, Contract, ContentId.Parse($"core:{name}"), SimpleAccept()))
                .ToImmutableArray();

            return new ScenarioOutcome(state, steps);
        }

        private static ScenarioOutcome Single(HeroState hero, DecisionResult decision)
        {
            var heroes = ImmutableSortedDictionary.CreateRange(new[]
            {
                new KeyValuePair<HeroId, HeroState>(hero.Id, hero),
            });

            var contracts = ImmutableSortedDictionary.CreateRange(new[]
            {
                new KeyValuePair<ContentId, ContractState>(Contract, BuildContract()),
            });

            var state = BuildState(heroes, contracts);
            var step = Step(0, hero.Id.Value, Contract, hero.Definition, decision);

            return new ScenarioOutcome(state, ImmutableArray.Create(step));
        }

        private static HeroState Hero(int index, string name) => new()
        {
            Id = new HeroId(index),
            Definition = ContentId.Parse($"core:{name}"),
            DisplayNameKey = $"hero.core.{name}.name",
            Greed = 50,
            Caution = 50,
            Pride = 50,
            TrustInGuild = 50,
            Traits = ImmutableArray<ContentId>.Empty,
            Relationships = ImmutableSortedDictionary<ContentId, int>.Empty,
        };

        private static ContractState BuildContract() => new()
        {
            Id = Contract,
            Payment = 40,
            Risk = 30,
            RequiredCrew = 1,
            Tags = ImmutableSortedSet<ContentId>.Empty,
            Status = ContractStatus.Offered,
            RespondedBy = ImmutableSortedSet<HeroId>.Empty,
            AcceptedBy = ImmutableSortedSet<HeroId>.Empty,
        };

        private static DecisionResult SimpleAccept() => new()
        {
            SelectedAction = Actions.Accept,
            ConsideredActions = ImmutableArray.Create(Actions.Accept, Actions.Decline),
            SelectedScore = 0,
            Trace = new CausalTrace
            {
                TraceId = 0,
                PositiveFactors = ImmutableArray<TraceFactor>.Empty,
                NegativeFactors = ImmutableArray<TraceFactor>.Empty,
                BlockedBy = ImmutableArray<TraceBlock>.Empty,
            },
        };

        private static StepOutcome Step(
            long commandId, int heroIndex, ContentId contractId, ContentId heroDefinition, DecisionResult decision) => new(
            new ScenarioCommand(commandId, heroIndex, contractId, ExpectedStateVersion: commandId),
            Applied: true,
            RejectionCode: null,
            HeroDefinition: heroDefinition,
            Decision: decision,
            Events: ImmutableArray<DomainEvent>.Empty);

        private static GameState BuildState(
            ImmutableSortedDictionary<HeroId, HeroState> heroes,
            ImmutableSortedDictionary<ContentId, ContractState> contracts) => new()
        {
            Metadata = new GameMetadata
            {
                SaveSchemaVersion = 1,
                RulesetVersion = "test/1",
                ContentVersion = "test",
                CampaignSeed = 1,
                StateVersion = 0,
                LogicalTime = 0,
                NextEventId = 0,
                NextTraceId = 0,
                NextDecisionOrdinal = 0,
            },
            Heroes = heroes,
            Contracts = contracts,
            Traces = ImmutableSortedDictionary<long, CausalTrace>.Empty,
            History = ImmutableArray<DomainEvent>.Empty,
        };
    }
}
