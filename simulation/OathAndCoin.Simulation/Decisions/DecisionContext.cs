using System.Collections.Immutable;
using OathAndCoin.Simulation.Ids;
using OathAndCoin.Simulation.State;

namespace OathAndCoin.Simulation.Decisions;

/// <summary>What a trait contributes, extracted from content by the caller.</summary>
/// <remarks>
/// The rule never sees a content definition: the core must not reference the
/// content assembly (ADR-002). What it needs is the tag, the kind and the
/// weight — so those travel, and file paths, localization keys and schema
/// versions stay on the other side of the boundary.
/// </remarks>
public sealed record HeldTrait(ContentId Id, ContentId Tag, bool IsPrinciple, int Weight);

/// <summary>
/// Everything a single decision is computable from (HERO_DECISION_SPEC §2.1). Assembled by
/// the caller, never fetched: the rule holds no reference to GameState, so a
/// test can pose a question without building a world.
/// </summary>
public sealed record DecisionContext
{
    public required HeroState Hero { get; init; }

    public required ContractState Contract { get; init; }

    /// <summary>The hero's own traits, already resolved. Sorted by id.</summary>
    public required ImmutableArray<HeldTrait> Traits { get; init; }

    /// <summary>
    /// Content ids of the heroes who have already accepted this contract,
    /// keyed by their runtime id — the only way the rule can match
    /// <see cref="ContractState.AcceptedBy"/> against relationships, which are
    /// authored against content ids.
    /// </summary>
    public required ImmutableSortedDictionary<HeroId, ContentId> Crew { get; init; }

    public required ulong CampaignSeed { get; init; }

    public required ulong DecisionOrdinal { get; init; }

    public required long TraceId { get; init; }
}
