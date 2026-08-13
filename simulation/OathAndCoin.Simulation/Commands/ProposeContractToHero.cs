using OathAndCoin.Simulation.Ids;

namespace OathAndCoin.Simulation.Commands;

/// <summary>
/// Offer a contract to one hero and let the hero decide (DEC-001: the player
/// proposes, heroes choose — there is no command that makes a hero accept).
/// </summary>
/// <param name="CommandId">
/// Identifies this command for the campaign's lifetime. Recorded in
/// <see cref="State.GameState.AppliedCommandIds"/> when the command is
/// applied, and re-applying the same id is refused — the same proposal
/// arriving twice (a retried UI action, a replayed log) must not produce two
/// decisions.
/// </param>
/// <param name="HeroId">The hero being asked.</param>
/// <param name="ContractId">The contract being offered.</param>
/// <param name="ExpectedStateVersion">
/// The <see cref="State.GameMetadata.StateVersion"/> this command was composed
/// against. A mismatch means the campaign moved on since — the offer the
/// sender was looking at is not the offer that exists now — and the command is
/// rejected rather than applied to a state it was never meant for.
/// </param>
public sealed record ProposeContractToHero(
    long CommandId,
    HeroId HeroId,
    ContentId ContractId,
    long ExpectedStateVersion);
