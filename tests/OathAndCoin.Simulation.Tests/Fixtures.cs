using System.Collections.Immutable;
using OathAndCoin.Simulation.Commands;
using OathAndCoin.Simulation.Decisions;
using OathAndCoin.Simulation.Events;
using OathAndCoin.Simulation.Ids;
using OathAndCoin.Simulation.State;

namespace OathAndCoin.Simulation.Tests;

/// <summary>
/// Minimal, valid <see cref="HeroState"/>/<see cref="ContractState"/> values
/// shared across this project's equality tests. Every collection-valued
/// property starts empty, so a test that cares about one collection can
/// override just that one with <c>with</c> and leave the rest at an
/// unambiguous default.
/// </summary>
internal static class Fixtures
{
    public static readonly ContentId HeroDefinition = ContentId.Parse("core:bram");

    public static readonly ContentId ContractId = ContentId.Parse("core:escort_the_caravan");

    private const ulong CampaignSeed = 424242;

    /// <summary>
    /// The (trait, tag) pair every principled-hero fixture below shares — the
    /// same pairing <see cref="ContractDecisionRule.Decide"/> actually reads:
    /// a principle blocks exactly when its own tag is among the contract's
    /// tags.
    /// </summary>
    private static readonly ContentId PrincipleTraitId = ContentId.Parse("core:will_not_strike_a_temple");

    private static readonly ContentId PrincipleTag = ContentId.Parse("target:temple");

    /// <summary>
    /// The comrade definition <see cref="StateWithBondedHeroes"/>'s second
    /// hero holds an opinion about — hero 0's own
    /// <see cref="HeroState.Definition"/>.
    /// </summary>
    public static readonly ContentId BondedComradeDefinition = ContentId.Parse("core:hero_0");

    /// <summary>
    /// Two inclination ids used by <see cref="StateWithTraitsAuthoredOutOfOrder"/>,
    /// named by their sort relationship to each other rather than by content
    /// (<c>"core:trait_a"</c> sorts before <c>"core:trait_b"</c> ordinally) —
    /// the fixture's whole point is that <see cref="HeroState.Traits"/>
    /// authors them the other way round.
    /// </summary>
    public static readonly ContentId LowerTraitId = ContentId.Parse("core:trait_a");

    public static readonly ContentId HigherTraitId = ContentId.Parse("core:trait_b");

    private static readonly ContentId SharedInclinationTag = ContentId.Parse("target:bandits");

    public static HeroState Hero() => new()
    {
        Id = new HeroId(1),
        Definition = HeroDefinition,
        DisplayNameKey = "hero.core.bram.name",
        Greed = 5,
        Caution = 5,
        Pride = 5,
        TrustInGuild = 5,
        Traits = ImmutableArray<ContentId>.Empty,
        Relationships = ImmutableSortedDictionary<ContentId, int>.Empty,
    };

    public static ContractState Contract() => new()
    {
        Id = ContractId,
        Payment = 100,
        Risk = 5,
        RequiredCrew = 1,
        Tags = ImmutableSortedSet<ContentId>.Empty,
        Status = ContractStatus.Offered,
        RespondedBy = ImmutableSortedSet<HeroId>.Empty,
        AcceptedBy = ImmutableSortedSet<HeroId>.Empty,
    };

    /// <summary>
    /// A minimal, otherwise-valid <see cref="DecisionResult"/> with
    /// <paramref name="score"/> and <paramref name="blockedBy"/> as the only
    /// two moving parts — for exercising the joint
    /// "<see cref="DecisionResult.SelectedScore"/> is null exactly when
    /// <paramref name="blockedBy"/> is non-empty" invariant without restating
    /// the rest of a decision each time.
    /// </summary>
    public static DecisionResult Result(int? score, ImmutableArray<TraceBlock> blockedBy) => new()
    {
        SelectedAction = Actions.Accept,
        ConsideredActions = ImmutableArray.Create(Actions.Accept, Actions.Decline),
        SelectedScore = score,
        Trace = new CausalTrace
        {
            TraceId = 1,
            PositiveFactors = ImmutableArray<TraceFactor>.Empty,
            NegativeFactors = ImmutableArray<TraceFactor>.Empty,
            BlockedBy = blockedBy,
        },
    };

    /// <summary>
    /// Two heroes offered the same contract, each stated decisively enough
    /// (payment 100, risk 0, greed 100, trust 100) that mood — bounded to
    /// <c>[-5, 5]</c> — can never turn their acceptance into a refusal (see
    /// <see cref="ContractDecisionRule.MoodMin"/>). The engine's crew-counting
    /// tests need every hero to accept regardless of which ordinal the shared
    /// seed happens to draw.
    /// </summary>
    public static GameState StateWithTwoHeroes(int requiredCrew)
    {
        var heroes = ImmutableSortedDictionary.CreateBuilder<HeroId, HeroState>();
        heroes.Add(new HeroId(0), DecisiveAcceptingHero(new HeroId(0), ContentId.Parse("core:hero_0")));
        heroes.Add(new HeroId(1), DecisiveAcceptingHero(new HeroId(1), ContentId.Parse("core:hero_1")));

        return BuildState(
            heroes.ToImmutable(),
            requiredCrew,
            payment: 100,
            risk: 0,
            tags: ImmutableSortedSet<ContentId>.Empty);
    }

    /// <summary>
    /// Six heroes, same decisive-acceptance shape as
    /// <see cref="StateWithTwoHeroes"/> — enough heroes to run an offer past
    /// <see cref="ContractState.RequiredCrew"/> and into proposals against an
    /// already-<see cref="ContractStatus.Crewed"/> contract, not merely
    /// enough to fill it exactly. Those later proposals land on
    /// <see cref="RejectionCodes.ContractAlreadyResolved"/>
    /// specifically — not, say, a stale <c>ExpectedStateVersion</c> — only
    /// when the caller re-reads the version from the actual resulting state
    /// before composing each next command, rather than assuming it advances
    /// by one per proposal (a rejected proposal does not advance it at all).
    /// </summary>
    public static GameState StateWithSixHeroes(int requiredCrew)
    {
        var heroes = ImmutableSortedDictionary.CreateBuilder<HeroId, HeroState>();
        for (var i = 0; i < 6; i++)
        {
            heroes.Add(new HeroId(i), DecisiveAcceptingHero(new HeroId(i), ContentId.Parse($"core:hero_{i}")));
        }

        return BuildState(
            heroes.ToImmutable(),
            requiredCrew,
            payment: 100,
            risk: 0,
            tags: ImmutableSortedSet<ContentId>.Empty);
    }

    /// <summary>
    /// One hero carrying a principle whose tag the contract offers, and
    /// nobody else — the gate this hero's decision hits must be the only
    /// thing that decision can possibly do, so a test can assert the RNG
    /// ordinal never moved.
    /// </summary>
    public static GameState StateWithPrincipledHero()
    {
        var heroes = ImmutableSortedDictionary.CreateBuilder<HeroId, HeroState>();
        heroes.Add(new HeroId(0), PrincipledHero(new HeroId(0), ContentId.Parse("core:hero_0")));

        return BuildState(
            heroes.ToImmutable(),
            requiredCrew: 1,
            payment: 40,
            risk: 50,
            tags: ImmutableSortedSet.Create(PrincipleTag),
            traitRules: PrincipleTraitRules(),
            nextDecisionOrdinal: 7);
    }

    /// <summary>
    /// The principled hero above, then a second, ordinary hero with no
    /// traits at all offered the same contract — exactly the pairing the
    /// "next scored decision reuses the ordinal the gate did not read" test
    /// needs: one decision that must draw no mood, immediately followed by
    /// one that must.
    /// </summary>
    public static GameState StateWithPrincipledHeroThenOrdinaryHero()
    {
        var heroes = ImmutableSortedDictionary.CreateBuilder<HeroId, HeroState>();
        heroes.Add(new HeroId(0), PrincipledHero(new HeroId(0), ContentId.Parse("core:hero_0")));
        heroes.Add(new HeroId(1), OrdinaryHero(new HeroId(1), ContentId.Parse("core:hero_1")));

        return BuildState(
            heroes.ToImmutable(),
            requiredCrew: 2,
            payment: 40,
            risk: 50,
            tags: ImmutableSortedSet.Create(PrincipleTag),
            traitRules: PrincipleTraitRules(),
            nextDecisionOrdinal: 3);
    }

    private static ImmutableSortedDictionary<ContentId, HeldTrait> PrincipleTraitRules() =>
        ImmutableSortedDictionary.CreateRange(new[]
        {
            KeyValuePair.Create(
                PrincipleTraitId,
                new HeldTrait(PrincipleTraitId, PrincipleTag, IsPrinciple: true, Weight: 0)),
        });

    /// <summary>
    /// Hero 0 (decisive, always accepts), then hero 1, who holds an opinion
    /// (<paramref name="relationshipWeight"/>) about hero 0's own
    /// <see cref="BondedComradeDefinition"/> — the pairing
    /// <see cref="ProposeContractTests.Propose_RecordsBondFactorNamingTheAcceptedComradesDefinition"/>
    /// needs to prove <see cref="DecisionContext.Crew"/>'s values, not merely
    /// its keys, are wired to the right content id.
    /// </summary>
    public static GameState StateWithBondedHeroes(int relationshipWeight)
    {
        var heroes = ImmutableSortedDictionary.CreateBuilder<HeroId, HeroState>();
        heroes.Add(new HeroId(0), DecisiveAcceptingHero(new HeroId(0), BondedComradeDefinition));
        heroes.Add(new HeroId(1), BondedHero(new HeroId(1), ContentId.Parse("core:hero_1"), relationshipWeight));

        return BuildState(
            heroes.ToImmutable(),
            requiredCrew: 2,
            payment: 100,
            risk: 0,
            tags: ImmutableSortedSet<ContentId>.Empty);
    }

    /// <summary>
    /// One hero holding two inclinations whose tag the contract offers,
    /// authored in <see cref="HeroState.Traits"/> in the reverse of their id
    /// order — see <see cref="LowerTraitId"/>/<see cref="HigherTraitId"/> and
    /// <see cref="ProposeContractTests.Propose_ResolvesTraitsRegardlessOfTheirAuthoredOrder"/>.
    /// </summary>
    public static GameState StateWithTraitsAuthoredOutOfOrder()
    {
        var heroes = ImmutableSortedDictionary.CreateBuilder<HeroId, HeroState>();
        heroes.Add(new HeroId(0), TwoInclinationsHero(new HeroId(0), ContentId.Parse("core:hero_0")));

        var traitRules = ImmutableSortedDictionary.CreateRange(new[]
        {
            KeyValuePair.Create(LowerTraitId, new HeldTrait(LowerTraitId, SharedInclinationTag, IsPrinciple: false, Weight: 3)),
            KeyValuePair.Create(HigherTraitId, new HeldTrait(HigherTraitId, SharedInclinationTag, IsPrinciple: false, Weight: 5)),
        });

        return BuildState(
            heroes.ToImmutable(),
            requiredCrew: 1,
            payment: 40,
            risk: 50,
            tags: ImmutableSortedSet.Create(SharedInclinationTag),
            traitRules: traitRules);
    }

    private static HeroState DecisiveAcceptingHero(HeroId id, ContentId definition) => new()
    {
        Id = id,
        Definition = definition,
        DisplayNameKey = "hero.test.decisive.name",
        Greed = 100,
        Caution = 0,
        Pride = 0,
        TrustInGuild = 100,
        Traits = ImmutableArray<ContentId>.Empty,
        Relationships = ImmutableSortedDictionary<ContentId, int>.Empty,
    };

    private static HeroState PrincipledHero(HeroId id, ContentId definition) => new()
    {
        Id = id,
        Definition = definition,
        DisplayNameKey = "hero.test.principled.name",
        Greed = 50,
        Caution = 50,
        Pride = 50,
        TrustInGuild = 50,
        Traits = ImmutableArray.Create(PrincipleTraitId),
        Relationships = ImmutableSortedDictionary<ContentId, int>.Empty,
    };

    private static HeroState OrdinaryHero(HeroId id, ContentId definition) => new()
    {
        Id = id,
        Definition = definition,
        DisplayNameKey = "hero.test.ordinary.name",
        Greed = 50,
        Caution = 50,
        Pride = 50,
        TrustInGuild = 50,
        Traits = ImmutableArray<ContentId>.Empty,
        Relationships = ImmutableSortedDictionary<ContentId, int>.Empty,
    };

    private static HeroState BondedHero(HeroId id, ContentId definition, int relationshipWeight) => new()
    {
        Id = id,
        Definition = definition,
        DisplayNameKey = "hero.test.bonded.name",
        Greed = 50,
        Caution = 50,
        Pride = 50,
        TrustInGuild = 50,
        Traits = ImmutableArray<ContentId>.Empty,
        Relationships = ImmutableSortedDictionary.CreateRange(new[]
        {
            KeyValuePair.Create(BondedComradeDefinition, relationshipWeight),
        }),
    };

    private static HeroState TwoInclinationsHero(HeroId id, ContentId definition) => new()
    {
        Id = id,
        Definition = definition,
        DisplayNameKey = "hero.test.two_inclinations.name",
        Greed = 50,
        Caution = 50,
        Pride = 50,
        TrustInGuild = 50,
        // Authored in the reverse of sorted (Id) order deliberately — see
        // LowerTraitId/HigherTraitId and the test this fixture supports.
        Traits = ImmutableArray.Create(HigherTraitId, LowerTraitId),
        Relationships = ImmutableSortedDictionary<ContentId, int>.Empty,
    };

    private static GameState BuildState(
        ImmutableSortedDictionary<HeroId, HeroState> heroes,
        int requiredCrew,
        int payment,
        int risk,
        ImmutableSortedSet<ContentId> tags,
        ImmutableSortedDictionary<ContentId, HeldTrait>? traitRules = null,
        ulong nextDecisionOrdinal = 0) => new()
    {
        Metadata = new GameMetadata
        {
            SaveSchemaVersion = 1,
            RulesetVersion = "test-ruleset",
            ContentVersion = "test-content",
            CampaignSeed = CampaignSeed,
            StateVersion = 0,
            LogicalTime = 0,
            NextEventId = 0,
            NextTraceId = 0,
            NextDecisionOrdinal = nextDecisionOrdinal,
        },
        Heroes = heroes,
        Contracts = ImmutableSortedDictionary.CreateRange(new[]
        {
            KeyValuePair.Create(ContractId, new ContractState
            {
                Id = ContractId,
                Payment = payment,
                Risk = risk,
                RequiredCrew = requiredCrew,
                Tags = tags,
                Status = ContractStatus.Offered,
                RespondedBy = ImmutableSortedSet<HeroId>.Empty,
                AcceptedBy = ImmutableSortedSet<HeroId>.Empty,
            }),
        }),
        TraitRules = traitRules ?? ImmutableSortedDictionary<ContentId, HeldTrait>.Empty,
        Traces = ImmutableSortedDictionary<long, CausalTrace>.Empty,
        History = ImmutableArray<DomainEvent>.Empty,
    };
}
