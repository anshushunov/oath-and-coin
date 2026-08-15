using System.Collections.Immutable;
using System.Globalization;
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

        // Review finding (Important 2 and 3): ContractDisplayNameKey and
        // TraitDisplayNameKey reconstruct a key from a bare ContentId by
        // convention, because neither ContractState nor HeldTrait carries the
        // authored key the way HeroState does. That convention was invisible
        // to every test — an author spelling display_name_key differently
        // than the convention assumes would still leave every other check
        // green while the screen showed a key nobody translated. Asserting
        // the reconstruction against the loaded content's own authored key,
        // for every contract and every trait, is what makes the convention a
        // checked fact instead of an assumption.
        foreach (var contract in content.Contracts.Values)
        {
            Assert.Equal(
                contract.DisplayNameKey, ContractOfferScreenModelFactory.ContractDisplayNameKey(contract.Id));
        }

        foreach (var trait in content.Traits.Values)
        {
            Assert.Equal(trait.DisplayNameKey, ContractOfferScreenModelFactory.TraitDisplayNameKey(trait.Id));
        }

        // Review finding (Important 7): the screen's own title key and every
        // reconstructed contract key are values ContractOfferScreenModel can
        // put on screen, same as a tag or a reason code, and were missing
        // from the set this test actually checks against the catalogue.
        //
        // Task 12 review (Critical 1 and 3): ActionKeys, WaveredKeys,
        // ErrorKeys and ScreenStateKeys are the four key families the review
        // added so the screen never shows a raw action id, a bare
        // True/False, a raw error code, or nothing at all distinguishing
        // Loading from Empty — each is exactly as much "a value
        // ContractOfferScreenModel can put on screen" as a tag or a grade,
        // and belongs in this same completeness check for the same reason.
        var keys = content.Contracts.Values.SelectMany(c => c.Tags).Select(TagKeys.For)
            .Concat(content.Traits.Values.Select(t => TagKeys.For(t.Tag)))
            .Concat(ReasonCodes.All)
            .Concat(QualitativeScale.AllKeys)
            .Concat(new[] { ContractOfferScreenModelFactory.TitleKey })
            .Concat(content.Contracts.Keys.Select(ContractOfferScreenModelFactory.ContractDisplayNameKey))
            .Concat(ActionKeys.AllKeys)
            .Concat(WaveredKeys.AllKeys)
            .Concat(ErrorKeys.AllKeys)
            .Concat(ScreenStateKeys.AllKeys);

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

        // The exact three, in order, not "no more than three": the weaker
        // assertion passes on an empty list, so a factory that dropped every
        // reason — or ranked them the wrong way round and kept the three
        // smallest — would have satisfied it. Outcomes.ManyReasons() carries
        // five factors of magnitudes 50/40/10/8/3, so the three strongest are
        // payment, risk and trust, in that order.
        Assert.Equal(
            new[] { ReasonCodes.PaymentAttractive, ReasonCodes.RiskTooHigh, ReasonCodes.TrustsTheGuild },
            line.Reasons.Select(reason => reason.ReasonCode));
    }

    [Fact]
    public void FromOutcome_PutsAPrincipleInItsOwnFieldNotAmongReasons()
    {
        var line = Factory.FromOutcome(Outcomes.PrincipleBlocked()).Responses.Single();

        Assert.Empty(line.Reasons);
        Assert.Equal("core:will_not_strike_a_temple", line.BlockedByEntity);
        Assert.False(line.Wavered);
    }

    /// <summary>
    /// Review finding (Critical, round 4): a block used to carry only the
    /// raw trait id (<see cref="ResponseLine.BlockedByEntity"/>) — HERO_DECISION_SPEC §3's
    /// own reason for putting an entity on a block at all was so a screen
    /// never has to guess which principle fired from the hero alone, and a
    /// raw id the screen refuses to show (TDD §11.1) leaves it guessing
    /// exactly the same way an empty field would. No fixture reaches this
    /// through a real Godot frame at seed 7 today (no scenario's tags happen
    /// to cross a hero's principle) — a scenario that does is later work —
    /// so this is the model-level proof the coordinator asked for in its
    /// place: the resolved key is present, distinct from both the raw id and
    /// from nothing at all.
    /// </summary>
    [Fact]
    public void FromOutcome_NamesTheBlockingPrincipleNotJustTheHero()
    {
        var line = Factory.FromOutcome(Outcomes.PrincipleBlocked()).Responses.Single();

        Assert.Equal("trait.core.will_not_strike_a_temple.name", line.BlockedByDisplayNameKey);
        Assert.NotEqual(line.BlockedByEntity, line.BlockedByDisplayNameKey);
        Assert.NotNull(line.BlockedByDisplayNameKey);
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

    /// <summary>
    /// The second half of the spec's own rule for this state — "no contract
    /// at all, or no hero at all" — which the factory did not implement.
    /// Before this, a campaign with a contract and an empty roster fell
    /// through to the completeness check, where <c>0 &gt;= 0</c> reported
    /// <see cref="ScreenState.Normal"/>: a screen telling the player everyone
    /// had answered, above an empty table.
    /// </summary>
    [Fact]
    public void FromOutcome_ReportsEmptyWhenTheSetHasNoHeroes()
    {
        Assert.Equal(ScreenState.Empty, Factory.FromOutcome(Outcomes.NoHeroes()).State);
    }

    /// <summary>
    /// Review finding (Important 1): the contract shown and the responses
    /// listed used to be resolved independently — the contract from the
    /// first step, the responses from every step — so a run with two offers
    /// in flight would show contract A's line with a stray answer to
    /// contract B mixed in.
    /// </summary>
    [Fact]
    public void FromOutcome_OnlyShowsResponsesToTheDisplayedContract()
    {
        var model = Factory.FromOutcome(Outcomes.TwoContractsOneShown());

        var response = Assert.Single(model.Responses);
        Assert.Equal("core:bram", response.HeroDefinition);
    }

    /// <summary>
    /// Review finding (Important 1, second half): completeness used to be
    /// <c>responses.Length &gt;= roster.Length</c> — a hero who somehow
    /// produced two response lines for the same contract would count twice.
    /// <c>ContractState.RespondedBy</c> is a set, so it cannot.
    /// </summary>
    [Fact]
    public void FromOutcome_CountsCompletenessByRespondedHeroesNotResponseLines()
    {
        Assert.Equal(ScreenState.Incomplete, Factory.FromOutcome(Outcomes.SameHeroAnsweredTwice()).State);
    }

    /// <summary>
    /// Review finding (Important 5): every other fixture's heroes carry no
    /// traits at all, so the principle/inclination split, the sort and the
    /// rulebook lookup in <c>ContractOfferScreenModelFactory.TraitKeys</c>
    /// never actually ran under any test.
    /// </summary>
    [Fact]
    public void FromOutcome_BuildsPrincipleAndInclinationKeysFromTheHeroesOwnTraits()
    {
        var bram = Factory.FromOutcome(Outcomes.HeroWithTraits()).Roster.Single(h => h.Definition == "core:bram");

        Assert.Equal(new[] { "trait.core.will_not_strike_a_temple.name" }, bram.PrincipleKeys.ToArray());
        Assert.Equal(new[] { "trait.core.hates_the_cult.name" }, bram.InclinationKeys.ToArray());
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

    // --- Model validation (review finding, Important 4) -----------------
    //
    // Sixty lines of "which fields a state may carry" validation on
    // ContractOfferScreenModel had zero tests: nobody tried to build a
    // roster on an error, an orphaned ErrorDetail, or a model with{}'d from
    // one shape into another. The two With_ tests below are also the direct
    // proof for the claim in this task's report that re-validation survives
    // a `with` — the very reason the type stopped being a positional record.

    [Fact]
    public void Model_RejectsARosterOnAnErrorState()
    {
        var oneHero = ImmutableArray.Create(
            new HeroCard(
                "core:bram", "hero.core.bram.name", QualitativeGrade.Low, QualitativeGrade.Low,
                QualitativeGrade.Low, ImmutableArray<string>.Empty, ImmutableArray<string>.Empty));

        Assert.Throws<ArgumentException>(() => new ContractOfferScreenModel
        {
            State = ScreenState.Error,
            TitleKey = Factory.TitleKey,
            Contract = null,
            Roster = oneHero,
            Responses = ImmutableArray<ResponseLine>.Empty,
            ErrorCode = "SOME_ERROR",
            ErrorDetail = null,
        });
    }

    [Fact]
    public void Model_RejectsAnErrorDetailWithoutAnErrorCode()
    {
        Assert.Throws<ArgumentException>(() => new ContractOfferScreenModel
        {
            State = ScreenState.Empty,
            TitleKey = Factory.TitleKey,
            Contract = null,
            Roster = ImmutableArray<HeroCard>.Empty,
            Responses = ImmutableArray<ResponseLine>.Empty,
            ErrorCode = null,
            ErrorDetail = "a detail with nothing to detail",
        });
    }

    [Fact]
    public void Model_RejectsAnIncompleteStateWithNoContractToOffer()
    {
        Assert.Throws<ArgumentException>(() => new ContractOfferScreenModel
        {
            State = ScreenState.Incomplete,
            TitleKey = Factory.TitleKey,
            Contract = null,
            Roster = ImmutableArray<HeroCard>.Empty,
            Responses = ImmutableArray<ResponseLine>.Empty,
            ErrorCode = null,
            ErrorDetail = null,
        });
    }

    [Fact]
    public void Model_RevalidatesOnWith_RejectsBecomingEmptyWithoutClearingTheOffer()
    {
        var normal = RichModel();

        Assert.Throws<ArgumentException>(() => normal with { State = ScreenState.Empty });
    }

    [Fact]
    public void Model_RevalidatesOnWith_RejectsAnErrorCodeAppearingOnANormalState()
    {
        var normal = RichModel();

        Assert.Throws<ArgumentException>(() => normal with { ErrorCode = "SOME_ERROR" });
    }

    // --- RenderedUiSnapshot and ReadModelHash coverage (review Critical) -
    //
    // Deleting SpikeScreenModelTests.cs deleted every test of the third
    // harness hash (RenderedUiSnapshot) along with it, and left
    // ReadModelHash without the one test shaped to catch "a field silently
    // stopped contributing to the hash" — the actual failure mode a
    // read-model/rendered-UI comparison exists to catch. Ported below onto
    // the new model: every category the old mutator theory covered
    // (state/title/error code/contract fields/roster order/response
    // order/reason fields), plus stability and culture-invariance.

    /// <summary>
    /// The claim this hash exists for: two processes that built the same
    /// model agree on it. Hashing one instance twice — what this test used to
    /// do — proves only that the function is not random between two calls in
    /// one process, which no failure mode of interest would break.
    /// </summary>
    /// <remarks>
    /// Two halves, and both are needed. Two independently constructed but
    /// equal models must hash alike, which rules out the hash depending on
    /// object identity or on anything a second construction would not
    /// reproduce. And the value itself is pinned, which is the only half that
    /// can speak about a <em>different</em> process: string hash
    /// randomization, a serializer's ordering, a culture leak — every one of
    /// those is per-process and reproduces perfectly within one. The pinned
    /// value is exactly what the runtime harness compares across its two
    /// processes, so a change here that is not also a deliberate change to
    /// the model's wire shape is the bug this catches.
    /// </remarks>
    [Fact]
    public void ReadModelHash_IsStableAcrossRuns()
    {
        Assert.Equal(Factory.ReadModelHash(RichModel()), Factory.ReadModelHash(RichModel()));

        Assert.Equal(
            "4ff05b6b44d3e3aa9a5638e803cc8199b5d07e6e13f025a68d52bc49abe25b7f",
            Factory.ReadModelHash(RichModel()));
    }

    /// <summary>
    /// Mirrors <c>ReplayDeterminismTests.CanonicalArtifact_IsCultureInvariant</c>
    /// and the old <c>SpikeScreenModelTests</c> test of the same name: the
    /// host machine's locale is a forbidden input, and hashing is where it
    /// would leak in first if a number were ever formatted through it.
    /// </summary>
    [Fact]
    public void ReadModelHash_IsCultureInvariant()
    {
        var model = RichModel();
        var invariant = Factory.ReadModelHash(model);

        var hostile = (CultureInfo)CultureInfo.GetCultureInfo("de-DE").Clone();
        hostile.NumberFormat.NegativeSign = "!";
        hostile.NumberFormat.NumberDecimalSeparator = ",";

        var previousCulture = CultureInfo.CurrentCulture;
        try
        {
            CultureInfo.CurrentCulture = hostile;
            Assert.Equal(invariant, Factory.ReadModelHash(model));
        }
        finally
        {
            CultureInfo.CurrentCulture = previousCulture;
        }
    }

    public static TheoryData<string, ContractOfferScreenModel, ContractOfferScreenModel> HashMutators()
    {
        var normal = RichModel();
        var contract = normal.Contract!;
        var bram = normal.Roster[0];
        var acceptResponse = normal.Responses[0];
        var reason = acceptResponse.Reasons[0];

        return new TheoryData<string, ContractOfferScreenModel, ContractOfferScreenModel>
        {
            { "state", normal, normal with { State = ScreenState.Incomplete } },
            { "title-key", normal, normal with { TitleKey = normal.TitleKey + "!" } },
            { "error-code", ErrorModel("CODE_A"), ErrorModel("CODE_B") },
            { "contract-definition", normal, normal with { Contract = contract with { Definition = "core:other" } } },
            { "contract-display-name-key", normal, normal with { Contract = contract with { DisplayNameKey = "x" } } },
            { "contract-payment", normal, normal with { Contract = contract with { Payment = contract.Payment + 1 } } },
            { "contract-risk", normal, normal with { Contract = contract with { Risk = QualitativeGrade.Extreme } } },
            { "contract-tag-keys", normal, normal with { Contract = contract with { TagKeys = contract.TagKeys.Add("tag.extra") } } },
            { "contract-required-crew", normal, normal with { Contract = contract with { RequiredCrew = contract.RequiredCrew + 1 } } },
            { "contract-accepted-count", normal, normal with { Contract = contract with { AcceptedCount = contract.AcceptedCount + 1 } } },
            { "roster-order", normal, normal with { Roster = normal.Roster.SetItem(0, normal.Roster[1]).SetItem(1, normal.Roster[0]) } },
            { "roster-hero-definition", normal, WithHero(normal, bram with { Definition = "core:other" }) },
            { "roster-hero-display-name-key", normal, WithHero(normal, bram with { DisplayNameKey = "hero.core.other.name" }) },
            { "roster-hero-greed", normal, WithHero(normal, bram with { Greed = QualitativeGrade.Extreme }) },
            { "roster-hero-caution", normal, WithHero(normal, bram with { Caution = QualitativeGrade.Extreme }) },
            { "roster-hero-pride", normal, WithHero(normal, bram with { Pride = QualitativeGrade.Extreme }) },
            { "roster-principle-keys", normal, WithHero(normal, bram with { PrincipleKeys = bram.PrincipleKeys.Add("trait.extra") }) },
            { "roster-inclination-keys", normal, WithHero(normal, bram with { InclinationKeys = bram.InclinationKeys.Add("trait.extra") }) },
            { "responses-order", normal, normal with { Responses = normal.Responses.SetItem(0, normal.Responses[1]).SetItem(1, normal.Responses[0]) } },
            { "response-hero-definition", normal, WithResponse(normal, acceptResponse with { HeroDefinition = "core:other" }) },
            { "response-hero-display-name-key", normal, WithResponse(normal, acceptResponse with { HeroDisplayNameKey = "hero.core.other.name" }) },
            { "response-action", normal, WithResponse(normal, acceptResponse with { Action = "action:decline" }) },
            { "response-blocked-by-entity", normal, WithResponse(normal, acceptResponse with { BlockedByEntity = "core:something" }) },
            { "response-blocked-by-display-name-key", normal, WithResponse(normal, acceptResponse with { BlockedByDisplayNameKey = "trait.extra" }) },
            { "response-wavered", normal, WithResponse(normal, acceptResponse with { Wavered = !acceptResponse.Wavered }) },
            { "reason-code", normal, WithResponse(normal, acceptResponse with { Reasons = acceptResponse.Reasons.SetItem(0, reason with { ReasonCode = "other" }) }) },
            { "reason-source-entity", normal, WithResponse(normal, acceptResponse with { Reasons = acceptResponse.Reasons.SetItem(0, reason with { SourceEntity = "core:other" }) }) },
            { "reason-strength", normal, WithResponse(normal, acceptResponse with { Reasons = acceptResponse.Reasons.SetItem(0, reason with { Strength = QualitativeGrade.Extreme }) }) },
            { "reason-source-display-name-key", normal, WithResponse(normal, acceptResponse with { Reasons = acceptResponse.Reasons.SetItem(0, reason with { SourceDisplayNameKey = "trait.extra" }) }) },
        };
    }

    [Theory]
    [MemberData(nameof(HashMutators))]
    public void ReadModelHash_ChangesWhenAnyShownValueChanges(
        string label, ContractOfferScreenModel original, ContractOfferScreenModel mutated)
    {
        Assert.True(
            Factory.ReadModelHash(original) != Factory.ReadModelHash(mutated),
            $"hash did not change when '{label}' changed");
    }

    /// <summary>
    /// The only catalogue this project ships, loaded once for every test in
    /// this file that resolves a key: <c>RichModel</c> below is built
    /// entirely from real production ids and keys (the same heroes,
    /// contract, tags and reason codes <c>content/</c> ships), so it never
    /// needs a hand-rolled fixture dictionary of its own.
    /// </summary>
    private static ImmutableSortedDictionary<string, string> Catalogue() =>
        LocaleCatalogue.Load(RepositoryFixtures.LocaleFile("ru"));

    /// <summary>
    /// Task 12 review (Critical 1): a raw content id shown next to the
    /// resolved name it duplicates — <c>core:bram</c> beside "Брам" — is
    /// exactly the leak this test now pins down as absent, not merely as
    /// "some resolved text happens to also be present". Renamed from
    /// <c>ExpectedSnapshot_ContainsEveryShownValue</c> (which asserted the
    /// model's raw keys/ids were the snapshot, the opposite of what a
    /// correctly bound screen shows) once <see cref="RenderedUiSnapshot.Expected(ContractOfferScreenModel, System.Collections.Generic.IReadOnlyDictionary{string,string})"/>
    /// became the only overload with a real caller.
    /// </summary>
    [Fact]
    public void ExpectedSnapshot_ContainsEveryResolvedValueAndNoRawIdentifier()
    {
        var model = RichModel();
        var catalogue = Catalogue();
        var snapshot = RenderedUiSnapshot.Expected(model, catalogue);

        Assert.Contains(catalogue[model.TitleKey], snapshot.Texts);
        Assert.Contains(catalogue[ScreenStateKeys.For(model.State)], snapshot.Texts);

        var contract = model.Contract!;
        Assert.Contains(catalogue[contract.DisplayNameKey], snapshot.Texts);
        Assert.Contains(contract.Payment.ToString(CultureInfo.InvariantCulture), snapshot.Texts);
        Assert.Contains(catalogue[QualitativeScale.KeyFor(contract.Risk)], snapshot.Texts);
        Assert.Contains(contract.RequiredCrew.ToString(CultureInfo.InvariantCulture), snapshot.Texts);
        Assert.Contains(contract.AcceptedCount.ToString(CultureInfo.InvariantCulture), snapshot.Texts);
        Assert.DoesNotContain(contract.Definition, snapshot.Texts);

        foreach (var tagKey in contract.TagKeys)
        {
            Assert.Contains(catalogue[tagKey], snapshot.Texts);
        }

        foreach (var hero in model.Roster)
        {
            Assert.Contains(catalogue[hero.DisplayNameKey], snapshot.Texts);
            Assert.Contains(catalogue[QualitativeScale.KeyFor(hero.Greed)], snapshot.Texts);
            Assert.Contains(catalogue[QualitativeScale.KeyFor(hero.Caution)], snapshot.Texts);
            Assert.Contains(catalogue[QualitativeScale.KeyFor(hero.Pride)], snapshot.Texts);
            Assert.DoesNotContain(hero.Definition, snapshot.Texts);

            foreach (var key in hero.PrincipleKeys.Concat(hero.InclinationKeys))
            {
                Assert.Contains(catalogue[key], snapshot.Texts);
            }
        }

        foreach (var response in model.Responses)
        {
            Assert.Contains(catalogue[response.HeroDisplayNameKey], snapshot.Texts);
            Assert.Contains(catalogue[ActionKeys.For(response.Action)], snapshot.Texts);
            Assert.Contains(catalogue[WaveredKeys.For(response.Wavered)], snapshot.Texts);
            Assert.DoesNotContain(response.HeroDefinition, snapshot.Texts);

            foreach (var reason in response.Reasons)
            {
                Assert.Contains(catalogue[reason.ReasonCode], snapshot.Texts);
                Assert.Contains(catalogue[QualitativeScale.KeyFor(reason.Strength)], snapshot.Texts);
                Assert.DoesNotContain(reason.SourceEntity, snapshot.Texts);

                if (reason.SourceDisplayNameKey is not null)
                {
                    Assert.Contains(catalogue[reason.SourceDisplayNameKey], snapshot.Texts);
                }
            }

            if (response.BlockedByEntity is not null)
            {
                Assert.DoesNotContain(response.BlockedByEntity, snapshot.Texts);
            }

            if (response.BlockedByDisplayNameKey is not null)
            {
                Assert.Contains(catalogue[response.BlockedByDisplayNameKey], snapshot.Texts);
            }
        }

        // Positive control (HERO_DECISION_SPEC §3): the fixture's trait-sourced reason
        // must actually resolve to its own trait's name, not merely "some
        // key or other happened to be null and the loop above never ran".
        Assert.Contains("trait.core.loyal_to_the_merchant_guild.name", catalogue.Keys);
        Assert.Contains(catalogue["trait.core.loyal_to_the_merchant_guild.name"], snapshot.Texts);

        // Positive control (HERO_DECISION_SPEC §3): the fixture's blocked response must
        // actually resolve to its own principle's name, not merely "some
        // key or other happened to be null and the loop above never ran".
        Assert.Contains("trait.core.will_not_strike_a_temple.name", catalogue.Keys);
        Assert.Contains(catalogue["trait.core.will_not_strike_a_temple.name"], snapshot.Texts);
    }

    [Fact]
    public void SnapshotHash_ChangesOnTextOrOrderChange()
    {
        var model = RichModel();
        var snapshot = RenderedUiSnapshot.Expected(model, Catalogue());

        Assert.True(snapshot.Texts.Length >= 2, "The fixture is expected to carry more than one text.");

        var swapped = new RenderedUiSnapshot(
            snapshot.Texts.SetItem(0, snapshot.Texts[1]).SetItem(1, snapshot.Texts[0]));

        Assert.NotEqual(RenderedUiSnapshot.Hash(snapshot), RenderedUiSnapshot.Hash(swapped));
    }

    /// <summary>
    /// Task 12 review (Important 1): the perfectly-independent-sounding
    /// catalogue-resolving overload had no test of its own contract — that
    /// it actually throws, loudly, rather than falling back to the key —
    /// which is the one behavior <c>TextSource.Resolve</c> and this method
    /// are both supposed to share without sharing code.
    /// </summary>
    [Fact]
    public void ExpectedSnapshot_ThrowsOnMissingCatalogueKey()
    {
        var model = RichModel();
        var incompleteCatalogue = Catalogue().Remove(model.TitleKey);

        var exception = Assert.Throws<InvalidOperationException>(
            () => RenderedUiSnapshot.Expected(model, incompleteCatalogue));

        Assert.Contains(model.TitleKey, exception.Message, StringComparison.Ordinal);
    }

    /// <summary>
    /// A fully populated, valid <see cref="ScreenState.Normal"/> model: two
    /// heroes (one with a principle and an inclination), one contract with
    /// two tags, and two responses — one accepted with a ranked reason, one
    /// declined and blocked. Shared by the hash-mutator theory and the
    /// snapshot tests above, so every field either of them exercises is
    /// actually populated with something a mutation can change.
    /// </summary>
    private static ContractOfferScreenModel RichModel() => new()
    {
        State = ScreenState.Normal,
        TitleKey = Factory.TitleKey,
        Contract = new ContractLine(
            "core:escort_the_caravan",
            "contract.core.escort_the_caravan.name",
            40,
            QualitativeGrade.Moderate,
            ImmutableArray.Create("tag.patron.merchant_guild", "tag.target.bandits"),
            2,
            1),
        Roster = ImmutableArray.Create(
            new HeroCard(
                "core:bram", "hero.core.bram.name", QualitativeGrade.High, QualitativeGrade.Low,
                QualitativeGrade.Moderate,
                ImmutableArray.Create("trait.core.will_not_strike_a_temple.name"),
                ImmutableArray.Create("trait.core.hates_the_cult.name")),
            new HeroCard(
                "core:zara", "hero.core.zara.name", QualitativeGrade.Low, QualitativeGrade.High,
                QualitativeGrade.Negligible, ImmutableArray<string>.Empty, ImmutableArray<string>.Empty)),
        Responses = ImmutableArray.Create(
            new ResponseLine(
                "core:bram",
                "hero.core.bram.name",
                "action:accept",
                ImmutableArray.Create(
                    // Contract-sourced: SourceDisplayNameKey null, the
                    // contract is already named on screen (Critical, round 3).
                    new ReasonLine(
                        ReasonCodes.PaymentAttractive, "core:escort_the_caravan", QualitativeGrade.High,
                        SourceDisplayNameKey: null),

                    // Trait-sourced: SourceDisplayNameKey names the specific
                    // conviction — ReasonCode alone only says "some
                    // conviction fired", not which of a hero's several.
                    new ReasonLine(
                        ReasonCodes.PersonalConviction, "core:loyal_to_the_merchant_guild", QualitativeGrade.Low,
                        SourceDisplayNameKey: "trait.core.loyal_to_the_merchant_guild.name")),
                BlockedByEntity: null,
                BlockedByDisplayNameKey: null,
                false),
            new ResponseLine(
                "core:zara", "hero.core.zara.name", "action:decline", ImmutableArray<ReasonLine>.Empty,
                BlockedByEntity: "core:will_not_strike_a_temple",
                BlockedByDisplayNameKey: "trait.core.will_not_strike_a_temple.name",
                Wavered: false)),
        ErrorCode = null,
        ErrorDetail = null,
    };

    private static ContractOfferScreenModel ErrorModel(string code) => new()
    {
        State = ScreenState.Error,
        TitleKey = Factory.TitleKey,
        Contract = null,
        Roster = ImmutableArray<HeroCard>.Empty,
        Responses = ImmutableArray<ResponseLine>.Empty,
        ErrorCode = code,
        ErrorDetail = "detail",
    };

    private static ContractOfferScreenModel WithHero(ContractOfferScreenModel model, HeroCard hero) =>
        model with { Roster = model.Roster.SetItem(0, hero) };

    private static ContractOfferScreenModel WithResponse(ContractOfferScreenModel model, ResponseLine response) =>
        model with { Responses = model.Responses.SetItem(0, response) };

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

            // Unlike Single's other callers, this fixture's comrades — zara
            // and doran, StandsWithComrade's own SourceEntity above — have to
            // actually be in the roster: Task 12 review (Critical, round 3)
            // resolves a comrade-sourced reason's display name by looking it
            // up there, exactly like ContractDecisionRule.Decide's own Crew
            // lookup already requires of a real AcceptedBy entry (see its
            // remarks). A comrade absent from state.Heroes is not a shape a
            // real decision ever produces, so this fixture is made to match
            // that instead of the factory being made to tolerate a shape
            // that cannot happen.
            var kestrel = Hero(0, "kestrel");
            var heroes = ImmutableSortedDictionary.CreateRange(new[]
            {
                new KeyValuePair<HeroId, HeroState>(kestrel.Id, kestrel),
                new KeyValuePair<HeroId, HeroState>(new HeroId(1), Hero(1, "zara")),
                new KeyValuePair<HeroId, HeroState>(new HeroId(2), Hero(2, "doran")),
            });

            var contracts = ImmutableSortedDictionary.CreateRange(new[]
            {
                new KeyValuePair<ContentId, ContractState>(Contract, BuildContract()),
            });

            var state = BuildState(heroes, contracts);
            var step = Step(0, kestrel.Id.Value, Contract, kestrel.Definition, decision);

            return new ScenarioOutcome(state, ImmutableArray.Create(step));
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

        /// <summary>
        /// A contract on offer and nobody to offer it to. Reachable in
        /// principle (a campaign whose roster is empty), and the half of the
        /// spec's Empty rule the factory did not implement until this branch
        /// of fixes.
        /// </summary>
        public static ScenarioOutcome NoHeroes()
        {
            var contracts = ImmutableSortedDictionary.CreateRange(new[]
            {
                new KeyValuePair<ContentId, ContractState>(Contract, BuildContract()),
            });

            var state = BuildState(ImmutableSortedDictionary<HeroId, HeroState>.Empty, contracts);

            return new ScenarioOutcome(state, ImmutableArray<StepOutcome>.Empty);
        }

        public static (string ErrorCode, string ErrorDetail) Failed(string errorCode, string errorDetail) =>
            (errorCode, errorDetail);

        /// <summary>
        /// Four heroes, one offered contract, and however many of the four
        /// have answered so far. <c>RespondedBy</c>/<c>AcceptedBy</c> are set
        /// to match the steps below the same way <c>SimulationEngine.Apply</c>
        /// itself would (see its <c>with</c> on <c>ContractState</c>) —
        /// without this, <c>FromOutcome</c>'s completeness check (which reads
        /// <c>ContractState.RespondedBy</c>, not the response line count) would
        /// see an empty set regardless of <paramref name="answered"/>.
        /// </summary>
        private static ScenarioOutcome Roster(int answered)
        {
            var names = new[] { "bram", "zara", "kestrel", "ilsa" };

            var heroes = ImmutableSortedDictionary.CreateRange(
                names.Select((name, index) => new KeyValuePair<HeroId, HeroState>(new HeroId(index), Hero(index, name))));

            var responded = ImmutableSortedSet.CreateRange(Enumerable.Range(0, answered).Select(index => new HeroId(index)));

            var contracts = ImmutableSortedDictionary.CreateRange(new[]
            {
                new KeyValuePair<ContentId, ContractState>(
                    Contract, BuildContract() with { RespondedBy = responded, AcceptedBy = responded }),
            });

            var state = BuildState(heroes, contracts);

            var steps = names
                .Take(answered)
                .Select((name, index) => Step(index, index, Contract, ContentId.Parse($"core:{name}"), SimpleAccept()))
                .ToImmutableArray();

            return new ScenarioOutcome(state, steps);
        }

        /// <summary>
        /// Two contracts, two heroes, one step each — but only the first
        /// contract's step is what <c>FromOutcome</c> resolves as "the"
        /// contract (it is the first step's own contract). Proves the
        /// response filter: without it, zara's answer to the other contract
        /// would leak onto this screen too.
        /// </summary>
        public static ScenarioOutcome TwoContractsOneShown()
        {
            var otherContract = ContentId.Parse("core:silence_the_cult");
            var zara = ContentId.Parse("core:zara");

            var heroes = ImmutableSortedDictionary.CreateRange(new[]
            {
                new KeyValuePair<HeroId, HeroState>(new HeroId(0), Hero(0, "bram")),
                new KeyValuePair<HeroId, HeroState>(new HeroId(1), Hero(1, "zara")),
            });

            var contracts = ImmutableSortedDictionary.CreateRange(new[]
            {
                new KeyValuePair<ContentId, ContractState>(
                    Contract,
                    BuildContract() with
                    {
                        RespondedBy = ImmutableSortedSet.Create(new HeroId(0)),
                        AcceptedBy = ImmutableSortedSet.Create(new HeroId(0)),
                    }),
                new KeyValuePair<ContentId, ContractState>(
                    otherContract,
                    BuildContract() with
                    {
                        Id = otherContract,
                        RespondedBy = ImmutableSortedSet.Create(new HeroId(1)),
                        AcceptedBy = ImmutableSortedSet.Create(new HeroId(1)),
                    }),
            });

            var state = BuildState(heroes, contracts);

            var steps = ImmutableArray.Create(
                Step(0, 0, Contract, ContentId.Parse("core:bram"), SimpleAccept()),
                Step(1, 1, otherContract, zara, SimpleAccept()));

            return new ScenarioOutcome(state, steps);
        }

        /// <summary>
        /// One hero, two steps that both somehow carry a decision for that
        /// same hero on the same contract — a shape the real engine never
        /// produces (a second proposal to an already-responded hero is
        /// rejected, <c>RejectionCodes.AlreadyResponded</c>) but that a
        /// naive "count response lines" completeness check would still be
        /// fooled by. <c>ContractState.RespondedBy</c> — the ground truth this
        /// factory actually reads — lists the hero exactly once, so the
        /// screen must stay <see cref="ScreenState.Incomplete"/> against a
        /// two-hero roster.
        /// </summary>
        public static ScenarioOutcome SameHeroAnsweredTwice()
        {
            var heroes = ImmutableSortedDictionary.CreateRange(new[]
            {
                new KeyValuePair<HeroId, HeroState>(new HeroId(0), Hero(0, "bram")),
                new KeyValuePair<HeroId, HeroState>(new HeroId(1), Hero(1, "zara")),
            });

            var contracts = ImmutableSortedDictionary.CreateRange(new[]
            {
                new KeyValuePair<ContentId, ContractState>(
                    Contract,
                    BuildContract() with
                    {
                        RespondedBy = ImmutableSortedSet.Create(new HeroId(0)),
                        AcceptedBy = ImmutableSortedSet.Create(new HeroId(0)),
                    }),
            });

            var state = BuildState(heroes, contracts);
            var bram = ContentId.Parse("core:bram");

            var steps = ImmutableArray.Create(
                Step(0, 0, Contract, bram, SimpleAccept()),
                Step(1, 0, Contract, bram, SimpleAccept()));

            return new ScenarioOutcome(state, steps);
        }

        /// <summary>
        /// One hero carrying one principle and one inclination, resolved
        /// through <c>GameState.TraitRules</c> exactly as content-loaded
        /// state carries them — the only fixture in this file that actually
        /// exercises <c>ContractOfferScreenModelFactory</c>'s principle/
        /// inclination split, sort and rulebook lookup; every other fixture's
        /// heroes carry no traits at all.
        /// </summary>
        public static ScenarioOutcome HeroWithTraits()
        {
            var bram = ContentId.Parse("core:bram");
            var principle = ContentId.Parse("core:will_not_strike_a_temple");
            var inclination = ContentId.Parse("core:hates_the_cult");
            var temple = ContentId.Parse("target:temple");
            var cult = ContentId.Parse("target:cult");

            var hero = Hero(0, "bram") with { Traits = ImmutableArray.Create(inclination, principle) };

            var heroes = ImmutableSortedDictionary.CreateRange(new[]
            {
                new KeyValuePair<HeroId, HeroState>(new HeroId(0), hero),
            });

            var contracts = ImmutableSortedDictionary.CreateRange(new[]
            {
                new KeyValuePair<ContentId, ContractState>(Contract, BuildContract()),
            });

            var traitRules = ImmutableSortedDictionary.CreateRange(new[]
            {
                new KeyValuePair<ContentId, HeldTrait>(principle, new HeldTrait(principle, temple, IsPrinciple: true, Weight: 0)),
                new KeyValuePair<ContentId, HeldTrait>(inclination, new HeldTrait(inclination, cult, IsPrinciple: false, Weight: 14)),
            });

            var state = BuildState(heroes, contracts) with { TraitRules = traitRules };

            return new ScenarioOutcome(state, ImmutableArray<StepOutcome>.Empty);
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
